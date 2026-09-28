import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient, hasServiceRole } from '@/lib/supabase/admin'
import {
  AI_DECISIONS_TABLE, AI_DECISION_ACTIONS, MISSING_TABLE_CODES, newsFromText,
  type AIDecisionRow, type AIDecisionAction,
} from '@/lib/ai-trader/decision-store'

export const runtime = 'nodejs'

// GET /api/ai-decisions — AIの判断の「消えない控え」（ai_decisions・supabase/migrations/0008_ai_decisions.sql）を読む。S0・2026-09-25。
//
// 読むのは誰でも（GET /api/ai-session と同じ。AIの判断は «サイトに1本» の公開記録で、個人のデータは含まない）。
// 書く経路はここには無い（追記は lib/ai-trader/decision-store.ts の appendDecisions だけ・tick の中から）。
//
// クエリ:
//   limit   … 件数。既定 20・最大 200（超えた分は 200 に丸める。数でなければ既定）
//   symbol  … 銘柄で絞る（例 AAPL・7203.T）
//   action  … buy | sell | hold | watch で絞る（それ以外は 400）
//   before  … この時刻より前（ISO 8601・decided_at < before）。ページ送りに使う。読めない時刻は 400
//   since   … この時刻以降（ISO 8601・decided_at >= since）
//
// 応答（3つの形）:
//   200: { count, oldest, newest, items: [{ id, sessionId, symbol, name, action, price, change, reasoning, confidence,
//          technicals, fundamentals, news: string[], knowledgeRefs, tickId, decidedAt, insertedAt }] }
//        count は表の «総件数»（絞り込みに依らない）・oldest/newest は decided_at の最小・最大（0件なら null）。
//        items は decided_at の新しい順。news は保存時の改行区切りを AIDecision.news と同じ string[] に戻す
//   503: { error: 'unavailable', message: '判断の保管庫が未設定です…' } … service-role 無し、または表が無い（0008 未実行。
//        Supabase が返すコードは 42P01 か PGRST205＝decision-store の MISSING_TABLE_CODES）
//   502: { error: 'read_failed', message } … Supabase が読めなかった（原因の英語はサーバーのログにだけ）
// すべて Cache-Control: no-store（控えは tick のたびに増える。CDN に古い件数を残さない）。検査: scripts/check-ai-decisions.ts

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 200
const NO_STORE = { 'Cache-Control': 'no-store' } as const
const UNAVAILABLE_MESSAGE = '判断の保管庫が未設定です（SUPABASE_SERVICE_ROLE_KEY と supabase/migrations/0008_ai_decisions.sql を確認してください）'
const READ_FAILED_MESSAGE = 'AIの判断の控えを読み込めませんでした'

type Item = {
  id: string
  sessionId: string
  symbol: string
  name: string | null
  action: AIDecisionAction
  price: number | null
  change: number | null
  reasoning: string | null
  confidence: string | null
  technicals: string | null
  fundamentals: string | null
  news: string[]
  knowledgeRefs: Array<{ id: string; title: string }> | null
  tickId: string | null
  decidedAt: string
  insertedAt: string | null
}
type StoredRow = AIDecisionRow & { inserted_at?: string | null }

function parseLimit(raw: string | null): number {
  const n = Number.parseInt(raw ?? '', 10)
  if (!Number.isFinite(n) || n < 1) return DEFAULT_LIMIT
  return Math.min(n, MAX_LIMIT)
}

/** ISO 8601 を検証して正規化する。無指定は null、読めない文字列は undefined（400 にする）。 */
function parseTime(raw: string | null): string | null | undefined {
  if (raw == null || raw.trim() === '') return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined
}

function isAction(v: string): v is AIDecisionAction {
  return (AI_DECISION_ACTIONS as readonly string[]).includes(v)
}

function toItem(r: StoredRow): Item {
  // numeric 列は文字列で返ることがある（PostgREST の既定）。数に戻し、読めなければ null（0 で埋めない）
  const num = (v: unknown): number | null => {
    if (v == null) return null
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : null
  }
  return {
    id: r.id,
    sessionId: r.session_id,
    symbol: r.symbol,
    name: r.name ?? null,
    action: r.action,
    price: num(r.price),
    change: num(r.change),
    reasoning: r.reasoning ?? null,
    confidence: r.confidence ?? null,
    technicals: r.technicals ?? null,
    fundamentals: r.fundamentals ?? null,
    news: newsFromText(r.news),
    knowledgeRefs: Array.isArray(r.knowledge_refs) ? r.knowledge_refs : null,
    tickId: r.tick_id ?? null,
    decidedAt: r.decided_at,
    insertedAt: r.inserted_at ?? null,
  }
}

function bad(message: string) {
  return NextResponse.json({ error: 'bad_request', message }, { status: 400, headers: NO_STORE })
}

export async function GET(req: NextRequest) {
  if (!hasServiceRole()) {
    return NextResponse.json({ error: 'unavailable', message: UNAVAILABLE_MESSAGE }, { status: 503, headers: NO_STORE })
  }

  const q = req.nextUrl.searchParams
  const limit = parseLimit(q.get('limit'))
  const symbol = (q.get('symbol') ?? '').trim()
  const actionRaw = (q.get('action') ?? '').trim()
  if (actionRaw !== '' && !isAction(actionRaw)) return bad(`action は ${AI_DECISION_ACTIONS.join(' | ')} のいずれか`)
  const before = parseTime(q.get('before'))
  if (before === undefined) return bad('before は ISO 8601 の時刻')
  const since = parseTime(q.get('since'))
  if (since === undefined) return bad('since は ISO 8601 の時刻')

  try {
    const client = getAdminClient()
    let items = client.from(AI_DECISIONS_TABLE).select('*').order('decided_at', { ascending: false }).limit(limit)
    if (symbol !== '') items = items.eq('symbol', symbol)
    if (actionRaw !== '') items = items.eq('action', actionRaw)
    if (before) items = items.lt('decided_at', before)
    if (since) items = items.gte('decided_at', since)

    const [total, oldest, newest, page] = await Promise.all([
      client.from(AI_DECISIONS_TABLE).select('id', { count: 'exact', head: true }),
      client.from(AI_DECISIONS_TABLE).select('decided_at').order('decided_at', { ascending: true }).limit(1).maybeSingle(),
      client.from(AI_DECISIONS_TABLE).select('decided_at').order('decided_at', { ascending: false }).limit(1).maybeSingle(),
      items,
    ])
    const failed = [total.error, oldest.error, newest.error, page.error].find(Boolean)
    if (failed) {
      if (MISSING_TABLE_CODES.has(failed.code ?? '')) {
        // 表が無い（42P01 か PGRST205）＝0008 未実行。「読めなかった」（502）ではなく「まだ用意されていない」（503）
        return NextResponse.json({ error: 'unavailable', message: UNAVAILABLE_MESSAGE }, { status: 503, headers: NO_STORE })
      }
      throw new Error(failed.message)
    }

    const rows = (page.data ?? []) as StoredRow[]
    return NextResponse.json({
      count: total.count ?? 0,
      oldest: (oldest.data as { decided_at: string } | null)?.decided_at ?? null,
      newest: (newest.data as { decided_at: string } | null)?.decided_at ?? null,
      items: rows.map(toItem),
    }, { headers: NO_STORE })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    // 原因の英語は画面に出さず、サーバーのログにだけ残す（app/api/ai-session/latest/route.ts と同じ流儀）
    console.error(`[api/ai-decisions] ${READ_FAILED_MESSAGE}: ${message}`)
    return NextResponse.json({ error: 'read_failed', message: READ_FAILED_MESSAGE }, { status: 502, headers: NO_STORE })
  }
}
