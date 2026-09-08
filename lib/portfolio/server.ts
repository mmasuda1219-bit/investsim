// ポートフォリオのサーバー側I/O。アカウント化の第2段。
//
// これまで lib/portfolio.ts がブラウザの localStorage で «判定も保存も» 行っていた。
// 判定をサーバーへ移す（オーナー決定・2026-09-03）。ブラウザ側で計算した結果を受け取る
// 作りにすると、送信内容を書き換えるだけで残高を好きな数字にできてしまい、
// 「自分の判断の質を振り返る」という製品の芯（原則11）が意味を失うため。
//
// 売買の実体は supabase/migrations/0006 の execute_trade 関数。現金・持ち株・取引記録を
// 1トランザクションで更新する。ここはその呼び出しと読み出しに徹し、ルールを二重に持たない
// （TypeScript側にも残高チェックを書くと、2つの実装が必ずいつか食い違う）。
//
// 保存先の分岐（Supabase / ローカルJSON）は持たない。ポートフォリオは auth.users に
// 紐づくデータで、認証が無いローカルではそもそも持ち主が決まらないため。
import 'server-only'
import { getAdminClient } from '@/lib/supabase/admin'
import type { Portfolio, Position, Trade } from '@/lib/portfolio'

export const INITIAL_CASH = 100_000

export type TradeErrorCode =
  | 'insufficient_cash'
  | 'insufficient_shares'
  | 'bad_input'

export type ExecuteResult =
  | { ok: true; portfolio: Portfolio; tradeId: string }
  | { ok: false; code: TradeErrorCode }

type TradeRow = {
  id: string
  executed_at: string
  symbol: string
  name: string
  action: 'buy' | 'sell'
  shares: number | string
  price: number | string
  reason: string | null
  /** migration 0007 以前の行には無い。null は練習場の売買とみなす。 */
  source: 'practice' | 'past' | null
}

/**
 * numeric は桁落ちを避けるため PostgREST から文字列で返ることがある。
 * 画面と既存の型（number）に合わせてここで一度だけ数値へ寄せる。
 */
function num(v: number | string | null | undefined): number {
  if (typeof v === 'number') return v
  const n = Number(v ?? 0)
  return Number.isFinite(n) ? n : 0
}

function tradeFromRow(r: TradeRow): Trade {
  return {
    id: r.id,
    timestamp: Date.parse(r.executed_at),
    symbol: r.symbol,
    name: r.name,
    action: r.action,
    shares: num(r.shares),
    price: num(r.price),
    ...(r.reason ? { reason: r.reason } : {}),
    source: r.source ?? 'practice',
  }
}

function normalizePositions(raw: unknown): Position[] {
  if (!Array.isArray(raw)) return []
  return raw.map((p) => {
    const o = p as Record<string, unknown>
    return {
      symbol: String(o.symbol ?? ''),
      name: String(o.name ?? ''),
      shares: num(o.shares as number | string),
      avgCost: num(o.avgCost as number | string),
    }
  })
}

/** その利用者の現金・持ち株・取引記録を返す。まだ1度も売買していなければ初期状態。 */
export async function getPortfolio(userId: string): Promise<Portfolio> {
  const client = getAdminClient()

  const [{ data: pf, error: pfErr }, { data: rows, error: trErr }] = await Promise.all([
    client.from('portfolios').select('cash, positions').eq('user_id', userId).maybeSingle(),
    client
      .from('trades')
      .select('id, executed_at, symbol, name, action, shares, price, reason, source')
      .eq('user_id', userId)
      .order('executed_at', { ascending: false })
      // 「振り返る」は直近を見る面。全件を無制限に返すと件数が増えたとき応答が重くなる。
      .limit(500),
  ])
  if (pfErr) throw new Error(`portfolios read failed: ${pfErr.message}`)
  if (trErr) throw new Error(`trades read failed: ${trErr.message}`)

  return {
    cash: pf ? num(pf.cash as number | string) : INITIAL_CASH,
    positions: pf ? normalizePositions(pf.positions) : [],
    trades: (rows ?? []).map((r) => tradeFromRow(r as TradeRow)),
  }
}

/**
 * 売買を1回実行する。残高・持ち株の判定はSQL関数側が行うので、ここでは判定しない。
 * 成立した場合は更新後のポートフォリオを返す（画面が再取得しなくて済むように）。
 */
export async function executeTrade(
  userId: string,
  input: {
    symbol: string
    name: string
    action: 'buy' | 'sell'
    shares: number
    price: number
    reason?: string
  },
): Promise<ExecuteResult> {
  const client = getAdminClient()
  const { data, error } = await client.rpc('execute_trade', {
    p_user_id: userId,
    p_symbol:  input.symbol,
    p_name:    input.name,
    p_action:  input.action,
    p_shares:  input.shares,
    p_price:   input.price,
    p_reason:  input.reason ?? null,
  })
  if (error) throw new Error(`execute_trade failed: ${error.message}`)

  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row.ok !== 'boolean') {
    throw new Error('execute_trade returned an unexpected shape')
  }
  if (!row.ok) {
    return { ok: false, code: (row.error_code ?? 'bad_input') as TradeErrorCode }
  }

  // 取引記録だけは関数の戻り値に含まれないので読み直す。
  const trades = (await getPortfolio(userId)).trades
  return {
    ok: true,
    tradeId: String(row.trade_id),
    portfolio: {
      cash: num(row.cash),
      positions: normalizePositions(row.positions),
      trades,
    },
  }
}

export type PastTradeErrorCode = 'bad_input' | 'future_date'

export type RecordPastResult =
  | { ok: true; portfolio: Portfolio; tradeId: string }
  | { ok: false; code: PastTradeErrorCode }

/**
 * 過去にやった取引を1件記録する（migration 0007 の record_past_trade）。
 *
 * **現金・持ち株は動かさない。** 練習場の売買ではなく «本人が実際にやったことの記録» で、
 * 今の残高で過去の取引の可否を判定するのは筋が通らないため（0007 のコメント参照）。
 */
export async function recordPastTrade(
  userId: string,
  input: {
    symbol: string
    name: string
    action: 'buy' | 'sell'
    shares: number
    price: number
    reason?: string
    /** ISO文字列。画面から来た YYYY-MM-DD をAPIルートで正午UTCに寄せてから渡す */
    executedAt: string
  },
): Promise<RecordPastResult> {
  const client = getAdminClient()
  const { data, error } = await client.rpc('record_past_trade', {
    p_user_id:     userId,
    p_symbol:      input.symbol,
    p_name:        input.name,
    p_action:      input.action,
    p_shares:      input.shares,
    p_price:       input.price,
    p_reason:      input.reason ?? null,
    p_executed_at: input.executedAt,
  })
  if (error) throw new Error(`record_past_trade failed: ${error.message}`)

  const row = Array.isArray(data) ? data[0] : data
  if (!row || typeof row.ok !== 'boolean') {
    throw new Error('record_past_trade returned an unexpected shape')
  }
  if (!row.ok) return { ok: false, code: (row.error_code ?? 'bad_input') as PastTradeErrorCode }

  return { ok: true, tradeId: String(row.trade_id), portfolio: await getPortfolio(userId) }
}

/** 記録した過去の取引を1件消す。練習場の売買は消えない（SQL側で source='past' に限定）。 */
export async function removePastTrade(userId: string, tradeId: string): Promise<boolean> {
  const client = getAdminClient()
  const { data, error } = await client.rpc('delete_past_trade', {
    p_user_id: userId,
    p_trade_id: tradeId,
  })
  if (error) throw new Error(`delete_past_trade failed: ${error.message}`)
  return data === true
}

/** 初期状態に戻す（現金・持ち株・練習場の取引記録）。過去の取引の記録は 0007 以降は消えない。 */
export async function resetPortfolio(userId: string): Promise<Portfolio> {
  const client = getAdminClient()
  const { error } = await client.rpc('reset_portfolio', { p_user_id: userId })
  if (error) throw new Error(`reset_portfolio failed: ${error.message}`)
  return { cash: INITIAL_CASH, positions: [], trades: [] }
}
