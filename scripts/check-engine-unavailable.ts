// AI の運用エンジン（lib/ai-trader/engine.ts）を、取得元・保存・AI を偽物に差し替えて「取れないとき」の振る舞いを
// 検査する。2026-09-17 architect 計画の②（7a: 比べる起点に実データの印）で作った。③（0銘柄なら AI を呼ばない）の
// 節は同じ土台（下の harness）にそのまま足す。
//
//  - 7a: startSession で SPY が取れたら benchmarkStart ＝ その価格・benchmarkBasis === 'real-v1'
//  - 7a: SPY が取れなかったら benchmarkStart === null・benchmarkBasis のキー自体が無い（undefined でも入れない）
//  - 7a: runTick の後も印は変わらない（取れた場合・取れなかった場合の両方）
//  - 7a: 印の無い旧セッション（benchmarkStart: 567.8・印なし）に runTick をかけても印が足されない
//  - 7a 静的: engine.ts で benchmarkBasis に値を入れる所は startSession の try の中（SPY が取れた直後）の1か所だけ。
//    catch にも runTick にも無い。benchmark-basis.ts は型と定数だけ
//  - 7a 静的: check-previous-close.ts と同じ数え方で「SPY は模擬データなし（2か所）」が保たれている
//
// 実ネットワーク不要・保存しない・AI を呼ばない:
//  - `@/lib/market`（取得元）・`./store`（保存）・`./news`（ニュース）・`@/lib/knowledge/store`（知識）・`child_process`
//    （claude CLI の spawn）を Module._load で差し替え、本物の startSession / runTick を呼ぶ。保存は記憶の中の Map
//    （data/sessions.json には書かない。最後にファイルのハッシュが変わっていないことを確かめる）
//  - ANTHROPIC_API_KEY は読み込む前に消す（API 経路に入らない）。念のため '@anthropic-ai/sdk' も module.registerHooks で
//    「呼ばれたら数える」偽物へ向ける（動的 import なので Module._load では止まらない。無い Node では SKIP）。
//    CLI 経路の spawn も「呼ばれたら数えて、検査用の返事を返す」偽物
//  - globalThis.fetch はどの import より先に「呼ばれたら記録して失敗」に差し替える（最後に 0 回を確かめる）
// 差し替えで返す値は検査用の合成値で、製品コードには入れない（原則9の範囲内）。
//
// 実行: npx tsx scripts/check-engine-unavailable.ts

// ── 0. 通信の遮断と鍵の削除（どの import より先。差し替えが効かなくても外へ出ない・本物の鍵を使わない） ──
const realFetch = globalThis.fetch
const fetchCalls: string[] = []
globalThis.fetch = (async (input: unknown) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
  fetchCalls.push(url)
  throw new Error(`検査中の通信は遮断: ${url}`)
}) as typeof fetch
for (const k of ['ANTHROPIC_API_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'NEXT_PUBLIC_SUPABASE_URL', 'TWELVE_DATA_API_KEY']) {
  delete process.env[k]
}

import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import Module from 'module'
import { EventEmitter } from 'events'
import childProcess from 'child_process'
import type { StockQuote, HistoricalBar, FundamentalsData, InvestorId } from '../types'
import type { AISession } from '../lib/ai-trader/engine'
// 純データ・純関数だけ（読み込んでも通信・保存はしない）
import { BENCHMARK_BASIS } from '../lib/ai-trader/benchmark-basis'
import { createLearningMemory } from '../lib/ai-trader/memory'
import { UNIVERSE, TICK_CANDIDATE_COUNT } from '../lib/ai-trader/universe'

let passed = 0
let failed = 0
let skipped = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS ${name}`)
  } else {
    failed++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}
// 環境の都合で実行できない検査。FAIL ではなく SKIP と数え、理由を必ず出す（黙って飛ばさない）
function skip(name: string, detail = '') {
  skipped++
  console.log(`  SKIP ${name}${detail ? ` — ${detail}` : ''}`)
}

const ROOT = process.cwd()
const j = (v: unknown) => JSON.stringify(v)
const code = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
const SESSIONS_FILE = path.join(ROOT, 'data', 'sessions.json')
const fileHash = (p: string) => fs.existsSync(p) ? crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex') : 'absent'
const sessionsHashBefore = fileHash(SESSIONS_FILE)

// ══════════════════════════════════════════════════════════════════════════════════════════
// harness: 差し替えの土台（節を足すときはここの state を操作する）
// ══════════════════════════════════════════════════════════════════════════════════════════

// ── 取得元の偽物（@/lib/market） ──
// 検査用の合成値。SPY の値は「実データの範囲」とは無関係の目印（値の範囲で判別しない方針なので、値そのものに意味は無い）
const QUOTE: StockQuote = {
  symbol: 'AAPL', name: 'Apple Inc.', price: 300, change: 1.5, changePercent: 0.5, volume: 1_000_000,
  currency: 'USD', market: 'US', isMarketOpen: false, lastUpdated: '2026-09-17T00:00:00.000Z',
}
const HISTORY: HistoricalBar[] = Array.from({ length: 250 }, (_, i) => ({
  time: 1_700_000_000 + i * 86_400, open: 200 + i * 0.4, high: 201 + i * 0.4, low: 199 + i * 0.4,
  close: 200 + i * 0.4 + (i % 3 === 0 ? -0.6 : 0.3), volume: 1_000_000,
}))
const FUNDAMENTALS: FundamentalsData = { pe: 20, roe: 0.2, debtToEquity: 40 }
const market = {
  spyFails: false,     // SPY だけ取れない（起点・比較点）
  quotesFail: false,   // SPY 以外の全銘柄が取れない（③ の「0銘柄」に使う）
  spyPrice: 650,
  log: [] as string[], // 'quote:SYM' / 'history:SYM' / 'fundamentals:SYM'
}
const unavailable = (symbol: string) => new Error(`Real quote unavailable for ${symbol} — yahoo2: 429 / yahoodirect: 429`)
const marketStub = {
  getQuote: async (symbol: string, opts?: { allowMock?: boolean }): Promise<StockQuote> => {
    if (opts?.allowMock !== false) throw new Error(`allowMock:false が外れている (getQuote ${symbol})`)
    market.log.push(`quote:${symbol}`)
    if (symbol === 'SPY') {
      if (market.spyFails) throw unavailable(symbol)
      return { ...QUOTE, symbol, name: 'SPDR S&P 500 ETF', price: market.spyPrice, change: null, changePercent: null }
    }
    if (market.quotesFail) throw unavailable(symbol)
    const idx = Math.max(0, UNIVERSE.indexOf(symbol))
    return { ...QUOTE, symbol, name: `${symbol} Inc.`, price: 100 + idx, changePercent: ((idx * 7) % 11) - 5, change: 1 }
  },
  getHistory: async (symbol: string, _period: string, opts?: { allowMock?: boolean }): Promise<HistoricalBar[]> => {
    if (opts?.allowMock !== false) throw new Error(`allowMock:false が外れている (getHistory ${symbol})`)
    market.log.push(`history:${symbol}`)
    if (market.quotesFail) throw unavailable(symbol)
    return HISTORY
  },
  getFundamentals: async (symbol: string, opts?: { allowMock?: boolean }): Promise<FundamentalsData> => {
    if (opts?.allowMock !== false) throw new Error(`allowMock:false が外れている (getFundamentals ${symbol})`)
    market.log.push(`fundamentals:${symbol}`)
    return { ...FUNDAMENTALS }
  },
}

// ── 保存の偽物（lib/ai-trader/store）。本物と同じく、読むたびに新しいオブジェクト（JSON 経由）を返す ──
const store = {
  rows: new Map<string, string>(),
  upserts: 0,
  lastUpserted: null as AISession | null, // 保存に渡された「生の」オブジェクト（JSON を通す前。undefined のキーもここでは見える）
}
const storeStub = {
  getSession: async (id: string): Promise<AISession | undefined> => {
    const raw = store.rows.get(id)
    return raw ? (JSON.parse(raw) as AISession) : undefined
  },
  listSessions: async (): Promise<AISession[]> => [...store.rows.values()].map(r => JSON.parse(r) as AISession),
  upsertSession: async (session: AISession): Promise<void> => {
    store.upserts++
    store.lastUpserted = session
    store.rows.set(session.id, JSON.stringify(session))
  },
}
const storedJson = (id: string) => JSON.parse(store.rows.get(id) ?? 'null') as AISession | null

// ── ニュースと知識の偽物（通信・ファイルに出ない） ──
const side = { newsCalls: 0, knowledgeListCalls: 0, knowledgeUsageCalls: 0 }
const newsStub = { fetchNews: async (_symbol: string, _count?: number) => { side.newsCalls++; return [] } }
const knowledgeStub = {
  listKnowledge: async () => { side.knowledgeListCalls++; return [] },
  recordKnowledgeUsage: async () => { side.knowledgeUsageCalls++ },
}

// ── AI の偽物。CLI 経路（spawn('claude')）は数えて検査用の返事を返す。API 経路（@anthropic-ai/sdk）は数えて失敗する ──
type FakeProc = EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write(chunk: string | Buffer): boolean; end(): void }
}
const ai = {
  mode: 'reply' as 'reply' | 'fail',
  spawnCalls: 0,
  prompts: [] as string[],
  sdkConstructed: 0,
  sdkCalls: 0,
  // 返事: プロンプトの【SYM】ごとに hold を1行。engine の extractDecisionArray が読む形（```json フェンス）
  reply(prompt: string): string {
    const symbols = [...prompt.matchAll(/【([A-Z][A-Z0-9.\-]*)】/g)].map(m => m[1])
    const rows = symbols.map(s => ({
      symbol: s, action: 'hold', confidence: 'low', reasoning: '検査用の判断', newsInfluence: '', techSignal: '', fundSignal: '', knowledgeRefs: [],
    }))
    return '```json\n' + JSON.stringify(rows) + '\n```\n'
  },
}
;(globalThis as Record<string, unknown>).__checkEngineUnavailable = ai
function fakeSpawn(cmd: string, args: string[]): FakeProc {
  ai.spawnCalls++
  const proc = new EventEmitter() as FakeProc
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  let input = ''
  proc.stdin = {
    write: (chunk) => { input += String(chunk); return true },
    end: () => {
      setImmediate(() => {
        if (ai.mode === 'fail') {
          proc.stderr.emit('data', Buffer.from(`検査: ${cmd} ${args.join(' ')} を失敗させた`))
          proc.emit('close', 1)
          return
        }
        ai.prompts.push(input)
        proc.stdout.emit('data', Buffer.from(ai.reply(input)))
        proc.emit('close', 0)
      })
    },
  }
  return proc
}
const childProcessStub = { ...childProcess, spawn: fakeSpawn }

// API 経路の偽物（別モジュールとして評価されるので globalThis 経由で ai を共有する）
const FAKE_SDK_SRC = `
const s = globalThis.__checkEngineUnavailable;
export default class FakeAnthropic {
  constructor() { s.sdkConstructed++ }
  get messages() { return { create: async () => { s.sdkCalls++; throw new Error('検査中は Anthropic API を呼ばない') } } }
}
`
const FAKE_SDK_URL = 'data:text/javascript,' + encodeURIComponent(FAKE_SDK_SRC)
type ResolveResult = { url: string; format?: string; shortCircuit?: boolean }
type ResolveHook = (specifier: string, context: unknown, next: (s: string, c: unknown) => ResolveResult) => ResolveResult
type ModuleWithHooks = typeof Module & { registerHooks?: (hooks: { resolve: ResolveHook }) => { deregister(): void } }
const registerHooks = (Module as ModuleWithHooks).registerHooks
const sdkLeaked: string[] = [] // 本物の @anthropic-ai/sdk が解決されてしまった URL
const hooks = registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@anthropic-ai/sdk') return { url: FAKE_SDK_URL, format: 'module', shortCircuit: true }
    const r = nextResolve(specifier, context)
    if (String(r.url).includes('@anthropic-ai')) sdkLeaked.push(String(r.url))
    return r
  },
})

// ── Module._load（CJS の require）の差し替え ──
const norm = (p?: string) => (p ?? '').replace(/\\/g, '/')
const fromEngine = (parent: unknown) => norm((parent as { filename?: string } | undefined)?.filename).endsWith('/lib/ai-trader/engine.ts')
type ModuleWithLoad = typeof Module & { _load: (request: string, parent: unknown, ...rest: unknown[]) => unknown }
const M = Module as unknown as ModuleWithLoad
const realLoad = M._load
M._load = function (request: string, parent: unknown, ...rest: unknown[]) {
  if (request === 'server-only') return {}
  if (request === '@/lib/market') return marketStub
  if (request === '@/lib/knowledge/store') return knowledgeStub
  if (request === './store' && fromEngine(parent)) return storeStub
  if (request === './news' && fromEngine(parent)) return newsStub
  if (request === 'child_process' || request === 'node:child_process') return childProcessStub
  if (request === '@anthropic-ai/sdk') return { default: class { constructor() { ai.sdkConstructed++ } get messages() { return { create: async () => { ai.sdkCalls++; throw new Error('検査中は Anthropic API を呼ばない') } } } } }
  return realLoad.call(this, request, parent, ...rest)
}

type Engine = {
  startSession: (capital?: number, persona?: InvestorId) => Promise<AISession>
  runTick: (sessionId: string) => Promise<AISession>
}
function loadEngine(): Engine {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(ROOT, 'lib/ai-trader/engine.ts')) as Engine
}

// engine の console.warn（usage 行など）は検査の出力に混ぜず集める
const warns: string[] = []
const realWarn = console.warn
async function quietly<T>(fn: () => Promise<T>): Promise<T> {
  console.warn = (...a: unknown[]) => { warns.push(a.map(String).join(' ')) }
  try { return await fn() } finally { console.warn = realWarn }
}
async function rejects(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null } catch (e) { return e instanceof Error ? e.message : String(e) }
}
// 各節の入口: 取得元の状態を既定に戻し、市場ログを空にする（保存の Map は節をまたいで残す＝旧セッションの検査で使う）
function fresh(where: string) {
  market.spyFails = false
  market.quotesFail = false
  market.spyPrice = 650
  market.log = []
  ai.mode = 'reply'
  console.log(`■ ${where}`)
}
const spyQuotes = () => market.log.filter(l => l === 'quote:SPY').length
// runTick の中の SPY の問い合わせ: 候補の走査（UNIVERSE に SPY が入っていれば 1 回。偽物は前日比 null を返すので候補には
// 選ばれない）＋ ベンチマークの比較点（benchmarkStart があるときだけ 1 回。tick の最後の市場呼び出し）
const UNIVERSE_SPY = UNIVERSE.includes('SPY') ? 1 : 0
const lastMarketCall = () => market.log[market.log.length - 1]
const benchmarkQuotedInTick = () => spyQuotes() === UNIVERSE_SPY + 1 && lastMarketCall() === 'quote:SPY'
const benchmarkNotQuotedInTick = () => spyQuotes() === UNIVERSE_SPY && lastMarketCall() !== 'quote:SPY'
// startSession の id は `session_${Date.now()}`。同じミリ秒に 2 回呼ぶと同じ id になり保存が上書きされるので、次のミリ秒まで待つ
async function nextMs() {
  const t = Date.now()
  while (Date.now() === t) await new Promise(r => setTimeout(r, 1))
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// 1. 差し替えの確認（検査自体が空振りしていない）
// ══════════════════════════════════════════════════════════════════════════════════════════
async function stubWorks(engine: Engine) {
  fresh('差し替えの確認（本物の startSession が偽物の取得元・保存を使っている）')
  check('ANTHROPIC_API_KEY・Supabase の鍵は消えている（API 経路・Supabase 経路に入らない）',
    process.env.ANTHROPIC_API_KEY === undefined && process.env.SUPABASE_SERVICE_ROLE_KEY === undefined && process.env.NEXT_PUBLIC_SUPABASE_URL === undefined)
  if (typeof registerHooks === 'function' && hooks != null) {
    check("'@anthropic-ai/sdk' の resolve フックが登録できた（Node 23.5 以上）", true, `node ${process.version}`)
  } else {
    skip("'@anthropic-ai/sdk' の resolve フック（module.registerHooks）が無い Node。鍵を消しているので API 経路には入らないが、動的 import の差し替えは無い", `node ${process.version}`)
  }
  await nextMs()
  const s = await quietly(() => engine.startSession(100000))
  check('startSession が偽物の取得元で SPY を 1 回問い合わせた', spyQuotes() === 1, j(market.log))
  check('保存は偽物（Map）に 1 回だけ。data/sessions.json には書いていない', store.upserts === 1 && store.rows.size === 1 && fileHash(SESSIONS_FILE) === sessionsHashBefore, `upserts=${store.upserts}`)
  check('保存されたのは返ったセッションと同じ id', store.lastUpserted?.id === s.id && storedJson(s.id)?.id === s.id)
  check('通信（fetch）は 0 回', fetchCalls.length === 0, j(fetchCalls))
  store.rows.delete(s.id) // 確認用のセッションは残さない
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// 2. 7a: 起点の印（startSession）
// ══════════════════════════════════════════════════════════════════════════════════════════
const sessions: { withBasis?: AISession; withoutBasis?: AISession } = {}

async function basisOnStart(engine: Engine) {
  fresh('7a: SPY が取れたとき — benchmarkStart ＝ その価格・benchmarkBasis === \'real-v1\'')
  market.spyPrice = 650
  await nextMs()
  const s = await quietly(() => engine.startSession(100000))
  sessions.withBasis = s
  check('benchmarkStart は取れた価格（650）', s.benchmarkStart === 650, String(s.benchmarkStart))
  check("benchmarkBasis === 'real-v1'", s.benchmarkBasis === 'real-v1', j(s.benchmarkBasis))
  check('その値は benchmark-basis.ts の定数と同じ（文字列の手書きではない）', s.benchmarkBasis === BENCHMARK_BASIS && BENCHMARK_BASIS === 'real-v1')
  check('保存された JSON にも印がある', storedJson(s.id)?.benchmarkBasis === 'real-v1', j(storedJson(s.id)?.benchmarkBasis))
  check('SPY の問い合わせは 1 回（起点の決め方は変えていない）', spyQuotes() === 1, j(market.log))

  fresh('7a: SPY が取れなかったとき — benchmarkStart === null・benchmarkBasis のキー自体が無い')
  market.spyFails = true
  await nextMs()
  const n = await quietly(() => engine.startSession(100000))
  sessions.withoutBasis = n
  check('前提: 2 つのセッションの id が別（同じミリ秒で上書きしていない）', s.id !== n.id, `${s.id} / ${n.id}`)
  check('benchmarkStart === null（乱数で埋めない・0 で埋めない）', n.benchmarkStart === null, String(n.benchmarkStart))
  check("'benchmarkBasis' in session === false（キー自体が無い。undefined を入れて「キーだけある」にもしない）",
    !('benchmarkBasis' in n), j(Object.keys(n)))
  check('保存に渡した生のオブジェクトにもキーが無い', store.lastUpserted === n && !('benchmarkBasis' in (store.lastUpserted ?? {})))
  check('保存された JSON にもキーが無い', !('benchmarkBasis' in (storedJson(n.id) ?? {})), j(Object.keys(storedJson(n.id) ?? {})))
  check('SPY は問い合わせている（失敗しただけ）', spyQuotes() === 1, j(market.log))
  check('取れた回と取れなかった回で、印以外の形は同じ（キーの集合の差は benchmarkBasis だけ）',
    j(Object.keys(s).filter(k => k !== 'benchmarkBasis').sort()) === j(Object.keys(n).sort()), `${j(Object.keys(s))} vs ${j(Object.keys(n))}`)
  check('2 セッションとも保存は偽物に（ファイルは不変）', store.rows.size === 2 && fileHash(SESSIONS_FILE) === sessionsHashBefore)
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// 3. 7a: runTick の後も印は変わらない
// ══════════════════════════════════════════════════════════════════════════════════════════
async function basisAfterTick(engine: Engine) {
  const s = sessions.withBasis!
  const n = sessions.withoutBasis!

  fresh('7a: 印のあるセッションに runTick — 印はそのまま・benchmarkPct は起点 650 と比べた値')
  market.spyPrice = 663 // (663 - 650) / 650 = +2.00%
  const spawnBefore = ai.spawnCalls
  const after = await quietly(() => engine.runTick(s.id))
  check('AI（claude CLI の偽物）が 1 回呼ばれた（tick が最後まで走った）', ai.spawnCalls === spawnBefore + 1, `${ai.spawnCalls - spawnBefore} 回`)
  check(`判断が候補の数（${TICK_CANDIDATE_COUNT}）だけ返り tickCount は 1`, after.decisions.length === TICK_CANDIDATE_COUNT && after.tickCount === 1, `${after.decisions.length} 件 / tickCount=${after.tickCount}`)
  check("印は 'real-v1' のまま", after.benchmarkBasis === 'real-v1', j(after.benchmarkBasis))
  check('benchmarkStart は 650 のまま（tick で書き換えない）', after.benchmarkStart === 650, String(after.benchmarkStart))
  check('equityHistory[0].benchmarkPct は +2（起点 650・比較点 663）', after.equityHistory.length === 1 && after.equityHistory[0].benchmarkPct === 2, j(after.equityHistory))
  check('tick の最後に SPY を 1 回問い合わせた（比較点。候補の走査ぶんとは別）', benchmarkQuotedInTick(), `SPY ${spyQuotes()} 回 / 最後=${lastMarketCall()}`)
  check('保存された JSON も印あり', storedJson(s.id)?.benchmarkBasis === 'real-v1')
  check('通信（fetch）は 0 回・ニュースは偽物が受けた', fetchCalls.length === 0 && side.newsCalls > 0, `fetch=${j(fetchCalls)} news=${side.newsCalls}`)

  fresh('7a: 印の無いセッション（起点 null）に runTick — 後から SPY が取れても印は足されず、比較もしない')
  market.spyFails = false // tick の時点では SPY が取れる
  market.spyPrice = 663
  const spawnBefore2 = ai.spawnCalls
  const after2 = await quietly(() => engine.runTick(n.id))
  check('AI が 1 回呼ばれた（tick が最後まで走った）', ai.spawnCalls === spawnBefore2 + 1)
  check("'benchmarkBasis' in session === false のまま", !('benchmarkBasis' in after2), j(Object.keys(after2)))
  check('benchmarkStart は null のまま（tick で起点を後付けしない）', after2.benchmarkStart === null, String(after2.benchmarkStart))
  // 生のオブジェクトは `{ ..., benchmarkPct }`（値 undefined）なのでキーだけは残る（スライス3からの形。保存の JSON では消える）
  check('benchmarkPct は出さない（起点が無いので比べない。保存の JSON にはキーも無い）',
    after2.equityHistory.length === 1 && after2.equityHistory[0].benchmarkPct === undefined
    && !('benchmarkPct' in (storedJson(n.id)?.equityHistory[0] ?? {})), j(after2.equityHistory))
  check('tick の最後に SPY を問い合わせていない（起点 null なら比較点を取りに行かない。候補の走査ぶんだけ）', benchmarkNotQuotedInTick(), `SPY ${spyQuotes()} 回 / 最後=${lastMarketCall()}`)
  check('保存された JSON にもキーが無い', !('benchmarkBasis' in (storedJson(n.id) ?? {})))

  fresh('7a: 印のあるセッションで tick の SPY が取れない回 — 印は消えず、その回の benchmarkPct だけ出ない')
  market.spyFails = true
  const after3 = await quietly(() => engine.runTick(s.id))
  check("印は 'real-v1' のまま（取れない回に消さない）", after3.benchmarkBasis === 'real-v1', j(after3.benchmarkBasis))
  check('benchmarkStart は 650 のまま', after3.benchmarkStart === 650)
  check('2 回目の点は benchmarkPct 無し・1 回目の +2 は残る', after3.equityHistory.length === 2 && after3.equityHistory[0].benchmarkPct === 2 && after3.equityHistory[1].benchmarkPct === undefined, j(after3.equityHistory))
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// 4. 7a: 印の無い旧セッションに runTick をかけても印が足されない
// ══════════════════════════════════════════════════════════════════════════════════════════
// 2026-09-17 より前の形（benchmarkStart はあるが印が無い。起点が実データだったか模擬データだったかは分からない）
function oldSession(): AISession {
  return {
    id: 'session_1757000000000', startedAt: '2026-09-04T13:30:00.000Z', lastTickAt: '2026-09-04T20:00:00.000Z',
    tickCount: 3, capital: 100000, cash: 100000, holdings: {}, trades: [], decisions: [], watchlist: [],
    totalValue: 100000, pnl: 0, pnlPct: 0, marketContext: '', learning: createLearningMemory(),
    equityHistory: [{ timestamp: '2026-09-04T20:00:00.000Z', totalValue: 100000, cash: 100000, pnlPct: 0, benchmarkPct: 0.35 }],
    benchmarkStart: 567.8,
    stats: { daysRunning: 1, maxValue: 100000, minValue: 100000, maxDrawdownPct: 0, annualizedReturnPct: 0, sharpeRatio: 0, totalTradeCount: 0, winRate: 0 },
    auto: { enabled: false, date: '', count: 0 },
  }
}
async function oldSessionUntouched(engine: Engine) {
  fresh('7a: 旧セッション（benchmarkStart: 567.8・印なし）に runTick — 印を足さない・起点も変えない')
  const old = oldSession()
  check('前提: 種の旧セッションに印が無い', !('benchmarkBasis' in old))
  store.rows.set(old.id, JSON.stringify(old))
  market.spyPrice = 663 // (663 - 567.8) / 567.8 = +16.77%
  const spawnBefore = ai.spawnCalls
  const after = await quietly(() => engine.runTick(old.id))
  check('AI が 1 回呼ばれた（tick が最後まで走った）', ai.spawnCalls === spawnBefore + 1)
  check("'benchmarkBasis' in session === false（補完で足していない）", !('benchmarkBasis' in after), j(Object.keys(after)))
  check('benchmarkStart は 567.8 のまま（補完で書き換えない・消さない）', after.benchmarkStart === 567.8, String(after.benchmarkStart))
  check('従来どおり起点 567.8 と比べた benchmarkPct（+16.77）は出る（画面の注記は 7b で付ける）',
    after.equityHistory.length === 2 && after.equityHistory[1].benchmarkPct === 16.77, j(after.equityHistory))
  check('tickCount は 3 → 4（tick 自体は今までどおり進む）', after.tickCount === 4, String(after.tickCount))
  check('保存された JSON にもキーが無い', !('benchmarkBasis' in (storedJson(old.id) ?? {})), j(Object.keys(storedJson(old.id) ?? {})))

  fresh('7a: 旧セッションで tick の SPY も取れない回 — それでも印は足されない')
  market.spyFails = true
  const after2 = await quietly(() => engine.runTick(old.id))
  check("'benchmarkBasis' in session === false のまま", !('benchmarkBasis' in after2))
  check('benchmarkStart は 567.8 のまま・その回の benchmarkPct は無し', after2.benchmarkStart === 567.8 && after2.equityHistory[2]?.benchmarkPct === undefined, j(after2.equityHistory))
}

// ══════════════════════════════════════════════════════════════════════════════════════════
// 5. 静的: 印を付ける所は startSession の try の中の1か所だけ
// ══════════════════════════════════════════════════════════════════════════════════════════
// 注釈を落としたコード（注釈に書いた「catch では付けない」などを誤検知しないため）。文字列の中の // は残す
function stripComments(src: string): string {
  let out = ''
  let i = 0
  while (i < src.length) {
    const c = src[i]
    const n = src[i + 1]
    if (c === '"' || c === "'" || c === '`') {
      out += c; i++
      while (i < src.length && src[i] !== c) {
        if (src[i] === '\\') { out += src[i]; i++ }
        out += src[i] ?? ''; i++
      }
      out += src[i] ?? ''; i++
      continue
    }
    if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; continue }
    if (c === '/' && n === '*') { i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue }
    out += c; i++
  }
  return out
}
const count = (src: string, re: RegExp) => (src.match(re) ?? []).length
// 関数の本文: 宣言の位置から、次の「行頭の宣言」まで
function fnBody(src: string, decl: string): string {
  const start = src.indexOf(decl)
  if (start < 0) return ''
  const rest = src.slice(start + decl.length)
  const next = rest.search(/\n(?:export |async function |function |const |let |class |interface |type )/)
  return next < 0 ? src.slice(start) : src.slice(start, start + decl.length + next)
}

function staticChecks() {
  console.log('■ 静的: engine.ts で印を付ける所は startSession の try の中（SPY が取れた直後）の1か所だけ')
  const engineSrc = stripComments(code('lib/ai-trader/engine.ts'))
  const importLine = engineSrc.match(/^import[^\n]*benchmark-basis[^\n]*$/m)?.[0] ?? ''
  check("BENCHMARK_BASIS と BenchmarkBasis は './benchmark-basis' から import（engine.ts に文字列の手書きが無い）",
    importLine.includes('BENCHMARK_BASIS') && importLine.includes('BenchmarkBasis') && !/['"]real-v1['"]/.test(engineSrc))
  const body = engineSrc.replace(importLine, '')
  const startSession = fnBody(body, 'export async function startSession(')
  const runTick = fnBody(body, 'export async function runTick(')
  const tryAt = startSession.indexOf('try {')
  const catchAt = startSession.indexOf('} catch', tryAt)
  const tryBody = tryAt > -1 && catchAt > tryAt ? startSession.slice(tryAt, catchAt) : ''
  const catchClose = catchAt > -1 ? startSession.indexOf('}', catchAt + '} catch'.length) : -1
  const catchBody = catchAt > -1 && catchClose > catchAt ? startSession.slice(catchAt + '} catch'.length, catchClose) : ''
  check('startSession・runTick・try/catch が見つかる', startSession.length > 0 && runTick.length > 0 && tryBody.length > 0 && catchClose > -1)
  check('BENCHMARK_BASIS の使用は import を除いて 1 回', count(body, /\bBENCHMARK_BASIS\b/g) === 1, `${count(body, /\bBENCHMARK_BASIS\b/g)} 回`)
  check("その 1 回は startSession の try の中で、getQuote('SPY', { allowMock: false }) の後",
    count(tryBody, /\bBENCHMARK_BASIS\b/g) === 1 && tryBody.indexOf("getQuote('SPY', { allowMock: false })") > -1
    && tryBody.indexOf("getQuote('SPY', { allowMock: false })") < tryBody.indexOf('BENCHMARK_BASIS'))
  check('benchmarkBasis への代入（=）は 1 回だけで、同じ try の中', count(body, /\bbenchmarkBasis\s*=(?!=)/g) === 1 && count(tryBody, /\bbenchmarkBasis\s*=(?!=)/g) === 1, `${count(body, /\bbenchmarkBasis\s*=(?!=)/g)} 回`)
  check('catch の中に印を付ける行が無い', !/benchmarkBasis|BENCHMARK_BASIS/.test(catchBody), catchBody.trim())
  check('セッションの項目への直接代入（.benchmarkBasis =）が無い（補完で足す・消す経路が無い）', !/\.benchmarkBasis\s*=(?!=)/.test(body))
  check('runTick に benchmarkBasis が出てこない', !/benchmarkBasis|BENCHMARK_BASIS/.test(runTick))
  check('印が無いときはキーごと持たない（条件付きの spread）', startSession.includes('...(benchmarkBasis !== undefined ? { benchmarkBasis } : {})'))
  check('AISession の benchmarkBasis は任意項目（?:）', /benchmarkBasis\?:\s*BenchmarkBasis/.test(engineSrc))
  check('benchmarkStart の決め方は変えていない（benchmarkStart = spy.price）', tryBody.includes('benchmarkStart = spy.price') && count(body, /\bbenchmarkStart\s*=(?!=)/g) === 2 /* 初期化 null と spy.price */)

  console.log('■ 静的: benchmark-basis.ts は型と定数だけ（import・副作用なし）')
  const basisSrc = stripComments(code('lib/ai-trader/benchmark-basis.ts'))
  check("export type BenchmarkBasis = 'real-v1'", basisSrc.includes("export type BenchmarkBasis = 'real-v1'"))
  check("export const BENCHMARK_BASIS: BenchmarkBasis = 'real-v1'", basisSrc.includes("export const BENCHMARK_BASIS: BenchmarkBasis = 'real-v1'"))
  check('import・require・process・fetch が無い', !/\bimport\b|\brequire\(|\bprocess\.|\bfetch\(/.test(basisSrc))
  check('export の 2 行以外に文が無い', basisSrc.split('\n').map(l => l.trim()).filter(Boolean).every(l => l.startsWith('export ')), basisSrc.trim())

  console.log('■ 静的: check-previous-close.ts と同じ数え方で「SPY は模擬データなし（2か所）」が保たれている')
  const engineLines = code('lib/ai-trader/engine.ts').split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  check("getQuote('SPY', { allowMock: false }) が 2 か所・getQuote('SPY') が無い",
    count(engineLines, /getQuote\('SPY', \{ allowMock: false \}\)/g) === 2 && !/getQuote\('SPY'\)/.test(engineLines))
}

// ══════════════════════════════════════════════════════════════════════════════════════════
async function main() {
  const engine = loadEngine()
  await stubWorks(engine)
  await basisOnStart(engine)
  await basisAfterTick(engine)
  await oldSessionUntouched(engine)
  staticChecks()

  console.log('■ 最後にもう一度: 通信 0 回・Anthropic API 0 回・ファイル不変')
  check('通信（fetch）は 0 回', fetchCalls.length === 0, j(fetchCalls))
  check('Anthropic API（SDK）は作られても呼ばれてもいない', ai.sdkConstructed === 0 && ai.sdkCalls === 0 && sdkLeaked.length === 0, j({ constructed: ai.sdkConstructed, calls: ai.sdkCalls, leaked: sdkLeaked }))
  check('AI の呼び出し（CLI の偽物）は runTick の回数（5）と同じ', ai.spawnCalls === 5, String(ai.spawnCalls))
  check('ANTHROPIC_API_KEY は最後まで無い', process.env.ANTHROPIC_API_KEY === undefined)
  check('data/sessions.json は 1 バイトも変わっていない', fileHash(SESSIONS_FILE) === sessionsHashBefore, `${sessionsHashBefore} → ${fileHash(SESSIONS_FILE)}`)
  check('知識の使用記録は呼ばれていない（判断に knowledgeRefs が無い）', side.knowledgeUsageCalls === 0 && side.knowledgeListCalls > 0)
}

main()
  .catch(err => {
    failed++
    console.error(err)
  })
  .finally(() => {
    M._load = realLoad
    hooks?.deregister()
    globalThis.fetch = realFetch
    console.log('')
    console.log(`PASS ${passed} 件 / FAIL ${failed} 件 / SKIP ${skipped} 件`)
    if (failed) process.exit(1)
    console.log(skipped ? `FAIL 無し（SKIP ${skipped} 件。上の SKIP 行に理由あり）` : 'すべてPASS')
  })
