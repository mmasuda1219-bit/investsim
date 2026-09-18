// トップページ用の軽い API（app/api/ai-session/latest/route.ts）の検査。2026-09-18。
//
//  - listSessions() の並びに依らず lastTickAt が最も新しいセッション1件を選ぶ
//  - decisions は最大3件・4項目（symbol / name / action / reasoning）だけ。price・technicals・fundamentals・
//    newsInfluence・news・confidence・sources は載せない。順序は元の decisions.slice(0, 3) のまま
//  - 記録なし（セッション0件／最新セッションの判断0件）は 200 の { lastTickAt: null, tickCount: 0, persona: null, decisions: [] }
//  - listSessions() が投げたら 502 ＋ no-store ＋ 和文の error だけ。原因の英語は console.error に1行だけ
//  - 成功（記録あり・記録なし）の Cache-Control は public, s-maxage=60, stale-while-revalidate=300
//  - 判断100件・各判断に数百字の technicals / fundamentals を持つセッションでも、応答の JSON は 2KB 未満
//  - persona はそのまま返る／無ければ null／記録なしでも null。3つの成功の形すべてに persona キーがある
//
// 実ネットワーク不要: `@/lib/ai-trader/engine` を Module._load で listSessions だけの偽物に差し替え（重い engine.ts を
// 読み込まない）、route.ts の GET をそのまま呼ぶ。差し替えで返す値は検査用の合成値で、製品コードには入れない
// （原則9の範囲内）。`server-only` は Next の外では import しただけで throw するので空に差し替える。
//
// 実行: npx tsx scripts/check-ai-session-latest.ts

import fs from 'fs'
import path from 'path'
import Module from 'module'
import type { AIDecision, AISession } from '../lib/ai-trader/engine'
import type { InvestorId } from '../types'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS ${name}`)
  } else {
    failed++
    // 詳細は 400 字まで（decisions を絞り忘れた形だと 8KB 超の本文が出て読めないため）
    const d = detail.length > 400 ? `${detail.slice(0, 400)}…(${detail.length} 字)` : detail
    console.error(`  FAIL ${name}${d ? ` — ${d}` : ''}`)
  }
}

const ROOT = process.cwd()
const ROUTE_REL = 'app/api/ai-session/latest/route.ts'
const code = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')

// ── 検査用の合成値（製品コードには入れない） ──
const LONG_TECH = 'RSI 62・MACD ゴールデンクロス直後・20日線と50日線の上・出来高は20日平均の1.4倍。'.repeat(8) // 約300字
const LONG_FUND = '売上成長 16.4%・ROE 148.8%・D/E 0.78倍・FCF プラス・PER 38.2倍。営業利益率は30%台で安定。'.repeat(8)
const LONG_NEWS = '新製品発表を受けてアナリストが目標株価を引き上げ。関税の懸念は一部残る。'.repeat(6)

function decision(i: number, overrides: Partial<AIDecision> = {}): AIDecision {
  return {
    symbol: `SYM${i}`,
    name: `Company ${i}`,
    action: (['buy', 'sell', 'hold', 'watch'] as const)[i % 4],
    price: 100 + i,
    change: 0.5,
    reasoning: `判断${i}: 直近の上昇トレンドと決算の内容を見て、ここでは${['買い', '売り', '様子見', '注目'][i % 4]}と判断した。`,
    newsInfluence: LONG_NEWS,
    news: ['news A', 'news B'],
    technicals: LONG_TECH,
    fundamentals: LONG_FUND,
    confidence: 'medium',
    sources: ['yahoo2', 'yahoodirect'],
    knowledgeRefs: [{ id: 'k1', title: '知識1' }],
    tickId: `tick-${i}`,
    decidedAt: '2026-09-18T00:00:00.000Z',
    changeBasis: 'prev-close-v1',
    ...overrides,
  }
}

type SessionOpts = { id: string; lastTickAt: string; tickCount?: number; persona?: InvestorId; decisions?: AIDecision[] }
function session(opts: SessionOpts): AISession {
  const s: AISession = {
    id: opts.id,
    startedAt: '2026-09-01T00:00:00.000Z',
    lastTickAt: opts.lastTickAt,
    tickCount: opts.tickCount ?? 1,
    capital: 1_000_000,
    cash: 500_000,
    holdings: {},
    trades: [],
    decisions: opts.decisions ?? [decision(0), decision(1), decision(2)],
    watchlist: ['SYM0'],
    totalValue: 1_000_000,
    pnl: 0,
    pnlPct: 0,
    marketContext: 'x'.repeat(500),
    learning: { lessons: [], patterns: [], mistakes: [] } as unknown as AISession['learning'],
    equityHistory: [],
    benchmarkStart: null,
    stats: { daysRunning: 1, maxValue: 1, minValue: 1, maxDrawdownPct: 0, annualizedReturnPct: 0, sharpeRatio: 0, totalTradeCount: 0, winRate: 0 },
  }
  if (opts.persona) s.persona = opts.persona
  return s
}

// ── engine の差し替え（この検査の中だけ。listSessions だけを持つ） ──
type EngineState = { sessions: AISession[]; throws: Error | null; calls: number }
const state: EngineState = { sessions: [], throws: null, calls: 0 }
const engineStub = {
  listSessions: async (): Promise<AISession[]> => {
    state.calls++
    if (state.throws) throw state.throws
    return state.sessions
  },
}

type ModuleWithLoad = typeof Module & { _load: (request: string, ...rest: unknown[]) => unknown }
const M = Module as unknown as ModuleWithLoad
const realLoad = M._load
M._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {}
  if (request === '@/lib/ai-trader/engine') return engineStub
  return realLoad.call(this, request, ...rest)
}

type Body = {
  lastTickAt?: string | null
  tickCount?: number
  persona?: string | null
  decisions?: Record<string, unknown>[]
  error?: string
}
type RouteModule = { GET: () => Promise<Response> }
async function callRoute() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const route = require(path.join(ROOT, ROUTE_REL)) as RouteModule
  const logged: string[] = []
  const realError = console.error
  console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
  state.calls = 0
  const res = await route.GET().finally(() => { console.error = realError })
  const text = await res.text()
  const body = JSON.parse(text) as Body
  return { status: res.status, cache: res.headers.get('cache-control') ?? '', body, text, bytes: Buffer.byteLength(text, 'utf8'), logged, calls: state.calls }
}

const CACHE_1MIN = 'public, s-maxage=60, stale-while-revalidate=300'
const EMPTY_JSON = JSON.stringify({ lastTickAt: null, tickCount: 0, persona: null, decisions: [] })
const FOUR_KEYS = ['action', 'name', 'reasoning', 'symbol']
const sortedKeys = (o: object) => Object.keys(o).sort()
const pick4 = (d: AIDecision) => ({ symbol: d.symbol, name: d.name, action: d.action, reasoning: d.reasoning })
const isEmptyForm = (b: Body) => JSON.stringify(sortedKeys(b)) === JSON.stringify(['decisions', 'lastTickAt', 'persona', 'tickCount'])
  && b.lastTickAt === null && b.tickCount === 0 && b.persona === null && Array.isArray(b.decisions) && b.decisions.length === 0

// ── 0. route.ts の静的検査（engine から値として使うのは listSessions だけ） ──
function staticChecks() {
  console.log('■ route.ts（engine から値として import するのは listSessions だけ）')
  const src = code(ROUTE_REL)
  const m = /import\s*\{([^}]*)\}\s*from\s*'@\/lib\/ai-trader\/engine'/.exec(src)
  const valueSpecs = (m?.[1] ?? '').split(',').map(s => s.trim()).filter(s => s && !s.startsWith('type '))
  check('engine の値 import は listSessions だけ', JSON.stringify(valueSpecs) === JSON.stringify(['listSessions']), JSON.stringify(valueSpecs))
  check('store を直接 import しない', !src.includes('@/lib/ai-trader/store'))
}

// ── 1. 応答（route.ts の GET を実際に呼ぶ） ──
async function behaviour() {
  console.log('■ 1. 複数セッション: lastTickAt が最新の1件（配列の先頭が最新ではない並び）')
  state.throws = null
  state.sessions = [
    session({ id: 'mid', lastTickAt: '2026-09-15T12:00:00.000Z', tickCount: 5, persona: 'soros', decisions: [decision(10), decision(11)] }),
    session({ id: 'old', lastTickAt: '2026-09-01T12:00:00.000Z', tickCount: 1, persona: 'graham', decisions: [decision(20)] }),
    session({ id: 'new', lastTickAt: '2026-09-18T09:30:00.000Z', tickCount: 9, persona: 'buffett', decisions: [decision(30), decision(31), decision(32)] }),
    session({ id: 'mid2', lastTickAt: '2026-09-17T12:00:00.000Z', tickCount: 7, persona: 'lynch', decisions: [decision(40)] }),
  ]
  {
    const r = await callRoute()
    check('200', r.status === 200, String(r.status))
    check('lastTickAt は最新（new）の値', r.body.lastTickAt === '2026-09-18T09:30:00.000Z', String(r.body.lastTickAt))
    check('tickCount は最新（new）の値 9', r.body.tickCount === 9, String(r.body.tickCount))
    check('decisions は最新（new）のもの（SYM30, SYM31, SYM32）', JSON.stringify(r.body.decisions?.map(d => d.symbol)) === JSON.stringify(['SYM30', 'SYM31', 'SYM32']), JSON.stringify(r.body.decisions?.map(d => d.symbol)))
    check('listSessions は1回だけ呼ばれる', r.calls === 1, String(r.calls))
    check('console.error は出ない', r.logged.length === 0, JSON.stringify(r.logged))
  }

  console.log('■ 4. セッション0件 → 200 の空の形')
  state.sessions = []
  {
    const r = await callRoute()
    check('200', r.status === 200, String(r.status))
    check('{ lastTickAt: null, tickCount: 0, persona: null, decisions: [] }', isEmptyForm(r.body), r.text)
    check('本文がその JSON と一字も違わない', r.text === EMPTY_JSON, r.text)
    check(`Cache-Control: ${CACHE_1MIN}（記録なし）`, r.cache === CACHE_1MIN, r.cache)
    check('error キーが無い', !('error' in r.body))
    check('persona は null（9c）・キーはある（9d・セッション0件）', r.body.persona === null && 'persona' in r.body, r.text)
  }

  console.log('■ 6. listSessions が投げる → 502・no-store・和文の error・原因はログにだけ')
  const CAUSE = 'ai_sessions list failed: TypeError: fetch failed (ECONNREFUSED supabase.co)'
  state.throws = new Error(CAUSE)
  state.sessions = [session({ id: 'x', lastTickAt: '2026-09-18T00:00:00.000Z' })]
  {
    const r = await callRoute()
    check('502', r.status === 502, String(r.status))
    check('no-store', r.cache === 'no-store', r.cache)
    check("error が 'AIの判断記録を読み込めませんでした'", r.body.error === 'AIの判断記録を読み込めませんでした', String(r.body.error))
    check('本文は error だけ（decisions や lastTickAt を持たない）', JSON.stringify(sortedKeys(r.body)) === JSON.stringify(['error']), r.text)
    check('元の例外の英語が本文に無い', !r.text.includes('ai_sessions list failed') && !r.text.includes('ECONNREFUSED') && !r.text.includes('fetch failed'), r.text)
    check('console.error はちょうど1回', r.logged.length === 1, String(r.logged.length))
    check('その1行に経路名と原因が入る', r.logged[0]?.includes('[api/ai-session/latest]') === true && r.logged[0]?.includes(CAUSE) === true, JSON.stringify(r.logged))
  }
  state.throws = null

  console.log('■ 2・3・7・9a. 判断5件 → 3件だけ・4項目だけ・順序は slice(0, 3)・60秒キャッシュ・persona はそのまま')
  const FIVE = [decision(1), decision(2), decision(3), decision(4), decision(5)]
  state.sessions = [session({ id: 'five', lastTickAt: '2026-09-18T10:00:00.000Z', tickCount: 12, persona: 'buffett', decisions: FIVE })]
  {
    const r = await callRoute()
    check('200', r.status === 200, String(r.status))
    check('decisions は3件', r.body.decisions?.length === 3, String(r.body.decisions?.length))
    check('各判断のキーは action / name / reasoning / symbol の4つだけ', (r.body.decisions ?? []).every(d => JSON.stringify(sortedKeys(d)) === JSON.stringify(FOUR_KEYS)), JSON.stringify(r.body.decisions?.map(sortedKeys)))
    check('中身と順序が元の decisions.slice(0, 3) を4項目に絞ったものと一致', JSON.stringify(r.body.decisions) === JSON.stringify(FIVE.slice(0, 3).map(pick4)), JSON.stringify(r.body.decisions))
    const LEAK = ['"price"', '"change"', '"technicals"', '"fundamentals"', '"newsInfluence"', '"news"', '"confidence"', '"sources"', '"knowledgeRefs"', '"tickId"', '"decidedAt"', '"changeBasis"']
    const leaked = LEAK.filter(k => r.text.includes(k))
    check('price・technicals・fundamentals・newsInfluence などのキーが本文に無い', leaked.length === 0, leaked.join(','))
    check('長い technicals / fundamentals / news の文字列が本文に無い', !r.text.includes(LONG_TECH) && !r.text.includes(LONG_FUND) && !r.text.includes(LONG_NEWS))
    check('lastTickAt / tickCount はセッションの値', r.body.lastTickAt === '2026-09-18T10:00:00.000Z' && r.body.tickCount === 12, `${r.body.lastTickAt} / ${r.body.tickCount}`)
    check('本文のキーは decisions / lastTickAt / persona / tickCount の4つ', JSON.stringify(sortedKeys(r.body)) === JSON.stringify(['decisions', 'lastTickAt', 'persona', 'tickCount']), JSON.stringify(sortedKeys(r.body)))
    check(`Cache-Control: ${CACHE_1MIN}（記録あり）`, r.cache === CACHE_1MIN, r.cache)
    check("persona: 'buffett' がそのまま返る（9a）", r.body.persona === 'buffett', String(r.body.persona))
    check('persona キーがある（9d・記録あり）', 'persona' in r.body)
  }

  console.log('■ 5. 最新セッションの判断が0件（古いセッションには判断がある） → 200 の空の形')
  state.sessions = [
    session({ id: 'old-with-decisions', lastTickAt: '2026-09-10T00:00:00.000Z', tickCount: 3, persona: 'dalio', decisions: [decision(7), decision(8)] }),
    session({ id: 'new-empty', lastTickAt: '2026-09-18T11:00:00.000Z', tickCount: 4, persona: 'dalio', decisions: [] }),
  ]
  {
    const r = await callRoute()
    check('200', r.status === 200, String(r.status))
    check('{ lastTickAt: null, tickCount: 0, persona: null, decisions: [] }（古いセッションの判断に落ちない）', isEmptyForm(r.body), r.text)
    check('本文がその JSON と一字も違わない', r.text === EMPTY_JSON, r.text)
    check(`Cache-Control: ${CACHE_1MIN}（記録なし）`, r.cache === CACHE_1MIN, r.cache)
    check('persona は null（9c）・キーはある（9d）', r.body.persona === null && 'persona' in r.body, String(r.body.persona))
  }
  // 旧い記録で decisions が配列でない（無い）ときも落ちず、同じ空の形
  state.sessions = [{ ...session({ id: 'no-array', lastTickAt: '2026-09-18T11:00:00.000Z' }), decisions: undefined as unknown as AIDecision[] }]
  {
    const r = await callRoute()
    check('decisions が無い旧記録でも 200 の空の形', r.status === 200 && r.text === EMPTY_JSON, `${r.status} ${r.text}`)
  }

  console.log('■ 9b. セッションに persona が無い → null（キーはある）')
  state.sessions = [session({ id: 'no-persona', lastTickAt: '2026-09-18T12:00:00.000Z', tickCount: 2, decisions: [decision(1)] })]
  {
    const r = await callRoute()
    check('200 で記録あり（decisions 1件）', r.status === 200 && r.body.decisions?.length === 1, r.text)
    check('persona は null', r.body.persona === null, String(r.body.persona))
    check('persona キーがある', 'persona' in r.body, JSON.stringify(sortedKeys(r.body)))
  }

  console.log('■ 8. 応答の大きさ: 判断100件・各判断に数百字の technicals / fundamentals でも 2KB 未満')
  const HUNDRED = Array.from({ length: 100 }, (_, i) => decision(i))
  state.sessions = [session({ id: 'big', lastTickAt: '2026-09-18T13:00:00.000Z', tickCount: 100, persona: 'lynch', decisions: HUNDRED })]
  {
    const sessionBytes = Buffer.byteLength(JSON.stringify(state.sessions), 'utf8')
    const r = await callRoute()
    check('偽のセッション全体は十分に大きい（100KB 超。検査として意味がある）', sessionBytes > 100_000, `${sessionBytes} bytes`)
    check(`応答の JSON は 2KB 未満（実測 ${r.bytes} bytes・セッション全体 ${sessionBytes} bytes）`, r.bytes < 2048, `${r.bytes} bytes`)
    check('decisions は3件', r.body.decisions?.length === 3, String(r.body.decisions?.length))
    check('中身は HUNDRED.slice(0, 3) の4項目', JSON.stringify(r.body.decisions) === JSON.stringify(HUNDRED.slice(0, 3).map(pick4)))
    console.log(`  （応答 ${r.bytes} bytes / セッション全体 ${sessionBytes} bytes ≒ 1/${Math.round(sessionBytes / r.bytes)}）`)
  }
}

async function main() {
  staticChecks()
  await behaviour()
}

main()
  .catch(err => {
    failed++
    console.error(err)
  })
  .finally(() => {
    M._load = realLoad
    console.log('')
    console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
    if (failed) process.exit(1)
    console.log('すべてPASS')
  })
