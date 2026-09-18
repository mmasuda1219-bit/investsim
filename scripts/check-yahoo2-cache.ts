// yahoo2（lib/market/providers/yahoo2.ts）のキャッシュの検査（2026-09-17 architect 計画①）。
//
//  - 本題: getFundamentals は「取れなかった結果（空 {}）」を覚えない。旧実装は空も30分覚えたので、次の30分は
//    問い合わせずに空が即返り、lib/market/index.ts（キーが1つ以上のときだけ受け取る）が毎回 yahoodirect（通常 429）へ
//    落ちて「判定できません」が固定されていた
//  - 値ありの結果は覚える（2回目は問い合わせない）。一部だけの結果（marketCap だけ）も覚える（「全部そろっていないと覚えない」にはしない）
//  - 取得元が失敗（throw）したときも覚えない
//  - yahoo2 は「キーはあるが中身が undefined」の形を返さない（num() が有限数だけを通し、undefined を落としてから返す）
//  - quote・history に同じ問題が無い（価格が無い／足が0本なら throw で、失敗はキャッシュに入らない）
//  - 静的: 覚える条件が index.ts の受け取る条件（Object.keys(...).length > 0）と同じ
//
// 実ネットワーク不要。yahoo2.ts は `await import('yahoo-finance2')` で取得元を読むので、Module._load（CJS の require の
// 差し替え）では止まらない。Node の module.registerHooks（resolve フック）で 'yahoo-finance2' を検査用の偽物（data: URL）へ
// 向け、本物の yf2GetFundamentals / yf2GetQuote / yf2GetHistory を呼ぶ。偽物は問い合わせ回数を数えるので、「検査自体が
// 空振りしていない」ことを先に示す。念のため globalThis.fetch も検査の中だけ差し替え、呼ばれたら失敗にする。
// 差し替えで返す値は検査用の合成値で、製品コードには入れない（原則9の範囲内）。
//
// 差し替えを使う検査（1〜5節）は Node 23.5 以上（22 系は 22.15 以上）でのみ実行される。yahoo-finance2 が動的 import のため
// Module._load では差し替えられず、module.registerHooks が要るため。無い環境では FAIL ではなく SKIP（理由と Node の版を出す）
// として exit 0 で終え、フックの要らない 6 節（静的な確認）だけ行う。
//
// 実行: npx tsx scripts/check-yahoo2-cache.ts

// ── 0. 通信の遮断（どの import より先。差し替えが効かなくても外へ出ない） ──
const realFetch = globalThis.fetch
const fetchCalls: string[] = []
globalThis.fetch = (async (input: unknown) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
  fetchCalls.push(url)
  throw new Error(`検査中の通信は遮断: ${url}`)
}) as typeof fetch

import fs from 'fs'
import path from 'path'
import Module from 'module'
import type { StockQuote, HistoricalBar, FundamentalsData } from '../types'

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

// ── 取得元の偽物（この検査の中だけ） ──
type Method = 'quoteSummary' | 'quote' | 'chart'
type FakeState = {
  constructed: unknown[]
  calls: Record<Method, number>
  log: string[]
  next: Record<Method, Array<() => unknown>>
  call(method: Method, symbol: string, opts?: unknown): unknown
}
const state: FakeState = {
  constructed: [],
  calls: { quoteSummary: 0, quote: 0, chart: 0 },
  log: [],
  next: { quoteSummary: [], quote: [], chart: [] },
  call(method, symbol, opts) {
    this.calls[method]++
    this.log.push(`${method}:${symbol}:${j(opts) ?? ''}`)
    const fn = this.next[method].shift()
    if (!fn) throw new Error(`検査の応答が用意されていない: ${method}(${symbol})`)
    return fn()
  },
}
;(globalThis as Record<string, unknown>).__checkYahoo2Cache = state

// 偽物の本体。別モジュールとして評価されるので globalThis 経由で state を共有する
const FAKE_SRC = `
const s = globalThis.__checkYahoo2Cache;
export default class FakeYahooFinance {
  constructor(opts) { s.constructed.push(opts) }
  async quoteSummary(symbol, opts) { return s.call('quoteSummary', symbol, opts) }
  async quote(symbol) { return s.call('quote', symbol) }
  async chart(symbol, opts) { return s.call('chart', symbol, opts) }
}
`
const FAKE_URL = 'data:text/javascript,' + encodeURIComponent(FAKE_SRC)

type ResolveResult = { url: string; format?: string; shortCircuit?: boolean }
type ResolveHook = (specifier: string, context: unknown, next: (s: string, c: unknown) => ResolveResult) => ResolveResult
type ModuleWithHooks = typeof Module & { registerHooks?: (hooks: { resolve: ResolveHook }) => { deregister(): void } }
const registerHooks = (Module as ModuleWithHooks).registerHooks
const redirected: string[] = [] // 偽物へ向けた回数
const leaked: string[] = []     // 本物の yahoo-finance2 が解決されてしまった URL
const hooks = registerHooks?.({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'yahoo-finance2') {
      redirected.push(specifier)
      return { url: FAKE_URL, format: 'module', shortCircuit: true }
    }
    const r = nextResolve(specifier, context)
    if (String(r.url).includes('yahoo-finance2')) leaked.push(String(r.url))
    return r
  },
})

const reply = (method: Method, ...responses: Array<() => unknown>) => { state.next[method].push(...responses) }
const calls = (method: Method) => state.calls[method]
const queued = () => ({ quoteSummary: state.next.quoteSummary.length, quote: state.next.quote.length, chart: state.next.chart.length })
// 各節の入口: キャッシュを空にし、前の節が用意した応答を使い切っていることを確かめる（余りがあると以降の応答が1つずつずれる）
function fresh(y: Yahoo2, where: string) {
  y._clearYahoo2Cache()
  const q = queued()
  check(`${where}: 前の応答の余りが無い（応答のずれ無し）`, q.quoteSummary === 0 && q.quote === 0 && q.chart === 0, j(q))
}

// 検査用の合成値（yahoo-finance2 v3 の形: 数値はそのまま、.raw は無い）。AAPL の形に合わせた「それらしい」値
const FULL = () => ({
  summaryDetail: { trailingPE: 38.2, marketCap: 4_500_000_000_000, dividendYield: 0.004, fiftyTwoWeekHigh: 340, fiftyTwoWeekLow: 200 },
  defaultKeyStatistics: { priceToBook: 45.16, pegRatio: 2.67, trailingEps: 7.9 },
  financialData: { returnOnEquity: 1.488, debtToEquity: 78.4, freeCashflow: 100_000_000_000, revenueGrowth: 0.164, earningsGrowth: 0.287 },
})
const PARTIAL = () => ({ summaryDetail: { marketCap: 1 } })
// 「取れなかった」のいろいろな形
const EMPTY_FORMS: Array<[string, () => unknown]> = [
  ['{}', () => ({})],
  ['null', () => null],
  ['3モジュールとも空 {}', () => ({ summaryDetail: {}, defaultKeyStatistics: {}, financialData: {} })],
  ['数でない値だけ（N/A・null・NaN・Infinity）', () => ({ summaryDetail: { trailingPE: 'N/A', marketCap: null }, financialData: { returnOnEquity: NaN, debtToEquity: Infinity } })],
]

type Yahoo2 = {
  yf2GetFundamentals: (symbol: string) => Promise<FundamentalsData>
  yf2GetQuote: (symbol: string) => Promise<StockQuote>
  yf2GetHistory: (symbol: string, period: string) => Promise<HistoricalBar[]>
  _clearYahoo2Cache: () => void
}
function loadYahoo2(): Yahoo2 {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(path.join(ROOT, 'lib/market/providers/yahoo2.ts')) as Yahoo2
}
const isFiniteNumbersOnly = (f: FundamentalsData) =>
  Object.entries(f).every(([, v]) => typeof v === 'number' && Number.isFinite(v))
async function rejects(p: Promise<unknown>): Promise<string | null> {
  try { await p; return null } catch (e) { return e instanceof Error ? e.message : String(e) }
}

// ── 1. 差し替えの確認（検査自体が空振りしていない） ──
async function stubWorks(y: Yahoo2) {
  console.log('■ 差し替えの確認（偽物で問い合わせ回数が数えられている）')
  check('module.registerHooks が使える（Node 23.5 以上）', typeof registerHooks === 'function' && hooks != null, `node ${process.version}`)
  fresh(y, '差し替え')
  reply('quoteSummary', FULL, FULL)
  const a = await y.yf2GetFundamentals('CHK1')
  check("'yahoo-finance2' が偽物へ向いた（resolve フックが1回動いた）", redirected.length === 1, j(redirected))
  check('yahoo2 の設定（suppressNotices: yahooSurvey）で偽物が1つ作られた',
    state.constructed.length === 1 && j(state.constructed[0]) === j({ suppressNotices: ['yahooSurvey'], validation: { logErrors: false } }), j(state.constructed))
  check('問い合わせ 1 回目が数えられた', calls('quoteSummary') === 1, String(calls('quoteSummary')))
  check('quoteSummary の modules は summaryDetail / defaultKeyStatistics / financialData',
    state.log[0] === `quoteSummary:CHK1:${j({ modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData'] })}`, state.log[0])
  check('偽物の値がそのまま返る（pe 38.2・pb は defaultKeyStatistics から 45.16・roe 1.488・marketCap）',
    a.pe === 38.2 && a.pb === 45.16 && a.roe === 1.488 && a.marketCap === 4_500_000_000_000 && a.freeCashflow === 100_000_000_000, j(a))
  await y.yf2GetFundamentals('CHK2')
  check('別の銘柄で 2 回目が数えられる（数え方が動いている）', calls('quoteSummary') === 2, String(calls('quoteSummary')))
  check('本物の yahoo-finance2 は解決されていない', leaked.length === 0, j(leaked))
  check('通信（fetch）は 0 回', fetchCalls.length === 0, j(fetchCalls))
}

// ── 2. 本題: 空 {} は覚えない ──
async function emptyNotCached(y: Yahoo2) {
  console.log('■ 財務データが取れなかったとき（空 {}）は覚えない — 1回目 {} → 2回目は問い合わせ直して値を返す')
  fresh(y, '空 {}')
  const before = calls('quoteSummary')
  reply('quoteSummary', () => ({}), FULL)
  const first = await y.yf2GetFundamentals('EMPTY1')
  check('1回目: 空 {} が返る（0 で埋めない）', Object.keys(first).length === 0, j(first))
  check('1回目: 問い合わせ 1 回', calls('quoteSummary') === before + 1, String(calls('quoteSummary') - before))
  const second = await y.yf2GetFundamentals('EMPTY1')
  check('2回目: もう一度問い合わせる（空を30分覚えていない）', calls('quoteSummary') === before + 2, `問い合わせ ${calls('quoteSummary') - before} 回`)
  check('2回目: 値が返る（pe 38.2）', second.pe === 38.2 && Object.keys(second).length === 13, j(second))
  const third = await y.yf2GetFundamentals('EMPTY1')
  check('3回目: 今度は覚えている（問い合わせは増えない・同じ値）', calls('quoteSummary') === before + 2 && j(third) === j(second), String(calls('quoteSummary') - before))

  console.log('■ 「取れなかった」のどの形でも覚えない（毎回問い合わせる）')
  for (const [label, form] of EMPTY_FORMS) {
    fresh(y, label)
    const b = calls('quoteSummary')
    reply('quoteSummary', form, form)
    const r1 = await y.yf2GetFundamentals('EMPTY2')
    await y.yf2GetFundamentals('EMPTY2')
    check(`${label}: 返りは {} で、2回目も問い合わせる（2回）`, Object.keys(r1).length === 0 && calls('quoteSummary') === b + 2, `${j(r1)} / ${calls('quoteSummary') - b} 回`)
  }

  console.log('■ 取得元が失敗（throw）したときも覚えない（従来どおり。writeCache の前に例外で抜ける）')
  fresh(y, '失敗')
  const b = calls('quoteSummary')
  reply('quoteSummary', () => { throw new Error('HTTP 429 Too Many Requests') }, FULL)
  const msg = await rejects(y.yf2GetFundamentals('ERR1'))
  check('1回目: 例外がそのまま出る（index.ts が次の取得元へ回す）', msg != null && msg.includes('429'), String(msg))
  const after = await y.yf2GetFundamentals('ERR1')
  check('2回目: 問い合わせ直して値が返る', calls('quoteSummary') === b + 2 && after.pe === 38.2, `${calls('quoteSummary') - b} 回 / ${j(after)}`)
}

// ── 3. 値ありは覚える・一部だけでも覚える ──
async function valuesCached(y: Yahoo2) {
  console.log('■ 値ありの結果は覚える（2回目は問い合わせない）')
  fresh(y, '値あり')
  const b = calls('quoteSummary')
  reply('quoteSummary', FULL, FULL)
  const first = await y.yf2GetFundamentals('FULL1')
  const second = await y.yf2GetFundamentals('FULL1')
  check('2回呼んで問い合わせは 1 回', calls('quoteSummary') === b + 1, `${calls('quoteSummary') - b} 回`)
  check('同じ値（キャッシュから）', j(first) === j(second) && first === second, j(second))
  await y.yf2GetFundamentals('FULL2')
  check('別の銘柄は別に問い合わせる（キーは銘柄ごと）', calls('quoteSummary') === b + 2, `${calls('quoteSummary') - b} 回`)

  console.log('■ 一部だけの結果（marketCap だけ）も覚える — 「全部そろっていないと覚えない」にはしない')
  fresh(y, '一部だけ')
  const c = calls('quoteSummary')
  reply('quoteSummary', PARTIAL) // 2回呼ぶが、覚えていれば問い合わせは1回なので応答は1つだけ用意する
  const p1 = await y.yf2GetFundamentals('PART1')
  const p2 = await y.yf2GetFundamentals('PART1')
  check('返りは { marketCap: 1 } だけ', j(p1) === j({ marketCap: 1 }), j(p1))
  check('2回呼んで問い合わせは 1 回（覚えている）', calls('quoteSummary') === c + 1 && j(p2) === j(p1), `${calls('quoteSummary') - c} 回`)
}

// ── 4. yahoo2 は「キーはあるが中身が undefined」の形を返さない（architect の前提 (a) の裏取り） ──
async function noUndefinedKeys(y: Yahoo2) {
  console.log('■ yahoo2 の返りは「有限の数だけ」— undefined のキーを持たない（yahoodirect の空応答の形にならない）')
  for (const [label, form] of [...EMPTY_FORMS, ['値あり', FULL] as [string, () => unknown], ['一部だけ', PARTIAL] as [string, () => unknown]]) {
    fresh(y, `形: ${label}`)
    reply('quoteSummary', form)
    const r = await y.yf2GetFundamentals('SHAPE')
    check(`${label}: 全キーが有限の数（undefined・NaN・Infinity のキーが無い）`, isFiniteNumbersOnly(r) && !Object.values(r).includes(undefined), j(r))
  }
  fresh(y, '形: NaN と 5')
  reply('quoteSummary', () => ({ summaryDetail: { trailingPE: NaN, marketCap: 5 } }))
  const mixed = await y.yf2GetFundamentals('SHAPE')
  check('NaN と 5 が混ざる → { marketCap: 5 } だけ（NaN のキーを undefined で残さない）', j(mixed) === j({ marketCap: 5 }) && Object.keys(mixed).length === 1, j(mixed))
}

// ── 5. quote・history に同じ問題が無い（architect の前提 (b) の裏取り） ──
async function quoteAndHistory(y: Yahoo2) {
  console.log('■ quote: 価格が取れなければ throw（失敗はキャッシュに入らず、次は問い合わせ直す）')
  fresh(y, 'quote')
  const bq = calls('quote')
  const bc = calls('chart')
  // v7 quote に価格が無い → v8 chart の meta に回る → meta にも価格が無い → throw（yahoo2.ts の :116）
  reply('quote', () => ({ currency: 'USD' }))
  reply('chart', () => ({ meta: {}, quotes: [] }))
  const msg = await rejects(y.yf2GetQuote('Q1'))
  check('価格が無い: 例外（no chart meta）', msg != null && msg.includes('no chart meta'), String(msg))
  check('quote 1 回・chart 1 回', calls('quote') === bq + 1 && calls('chart') === bc + 1)
  reply('quote', () => ({ regularMarketPrice: 100, regularMarketPreviousClose: 99, currency: 'USD', marketState: 'CLOSED', regularMarketVolume: 10, regularMarketTime: new Date('2026-09-11T20:00:00Z') }))
  const q = await y.yf2GetQuote('Q1')
  check('次の呼び出しは問い合わせ直して価格が返る（100・前日比 +1）', calls('quote') === bq + 2 && q.price === 100 && q.change === 1 && q.changePercent === 1.01, j(q))
  const q2 = await y.yf2GetQuote('Q1')
  check('値ありは覚える（問い合わせは増えない）', calls('quote') === bq + 2 && j(q2) === j(q))

  console.log('■ history: 足が 0 本なら throw（失敗はキャッシュに入らず、次は問い合わせ直す）')
  fresh(y, 'history')
  const b = calls('chart')
  reply('chart', () => ({ quotes: [] }))
  const m = await rejects(y.yf2GetHistory('H1', '3mo'))
  check('足が 0 本: 例外（no history）', m != null && m.includes('no history'), String(m))
  const rows = [
    { date: new Date('2026-09-09T13:30:00Z'), open: 1, high: 2, low: 1, close: 1.5, volume: 10 },
    { date: new Date('2026-09-10T13:30:00Z'), open: 1.5, high: 2, low: 1, close: 1.6, volume: 10 },
    { date: new Date('2026-09-11T13:30:00Z'), open: 1.6, high: 2, low: 1, close: 1.7, volume: 10 },
  ]
  reply('chart', () => ({ quotes: rows }))
  const h = await y.yf2GetHistory('H1', '3mo')
  check('次の呼び出しは問い合わせ直して 3 本返る', calls('chart') === b + 2 && h.length === 3 && h[2].close === 1.7, `${calls('chart') - b} 回 / ${h.length} 本`)
  const h2 = await y.yf2GetHistory('H1', '3mo')
  check('値ありは覚える（問い合わせは増えない）', calls('chart') === b + 2 && h2.length === 3)
}

// ── 6. 静的: 覚える条件が index.ts の受け取る条件と同じ ──
function staticChecks() {
  console.log('■ 静的な確認（覚える条件 ＝ lib/market/index.ts が受け取る条件）')
  const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8')
  const code = (f: string) => read(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const yahoo2 = code('lib/market/providers/yahoo2.ts')
  const start = yahoo2.indexOf('export async function yf2GetFundamentals')
  const end = yahoo2.indexOf('export async function', start + 1)
  const fn = start > -1 && end > start ? yahoo2.slice(start, end) : ''
  check('yf2GetFundamentals が見つかる', fn.length > 0)
  check('覚えるのは Object.keys(data).length > 0 のときだけ', fn.includes('if (Object.keys(data).length > 0) writeCache(key, data)'))
  check('無条件の writeCache(key, data) が残っていない', !/^\s*writeCache\(key, data\)/m.test(fn))
  check('index.ts の受け取る条件は Object.keys(f).length > 0（同じ条件）', code('lib/market/index.ts').includes('if (Object.keys(f).length > 0) return f'))
  check('num() は有限の数だけ通す（undefined のキーが生まれない根拠）', yahoo2.includes("typeof v === 'number' && Number.isFinite(v) ? v : undefined"))
  check('undefined を落としてから返す', fn.includes('.filter(([, v]) => v !== undefined)'))
}

async function main() {
  if (typeof registerHooks !== 'function' || hooks == null) {
    console.log('■ 差し替えの確認（偽物で問い合わせ回数が数えられている）')
    skip('module.registerHooks が無い（Node 23.5 未満・22 系は 22.15 未満）ため、取得元の差し替えを使う検査（1〜5節）は飛ばす',
      `node ${process.version}`)
    staticChecks()
    return
  }
  const y = loadYahoo2()
  await stubWorks(y)
  await emptyNotCached(y)
  await valuesCached(y)
  await noUndefinedKeys(y)
  await quoteAndHistory(y)
  staticChecks()
  console.log('■ 最後にもう一度: 通信 0 回・本物の取得元は読まれていない・偽物は 1 つだけ')
  check('通信（fetch）は 0 回', fetchCalls.length === 0, j(fetchCalls))
  check('本物の yahoo-finance2 は解決されていない', leaked.length === 0, j(leaked))
  check('偽物は 1 つだけ（yahoo2 の singleton）', state.constructed.length === 1, String(state.constructed.length))
  const q = queued()
  check('用意した応答を使い切っている（検査の順番どおりに呼ばれた）', q.quoteSummary === 0 && q.quote === 0 && q.chart === 0, j(q))
}

main()
  .catch(err => {
    failed++
    console.error(err)
  })
  .finally(() => {
    hooks?.deregister()
    globalThis.fetch = realFetch
    console.log('')
    console.log(`PASS ${passed} 件 / FAIL ${failed} 件 / SKIP ${skipped} 件`)
    if (failed) process.exit(1)
    console.log(skipped ? `FAIL 無し（SKIP ${skipped} 件。上の SKIP 行に理由あり）` : 'すべてPASS')
  })
