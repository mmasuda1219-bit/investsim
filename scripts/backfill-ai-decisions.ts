// 現存する AI の判断を ai_decisions（supabase/migrations/0008_ai_decisions.sql）へ救出する1回きりのスクリプト（S0・2026-09-25）。
//
// 実行:
//   npx tsx scripts/backfill-ai-decisions.ts                  ← 既定は dry-run。何も書かず、件数と最古・最新の日付だけ出す
//   npx tsx scripts/backfill-ai-decisions.ts --write --yes    ← 実際に書く。on conflict (id) do nothing なので何度流しても増えない
//                                                                （--write だけでは書かない。接続先を出して exit 1）
// 前提: .env.local（または環境変数）に NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY。0008 が実行済みであること。
//       どちらの Supabase（本番／ローカル）を向くかは環境変数で決まる。本番へ書く前に必ず dry-run を見ること。
//
// 何をするか:
//   1. ai_sessions の全行（AISession の blob）を読む
//   2. 各セッションの session.decisions（AIDecision・上限200・銘柄名/前日比/見出し/知識/tick を持つ）と
//      learning.allDecisions（DecisionRecord・上限1500・timestamp を持つが名前や見出しは持たない）を合わせる
//   3. 同じ判断が両方にあれば1件にする（重複排除）。両者の時刻は同じ tick でも数秒ずれる（AIDecision.decidedAt は AI の
//      返事を受け取った時刻、DecisionRecord.timestamp は約定処理に入った時刻＝engine.ts の executeTrades）ので、
//      「同じ symbol・同じ reasoning・時刻の差が MATCH_WINDOW_MS 以内で最も近い、まだ誰にも取られていない（未 claimed）
//      学習メモリの候補」を同じ判断とみなす。取られた候補は次の blob 判断の照合先にしない＝2分差で2回 tick が回った
//      同銘柄の判断（reasoning が同じ・'' でも）は2行のまま（1行に潰れない）。
//      学習メモリの中での重複は (symbol, timestamp) の完全一致だけを1件にする（同じ tick に同じ銘柄が2件出ることは無い）。
//      2026-09-11（4a）より前の AIDecision は decidedAt を持たないので、同じ symbol・reasoning の未 claimed な
//      DecisionRecord がちょうど1件あればその timestamp を借りる。見つからない／複数ある（どれか決められない）なら
//      「時刻不明」で見送る（時刻を作らない・原則9）。
//   4. すでに ai_decisions にある判断は除く。まず id の完全一致、次に「同じ symbol・reasoning・MATCH_WINDOW_MS 以内で
//      最も近い、まだ他の候補に当たっていない既存行」（学習メモリだけに残った判断＝id が timestamp 由来を、tick が書いた
//      id が decidedAt 由来の既存行と突き合わせるため）。既存行1本は候補1件にしか当たらない
//   5. dry-run なら件数と最古・最新を出して終わる。--write --yes なら 200件ずつ upsert（ignoreDuplicates）で入れ、前後の件数を出す
//
// 注意: lib/supabase/admin.ts は `import 'server-only'` のため tsx から読めない。scripts/seed-sessions.ts と同じく
//       自前で service-role クライアントを作る（anon では書かない）。行の形は lib/ai-trader/decision-store.ts の
//       toDecisionRow で作る（tick 中の追記と同じ関数＝同じ id・同じ列）。
import fs from 'fs'
import path from 'path'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { toDecisionRow, AI_DECISIONS_TABLE, AI_DECISION_ACTIONS, MISSING_TABLE_CODES, type AIDecisionRow, type DecisionInput } from '../lib/ai-trader/decision-store'
import { decisionIdFor } from '../lib/ai-trader/tick-record'
import type { AISession, AIDecision } from '../lib/ai-trader/engine'
import type { DecisionRecord } from '../lib/ai-trader/memory'

/** 同じ判断とみなす時刻の差の上限。同じ tick の decidedAt と timestamp のずれは通常数秒（知識の使用記録の await を挟むだけ） */
export const MATCH_WINDOW_MS = 10 * 60 * 1000
const WRITE_CHUNK = 200

// ── 純粋な計画づくり（検査 scripts/check-ai-decisions.ts から呼ぶ。通信しない） ──────────────────────────

/** 救出候補1件。source は出所（両方 / blob だけ / 学習メモリだけ） */
export interface Candidate {
  sessionId: string
  symbol: string
  reasoning: string
  /** decided_at にする時刻（ISO）。AIDecision.decidedAt があればそれ、無ければ DecisionRecord.timestamp */
  at: string
  input: DecisionInput
  source: 'both' | 'blob' | 'memory'
  /**
   * blob の判断に一度取られた（または blob 由来で最初から確定している）候補。true の候補は次の blob 判断の照合先
   * （nearest / 借りる相手）にしない。これが無いと、同じ symbol・reasoning の別 tick の判断（2分差など）が1行に潰れる。
   */
  claimed: boolean
}

export interface BackfillPlan {
  sessions: Array<{ id: string; decisions: number; withDecidedAt: number; allDecisions: number }>
  /** 重複排除後・既存分を除く前 */
  merged: Candidate[]
  /** 実際に書く行（既存分を除いたもの・decided_at 昇順） */
  rows: AIDecisionRow[]
  counts: {
    both: number; blobOnly: number; memoryOnly: number
    noTime: number; badAction: number; alreadyStored: number
  }
  oldest: string | null
  newest: string | null
}

/** 既に表にある行の照合に使う最小の形 */
export type ExistingRow = { id: string; symbol: string; reasoning: string | null; decided_at: string }

const isAction = (v: unknown): v is AIDecision['action'] => (AI_DECISION_ACTIONS as readonly unknown[]).includes(v)
const parseMs = (iso: unknown): number | null => {
  if (typeof iso !== 'string') return null
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : null
}
const matchKey = (symbol: string, reasoning: string) => `${symbol}\u0000${reasoning.trim()}`

/**
 * (symbol, reasoning) → その組の判断の時刻の一覧。時刻の近さで「同じ判断」を探す。
 * claimed: true の項目は「もう別の判断に当たった」ので、nearest / all のどちらからも外す（1項目は1判断にしか当たらない）。
 */
class MatchIndex<T extends { at: string; claimed?: boolean }> {
  private map = new Map<string, T[]>()
  add(symbol: string, reasoning: string, item: T) {
    const k = matchKey(symbol, reasoning)
    const list = this.map.get(k)
    if (list) list.push(item)
    else this.map.set(k, [item])
  }
  /** 未 claimed のうち、時刻が窓の内側で最も近い1件（無ければ undefined） */
  nearest(symbol: string, reasoning: string, atMs: number): T | undefined {
    let best: T | undefined
    let bestGap = Infinity
    for (const item of this.map.get(matchKey(symbol, reasoning)) ?? []) {
      if (item.claimed) continue
      const ms = parseMs(item.at)
      if (ms == null) continue
      const gap = Math.abs(ms - atMs)
      if (gap <= MATCH_WINDOW_MS && gap < bestGap) { best = item; bestGap = gap }
    }
    return best
  }
  /** 時刻が分からない判断のために、その組の未 claimed な候補をすべて返す（ちょうど1件なら借りられる） */
  all(symbol: string, reasoning: string): T[] {
    return (this.map.get(matchKey(symbol, reasoning)) ?? []).filter(item => !item.claimed)
  }
}

function recordToInput(r: DecisionRecord): DecisionInput {
  return {
    symbol: r.symbol, action: r.action, price: r.price, reasoning: r.reasoning,
    confidence: r.confidence, technicals: r.technicals, fundamentals: r.fundamentals,
    // DecisionRecord は見出しを newsHeadlines に持つ（AIDecision.news と同じ中身）
    news: Array.isArray(r.newsHeadlines) ? r.newsHeadlines : undefined,
  }
}

/** AIDecision の項目で DecisionRecord 由来の入力を上書きする（AIDecision の方が情報が多い） */
function overlay(base: DecisionInput, d: AIDecision): DecisionInput {
  return {
    ...base,
    symbol: d.symbol, action: d.action, price: d.price, reasoning: d.reasoning,
    confidence: d.confidence, technicals: d.technicals, fundamentals: d.fundamentals,
    name: d.name, change: d.change, news: Array.isArray(d.news) ? d.news : base.news,
    knowledgeRefs: d.knowledgeRefs, tickId: d.tickId,
  }
}

/**
 * セッション群と既存行から、書くべき行を決める（純関数・通信しない）。
 * 手順は冒頭の注釈 2〜4。時刻を作らない・action が不正な判断は入れない（表の check 制約で弾かれる前にここで見送る）。
 */
export function planBackfill(sessions: AISession[], existing: ExistingRow[]): BackfillPlan {
  const counts = { both: 0, blobOnly: 0, memoryOnly: 0, noTime: 0, badAction: 0, alreadyStored: 0 }
  const merged: Candidate[] = []
  const summary: BackfillPlan['sessions'] = []

  for (const session of sessions) {
    const decisions: AIDecision[] = Array.isArray(session.decisions) ? session.decisions : []
    const records: DecisionRecord[] = Array.isArray(session.learning?.allDecisions) ? session.learning.allDecisions : []
    summary.push({
      id: session.id, decisions: decisions.length,
      withDecidedAt: decisions.filter(d => parseMs(d.decidedAt) != null).length,
      allDecisions: records.length,
    })

    // (a) 学習メモリ（全件に時刻がある）を土台にする。メモリの中の重複は (symbol, timestamp) の完全一致だけ
    //     （同じ tick に同じ銘柄が2件出ることは無いので、10分窓で寄せると別 tick の判断まで1件に潰れる）
    const index = new MatchIndex<Candidate>()
    const seenExact = new Set<string>()
    for (const r of records) {
      if (!isAction(r.action)) { counts.badAction++; continue }
      const ms = parseMs(r.timestamp)
      if (ms == null) { counts.noTime++; continue }
      const exactKey = decisionIdFor(r.symbol, r.timestamp)
      if (seenExact.has(exactKey)) continue
      seenExact.add(exactKey)
      const c: Candidate = { sessionId: session.id, symbol: r.symbol, reasoning: r.reasoning ?? '', at: r.timestamp, input: recordToInput(r), source: 'memory', claimed: false }
      index.add(r.symbol, c.reasoning, c)
      merged.push(c)
    }

    // (b) blob の判断（情報が多い）を重ねる。時刻があれば「未 claimed で最も近い1件」へ（取ったら claimed）、
    //     無ければ (symbol, reasoning) の未 claimed がちょうど1件のときだけ借りる（借りたら claimed）。
    //     照合先が無ければ blob 由来の新しい候補（最初から claimed＝別の blob 判断はここに重ねない）
    for (const d of decisions) {
      if (!isAction(d.action)) { counts.badAction++; continue }
      const reasoning = d.reasoning ?? ''
      const ms = parseMs(d.decidedAt)
      if (ms != null) {
        const hit = index.nearest(d.symbol, reasoning, ms)
        if (hit) {
          hit.input = overlay(hit.input, d)
          hit.at = d.decidedAt as string   // id と decided_at は decidedAt（tick の decisionIds と同じ鍵）を優先
          hit.source = 'both'
          hit.claimed = true
        } else {
          const c: Candidate = { sessionId: session.id, symbol: d.symbol, reasoning, at: d.decidedAt as string, input: overlay(recordToInput({ ...d, id: '', timestamp: d.decidedAt as string, newsHeadlines: d.news }), d), source: 'blob', claimed: true }
          index.add(d.symbol, reasoning, c)
          merged.push(c)
        }
        continue
      }
      const same = index.all(d.symbol, reasoning)
      if (same.length === 1) {
        same[0].input = overlay(same[0].input, d)
        same[0].source = 'both'
        same[0].claimed = true
      } else {
        counts.noTime++   // 借りられる時刻が無い（0件）か、どれか決められない（2件以上）
      }
    }
  }

  for (const c of merged) {
    if (c.source === 'both') counts.both++
    else if (c.source === 'blob') counts.blobOnly++
    else counts.memoryOnly++
  }

  // (c) 既に表にある分を除く。既存行1本は候補1件にしか当たらない（claimed）。先に id の完全一致を全部確定させてから、
  //     残りを「同じ symbol・reasoning・窓の内側で最も近い未 claimed の既存行」で照合する（順序で結果が変わらないように）
  type ExistingItem = { at: string; claimed: boolean }
  const existingById = new Map<string, ExistingItem>()
  const existingIndex = new MatchIndex<ExistingItem>()
  for (const e of existing) {
    const item: ExistingItem = { at: e.decided_at, claimed: false }
    existingById.set(e.id, item)
    existingIndex.add(e.symbol, e.reasoning ?? '', item)
  }
  const storedById = new Set<Candidate>()
  for (const c of merged) {
    const hit = existingById.get(decisionIdFor(c.symbol, c.at))
    if (hit && !hit.claimed) { hit.claimed = true; storedById.add(c) }
  }

  // 残りを「同じ symbol・reasoning・窓の内側」で既存行と照合する。候補ごとに「いちばん近い既存行」を先着順で
  // 取る形だと、遠い候補が先に既存行を奪って近い候補のほうが書かれてしまう（候補の並び順で結果が変わる。
  // 2026-09-28 に検査 (16c) で実測: メモリだけの2件と既存行 sym@T1 で、3秒差の T1m でなく2分差の T2m が既存扱いになった）。
  // → 窓の内側の全組を「差の小さい順」に並べ、候補・既存行の両方が未 claimed の組から確定する（並び順に依らない）。
  const pairs: Array<{ c: Candidate; e: ExistingItem; gap: number }> = []
  for (const c of merged) {
    if (storedById.has(c)) continue
    const ms = parseMs(c.at) as number
    for (const e of existingIndex.all(c.symbol, c.reasoning)) {
      const ems = parseMs(e.at)
      if (ems == null) continue
      const gap = Math.abs(ems - ms)
      if (gap <= MATCH_WINDOW_MS) pairs.push({ c, e, gap })
    }
  }
  pairs.sort((a, b) => a.gap - b.gap)
  const storedByNear = new Set<Candidate>()
  for (const p of pairs) {
    if (p.e.claimed || storedByNear.has(p.c)) continue
    p.e.claimed = true
    storedByNear.add(p.c)
  }

  const rows: AIDecisionRow[] = []
  for (const c of merged) {
    if (storedById.has(c) || storedByNear.has(c)) { counts.alreadyStored++; continue }
    rows.push(toDecisionRow(c.sessionId, c.input, c.at))
  }
  rows.sort((a, b) => Date.parse(a.decided_at) - Date.parse(b.decided_at))

  return {
    sessions: summary, merged, rows, counts,
    oldest: rows.length ? rows[0].decided_at : null,
    newest: rows.length ? rows[rows.length - 1].decided_at : null,
  }
}

// ── 実行（通信する部分） ─────────────────────────────────────────────────────────────

// .env.local を手動ロード（dotenv非依存・既存の環境変数は上書きしない）。scripts/seed-sessions.ts と同じ
function loadEnvLocal() {
  const envPath = path.join(process.cwd(), '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!m) continue
    const key = m[1]
    let value = m[2].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
}

async function readAllSessions(supabase: SupabaseClient): Promise<AISession[]> {
  const { data, error } = await supabase.from('ai_sessions').select('id, data')
  if (error) throw new Error(`ai_sessions を読めません: ${error.message}`)
  return (data ?? []).map(row => row.data as AISession)
}

async function readExisting(supabase: SupabaseClient): Promise<ExistingRow[]> {
  const out: ExistingRow[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    // 並びは (decided_at, id) で決定的にする。同じ tick の判断は全件同時刻なので、decided_at だけだと 1000 件の境界を
    // 同時刻の塊が跨いだとき並びが安定せず、取りこぼし（→ 二重の入口）が起こりうる
    const { data, error } = await supabase
      .from(AI_DECISIONS_TABLE)
      .select('id, symbol, reasoning, decided_at')
      .order('decided_at', { ascending: true }).order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) {
      if (MISSING_TABLE_CODES.has(error.code ?? '')) throw new Error(`表 ${AI_DECISIONS_TABLE} がありません（${error.code}）。先に supabase/migrations/0008_ai_decisions.sql を Supabase の SQL Editor で実行してください`)
      throw new Error(`${AI_DECISIONS_TABLE} を読めません: ${error.message}`)
    }
    const rows = (data ?? []) as ExistingRow[]
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

async function countRows(supabase: SupabaseClient): Promise<number> {
  const { count, error } = await supabase.from(AI_DECISIONS_TABLE).select('id', { count: 'exact', head: true })
  if (error) throw new Error(`${AI_DECISIONS_TABLE} の件数を読めません: ${error.message}`)
  return count ?? 0
}

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '—')

async function main() {
  const write = process.argv.includes('--write')
  const yes = process.argv.includes('--yes')
  const dryRun = !write
  loadEnvLocal()

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    console.error('NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください（.env.local か環境変数）')
    process.exit(1)
  }
  // 書くときは --yes も要る（接続先を見て、本当にその Supabase へ書いてよいか確かめてから）
  if (write && !yes) {
    console.error(`本番に書くには --write --yes を付けてください（接続先: ${url}）。--write だけでは書きません。`)
    process.exit(1)
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })
  console.log(`${dryRun ? '[dry-run]' : '[write]'} 接続先: ${url}`)

  const sessions = await readAllSessions(supabase)
  const existing = await readExisting(supabase)
  const plan = planBackfill(sessions, existing)

  console.log(`ai_sessions: ${sessions.length} セッション`)
  for (const s of plan.sessions) {
    console.log(`  ${s.id}: decisions ${s.decisions}（decidedAt あり ${s.withDecidedAt}）／ learning.allDecisions ${s.allDecisions}`)
  }
  const c = plan.counts
  console.log(`候補（重複排除後）: ${plan.merged.length} 件`)
  console.log(`  内訳: blob と学習メモリの両方 ${c.both} ／ blob だけ ${c.blobOnly} ／ 学習メモリだけ ${c.memoryOnly}`)
  console.log(`  見送り: 時刻不明 ${c.noTime} ／ action 不正 ${c.badAction}`)
  console.log(`既に ${AI_DECISIONS_TABLE} にある: ${c.alreadyStored} 件（表の現在: ${existing.length} 件）`)
  console.log(`書き込む予定: ${plan.rows.length} 件  最古 ${plan.oldest ?? '—'}（${day(plan.oldest)}）  最新 ${plan.newest ?? '—'}（${day(plan.newest)}）`)

  if (dryRun) {
    console.log('dry-run のため書き込んでいません。書くには --write --yes を付けて再実行してください。')
    return
  }
  if (plan.rows.length === 0) {
    console.log('書くものがありません。')
    return
  }

  const before = await countRows(supabase)
  for (let i = 0; i < plan.rows.length; i += WRITE_CHUNK) {
    const chunk = plan.rows.slice(i, i + WRITE_CHUNK)
    // on conflict (id) do nothing（既にある id は飛ばす。更新しない＝追記だけ）
    const { error } = await supabase.from(AI_DECISIONS_TABLE).upsert(chunk, { onConflict: 'id', ignoreDuplicates: true })
    if (error) {
      console.error(`書き込みに失敗（${i + 1}〜${i + chunk.length} 件目）: ${error.message}`)
      process.exit(1)
    }
    console.log(`  書き込み ${Math.min(i + WRITE_CHUNK, plan.rows.length)} / ${plan.rows.length}`)
  }
  const after = await countRows(supabase)
  console.log(`完了: 表の件数 ${before} → ${after}（+${after - before}）`)
}

// tsx から直接実行したときだけ動く（検査からは planBackfill だけを import する）
if (require.main === module) {
  main().catch(e => {
    console.error(e instanceof Error ? e.message : String(e))
    process.exit(1)
  })
}
