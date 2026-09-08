// ポートフォリオの «形» と、画面から呼ぶAPIクライアント。
//
// 2026-09-03 以前はこのファイルが localStorage を直接読み書きし、残高チェックなどの
// ルール判定もここ（ブラウザ内）で行っていた。アカウント化にあたり、保存先はDBへ、
// 判定はサーバーへ移した（オーナー決定・DECISIONS 2026-09-03）。
// 実体は lib/portfolio/server.ts と supabase/migrations/0006 の execute_trade。
//
// このファイルはブラウザ・サーバーの両方から読まれる（型と定数を共有するため）。
// 'use client' は付けない。fetch を使う関数は画面（クライアントコンポーネント）からのみ呼ぶこと。

export interface Position {
  symbol: string
  name: string
  shares: number
  avgCost: number    // average cost basis per share
}

export interface Trade {
  id: string
  timestamp: number
  symbol: string
  name: string
  action: 'buy' | 'sell'
  shares: number
  price: number      // price per share at execution
  /**
   * なぜそう判断したか（利用者の自由記述）。
   * 「振り返る」で判断の質を見るための素材。既存の保存データには存在しないため
   * 任意フィールドにしてある（形式互換を壊さない）。読む側は未設定を許容すること。
   */
  reason?: string
  /**
   * 練習場の売買か、本人が «あとから» 入力した過去の取引の記録か（migration 0007）。
   * 未設定は 'practice' とみなす（0007 以前に保存された行）。
   *
   * **表示側は必ず見分けを付けること。** 混ぜると「儲けた額」の集計に実際の取引が
   * 混ざり、どれが練習でどれが記録なのか本人にも分からなくなる。
   */
  source?: 'practice' | 'past'
}

export interface Portfolio {
  cash: number
  positions: Position[]
  trades: Trade[]
}

export const INITIAL_CASH = 100_000  // $100,000 starting capital

/**
 * 理由の最低文字数。/trade・TradeModal・APIの3か所で同じ値を使う。
 * 以前は3か所に別々のリテラルが書かれていた（片方だけ変えると入口ごとに規律が変わる）。
 */
export const MIN_REASON = 10

// ── 画面から呼ぶAPIクライアント ─────────────────────────────
export type LoadResult =
  | { status: 'ok'; portfolio: Portfolio }
  /** 未ログイン。「見るのは自由・保存はログイン」なのでエラーではなく通常の分岐。 */
  | { status: 'unauthenticated' }
  | { status: 'error'; message: string }

export type TradeResult =
  | { ok: true; portfolio: Portfolio }
  | { ok: false; message: string; unauthenticated?: boolean }

async function load(path: string, init?: RequestInit): Promise<LoadResult> {
  try {
    const res = await fetch(path, { cache: 'no-store', ...init })
    if (res.status === 401) return { status: 'unauthenticated' }
    if (!res.ok) return { status: 'error', message: '読み込めませんでした' }
    return { status: 'ok', portfolio: (await res.json()) as Portfolio }
  } catch {
    return { status: 'error', message: '通信できませんでした' }
  }
}

/** ログイン中の利用者の現金・持ち株・取引記録を取得する。 */
export function fetchPortfolio(): Promise<LoadResult> {
  return load('/api/portfolio')
}

/** 現金・持ち株・取引記録を初期状態に戻す。取り消せないので呼ぶ前に必ず確認を取ること。 */
export function requestReset(): Promise<LoadResult> {
  return load('/api/portfolio/reset', { method: 'POST' })
}

/**
 * 売買を1回実行する。残高・持ち株の判定はサーバーが行うので、ここでは投げるだけ。
 * 画面側で先に残高を判定して出し分けると、サーバーの判定と二重になっていつか食い違う。
 */
export async function submitTrade(input: {
  symbol: string
  name: string
  action: 'buy' | 'sell'
  shares: number
  price: number
  reason: string
}): Promise<TradeResult> {
  try {
    const res = await fetch('/api/portfolio/trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) {
      return { ok: false, unauthenticated: true, message: data.message ?? 'ログインすると売買の記録を残せます' }
    }
    if (!res.ok) return { ok: false, message: data.message ?? '記録できませんでした' }
    return { ok: true, portfolio: data.portfolio as Portfolio }
  } catch {
    return { ok: false, message: '通信できませんでした' }
  }
}

export type PastTradeResult =
  | { ok: true; portfolio: Portfolio }
  | { ok: false; message: string; unauthenticated?: boolean }

/**
 * 過去にやった取引を1件«記録»する。練習場の売買とは別物で、
 * **仮想の現金・持ち株は動かない**（migration 0007 の record_past_trade）。
 */
export async function submitPastTrade(input: {
  symbol: string
  name: string
  action: 'buy' | 'sell'
  shares: number
  price: number
  reason: string
  /** 本人が入力した過去の日付（YYYY-MM-DD） */
  executedOn: string
}): Promise<PastTradeResult> {
  try {
    const res = await fetch('/api/portfolio/past-trade', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) {
      return { ok: false, unauthenticated: true, message: data.message ?? 'ログインすると記録を残せます' }
    }
    if (!res.ok) return { ok: false, message: data.message ?? '記録できませんでした' }
    return { ok: true, portfolio: data.portfolio as Portfolio }
  } catch {
    return { ok: false, message: '通信できませんでした' }
  }
}

/** 記録した過去の取引を1件消す。練習場の売買は消せない。 */
export async function deletePastTrade(tradeId: string): Promise<PastTradeResult> {
  try {
    const res = await fetch(`/api/portfolio/past-trade?id=${encodeURIComponent(tradeId)}`, { method: 'DELETE' })
    const data = await res.json().catch(() => ({}))
    if (res.status === 401) {
      return { ok: false, unauthenticated: true, message: 'ログインが必要です' }
    }
    if (!res.ok) return { ok: false, message: data.message ?? '消せませんでした' }
    return { ok: true, portfolio: data.portfolio as Portfolio }
  } catch {
    return { ok: false, message: '通信できませんでした' }
  }
}

// ── 純関数（サーバー・クライアント共通）──────────────────────
export function getPortfolioValue(positions: Position[], prices: Record<string, number>): number {
  return positions.reduce((sum, pos) => sum + pos.shares * (prices[pos.symbol] ?? pos.avgCost), 0)
}
