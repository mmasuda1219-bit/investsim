// AIの判断を「1件1行・追記だけ」で保管する層（S0・2026-09-25）。表は supabase/migrations/0008_ai_decisions.sql。
//
// なぜ要るか: ai_sessions は AISession の JSONB blob を丸ごと上書き保存する（./store.ts の upsertSession）。判断は
// session.decisions（上限200・engine.ts）と learning.allDecisions（上限1500・memory.ts）にしか無く、溢れた分は履歴にも
// 残らず消える。「まねる」のお手本を自サイトのAI判断から作る（DECISIONS.md 2026-09-24）ので、消えない控えをここに取る。
//
// 約束:
//   * 追記だけ。id（decisionIdFor(symbol, decidedAt) ＝ AISession.ticks[].decisionIds と同じ鍵）が重複したら何もしない
//     （SQL の on conflict (id) do nothing。supabase-js では upsert の { onConflict: 'id', ignoreDuplicates: true } がそれ）。
//   * 失敗しても throw しない。tick（engine.ts の runTick）を「控え」の都合で落とさない。console.error を1行だけ出して
//     結果は戻り値で返す。表が未作成（0008 未実行）でも同じ。
//   * APPEND_TIMEOUT_MS で打ち切る（cron の 50秒枠を控えの保存で食わない。engine.ts の FAILED_TICK_SAVE_TIMEOUT_MS と同じ考え方）。
//   * service-role が無ければ何もしない（./store.ts と同じ hasServiceRole() の分岐。ローカルのファイル store に控えは取らない）。
//   * blob（ai_sessions）の保存には触らない。/watch と /api/ai-session は今までどおり。
//   * 控えは最終の upsertSession より先に書くので、blob の保存に失敗した tick の判断も控えに残る（その tick_id は
//     session.ticks に無い）。控えを読む側はこの食い違いを異常とみなさないこと。
//   * action が許可値（AI_DECISION_ACTIONS）でない判断は控えから除外し、銘柄と値を console.error に出す（黙って落とさない）。
//     engine.ts は AI の返事の action をそのまま通すので、1件でも混じると表の check 制約で1バッチの upsert 全体が落ち、
//     同じ tick の他の判断まで控えに残らなくなる。それを防ぐための最後の砦。
//
// '@/lib/supabase/admin' は `import 'server-only'` を含み、静的 import すると tsx（scripts/backfill-ai-decisions.ts・
// scripts/check-ai-decisions.ts）から読めなくなる。lib/screen/cache.ts と同じく hasServiceRole() は '@/lib/supabase/env'
// から読み、getAdminClient() は実際に Supabase 経路へ入る時だけ動的 import する。
import { hasServiceRole } from '@/lib/supabase/env'
import { decisionIdFor } from './tick-record'
import type { AIDecision } from './engine'

export const AI_DECISIONS_TABLE = 'ai_decisions'
/** 控えの保存に許す時間。超えたら諦めて tick を進める（保存できなかったことは console.error に残る）。 */
export const APPEND_TIMEOUT_MS = 5_000
/** action の許可値（表の check 制約と同じ）。GET /api/ai-decisions の絞り込みの検証にも使う。 */
export const AI_DECISION_ACTIONS = ['buy', 'sell', 'hold', 'watch'] as const
export type AIDecisionAction = (typeof AI_DECISION_ACTIONS)[number]
/**
 * 「表が無い」（0008 未実行）のときに Supabase が返すエラーコード。両方を受ける。
 *   42P01    … PostgreSQL の undefined_table（PostgREST 12.1 以前はこれをそのまま返した）
 *   PGRST205 … PostgREST 12.2 以降がスキーマキャッシュに無い表に返すコード（HTTP 404）
 * route（GET /api/ai-decisions の 503 分岐）と scripts/backfill-ai-decisions.ts の readExisting が使う。
 */
export const MISSING_TABLE_CODES: ReadonlySet<string> = new Set(['42P01', 'PGRST205'])

const isAllowedAction = (v: unknown): v is AIDecisionAction => (AI_DECISION_ACTIONS as readonly unknown[]).includes(v)

/** ai_decisions の1行（列名は SQL と同じ snake_case。inserted_at は DB が埋める）。 */
export interface AIDecisionRow {
  id: string
  session_id: string
  symbol: string
  name: string | null
  action: AIDecisionAction
  price: number | null
  change: number | null
  reasoning: string | null
  confidence: string | null
  technicals: string | null
  fundamentals: string | null
  news: string | null
  knowledge_refs: Array<{ id: string; title: string }> | null
  tick_id: string | null
  decided_at: string
}

/**
 * 行にするのに要る最小の形。AIDecision はそのまま渡せる。学習メモリの DecisionRecord（name・change・news 等を持たない）
 * から起こす場合（scripts/backfill-ai-decisions.ts）は、無い項目を省いて渡す（null で入る。作らない・原則9）。
 */
export type DecisionInput =
  Pick<AIDecision, 'symbol' | 'action' | 'price' | 'reasoning' | 'confidence' | 'technicals' | 'fundamentals'> &
  Partial<Pick<AIDecision, 'name' | 'change' | 'news' | 'knowledgeRefs' | 'tickId'>>

export type AppendResult =
  | { skipped: true; reason: 'no-service-role' | 'empty' }
  | { skipped: false; ok: true; attempted: number }
  | { skipped: false; ok: false; attempted: number; error: string }

const finiteOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const textOrNull = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null)

/** 見出しの配列 → 1行1本のテキスト（列 news は text）。空なら null。 */
export function newsToText(news: unknown): string | null {
  if (!Array.isArray(news)) return null
  const lines = news.filter((n): n is string => typeof n === 'string').map(n => n.replace(/\r?\n/g, ' ').trim()).filter(Boolean)
  return lines.length ? lines.join('\n') : null
}

/** newsToText の逆。API の応答で AIDecision.news と同じ string[] に戻す。 */
export function newsFromText(text: unknown): string[] {
  if (typeof text !== 'string' || text === '') return []
  return text.split('\n').filter(Boolean)
}

/** 判断1件 → ai_decisions の1行（純関数）。decidedAt は id と decided_at の両方に使う。 */
export function toDecisionRow(sessionId: string, d: DecisionInput, decidedAt: string): AIDecisionRow {
  const refs = Array.isArray(d.knowledgeRefs)
    ? d.knowledgeRefs.filter(r => r && typeof r.id === 'string').map(r => ({ id: r.id, title: typeof r.title === 'string' ? r.title : '' }))
    : []
  return {
    id: decisionIdFor(d.symbol, decidedAt),
    session_id: sessionId,
    symbol: d.symbol,
    name: textOrNull(d.name),
    action: d.action,
    price: finiteOrNull(d.price),
    change: finiteOrNull(d.change),
    reasoning: textOrNull(d.reasoning),
    confidence: textOrNull(d.confidence),
    technicals: textOrNull(d.technicals),
    fundamentals: textOrNull(d.fundamentals),
    news: newsToText(d.news),
    knowledge_refs: refs.length ? refs : null,
    tick_id: textOrNull(d.tickId),
    decided_at: decidedAt,
  }
}

/**
 * tick の判断を ai_decisions へ追記する。engine.ts の runTick から1回だけ呼ばれる。
 *
 * 投げない。service-role 無し・0件は skipped、保存の失敗（表が無い・通信・タイムアウト）は ok:false で返し、
 * console.error を1行だけ出す。呼び出し側は戻り値を見なくてよい（tick を落とさないため）。
 */
/**
 * admin クライアントの読み込み方（テスト用の差し込み口）。製品コードは既定の動的 import をそのまま使う。
 * scripts/check-ai-decisions.ts だけが「読み込み自体が失敗する」経路を作るために差し替える。
 * 理由: 検査は route.ts を静的 import しており、その先で admin.ts が先に読み込まれてキャッシュされるため、
 * Module._load の差し替えでは動的 import の失敗を再現できない（2026-09-28 実測）。
 */
export const adminLoader = { load: () => import('@/lib/supabase/admin') }

export async function appendDecisions(sessionId: string, decisions: AIDecision[], decidedAt: string): Promise<AppendResult> {
  if (!hasServiceRole()) return { skipped: true, reason: 'no-service-role' }
  // action が許可値でない判断は除外する（1件混じると check 制約で1バッチ全体が落ち、同 tick の他の判断も残らないため）。
  // 除外は黙って行わず、銘柄と値を1件1行で console.error に出す。
  const valid = decisions.filter(d => {
    if (isAllowedAction(d.action)) return true
    console.error(`[ai-decisions] action が許可値でないため控えから除外: ${String(d.symbol)}="${String(d.action)}"`)
    return false
  })
  if (valid.length === 0) return { skipped: true, reason: 'empty' }
  const attempted = valid.length
  try {
    // 行の組み立ても try の内側（toDecisionRow が将来投げるようになっても tick に届かせない）
    const rows = valid.map(d => toDecisionRow(sessionId, d, decidedAt))
    const { getAdminClient } = await adminLoader.load()
    const { error } = await getAdminClient()
      .from(AI_DECISIONS_TABLE)
      // on conflict (id) do nothing（既にある id は黙って飛ばす。更新はしない＝追記だけ）
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
      .abortSignal(AbortSignal.timeout(APPEND_TIMEOUT_MS))
    if (error) {
      console.error(`[ai-decisions] 判断の控えを保存できなかった（tick は続行・${attempted}件）: ${error.message}`)
      return { skipped: false, ok: false, attempted, error: error.message }
    }
    return { skipped: false, ok: true, attempted }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error(`[ai-decisions] 判断の控えを保存できなかった（tick は続行・${attempted}件）: ${message}`)
    return { skipped: false, ok: false, attempted, error: message }
  }
}
