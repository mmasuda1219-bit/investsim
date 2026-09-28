// S0（2026-09-25）「AIの判断を1件1行・追記だけの表に移す」の検査。ネットワーク不要・Supabase に触らない。
//   $env:PATH = "C:\Program Files\nodejs;$env:PATH"; npx tsx scripts/check-ai-decisions.ts
//
// 見るもの:
//  A. supabase/migrations/0008_ai_decisions.sql … 列16本とその型／index 3本／RLS 有効・ポリシー無し／実行方法の注記／
//     更新・削除の文が無い（追記だけ）／0008 は ai_decisions だけ（0008_reason_readings は存在しない）
//  B. lib/ai-trader/decision-store.ts … 投げない（try/catch と console.error があり、実際に error を返されても・throw されても・
//     admin の動的 import が失敗しても呼び出し側に届かない）／service-role 無しは何もしない／on conflict do nothing
//     （ignoreDuplicates: true）／打ち切り付き／行の形（id は decisionIdFor と同じ・null で埋める・news は改行区切り・
//     knowledgeRefs にゴミが混ざっても落ちない）／action が許可値でない判断は除外して console.error（他の判断は残る）／
//     MISSING_TABLE_CODES（42P01 と PGRST205）
//  C. lib/ai-trader/engine.ts … appendDecisions を1回だけ・session.decisions の直後・await あり／upsertSession（blob）は残る／
//     上限 200（engine）と 1500（memory）は据え置き
//  D. app/api/ai-decisions/route.ts … GET だけ・認証なし・no-store／503（保管庫が未設定）／limit 既定20・最大200／
//     action・before・since の検証（400）／表が無い（42P01 と PGRST205 の両方）は 503・その他は 502／応答の形 { count, oldest, newest, items }
//  E. scripts/backfill-ai-decisions.ts … 既定は dry-run（--write --yes のときだけ書く）／service-role で書く／planBackfill の重複排除
//     （両方にある判断は1件・時刻は decidedAt を優先・時刻の無い判断は借りられるときだけ・既存分を除く・別 tick の判断は
//     潰れない＝claimed）／readExisting の並びは (decided_at, id)
//
// 差し替え: `server-only` → {}／`@supabase/supabase-js` → 記録するだけの偽クライアント／`@/lib/supabase/admin` → 同じ偽クライアント。
// globalThis.fetch は「呼ばれたら数えて失敗」に差し替え、最後に 0 回を確かめる。差し替えで返す値は検査用の合成値で、
// 製品コードには入れない（原則9の範囲内）。

delete process.env.NEXT_PUBLIC_SUPABASE_URL
delete process.env.SUPABASE_SERVICE_ROLE_KEY

import fs from 'fs'
import path from 'path'
import Module from 'module'
import type { AIDecision, AISession } from '../lib/ai-trader/engine'
import type { DecisionRecord } from '../lib/ai-trader/memory'
import { createLearningMemory } from '../lib/ai-trader/memory'
import { decisionIdFor } from '../lib/ai-trader/tick-record'
// decision-store の静的 import は純関数（env / tick-record）だけなので先頭で読んでよい（admin は呼ぶ時に動的 import）
import {
  toDecisionRow, newsToText, newsFromText, appendDecisions,
  AI_DECISIONS_TABLE, AI_DECISION_ACTIONS, APPEND_TIMEOUT_MS, MISSING_TABLE_CODES,
} from '../lib/ai-trader/decision-store'
// テスト用の差し込み口（admin の読み込み失敗を再現するため。B 節の S2 で使う）
import { adminLoader } from '../lib/ai-trader/decision-store'
import { planBackfill, MATCH_WINDOW_MS, type ExistingRow } from './backfill-ai-decisions'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS ${name}`)
  } else {
    failed++
    const d = detail.length > 400 ? `${detail.slice(0, 400)}…(${detail.length} 字)` : detail
    console.error(`  FAIL ${name}${d ? ` — ${d}` : ''}`)
  }
}

const ROOT = process.cwd()
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const j = (v: unknown) => JSON.stringify(v)
/** 注釈を落とす（注釈に書いた名前を「呼んでいる」と誤検知しないため）。文字列の中の // は残す */
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/[^\n]*/g, '$1')
const stripSqlComments = (s: string) => s.replace(/--[^\n]*/g, '')
const count = (s: string, re: RegExp) => (s.match(re) ?? []).length

// ── 通信の遮断 ──
const realFetch = globalThis.fetch
const fetchCalls: string[] = []
globalThis.fetch = (async (input: unknown) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
  fetchCalls.push(url)
  throw new Error(`検査中の通信は遮断: ${url}`)
}) as typeof fetch

// ── 偽の Supabase クライアント（呼ばれ方を記録し、状態に応じた結果を返す） ──
type Call = { method: string; args: unknown[] }
type DbError = { message: string; code?: string }
const db = {
  rows: [] as Record<string, unknown>[],
  total: 0,
  oldest: null as string | null,
  newest: null as string | null,
  error: null as DbError | null,        // 読み取りが返す error
  upsertError: null as DbError | null,  // upsert が返す error
  upsertThrows: null as Error | null,   // upsert が投げる
  upserts: [] as Array<{ table: string; rows: unknown[]; opts: unknown }>,
  queries: [] as FakeQuery[],
  clientsCreated: 0,
}
class FakeQuery {
  calls: Call[] = []
  private kind: 'select' | 'upsert' = 'select'
  private head = false
  private single = false
  private ascending = true
  constructor(public table: string) {}
  private rec(method: string, args: unknown[]) { this.calls.push({ method, args }); return this }
  select(cols: string, opts?: { count?: string; head?: boolean }) { if (opts?.head) this.head = true; return this.rec('select', [cols, opts]) }
  order(col: string, opts?: { ascending?: boolean }) { this.ascending = opts?.ascending !== false; return this.rec('order', [col, opts]) }
  limit(n: number) { return this.rec('limit', [n]) }
  eq(col: string, v: unknown) { return this.rec('eq', [col, v]) }
  lt(col: string, v: unknown) { return this.rec('lt', [col, v]) }
  gte(col: string, v: unknown) { return this.rec('gte', [col, v]) }
  range(a: number, b: number) { return this.rec('range', [a, b]) }
  maybeSingle() { this.single = true; return this.rec('maybeSingle', []) }
  upsert(rows: unknown[], opts: unknown) {
    this.kind = 'upsert'
    db.upserts.push({ table: this.table, rows, opts })
    this.rec('upsert', [rows, opts])
    if (db.upsertThrows) throw db.upsertThrows
    return this
  }
  abortSignal(sig: unknown) { return this.rec('abortSignal', [sig]) }
  has(method: string) { return this.calls.some(c => c.method === method) }
  arg(method: string) { return this.calls.find(c => c.method === method)?.args }
  private result() {
    if (this.kind === 'upsert') return { data: null, error: db.upsertError }
    if (db.error) return { data: null, error: db.error, count: null }
    if (this.head) return { data: null, error: null, count: db.total }
    if (this.single) {
      const at = this.ascending ? db.oldest : db.newest
      return { data: at ? { decided_at: at } : null, error: null }
    }
    return { data: db.rows, error: null }
  }
  then<T>(resolve: (v: unknown) => T, reject?: (e: unknown) => T) { return Promise.resolve(this.result()).then(resolve, reject) }
}
const fakeClient = { from: (table: string) => { const q = new FakeQuery(table); db.queries.push(q); return q } }
const supabaseJsStub = { createClient: () => { db.clientsCreated++; return fakeClient } }
const adminStub = {
  hasServiceRole: () => Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
  getAdminClient: () => { db.clientsCreated++; return fakeClient },
}
function resetDb() {
  db.rows = []; db.total = 0; db.oldest = null; db.newest = null
  db.error = null; db.upsertError = null; db.upsertThrows = null
  db.upserts = []; db.queries = []
}
function withServiceRole(on: boolean) {
  if (on) {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://fake.invalid'   // 検査用。通信は fetch の差し替えで遮断
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fake-service-role-key'
  } else {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL
    delete process.env.SUPABASE_SERVICE_ROLE_KEY
  }
}

type ModuleWithLoad = typeof Module & { _load: (request: string, ...rest: unknown[]) => unknown }
const M = Module as unknown as ModuleWithLoad
const realLoad = M._load
/** 設定すると '@/lib/supabase/admin' の読み込み（decision-store の動的 import）がこの例外で失敗する */
let adminLoadThrows: Error | null = null
M._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {}
  if (request === '@supabase/supabase-js') return supabaseJsStub
  if (request === '@/lib/supabase/admin') {
    if (adminLoadThrows) throw adminLoadThrows
    return adminStub
  }
  return realLoad.call(this, request, ...rest)
}

/** console.error を集める（1行だけ出ることを確かめる） */
async function capturingError<T>(fn: () => Promise<T>): Promise<{ value: T; logged: string[] }> {
  const logged: string[] = []
  const real = console.error
  console.error = (...a: unknown[]) => { logged.push(a.map(String).join(' ')) }
  try { return { value: await fn(), logged } } finally { console.error = real }
}

// ── 検査用の合成値（製品コードには入れない） ──
const T_AI = '2026-09-25T13:30:41.512Z'                       // AI の返事を受け取った時刻（decidedAt）
const T_TRADE = '2026-09-25T13:30:44.120Z'                    // 約定処理に入った時刻（DecisionRecord.timestamp・数秒後）
function decision(over: Partial<AIDecision> = {}): AIDecision {
  return {
    symbol: 'AAPL', name: 'Apple Inc.', action: 'watch', price: 231.4, change: 1.23,
    reasoning: '20日線の上で推移し出来高も伴うが、決算前なので様子見。', newsInfluence: '決算前で材料待ち',
    news: ['Apple、新型モデルを発表', '半導体株が反発'], technicals: 'RSI 58・MACD 強気', fundamentals: 'PER 30.1・ROE 150%',
    confidence: 'medium', sources: ['yahoo2'], knowledgeRefs: [{ id: 'k1', title: '決算前の様子見' }], tickId: 'tick_1', decidedAt: T_AI,
    ...over,
  }
}
function record(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return {
    id: 'dr_1', timestamp: T_TRADE, symbol: 'AAPL', action: 'watch', price: 231.4, confidence: 'medium',
    reasoning: '20日線の上で推移し出来高も伴うが、決算前なので様子見。', technicals: 'RSI 58・MACD 強気',
    fundamentals: 'PER 30.1・ROE 150%', newsHeadlines: ['Apple、新型モデルを発表', '半導体株が反発'],
    ...over,
  }
}
/** planBackfill が読むのは id / decisions / learning.allDecisions だけなので、それ以外は最小限（検査用の合成値） */
function session(id: string, decisions: AIDecision[], records: DecisionRecord[]): AISession {
  const learning = createLearningMemory()
  learning.allDecisions = records
  return {
    id, startedAt: '2026-07-01T00:00:00.000Z', lastTickAt: T_AI, capital: 100000, cash: 100000, holdings: {},
    trades: [], decisions, equityHistory: [], watchlist: [], tickCount: 1, totalValue: 100000, pnl: 0, pnlPct: 0,
    benchmarkStart: null, learning,
  } as unknown as AISession
}

async function main() {
  // ═══ A. SQL ═══
  console.log('A. supabase/migrations/0008_ai_decisions.sql')
  {
    const files = fs.readdirSync(path.join(ROOT, 'supabase/migrations')).filter(f => f.startsWith('0008_'))
    check('0008 は ai_decisions だけ', j(files) === j(['0008_ai_decisions.sql']), j(files))
    check('0008_reason_readings は存在しない', !files.some(f => f.includes('reason_readings')))
    const sql = read('supabase/migrations/0008_ai_decisions.sql')
    const body = stripSqlComments(sql)
    check('create table if not exists public.ai_decisions', /create table if not exists public\.ai_decisions\s*\(/.test(body))
    const columns: Array<[string, RegExp]> = [
      ['id text primary key', /^\s*id\s+text\s+primary key/m],
      ['session_id text not null', /^\s*session_id\s+text\s+not null/m],
      ['symbol text not null', /^\s*symbol\s+text\s+not null/m],
      ['name text', /^\s*name\s+text\s*,/m],
      ['action text not null + check', /^\s*action\s+text\s+not null\s+check \(action in \('buy', 'sell', 'hold', 'watch'\)\)/m],
      ['price numeric', /^\s*price\s+numeric\s*,/m],
      ['change numeric', /^\s*change\s+numeric\s*,/m],
      ['reasoning text', /^\s*reasoning\s+text\s*,/m],
      ['confidence text', /^\s*confidence\s+text\s*,/m],
      ['technicals text', /^\s*technicals\s+text\s*,/m],
      ['fundamentals text', /^\s*fundamentals\s+text\s*,/m],
      ['news text', /^\s*news\s+text\s*,/m],
      ['knowledge_refs jsonb', /^\s*knowledge_refs\s+jsonb\s*,/m],
      ['tick_id text', /^\s*tick_id\s+text\s*,/m],
      ['decided_at timestamptz not null', /^\s*decided_at\s+timestamptz\s+not null\s*,/m],
      ['inserted_at timestamptz not null default now()', /^\s*inserted_at\s+timestamptz\s+not null\s+default now\(\)/m],
    ]
    for (const [name, re] of columns) check(`列 ${name}`, re.test(body))
    const tableBody = body.slice(body.indexOf('ai_decisions ('), body.indexOf(');'))
    const columnLines = tableBody.split('\n').filter(l => /^\s+[a-z_]+\s+(text|numeric|jsonb|timestamptz)\b/.test(l))
    check('列は16本ちょうど', columnLines.length === 16, String(columnLines.length))
    check('action の許可値は decision-store の AI_DECISION_ACTIONS と同じ', j(AI_DECISION_ACTIONS) === j(['buy', 'sell', 'hold', 'watch']))
    check('index (decided_at desc)', /create index if not exists \S+\s+on public\.ai_decisions \(decided_at desc\)/.test(body))
    check('index (symbol, decided_at desc)', /create index if not exists \S+\s+on public\.ai_decisions \(symbol, decided_at desc\)/.test(body))
    check('index (session_id)', /create index if not exists \S+\s+on public\.ai_decisions \(session_id\)/.test(body))
    check('index は3本', count(body, /create index/g) === 3, String(count(body, /create index/g)))
    check('RLS 有効', /alter table public\.ai_decisions enable row level security/.test(body))
    check('ポリシー無し（create policy が無い）', !/create policy/i.test(body))
    check('更新・削除の経路が無い（update / delete / drop / truncate が無い＝追記だけ）', !/\b(update|delete|drop|truncate)\b/i.test(body))
    check('関数・トリガーを作らない', !/create (or replace )?(function|trigger)/i.test(body))
    check('先頭の注記: 実行方法: Supabase Dashboard → SQL Editor', /実行方法: Supabase Dashboard → SQL Editor/.test(sql))
    check('注記: 0008 を実行するまで 503（コードは 42P01 か PGRST205）', /0008 を実行するまで GET \/api\/ai-decisions は 503/.test(sql) && /42P01/.test(sql) && /PGRST205/.test(sql))
    check('0001 と同じ注意書き（RLS有効・ポリシー無し = anonキーからは読み書き不可）', /RLS有効・ポリシー無し = anonキーからは読み書き不可/.test(sql))
    check('0001 と同じ注意書き（service-roleクライアント経由のみ）', /server-onlyのservice-roleクライアント（lib\/supabase\/admin\.ts）経由のみ/.test(sql))
    check('id の規則（decisionIdFor）を注記している', /decisionIdFor/.test(sql))
  }

  // ═══ B. decision-store ═══
  console.log('B. lib/ai-trader/decision-store.ts（静的）')
  const storeSrc = read('lib/ai-trader/decision-store.ts')
  const storeCode = stripTsComments(storeSrc)
  {
    check('hasServiceRole は @/lib/supabase/env から（server-only を静的に持ち込まない）', /import \{ hasServiceRole \} from '@\/lib\/supabase\/env'/.test(storeCode))
    // 2026-09-28: 動的 import はテスト用の差し込み口 adminLoader.load の中にあり、appendDecisions はそれを await する
    //（静的 import `from '@/lib/supabase/admin'` は無い＝server-only を持ち込まない、という趣旨は変わらない）
    check('@/lib/supabase/admin は動的 import（adminLoader.load の中・Supabase 経路に入る時だけ）',
      /adminLoader = \{ load: \(\) => import\('@\/lib\/supabase\/admin'\) \}/.test(storeCode)
        && /await adminLoader\.load\(\)/.test(storeCode)
        && !/from '@\/lib\/supabase\/admin'/.test(storeCode))
    check('try / catch がある', /try \{/.test(storeCode) && /\} catch \(/.test(storeCode))
    check('console.error を出す（無音にしない）', count(storeCode, /console\.error\(/g) >= 1)
    check('throw が無い（呼び出し側＝tick に届く例外を作らない）', !/\bthrow\b/.test(storeCode))
    check('on conflict do nothing 相当（onConflict: id ＋ ignoreDuplicates: true）', /upsert\(rows, \{ onConflict: 'id', ignoreDuplicates: true \}\)/.test(storeCode))
    check('打ち切り付き（abortSignal(AbortSignal.timeout(APPEND_TIMEOUT_MS))）', /\.abortSignal\(AbortSignal\.timeout\(APPEND_TIMEOUT_MS\)\)/.test(storeCode))
    check('打ち切りは 5 秒（engine の FAILED_TICK_SAVE_TIMEOUT_MS と同じ）', APPEND_TIMEOUT_MS === 5_000, String(APPEND_TIMEOUT_MS))
    check('表名は ai_decisions', AI_DECISIONS_TABLE === 'ai_decisions')
    check('id は decisionIdFor で作る', /decisionIdFor\(d\.symbol, decidedAt\)/.test(storeCode))
    check('更新・削除の関数が無い（update / delete を呼ばない）', !/\.(update|delete)\(/.test(storeCode))
    check('MISSING_TABLE_CODES を export（42P01 と PGRST205 の2つ）', /export const MISSING_TABLE_CODES/.test(storeCode) && j([...MISSING_TABLE_CODES].sort()) === j(['42P01', 'PGRST205']), j([...MISSING_TABLE_CODES]))
    const appendCode = storeCode.slice(storeCode.indexOf('export async function appendDecisions('))
    check('action を許可値で filter してから upsert（除外の文言あり）', /decisions\.filter\(/.test(appendCode) && /action が許可値でないため控えから除外/.test(storeSrc))
    check('行の組み立て（toDecisionRow）は try の内側', appendCode.indexOf('try {') >= 0 && appendCode.indexOf('try {') < appendCode.indexOf('.map(d => toDecisionRow('), `${appendCode.indexOf('try {')} vs ${appendCode.indexOf('.map(d => toDecisionRow(')}`)
    check('冒頭の注記: 控えは最終の upsertSession より先に書く（blob 保存に失敗した tick の判断も残る）', /控えは最終の upsertSession より先に書く/.test(storeSrc) && /session\.ticks に無い/.test(storeSrc))
  }

  console.log('B. decision-store（行の形・純関数）')
  {
    const row = toDecisionRow('session_1', decision(), T_AI)
    check('id は symbol@decidedAt（decisionIdFor と同じ）', row.id === decisionIdFor('AAPL', T_AI) && row.id === `AAPL@${T_AI}`, row.id)
    check('decided_at は渡した時刻', row.decided_at === T_AI)
    check('session_id・symbol・action・price・change', row.session_id === 'session_1' && row.symbol === 'AAPL' && row.action === 'watch' && row.price === 231.4 && row.change === 1.23)
    check('news は改行区切りのテキスト', row.news === 'Apple、新型モデルを発表\n半導体株が反発', j(row.news))
    check('knowledge_refs は [{ id, title }]', j(row.knowledge_refs) === j([{ id: 'k1', title: '決算前の様子見' }]))
    check('tick_id', row.tick_id === 'tick_1')
    check('列名は SQL と同じ 15 本（inserted_at は DB が埋める）', j(Object.keys(row).sort()) === j(['action', 'change', 'confidence', 'decided_at', 'fundamentals', 'id', 'knowledge_refs', 'name', 'news', 'price', 'reasoning', 'session_id', 'symbol', 'technicals', 'tick_id']), j(Object.keys(row).sort()))

    const sparse = toDecisionRow('s', decision({ change: null, news: [], knowledgeRefs: [], tickId: undefined, name: '', price: Number.NaN }), T_AI)
    check('change null はそのまま null（0 で埋めない・原則9）', sparse.change === null)
    check('news 空は null', sparse.news === null)
    check('knowledgeRefs 空は null', sparse.knowledge_refs === null)
    check('tickId 無しは null', sparse.tick_id === null)
    check('name 空は null', sparse.name === null)
    check('price が数でなければ null', sparse.price === null)
    check('JSON 往復で undefined が無い（全列が null か値）', Object.values(JSON.parse(j(sparse))).every(v => v !== undefined) && Object.keys(JSON.parse(j(sparse))).length === 15)

    const rec: DecisionRecord = record()
    const fromRecord = toDecisionRow('s', { ...rec, news: rec.newsHeadlines }, rec.timestamp)
    check('DecisionRecord（name・change・knowledge・tick を持たない）からも行になる', fromRecord.name === null && fromRecord.change === null && fromRecord.knowledge_refs === null && fromRecord.tick_id === null && fromRecord.news === 'Apple、新型モデルを発表\n半導体株が反発')

    check('newsToText → newsFromText で元に戻る', j(newsFromText(newsToText(['a', 'b']))) === j(['a', 'b']))
    check('newsFromText(null) は []', j(newsFromText(null)) === j([]))
    check('newsToText は見出しの中の改行を潰す（1行1本を守る）', newsToText(['a\nb', 'c']) === 'a b\nc')

    // S2: knowledgeRefs にゴミ（null・数値・文字列・id が数値）が混ざっても落ちない。id が文字列のものだけ残る
    let refsThrew: unknown = null
    let refsRow: ReturnType<typeof toDecisionRow> | null = null
    try {
      const dirty = [null, 42, 'k', { id: 7, title: 'n' }, { id: 'k2' }, { id: 'k1', title: 'x' }] as unknown as AIDecision['knowledgeRefs']
      refsRow = toDecisionRow('s', decision({ knowledgeRefs: dirty }), T_AI)
    } catch (e) { refsThrew = e }
    check('knowledgeRefs に null・数値・文字列が混ざっても落ちない・id が文字列のものだけ残る（title 無しは \'\'）', refsThrew === null && j(refsRow?.knowledge_refs) === j([{ id: 'k2', title: '' }, { id: 'k1', title: 'x' }]), refsThrew ? String(refsThrew) : j(refsRow?.knowledge_refs))
    let refsThrew2: unknown = null
    let nonArray: Array<ReturnType<typeof toDecisionRow>> = []
    try {
      nonArray = [null, 'abc', 42, {}].map(v => toDecisionRow('s', decision({ knowledgeRefs: v as unknown as AIDecision['knowledgeRefs'] }), T_AI))
    } catch (e) { refsThrew2 = e }
    check('knowledgeRefs が配列でない（null・文字列・数値・オブジェクト）→ 落ちず null', refsThrew2 === null && nonArray.length === 4 && nonArray.every(r => r.knowledge_refs === null), refsThrew2 ? String(refsThrew2) : j(nonArray.map(r => r.knowledge_refs)))
  }

  console.log('B. decision-store（appendDecisions の振る舞い・偽クライアント）')
  {
    withServiceRole(false); resetDb()
    const r0 = await appendDecisions('s', [decision()], T_AI)
    check('service-role 無し → { skipped: true, reason: no-service-role }・クライアントを作らない・upsert しない', j(r0) === j({ skipped: true, reason: 'no-service-role' }) && db.clientsCreated === 0 && db.upserts.length === 0, j(r0))

    withServiceRole(true); resetDb()
    const r1 = await appendDecisions('s', [], T_AI)
    check('0件 → { skipped: true, reason: empty }・upsert しない', j(r1) === j({ skipped: true, reason: 'empty' }) && db.upserts.length === 0, j(r1))

    // S2: '@/lib/supabase/admin' の動的 import そのものが失敗しても投げない。
    // 注意: この検査ファイルは冒頭で route.ts を静的 import しており、その先で admin.ts が先に読み込まれてキャッシュ
    // される。Module._load の差し替え（上）や require.cache の削除では、decision-store の動的 import の失敗を
    // 再現できなかった（2026-09-28 実測: どちらも ok:true・attempted:1 のまま）。
    // → decision-store が公開しているテスト用の差し込み口 adminLoader.load を差し替えて、読み込み自体を失敗させる。
    resetDb(); let threw: unknown = null
    const realAdminLoad = adminLoader.load
    adminLoader.load = async () => { throw new Error("Cannot find module '@/lib/supabase/admin'") }
    const { value: r5, logged: l5 } = await capturingError(async () => { try { return await appendDecisions('s', [decision()], T_AI) } catch (e) { threw = e; return null } })
    adminLoader.load = realAdminLoad
    check('admin の動的 import が失敗 → 投げない・ok:false・error に原因・upsert しない', threw === null && r5 != null && !r5.skipped && r5.ok === false && /Cannot find module/.test(r5.error) && db.upserts.length === 0, threw ? String(threw) : j(r5))
    check('その時も console.error は1行だけ・「tick は続行」', l5.length === 1 && /tick は続行/.test(l5[0]), j(l5))

    resetDb()
    const { value: r2, logged: l2 } = await capturingError(() => appendDecisions('session_9', [decision(), decision({ symbol: 'NVDA', name: 'NVIDIA' })], T_AI))
    check('2件 → ok:true・attempted 2・console.error 無し', j(r2) === j({ skipped: false, ok: true, attempted: 2 }) && l2.length === 0, j(r2) + j(l2))
    check('upsert は1回・ai_decisions・2行', db.upserts.length === 1 && db.upserts[0].table === 'ai_decisions' && (db.upserts[0].rows as unknown[]).length === 2, j(db.upserts.map(u => [u.table, (u.rows as unknown[]).length])))
    check('upsert のオプションは { onConflict: id, ignoreDuplicates: true }', j(db.upserts[0]?.opts) === j({ onConflict: 'id', ignoreDuplicates: true }), j(db.upserts[0]?.opts))
    const rows = (db.upserts[0]?.rows ?? []) as Array<{ id: string; session_id: string }>
    check('行の id は decisionIdFor(symbol, decidedAt)・session_id は渡した id', j(rows.map(r => r.id)) === j([`AAPL@${T_AI}`, `NVDA@${T_AI}`]) && rows.every(r => r.session_id === 'session_9'), j(rows.map(r => r.id)))
    const q = db.queries.find(x => x.has('upsert'))
    check('abortSignal を付けている', !!q && q.has('abortSignal') && (q.arg('abortSignal')?.[0] instanceof AbortSignal))

    resetDb(); db.upsertError = { message: 'relation "public.ai_decisions" does not exist', code: '42P01' }
    threw = null
    const { value: r3, logged: l3 } = await capturingError(async () => { try { return await appendDecisions('s', [decision()], T_AI) } catch (e) { threw = e; return null } })
    check('表が無い（error が返る）→ 投げない・ok:false・error に原因', threw === null && r3 != null && !r3.skipped && r3.ok === false && /does not exist/.test(r3.error), j(r3))
    check('その時 console.error は1行だけ・「tick は続行」', l3.length === 1 && /tick は続行/.test(l3[0]) && /does not exist/.test(l3[0]), j(l3))

    resetDb(); db.upsertThrows = new Error('network down')
    threw = null
    const { value: r4, logged: l4 } = await capturingError(async () => { try { return await appendDecisions('s', [decision()], T_AI) } catch (e) { threw = e; return null } })
    check('クライアントが投げても → 投げない・ok:false', threw === null && r4 != null && !r4.skipped && r4.ok === false && /network down/.test(r4.error), j(r4))
    check('その時も console.error は1行だけ', l4.length === 1, j(l4))

    // W3: action が許可値でない判断（engine.ts は AI の返事の action をそのまま通す）が1件混じっても、他の判断は控えに入る
    resetDb()
    const mixed = [decision({ action: 'BUY' as AIDecision['action'] }), decision({ symbol: 'NVDA', name: 'NVIDIA' }), decision({ symbol: 'MSFT', name: 'Microsoft', action: 'sell' })]
    const { value: r6, logged: l6 } = await capturingError(() => appendDecisions('session_9', mixed, T_AI))
    const r6ids = ((db.upserts[0]?.rows ?? []) as Array<{ id: string; action: string }>).map(r => r.id)
    check('不正 action 1件混在 → 他の2件は控えに入る（ok:true・attempted 2・upsert 1回・2行）', j(r6) === j({ skipped: false, ok: true, attempted: 2 }) && db.upserts.length === 1 && j(r6ids) === j([`NVDA@${T_AI}`, `MSFT@${T_AI}`]), j(r6) + j(r6ids))
    check('除外は console.error に銘柄と値で出る（1行・黙って落とさない）', l6.length === 1 && /\[ai-decisions\] action が許可値でないため控えから除外: AAPL="BUY"/.test(l6[0]), j(l6))
    check('upsert した行の action はすべて許可値', ((db.upserts[0]?.rows ?? []) as Array<{ action: string }>).every(r => (AI_DECISION_ACTIONS as readonly string[]).includes(r.action)))
    resetDb()
    const { value: r7, logged: l7 } = await capturingError(() => appendDecisions('s', [decision({ action: 'short' as AIDecision['action'] }), decision({ symbol: 'NVDA', action: undefined as unknown as AIDecision['action'] })], T_AI))
    check('全件が不正 action → skipped: empty・upsert しない・除外は2行出る', j(r7) === j({ skipped: true, reason: 'empty' }) && db.upserts.length === 0 && l7.length === 2 && /AAPL="short"/.test(l7[0]) && /NVDA="undefined"/.test(l7[1]), j(r7) + j(l7))
    withServiceRole(false); resetDb()
    const { value: r8, logged: l8 } = await capturingError(() => appendDecisions('s', [decision({ action: 'BUY' as AIDecision['action'] })], T_AI))
    check('service-role 無しなら action の検証より先に skipped（console.error も出ない）', j(r8) === j({ skipped: true, reason: 'no-service-role' }) && l8.length === 0, j(r8) + j(l8))
    withServiceRole(false); resetDb()
  }

  // ═══ C. engine.ts ═══
  console.log('C. lib/ai-trader/engine.ts（静的）')
  {
    const src = read('lib/ai-trader/engine.ts')
    const code = stripTsComments(src)
    check('appendDecisions を ./decision-store から import', /import \{ appendDecisions \} from '\.\/decision-store'/.test(code))
    check('appendDecisions の呼び出しは1回だけ', count(code, /appendDecisions\(/g) === 1, String(count(code, /appendDecisions\(/g)))
    const callRe = /await appendDecisions\(session\.id, decisions, decidedAt\)/
    check('await appendDecisions(session.id, decisions, decidedAt)', callRe.test(code))
    const iCall = code.search(callRe)
    const iSlice = code.indexOf('session.decisions = [...decisions, ...session.decisions].slice(0, 200)')
    const iTrades = code.indexOf('executeTrades(session, decisions)')
    const iFinalSave = code.lastIndexOf('await upsertSession(session)')
    check('位置: session.decisions = […].slice(0, 200) の直後・executeTrades より前', iSlice >= 0 && iCall > iSlice && iCall < iTrades, `${iSlice} < ${iCall} < ${iTrades}`)
    const runTickCode = code.slice(code.indexOf('export async function runTick('))
    check('blob の保存（await upsertSession(session)）は runTick に残っている（失敗 tick の記録と最後の保存の2回）', count(runTickCode, /await (withDeadline\()?upsertSession\(session\)/g) === 2 && iFinalSave > iCall, String(count(runTickCode, /upsertSession\(session\)/g)))
    check('startSession の保存（await upsertSession(session)）も残っている', count(code, /await upsertSession\(session\)/g) === 2 && code.indexOf('await upsertSession(session)') < code.indexOf('export async function runTick('), String(count(code, /await upsertSession\(session\)/g)))
    check('appendDecisions は try/catch で囲っていない（投げないのは decision-store 側の保証）', !/try \{\s*await appendDecisions/.test(code))
    check('判断の上限 200（blob）は据え置き', /\.slice\(0, 200\)/.test(code))
    check('runTick の中にある（startSession ではない）', iCall > code.indexOf('export async function runTick('))
    const memCode = stripTsComments(read('lib/ai-trader/memory.ts'))
    check('学習メモリの上限 1500 は据え置き', /allDecisions\.length > 1500/.test(memCode) && /slice\(0, 1500\)/.test(memCode))
    check('store.ts（blob の保存）は変えていない: upsertSession は ai_sessions へ', /const TABLE = 'ai_sessions'/.test(read('lib/ai-trader/store.ts')) && !/ai_decisions/.test(read('lib/ai-trader/store.ts')))
  }

  // ═══ D. route ═══
  console.log('D. app/api/ai-decisions/route.ts（静的）')
  const ROUTE_REL = 'app/api/ai-decisions/route.ts'
  {
    const src = read(ROUTE_REL)
    const code = stripTsComments(src)
    const handlers = [...code.matchAll(/export async function (\w+)\(/g)].map(m => m[1])
    check('export しているのは GET だけ（書く口は無い）', j(handlers) === j(['GET']), j(handlers))
    check('認証なし（読むのは誰でも＝/api/ai-session と同じ）', !/getCurrentUserId|isAdminUserId/.test(code))
    check('Cache-Control: no-store', /'Cache-Control': 'no-store'/.test(code))
    check('503 の分岐がある', /status: 503/.test(code))
    check('「保管庫が未設定」の文言', /保管庫が未設定/.test(src))
    check('limit 既定 20・最大 200', /DEFAULT_LIMIT = 20/.test(code) && /MAX_LIMIT = 200/.test(code))
    check('hasServiceRole() で分岐', /if \(!hasServiceRole\(\)\)/.test(code))
    check('service-role クライアント（lib/supabase/admin）で読む（anon ではない）', /from '@\/lib\/supabase\/admin'/.test(code) && !/createBrowserClient|NEXT_PUBLIC_SUPABASE_ANON_KEY/.test(code))
    check('表が無いコードは decision-store の MISSING_TABLE_CODES で判定（42P01 を手書きしない）', /MISSING_TABLE_CODES\.has\(failed\.code \?\? ''\)/.test(code) && !/42P01|PGRST205/.test(code) && /MISSING_TABLE_CODES/.test(code.slice(0, code.indexOf('export const runtime'))))
    check('upsert / insert / update / delete を呼ばない（読むだけ）', !/\.(upsert|insert|update|delete)\(/.test(code))
    check('decided_at の新しい順', /\.order\('decided_at', \{ ascending: false \}\)\.limit\(limit\)/.test(code))
  }

  console.log('D. route（振る舞い・偽クライアント）')
  {
    type Body = { count?: number; oldest?: string | null; newest?: string | null; items?: Record<string, unknown>[]; error?: string; message?: string }
    type RouteModule = { GET: (req: unknown) => Promise<Response> }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const route = require(path.join(ROOT, ROUTE_REL)) as RouteModule
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { NextRequest } = require('next/server') as { NextRequest: new (url: string) => unknown }
    /** 偽の表を setup で用意してから GET を1回呼ぶ */
    async function callWith(qs: string, setup: () => void = () => {}) {
      resetDb()
      setup()
      const { value: res, logged } = await capturingError(() => route.GET(new NextRequest(`http://localhost/api/ai-decisions${qs}`)))
      const body = JSON.parse(await res.text()) as Body
      const itemsQuery = db.queries.find(q => q.has('limit') && !q.has('maybeSingle'))
      return { status: res.status, cache: res.headers.get('cache-control') ?? '', body, logged, itemsQuery, queries: db.queries }
    }
    const call = (qs = '') => callWith(qs)

    withServiceRole(false)
    const r0 = await call()
    check('service-role 無し → 503・error unavailable・「保管庫が未設定」・no-store・DB に触らない', r0.status === 503 && r0.body.error === 'unavailable' && /保管庫が未設定/.test(r0.body.message ?? '') && r0.cache === 'no-store' && r0.queries.length === 0, j([r0.status, r0.body, r0.cache]))

    withServiceRole(true)
    db.rows = []
    const rEmpty = await call()
    check('空の表 → 200・{ count: 0, oldest: null, newest: null, items: [] }・no-store', rEmpty.status === 200 && j(rEmpty.body) === j({ count: 0, oldest: null, newest: null, items: [] }) && rEmpty.cache === 'no-store', j(rEmpty.body))
    check('既定の limit は 20', rEmpty.itemsQuery?.arg('limit')?.[0] === 20, j(rEmpty.itemsQuery?.arg('limit')))
    check('count は表の総件数（head + count: exact）', rEmpty.queries.some(q => { const a = q.arg('select'); return !!a && j(a[1]) === j({ count: 'exact', head: true }) }))
    check('oldest / newest は decided_at の昇順・降順 1件', rEmpty.queries.filter(q => q.has('maybeSingle')).length === 2)

    const stored = {
      id: `AAPL@${T_AI}`, session_id: 's1', symbol: 'AAPL', name: 'Apple Inc.', action: 'watch', price: '231.4', change: '1.23',
      reasoning: 'r', confidence: 'medium', technicals: 't', fundamentals: 'f', news: 'A\nB', knowledge_refs: [{ id: 'k1', title: 'x' }],
      tick_id: 'tick_1', decided_at: T_AI, inserted_at: '2026-09-25T13:30:45.000Z',
    }
    const r2 = await callWith('?limit=5', () => { db.error = null; db.rows = [stored]; db.total = 361; db.oldest = '2026-07-14T13:31:02.000Z'; db.newest = T_AI })
    check('記録あり → 200・count 361・oldest/newest', r2.status === 200 && r2.body.count === 361 && r2.body.oldest === '2026-07-14T13:31:02.000Z' && r2.body.newest === T_AI, j([r2.status, r2.body.count, r2.body.oldest, r2.body.newest]))
    const item = r2.body.items?.[0] ?? {}
    check('items は camelCase・16項目', j(Object.keys(item).sort()) === j(['action', 'change', 'confidence', 'decidedAt', 'fundamentals', 'id', 'insertedAt', 'knowledgeRefs', 'name', 'news', 'price', 'reasoning', 'sessionId', 'symbol', 'technicals', 'tickId']), j(Object.keys(item).sort()))
    check('news は string[] に戻る', j(item.news) === j(['A', 'B']), j(item.news))
    check('numeric が文字列で来ても数に戻す', item.price === 231.4 && item.change === 1.23, j([item.price, item.change]))
    check('sessionId / tickId / decidedAt / insertedAt / knowledgeRefs', item.sessionId === 's1' && item.tickId === 'tick_1' && item.decidedAt === T_AI && item.insertedAt === '2026-09-25T13:30:45.000Z' && j(item.knowledgeRefs) === j([{ id: 'k1', title: 'x' }]))
    check('limit=5 はそのまま', r2.itemsQuery?.arg('limit')?.[0] === 5)

    const r3 = await callWith('?limit=999', () => { db.rows = [] })
    check('limit=999 は 200 に丸める', r3.itemsQuery?.arg('limit')?.[0] === 200, j(r3.itemsQuery?.arg('limit')))
    const r4 = await callWith('?limit=abc', () => { db.rows = [] })
    check('limit=abc は既定 20', r4.itemsQuery?.arg('limit')?.[0] === 20)
    const r5 = await callWith('?limit=0', () => { db.rows = [] })
    check('limit=0 は既定 20', r5.itemsQuery?.arg('limit')?.[0] === 20)

    const r6 = await callWith('?symbol=7203.T&action=buy&before=2026-09-20T00:00:00Z&since=2026-07-01T00:00:00.000Z', () => { db.rows = [] })
    check('symbol → eq(symbol)', j(r6.itemsQuery?.arg('eq')) === j(['symbol', '7203.T']), j(r6.itemsQuery?.calls))
    check('action → eq(action)', r6.itemsQuery?.calls.some(c => c.method === 'eq' && j(c.args) === j(['action', 'buy'])) === true)
    check('before → lt(decided_at, ISO 正規化)', j(r6.itemsQuery?.arg('lt')) === j(['decided_at', '2026-09-20T00:00:00.000Z']), j(r6.itemsQuery?.arg('lt')))
    check('since → gte(decided_at)', j(r6.itemsQuery?.arg('gte')) === j(['decided_at', '2026-07-01T00:00:00.000Z']))
    check('絞り込みは items にだけ掛かる（count / oldest / newest は表全体）', r6.queries.filter(q => q !== r6.itemsQuery).every(q => !q.has('eq') && !q.has('lt') && !q.has('gte')))

    const r7 = await callWith('?action=foo', () => { db.rows = [] })
    check('action=foo → 400・no-store・DB に触らない', r7.status === 400 && r7.cache === 'no-store' && r7.queries.length === 0, j([r7.status, r7.body]))
    const r8 = await callWith('?before=yesterday', () => { db.rows = [] })
    check('before=yesterday → 400', r8.status === 400 && /before/.test(r8.body.message ?? ''), j(r8.body))
    const r9 = await callWith('?since=nope', () => { db.rows = [] })
    check('since=nope → 400', r9.status === 400)

    const r10 = await callWith('', () => { db.error = { message: 'relation "public.ai_decisions" does not exist', code: '42P01' } })
    check('表が無い（42P01・PostgREST 12.1 以前）→ 503・「保管庫が未設定」・no-store', r10.status === 503 && r10.body.error === 'unavailable' && /保管庫が未設定/.test(r10.body.message ?? '') && r10.cache === 'no-store', j([r10.status, r10.body]))
    const r10b = await callWith('', () => { db.error = { message: "Could not find the table 'public.ai_decisions' in the schema cache", code: 'PGRST205' } })
    check('表が無い（PGRST205・PostgREST 12.2 以降）→ 503・「保管庫が未設定」・no-store', r10b.status === 503 && r10b.body.error === 'unavailable' && /保管庫が未設定/.test(r10b.body.message ?? '') && r10b.cache === 'no-store', j([r10b.status, r10b.body]))
    check('503 のとき console.error は出さない（未設定は失敗ではない）', r10.logged.length === 0 && r10b.logged.length === 0, j([r10.logged, r10b.logged]))
    const r10c = await callWith('', () => { db.error = { message: 'permission denied for table ai_decisions', code: '42501' } })
    check('表はあるが別のコード（42501）→ 502（503 にしない）', r10c.status === 502 && r10c.body.error === 'read_failed', j([r10c.status, r10c.body]))
    const r11 = await callWith('', () => { db.error = { message: 'connection refused' } })
    check('その他の失敗 → 502・read_failed・和文の message・no-store', r11.status === 502 && r11.body.error === 'read_failed' && !/connection refused/.test(r11.body.message ?? '') && r11.cache === 'no-store', j([r11.status, r11.body]))
    check('その時 console.error は1行・原因の英語はログにだけ', r11.logged.length === 1 && /connection refused/.test(r11.logged[0]), j(r11.logged))
    withServiceRole(false); resetDb()
  }

  // ═══ E. backfill ═══
  console.log('E. scripts/backfill-ai-decisions.ts（静的）')
  {
    const src = read('scripts/backfill-ai-decisions.ts')
    const code = stripTsComments(src)
    check('既定は dry-run（--write のときだけ書く）', /const write = process\.argv\.includes\('--write'\)/.test(code) && /const dryRun = !write/.test(code))
    check('dry-run は書く前に return', /if \(dryRun\) \{[\s\S]*?return\s*\}/.test(code) && code.indexOf('if (dryRun)') < code.indexOf('.upsert('))
    check('書くときも on conflict do nothing（ignoreDuplicates: true）', /upsert\(chunk, \{ onConflict: 'id', ignoreDuplicates: true \}\)/.test(code))
    check('service-role で書く（SUPABASE_SERVICE_ROLE_KEY・anon ではない）', /process\.env\.SUPABASE_SERVICE_ROLE_KEY/.test(code) && !/ANON_KEY/.test(code))
    check('ai_sessions を読む', /from\('ai_sessions'\)\.select\('id, data'\)/.test(code))
    check('行は decision-store の toDecisionRow で作る（tick の追記と同じ id・列）', /import \{ toDecisionRow/.test(code) && /toDecisionRow\(c\.sessionId, c\.input, c\.at\)/.test(code))
    check('直接実行のときだけ main（検査からの import では動かない）', /if \(require\.main === module\)/.test(code))
    check('update / delete を呼ばない', !/\.(update|delete)\(/.test(code))
    check('照合の窓は 10 分', MATCH_WINDOW_MS === 10 * 60 * 1000)
    check('表が無いコードは MISSING_TABLE_CODES で判定（42P01 を手書きしない）', /MISSING_TABLE_CODES\.has\(error\.code \?\? ''\)/.test(code) && !/'42P01'|'PGRST205'/.test(code))
    check('readExisting の並びは (decided_at, id) で決定的（同時刻の塊が 1000 件境界を跨いでも取りこぼさない）', /\.order\('decided_at', \{ ascending: true \}\)\.order\('id', \{ ascending: true \}\)/.test(code))
    check('--write には --yes も要る（無ければ接続先を出して exit 1・クライアントを作る前）', /const yes = process\.argv\.includes\('--yes'\)/.test(code) && /if \(write && !yes\) \{[\s\S]*?--write --yes[\s\S]*?process\.exit\(1\)/.test(code) && code.indexOf('if (write && !yes)') < code.indexOf('createClient(url'))
    check('Candidate に claimed がある（取られた候補を照合先から外す）', /claimed: boolean/.test(code) && /if \(item\.claimed\) continue/.test(code))
  }

  console.log('E. planBackfill（重複排除・純関数）')
  {
    // (1) 同じ判断が blob（decidedAt あり）と学習メモリ（3秒後の timestamp）の両方にある → 1件・decidedAt を使う・情報は blob 優先
    const p1 = planBackfill([session('s1', [decision()], [record()])], [])
    check('両方にある判断は1件（source both）', p1.merged.length === 1 && p1.merged[0].source === 'both' && p1.counts.both === 1 && p1.counts.memoryOnly === 0 && p1.counts.blobOnly === 0, j(p1.counts))
    check('id・decided_at は decidedAt（ticks[].decisionIds と同じ鍵。timestamp ではない）', p1.rows.length === 1 && p1.rows[0].id === `AAPL@${T_AI}` && p1.rows[0].decided_at === T_AI, j(p1.rows[0]?.id))
    check('name・change・knowledge・tick は blob から入る', p1.rows[0]?.name === 'Apple Inc.' && p1.rows[0]?.change === 1.23 && p1.rows[0]?.tick_id === 'tick_1' && j(p1.rows[0]?.knowledge_refs) === j([{ id: 'k1', title: '決算前の様子見' }]))
    check('sessions の要約', j(p1.sessions) === j([{ id: 's1', decisions: 1, withDecidedAt: 1, allDecisions: 1 }]), j(p1.sessions))
    check('oldest / newest', p1.oldest === T_AI && p1.newest === T_AI)

    // (2) 学習メモリだけにある判断（blob の 200 件から溢れた分）→ memory・name/change は null
    const oldRec = record({ id: 'dr_old', timestamp: '2026-07-14T13:31:02.000Z', symbol: 'NVDA', reasoning: '古い判断。' })
    const p2 = planBackfill([session('s1', [], [oldRec])], [])
    check('学習メモリだけの判断も救う（source memory・name/change/tick は null・news は newsHeadlines から）', p2.rows.length === 1 && p2.merged[0].source === 'memory' && p2.rows[0].id === 'NVDA@2026-07-14T13:31:02.000Z' && p2.rows[0].name === null && p2.rows[0].change === null && p2.rows[0].tick_id === null && p2.rows[0].news === 'Apple、新型モデルを発表\n半導体株が反発', j(p2.rows[0]))

    // (3) decidedAt の無い blob の判断（4a より前）は、同じ symbol・reasoning の学習メモリがちょうど1件なら時刻を借りる
    const p3 = planBackfill([session('s1', [decision({ decidedAt: undefined, tickId: undefined })], [record()])], [])
    check('decidedAt 無し＋学習メモリ1件 → 借りて1件（both）・時刻は timestamp', p3.rows.length === 1 && p3.merged[0].source === 'both' && p3.rows[0].decided_at === T_TRADE && p3.rows[0].name === 'Apple Inc.', j(p3.rows[0]))
    // (4) decidedAt 無し＋学習メモリに無い → 時刻を作らず見送る
    const p4 = planBackfill([session('s1', [decision({ decidedAt: undefined })], [])], [])
    check('decidedAt 無し＋照合先なし → 時刻不明で見送り（作らない・原則9）', p4.rows.length === 0 && p4.counts.noTime === 1, j(p4.counts))
    // (5) decidedAt 無し＋同じ symbol・reasoning が2件 → どれか決められないので見送る（学習メモリの2件は残る）
    const twoRecs = [record({ id: 'a', timestamp: '2026-08-01T00:00:00.000Z' }), record({ id: 'b', timestamp: '2026-08-02T00:00:00.000Z' })]
    const p5 = planBackfill([session('s1', [decision({ decidedAt: undefined })], twoRecs)], [])
    check('decidedAt 無し＋候補2件 → 見送り・学習メモリの2件はそのまま', p5.rows.length === 2 && p5.counts.noTime === 1 && p5.counts.memoryOnly === 2, j(p5.counts))

    // (6) 窓（10分）の外は別の判断
    const farRec = record({ id: 'far', timestamp: '2026-09-25T13:41:00.000Z' })  // decidedAt の 10分19秒後
    const p6 = planBackfill([session('s1', [decision()], [farRec])], [])
    check('時刻の差が窓の外（10分超）→ 別の判断として2件', p6.rows.length === 2 && p6.counts.blobOnly === 1 && p6.counts.memoryOnly === 1, j(p6.counts))
    const nearRec = record({ id: 'near', timestamp: '2026-09-25T13:40:41.512Z' })  // ちょうど 10分後
    const p6b = planBackfill([session('s1', [decision()], [nearRec])], [])
    check('ちょうど窓の内側（10分）→ 1件', p6b.rows.length === 1, String(p6b.rows.length))

    // (7) 既に表にある分は除く（id が同じ／同じ照合で一致）
    const existingSameId: ExistingRow[] = [{ id: `AAPL@${T_AI}`, symbol: 'AAPL', reasoning: decision().reasoning, decided_at: T_AI }]
    const p7 = planBackfill([session('s1', [decision()], [record()])], existingSameId)
    check('id が同じ既存行 → 書かない（alreadyStored）', p7.rows.length === 0 && p7.counts.alreadyStored === 1 && p7.merged.length === 1, j(p7.counts))
    const existingNear: ExistingRow[] = [{ id: `AAPL@${T_TRADE}`, symbol: 'AAPL', reasoning: decision().reasoning, decided_at: T_TRADE }]
    const p7b = planBackfill([session('s1', [decision()], [])], existingNear)
    check('id は違うが同じ判断（symbol・reasoning・3秒差）の既存行 → 書かない', p7b.rows.length === 0 && p7b.counts.alreadyStored === 1, j(p7b.counts))
    check('既存行が無ければ書く', planBackfill([session('s1', [decision()], [])], []).rows.length === 1)

    // (8) action が不正なものは入れない（表の check 制約で失敗する前に見送る）
    const p8 = planBackfill([session('s1', [decision({ action: 'short' as AIDecision['action'] })], [record({ action: 'cover' as DecisionRecord['action'] })])], [])
    check('action 不正 → 見送り（badAction 2）', p8.rows.length === 0 && p8.counts.badAction === 2, j(p8.counts))

    // (9) 複数セッション・並びは decided_at 昇順・oldest/newest
    const s1 = session('s1', [decision()], [record()])
    const s2 = session('s2', [], [record({ id: 'x', timestamp: '2026-07-14T13:31:02.000Z', symbol: 'MSFT', reasoning: '別の判断。' }), record({ id: 'y', timestamp: '2026-08-20T10:00:00.000Z', symbol: 'MSFT', reasoning: 'さらに別の判断。' })])
    const p9 = planBackfill([s1, s2], [])
    check('複数セッション → 3件・昇順', p9.rows.length === 3 && p9.rows.map(r => r.session_id).join(',') === 's2,s2,s1' && p9.rows[0].decided_at === '2026-07-14T13:31:02.000Z', j(p9.rows.map(r => [r.session_id, r.decided_at])))
    check('oldest は 7月・newest は 9月', p9.oldest === '2026-07-14T13:31:02.000Z' && p9.newest === T_AI, j([p9.oldest, p9.newest]))
    check('同じ symbol でも reasoning が違えば別の判断', p9.rows.filter(r => r.symbol === 'MSFT').length === 2)

    // (10) tick の追記（appendDecisions）と backfill は同じ id になる＝二重に入らない
    const live = toDecisionRow('s1', decision(), T_AI)
    check('tick の追記と backfill の id が一致（on conflict do nothing で二重に入らない）', live.id === p1.rows[0]?.id && j(live) === j(p1.rows[0]))

    // (11) 旧フォーマット（decisions / learning が無い）でも落ちない
    const bare = { id: 'old', startedAt: '2026-07-01T00:00:00.000Z', lastTickAt: '2026-07-01T00:00:00.000Z' } as unknown as AISession
    let threw = false
    try { planBackfill([bare], []) } catch { threw = true }
    check('decisions / learning を欠く旧セッションでも落ちない', !threw && planBackfill([bare], []).rows.length === 0)
    // (12) 入力を変更しない
    const before = j(s1)
    planBackfill([s1], [])
    check('入力のセッションを変更しない', j(s1) === before)

    // ── W2: 別 tick の判断が1行に潰れない（claimed） ──
    // 手動 tick を2分差で2回回した想定。同じ銘柄・同じ reasoning の判断が blob に2件（decidedAt T1・T2）・学習メモリに2件（各3秒後）
    const T1 = T_AI                                  // 1回目の tick の decidedAt
    const T2 = '2026-09-25T13:32:41.512Z'            // 2回目（2分後）
    const T1m = T_TRADE                              // 1回目の DecisionRecord.timestamp（3秒後）
    const T2m = '2026-09-25T13:32:44.120Z'           // 2回目の timestamp
    const d1 = decision({ decidedAt: T1, tickId: 'tick_1' })
    const d2 = decision({ decidedAt: T2, tickId: 'tick_2' })
    const m1 = record({ id: 'm1', timestamp: T1m })
    const m2 = record({ id: 'm2', timestamp: T2m })
    // (13) session.decisions は新しい順（engine.ts の [...decisions, ...session.decisions]）
    const p13 = planBackfill([session('s1', [d2, d1], [m2, m1])], [])
    check('2分差の2判断＋メモリ2件 → 行2本・id は sym@T1 と sym@T2（両方 both）', p13.rows.length === 2 && j(p13.rows.map(r => r.id)) === j([`AAPL@${T1}`, `AAPL@${T2}`]) && p13.counts.both === 2 && p13.counts.blobOnly === 0 && p13.counts.memoryOnly === 0, j(p13.rows.map(r => r.id)) + j(p13.counts))
    check('各行の tick_id は自分の tick（tick_1 / tick_2）', j(p13.rows.map(r => r.tick_id)) === j(['tick_1', 'tick_2']), j(p13.rows.map(r => r.tick_id)))
    const p13b = planBackfill([session('s1', [d1, d2], [m1, m2])], [])
    check('並びが逆（古い順）でも同じ結果', j(p13b.rows.map(r => [r.id, r.tick_id])) === j(p13.rows.map(r => [r.id, r.tick_id])) && j(p13b.counts) === j(p13.counts), j(p13b.rows.map(r => r.id)))
    // (14) reasoning が ''（engine.ts の r.reasoning ?? ''）だと同銘柄はすべて同じ照合鍵になる → それでも潰れない
    const p14 = planBackfill([session('s1', [{ ...d2, reasoning: '' }, { ...d1, reasoning: '' }], [{ ...m2, reasoning: '' }, { ...m1, reasoning: '' }])], [])
    check("reasoning が '' の同銘柄2件（2分差）も潰れない → 行2本・sym@T1 と sym@T2", p14.rows.length === 2 && j(p14.rows.map(r => r.id)) === j([`AAPL@${T1}`, `AAPL@${T2}`]) && p14.counts.both === 2, j(p14.rows.map(r => r.id)) + j(p14.counts))
    // (15) 学習メモリだけの同銘柄・同 reasoning・2分差の2件（blob から溢れた分）→ 2行（10分窓で1件に寄せない）
    const p15 = planBackfill([session('s1', [], [m2, m1])], [])
    check('学習メモリだけの同銘柄・同 reasoning・2分差の2件 → 2行（memoryOnly 2）', p15.rows.length === 2 && p15.counts.memoryOnly === 2 && j(p15.rows.map(r => r.id)) === j([`AAPL@${T1m}`, `AAPL@${T2m}`]), j(p15.counts))
    const p15b = planBackfill([session('s1', [], [m1, record({ id: 'dup', timestamp: T1m })])], [])
    check('学習メモリの (symbol, timestamp) 完全一致だけは1件にする', p15b.rows.length === 1 && p15b.counts.memoryOnly === 1, j(p15b.counts))
    // (16) 既存行は候補1件にしか当たらない: 表に sym@T1 だけある → sym@T2 だけ書く（並びに依らない）
    const exT1: ExistingRow[] = [{ id: `AAPL@${T1}`, symbol: 'AAPL', reasoning: decision().reasoning, decided_at: T1 }]
    const p16 = planBackfill([session('s1', [d2, d1], [m2, m1])], exT1)
    check('既存行が sym@T1 だけ → sym@T2 だけ書く（alreadyStored 1）', p16.rows.length === 1 && p16.rows[0].id === `AAPL@${T2}` && p16.counts.alreadyStored === 1, j(p16.rows.map(r => r.id)) + j(p16.counts))
    const p16b = planBackfill([session('s1', [d1, d2], [m1, m2])], exT1)
    check('その並びが逆でも sym@T2 だけ書く', p16b.rows.length === 1 && p16b.rows[0].id === `AAPL@${T2}`, j(p16b.rows.map(r => r.id)))
    // 学習メモリだけの2件（id は timestamp 由来）と、tick が書いた既存行 sym@T1（decidedAt 由来・3秒前）→ 既存行に当たるのは1件だけ
    const p16c = planBackfill([session('s1', [], [m2, m1])], exT1)
    check('メモリだけの2件＋既存行 sym@T1 → 近い1件（T1m）だけ既存扱い・T2m は書く', p16c.rows.length === 1 && p16c.rows[0].id === `AAPL@${T2m}` && p16c.counts.alreadyStored === 1, j(p16c.rows.map(r => r.id)) + j(p16c.counts))
    // 2026-09-28: (16c) は候補の並び順でバグを踏んだケースそのもの（[m2, m1] だと2分差の T2m が既存行を先に奪っていた）。
    // 逆順でも同じ結果になることを退行防止として固定する（reviewer 再レビュー W2）。
    const p16d = planBackfill([session('s1', [], [m1, m2])], exT1)
    check('その並びが逆（[m1, m2]）でも同じ結果（T1m が既存扱い・T2m だけ書く）', j(p16d.rows.map(r => r.id)) === j(p16c.rows.map(r => r.id)) && j(p16d.counts) === j(p16c.counts), j(p16d.rows.map(r => r.id)) + j(p16d.counts))
    // (17) decidedAt 無しの旧判断は、既に取られた（claimed）メモリを借りない → 見送り（時刻を作らない・原則9）
    const p17 = planBackfill([session('s1', [d1, decision({ decidedAt: undefined, tickId: undefined })], [m1])], [])
    check('decidedAt 無しの判断は claimed 済みのメモリを借りない → 見送り（noTime 1・行は sym@T1 の1本）', p17.rows.length === 1 && p17.rows[0].id === `AAPL@${T1}` && p17.counts.noTime === 1, j(p17.rows.map(r => r.id)) + j(p17.counts))
    // 借りたメモリも claimed: decidedAt 無しの判断が2件・メモリ1件 → 1件目が借り、2件目は見送り（1行に潰さない）
    const p17b = planBackfill([session('s1', [decision({ decidedAt: undefined, tickId: undefined }), decision({ decidedAt: undefined, tickId: undefined, name: 'Apple (2)' })], [m1])], [])
    check('decidedAt 無し2件＋メモリ1件 → 1件目だけ借りる・2件目は見送り（noTime 1）', p17b.rows.length === 1 && p17b.rows[0].name === 'Apple Inc.' && p17b.counts.noTime === 1 && p17b.counts.both === 1, j(p17b.rows.map(r => [r.id, r.name])) + j(p17b.counts))
    check('merged の候補は全件 claimed を持つ（boolean）', p13.merged.every(c => typeof c.claimed === 'boolean') && p15.merged.every(c => c.claimed === false) && p13.merged.every(c => c.claimed === true))
  }

  // ═══ 後始末 ═══
  console.log('後始末')
  check('検査中に通信していない（fetch 0 回）', fetchCalls.length === 0, j(fetchCalls))
  check('偽クライアントが使われた（本物の supabase-js は読み込んでいない）', db.clientsCreated >= 1)
  M._load = realLoad
  globalThis.fetch = realFetch
}

main().then(() => {
  console.log(`\n${passed} PASS / ${failed} FAIL`)
  process.exit(failed === 0 ? 0 : 1)
}).catch(e => {
  console.error('FAIL 検査そのものが落ちた —', e instanceof Error ? e.stack ?? e.message : String(e))
  process.exit(1)
})
