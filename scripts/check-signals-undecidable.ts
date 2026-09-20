// 名人の判定 API（app/api/signals/[symbol]/route.ts）と、それを読む画面の検査。
// 2026-09-17 スライス2（財務が無いとき「◇ 様子見」を返さない）で作り、同日の S2（ルールブック化）で全面改訂。
//
//  - route は lib/investors/*.ts の analyze() を呼ばず、lib/investors/rulebooks の evaluate()（純関数）で判定する
//  - 応答は { symbol, rulebooks: { [id]: { version, checks } }, undecidable? }。signals（▲買い／◇様子見の札）は返さない
//  - 財務が空 `{}`（と全項目 undefined）のとき: データルールは全部 undecidable(no-data)、undecidable に理由の文、no-store
//  - 財務が一部だけ `{ marketCap: 1 }` のとき: 旧「既知の穴」（4人が hold＝偽の様子見）を反転。偽の様子見 0 件・
//    バフェットのデータルールがすべて判定できない
//  - 財務があるとき: evaluate() を直接呼んだ結果と API の応答が一致する（正規表現ではなく振る舞いの比較）。
//    全部判定できたら従来の5分キャッシュ、1つでも判定できなければ no-store
//  - 業種: AAPL（Technology）は B4 を判定、JPM（Financials）は excluded-sector、7203.T（一覧に無い）は unknown-sector
//  - 株価が取れないとき: 502 ＋ no-store ＋ console.error 1行（スライス1のまま）
//  - 画面側: MasterSignals / InvestorPanel が旧札・色付きの四角・格言を持たず RulebookView（人物像 → ご本人とは無関係 → 表と数直線 →
//    問いのレール → 出典の年 → 共通の免責。2026-09-18 オーナー選択）を使う。RuleCheckList の値の書式（ROE 16.2%・D/E 0.78倍・
//    FCF プラス）。数直線の規則（塗り分けゾーン無し・範囲外は文字）。Disclaimer の文言が marketing/RULES.md §2(a) の短い版と一致
//
// 実ネットワーク不要: `@/lib/market`（取得元）だけを Module._load で差し替え、route.ts の GET をそのまま呼ぶ。
// 差し替えで返す値は検査用の合成値で、製品コードには入れない（原則9の範囲内）。`server-only` は Next の外では
// import しただけで throw するので空に差し替える。
//
// 実行: npx tsx scripts/check-signals-undecidable.ts

import fs from 'fs'
import path from 'path'
import Module from 'module'
import type { StockQuote, HistoricalBar, FundamentalsData } from '../types'
import { getRulebook, publishedRules, evaluate, type RuleCheck, type DataRule } from '../lib/investors/rulebooks'
import { US_UNIVERSE } from '../lib/market/us-universe'
import { describeCheck, formatObserved, formatThreshold } from '../components/investors/RuleCheckList'
import { sourceYears } from '../components/investors/RulebookView'
import { DISCLAIMER_TEXT, INVESTOR_DISCLAIMER_TEXT } from '../components/ui/Disclaimer'

let passed = 0
let failed = 0
function check(name: string, ok: boolean, detail = '') {
  if (ok) {
    passed++
    console.log(`  PASS ${name}`)
  } else {
    failed++
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const ROOT = process.cwd()
const code = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8')
// 注釈を落としたコード（注釈に書いた「analyze() は呼ばない」「/100 しない」を誤検知しないため）。文字列の中の // は残す
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
// import の指定子だけを取り出す（注釈の中のパスは見ない）
const importSpecs = (src: string) => [...src.matchAll(/(?:from\s*|import\s*\(\s*)['"]([^'"]+)['"]/g)].map(m => m[1])

// ── 取得元の差し替え（この検査の中だけ） ──
type MarketState = {
  fundamentals: FundamentalsData | (() => never)
  quoteFails: boolean
}
const state: MarketState = { fundamentals: {}, quoteFails: false }

// 検査用の合成値。AAPL の形に合わせた「それらしい」値で、製品コードには入れない。
const QUOTE: StockQuote = {
  symbol: 'AAPL', name: 'Apple Inc.', price: 300, change: 1.5, changePercent: 0.5, volume: 1_000_000,
  currency: 'USD', market: 'US', isMarketOpen: false, lastUpdated: '2026-09-17T00:00:00.000Z',
}
const HISTORY: HistoricalBar[] = Array.from({ length: 250 }, (_, i) => ({
  time: 1_700_000_000 + i * 86_400, open: 200 + i * 0.4, high: 201 + i * 0.4, low: 199 + i * 0.4,
  close: 200 + i * 0.4 + (i % 3 === 0 ? -0.6 : 0.3), volume: 1_000_000,
}))
// yahoo2 が AAPL に返す形（debtToEquity は Yahoo 原値の%表記）。freeCashflow は無い＝B7 が判定できない
const FULL_FUNDAMENTALS: FundamentalsData = {
  pe: 38.2, pb: 45.16, pegRatio: 2.67, roe: 1.488, debtToEquity: 78.4, revenueGrowth: 0.164, earningsGrowth: 0.287,
}
// 判定に使う3項目がそろった形
const COMPLETE_FUNDAMENTALS: FundamentalsData = { ...FULL_FUNDAMENTALS, freeCashflow: 100 }

const marketStub = {
  getQuote: async (symbol: string, opts?: { allowMock?: boolean }) => {
    if (opts?.allowMock !== false) throw new Error('allowMock:false が外れている')
    if (state.quoteFails) throw new Error(`Real quote unavailable for ${symbol} — yahoo2: 429 / yahoodirect: 429`)
    return { ...QUOTE, symbol }
  },
  getHistory: async (_symbol: string, _period: string, opts?: { allowMock?: boolean }) => {
    if (opts?.allowMock !== false) throw new Error('allowMock:false が外れている')
    return HISTORY
  },
  getFundamentals: async (_symbol: string, opts?: { allowMock?: boolean }) => {
    if (opts?.allowMock !== false) throw new Error('allowMock:false が外れている')
    return typeof state.fundamentals === 'function' ? state.fundamentals() : state.fundamentals
  },
}

type ModuleWithLoad = typeof Module & { _load: (request: string, ...rest: unknown[]) => unknown }
const M = Module as unknown as ModuleWithLoad
const realLoad = M._load
M._load = function (request: string, ...rest: unknown[]) {
  if (request === 'server-only') return {}
  if (request === '@/lib/market') return marketStub
  return realLoad.call(this, request, ...rest)
}

type Body = {
  symbol?: string
  rulebooks?: Record<string, { version: string; checks: RuleCheck[] }>
  undecidable?: Record<string, string>
  signals?: unknown
  error?: string
  listed?: boolean
}
type RouteModule = {
  GET: (req: Request, ctx: { params: Promise<{ symbol: string }> }) => Promise<Response>
}
async function callRoute(symbol = 'aapl') {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const route = require(path.join(ROOT, 'app/api/signals/[symbol]/route.ts')) as RouteModule
  const res = await route.GET(new Request(`http://localhost/api/signals/${symbol}`), { params: Promise.resolve({ symbol }) })
  const text = await res.text()
  const body = JSON.parse(text) as Body
  return { status: res.status, cache: res.headers.get('cache-control') ?? '', body, text }
}

// ── 期待値: evaluate() を直接呼ぶ（route と同じ材料・同じ業種の引き方） ──
const book = getRulebook('buffett')!
const published = { ...book, rules: publishedRules(book) }
const universeJson = JSON.parse(code('data/universe.json')) as { stocks: { symbol: string; sector?: string }[] }
function sectorOf(symbol: string): string | undefined {
  return US_UNIVERSE.find(s => s.symbol === symbol)?.sector ?? universeJson.stocks.find(s => s.symbol === symbol)?.sector
}
function expected(f: FundamentalsData, symbol = 'AAPL'): RuleCheck[] {
  return evaluate(published, f, { sector: sectorOf(symbol) })
}
const stateOf = (checks: RuleCheck[] | undefined, id: string) => checks?.find(c => c.ruleId === id)
const CACHE_5MIN = 'public, s-maxage=300, stale-while-revalidate=60'

// ── 1. route.ts の静的検査 ──
function staticChecks() {
  console.log('■ route.ts（ルールブックで判定し、analyze() と /100 を持たない）')
  const route = stripComments(code('app/api/signals/[symbol]/route.ts'))
  const routeImports = importSpecs(route)
  check('rulebooks を index 経由で import', routeImports.includes('@/lib/investors/rulebooks'))
  check('lib/investors（analyze の5人）を import せず analyze() を呼ばない', !routeImports.includes('@/lib/investors') && !/\.analyze\(/.test(route))
  check('FUNDAMENTALS_INVESTOR_IDS のコピーが無い', !route.includes('FUNDAMENTALS_INVESTOR_IDS'))
  check('D/E の /100 のコピーが無い（換算は evaluate.ts だけ）', !/\/\s*100\b/.test(route))
  check('signals（札）を返さない', !/\bsignals\b\s*[:=]/.test(route))
  check('業種はローカルの一覧（US_UNIVERSE → findStock）から引く', route.includes('US_UNIVERSE.find(') && route.includes('findStock(symbol)?.sector'))
  check('照合済みの出典を持つルールだけを判定する（publishedRules）', route.includes('publishedRules(book)'))
  check('判定できないルールが1つでもあれば no-store', /anyUndecidable \? 'no-store'/.test(route))
  check('全部判定できた応答は従来の5分のまま', route.includes(`'${CACHE_5MIN}'`))
  check('502 の catch は変えていない（status: 502 ＋ no-store ＋ listed。500 は無い）',
    route.includes('status: 502') && !route.includes('status: 500') && route.includes("{ error: message, symbol, listed: Boolean(findStock(symbol)) }"))
  check('財務の有無は「値が1つでも入っているか」で見る', /Object\.values\(fundamentals\)\.some\(v => v != null\)/.test(route))
  check('財務が取れないときの理由の文は三点形式（判定できません＋時間をおいて再読み込み）',
    route.includes('判定できません') && route.includes('時間をおいて再読み込みしてください'))
}

// ── 2. 応答（route.ts の GET を実際に呼ぶ） ──
async function behaviour() {
  console.log('■ 財務データが空 {} のとき')
  state.fundamentals = {}
  {
    const r = await callRoute()
    check('200 で返る（502 にしない: 株価と足は取れている）', r.status === 200, String(r.status))
    check('symbol は大文字', r.body.symbol === 'AAPL', String(r.body.symbol))
    check('rulebooks.buffett がある（version buffett@2026-09-18）', r.body.rulebooks?.buffett?.version === 'buffett@2026-09-18', JSON.stringify(r.body.rulebooks))
    check('signals（札）のキーが無い', !('signals' in r.body), Object.keys(r.body).join(','))
    check('checks ＝ evaluate({}) を直接呼んだ結果（3件とも undecidable / no-data）',
      JSON.stringify(r.body.rulebooks?.buffett?.checks) === JSON.stringify(expected({})), JSON.stringify(r.body.rulebooks?.buffett?.checks))
    check('3件とも no-data', (r.body.rulebooks?.buffett?.checks ?? []).every(c => c.state === 'undecidable' && c.reason === 'no-data'))
    check('undecidable.buffett に理由の文（財務データ・判定できません・再読み込み）',
      typeof r.body.undecidable?.buffett === 'string' && r.body.undecidable.buffett.includes('財務データ')
      && r.body.undecidable.buffett.includes('判定できません') && r.body.undecidable.buffett.includes('時間をおいて再読み込みしてください'))
    check('応答に「様子見」「hold」「指標が不足」が無い', !/様子見|"hold"|指標が不足/.test(r.text))
    check('no-store', r.cache === 'no-store', r.cache)
  }

  console.log('■ 財務データがキーだけあって全項目 undefined のとき（yahoodirect の空応答の形）')
  state.fundamentals = { pe: undefined, pb: undefined, roe: undefined, debtToEquity: undefined }
  {
    const r = await callRoute()
    check('checks ＝ evaluate() の結果（3件とも no-data）', JSON.stringify(r.body.rulebooks?.buffett?.checks) === JSON.stringify(expected({})))
    check('undecidable.buffett がある', typeof r.body.undecidable?.buffett === 'string')
    check('no-store', r.cache === 'no-store', r.cache)
  }

  console.log('■ 財務データが 0 だけのとき（0 は有効な値。「無い」の判定を `!= null` にした根拠を固定する）')
  state.fundamentals = { debtToEquity: 0 }
  {
    const r = await callRoute()
    const checks = r.body.rulebooks?.buffett?.checks
    check('200', r.status === 200, String(r.status))
    check('undecidable キーが無い（財務は「取れた」）', !('undecidable' in r.body), JSON.stringify(Object.keys(r.body)))
    check('B4 は D/E 0 で「目安を満たす」（0 を「無い」と誤らない）', stateOf(checks, 'buffett.B4')?.state === 'meets', JSON.stringify(stateOf(checks, 'buffett.B4')))
    check('B3・B7 は no-data', stateOf(checks, 'buffett.B3')?.reason === 'no-data' && stateOf(checks, 'buffett.B7')?.reason === 'no-data')
    check('checks ＝ evaluate() の結果', JSON.stringify(checks) === JSON.stringify(expected({ debtToEquity: 0 })))
    check('判定できないルールがあるので no-store', r.cache === 'no-store', r.cache)
  }

  console.log('■ 財務データが一部だけのとき（{ marketCap: 1 }）— 旧「既知の穴」を反転')
  // 旧: 「値が1つでも入っている」で財務ありとみなし、4人の analyze() が「○○基準を満たす指標が不足」の hold を返して
  // 画面では「◇ 様子見」に見えた。S2: ルールごとに材料を見るので、判定に使わない項目だけでは全部「判定できない」になる
  state.fundamentals = { marketCap: 1 }
  {
    const r = await callRoute()
    const checks = r.body.rulebooks?.buffett?.checks ?? []
    check('200', r.status === 200, String(r.status))
    check('偽の様子見 0 件（signals も hold も「指標が不足」も無い）', !('signals' in r.body) && !/様子見|"hold"|指標が不足/.test(r.text))
    check('バフェットのデータルール3件がすべて判定できない（no-data）', checks.length === 3 && checks.every(c => c.state === 'undecidable' && c.reason === 'no-data'), JSON.stringify(checks))
    check('checks ＝ evaluate() の結果', JSON.stringify(checks) === JSON.stringify(expected({ marketCap: 1 })))
    check('undecidable キーは無い（財務は一部取れている。行ごとの理由は checks の reason）', !('undecidable' in r.body))
    check('no-store（旧: 偽の様子見が5分キャッシュに乗っていた）', r.cache === 'no-store', r.cache)
  }

  console.log('■ 財務データがあるとき（AAPL の形。freeCashflow は無い）')
  state.fundamentals = FULL_FUNDAMENTALS
  {
    const r = await callRoute()
    const checks = r.body.rulebooks?.buffett?.checks
    check('200', r.status === 200, String(r.status))
    check('checks ＝ evaluate(FULL) を直接呼んだ結果', JSON.stringify(checks) === JSON.stringify(expected(FULL_FUNDAMENTALS)), JSON.stringify(checks))
    check('B3: ROE 1.488 → 目安を満たす', stateOf(checks, 'buffett.B3')?.state === 'meets')
    check('B4: D/E 78.4 → 目安を満たさない（observed は Yahoo 原値 78.4・yahooPct のまま）',
      stateOf(checks, 'buffett.B4')?.state === 'misses'
      && JSON.stringify(stateOf(checks, 'buffett.B4')?.observed) === JSON.stringify({ metric: 'debtToEquity', value: 78.4, unit: 'yahooPct' }),
      JSON.stringify(stateOf(checks, 'buffett.B4')))
    check('B7: FCF 無し → 判定できない（no-data）', stateOf(checks, 'buffett.B7')?.reason === 'no-data')
    check('データルールの並びは B3・B4・B7（言葉のルールは含まない）', JSON.stringify(checks?.map(c => c.ruleId)) === JSON.stringify(['buffett.B3', 'buffett.B4', 'buffett.B7']))
    check('undecidable キーが無い', !('undecidable' in r.body))
    check('1件判定できないので no-store', r.cache === 'no-store', r.cache)
  }

  console.log('■ 判定に使う3項目がそろっているとき')
  state.fundamentals = COMPLETE_FUNDAMENTALS
  {
    const r = await callRoute()
    const checks = r.body.rulebooks?.buffett?.checks ?? []
    check('3件とも判定できる', checks.length === 3 && checks.every(c => c.state === 'meets' || c.state === 'misses'), JSON.stringify(checks))
    check('checks ＝ evaluate(COMPLETE) の結果', JSON.stringify(checks) === JSON.stringify(expected(COMPLETE_FUNDAMENTALS)))
    check('B7: FCF 100 → 目安を満たす', stateOf(checks, 'buffett.B7')?.state === 'meets')
    check('従来の5分のキャッシュ', r.cache === CACHE_5MIN, r.cache)
  }

  console.log('■ 業種（B4 は金融業を判定しない・業種が分からなければ判定できない）')
  state.fundamentals = COMPLETE_FUNDAMENTALS
  {
    const jpm = await callRoute('jpm')
    const b4 = stateOf(jpm.body.rulebooks?.buffett?.checks, 'buffett.B4')
    check('JPM（us-universe.ts: Financials）: B4 は excluded-sector', b4?.state === 'undecidable' && b4?.reason === 'excluded-sector', JSON.stringify(b4))
    check('JPM: B3・B7 は判定する', stateOf(jpm.body.rulebooks?.buffett?.checks, 'buffett.B3')?.state === 'meets' && stateOf(jpm.body.rulebooks?.buffett?.checks, 'buffett.B7')?.state === 'meets')
    check('JPM: checks ＝ evaluate() の結果（同じ業種の引き方）', JSON.stringify(jpm.body.rulebooks?.buffett?.checks) === JSON.stringify(expected(COMPLETE_FUNDAMENTALS, 'JPM')))
    check('JPM: no-store', jpm.cache === 'no-store', jpm.cache)

    const jp = await callRoute('7203.T')
    const b4jp = stateOf(jp.body.rulebooks?.buffett?.checks, 'buffett.B4')
    check('7203.T（どの一覧にも業種が無い）: B4 は unknown-sector', b4jp?.state === 'undecidable' && b4jp?.reason === 'unknown-sector', JSON.stringify(b4jp))
    check('7203.T: B3・B7 は判定する', stateOf(jp.body.rulebooks?.buffett?.checks, 'buffett.B3')?.state === 'meets' && stateOf(jp.body.rulebooks?.buffett?.checks, 'buffett.B7')?.state === 'meets')
    check('7203.T: 200 で返る（一覧に無い銘柄でも落ちない）', jp.status === 200, String(jp.status))
    check('7203.T: no-store', jp.cache === 'no-store', jp.cache)
  }

  console.log('■ 株価が取れないとき（スライス1の 502 はそのまま。原因はサーバーのログに残す）')
  state.fundamentals = COMPLETE_FUNDAMENTALS
  state.quoteFails = true
  {
    const logged: string[] = []
    const realError = console.error
    console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
    const r = await callRoute().finally(() => { console.error = realError })
    check('502', r.status === 502, String(r.status))
    check('no-store', r.cache === 'no-store', r.cache)
    check('error と listed がある', typeof r.body.error === 'string' && typeof r.body.listed === 'boolean', JSON.stringify(r.body))
    check('rulebooks を返さない', r.body.rulebooks == null)
    check('原因が console.error でサーバーのログに出る', logged.some(l => l.includes('[api/signals/[symbol]]') && l.includes('AAPL') && l.includes('Real quote unavailable')), JSON.stringify(logged))
    check('ログは1行だけ', logged.length === 1, String(logged.length))
  }
  state.quoteFails = false
}

// ── 3. 画面側 ──
function clientChecks() {
  console.log('■ 画面側（MasterSignals / InvestorPanel）— 札・色付きの四角・格言が無く、RulebookView を使う')
  const OLD_BADGES = ['▲ 買い', '▼ 売り', '◇ 様子見', '＝ 保有', '強度', 'ACTION_LABEL', 'STRENGTH_DOTS', 'philosophy', 'backgroundColor', 'italic', 'avatarColor']
  for (const file of ['components/MasterSignals.tsx', 'components/InvestorPanel.tsx']) {
    const src = code(file)
    const hits = OLD_BADGES.filter(w => src.includes(w))
    check(`${file}: 旧札・色付き四角・格言の語が無い`, hits.length === 0, hits.join('/'))
    const specs = importSpecs(src)
    check(`${file}: RulebookView を使う`, specs.includes('@/components/investors/RulebookView') && src.includes('<RulebookView'))
    check(`${file}: rulebooks の中のファイルを直接 import しない（index 経由だけ）`, !specs.some(s => s.includes('investors/rulebooks/')))
    check(`${file}: HTTP の番号・生の英語を画面に出さない`, !src.includes('HTTP ${') && !/setError\(e\.message\)/.test(src) && !src.includes('データ取得エラー'))
    check(`${file}: 免責の手書きが無い（Disclaimer だけ）`, !src.includes('本人の見解でも') && !src.includes('売買の推奨でもありません') && !src.includes('ご本人とは無関係'))
    check(`${file}: 節の見出しは h2（small/--muted に戻さない）`, /<h2 id="[a-z-]+-heading" className="text-h2 text-ink">/.test(src))
    check(`${file}: 件数（8つのうち3つ）を出さない`, !/つのうち|\d+件/.test(src))
  }
  // 取得の仕組みは MasterSignals の useRulebookSignals に1つ。InvestorPanel はそれを使う
  const ms = code('components/MasterSignals.tsx')
  check('MasterSignals: fetch の symbol は encodeURIComponent', ms.includes('fetch(`/api/signals/${encodeURIComponent(symbol)}`)'))
  check('MasterSignals: アンマウント後に state を書かない（alive ガード）', ms.includes('let alive = true') && ms.includes('return () => { alive = false }'))
  check('MasterSignals: 取得失敗の文は和文（502 → データ源の文）', ms.includes("status === 502 ? MSG_UPSTREAM : MSG_SERVER"))
  check('MasterSignals: effect の中で同期に setState しない（銘柄が変わった直後は state の派生で読み込み中）', ms.includes('return state.symbol === symbol ? state : idle(symbol)'))
  check('MasterSignals: 区画に id（撮影と aria-labelledby 用）', ms.includes('id="master-signals"'))
  const ip = code('components/InvestorPanel.tsx')
  check('InvestorPanel: useRulebookSignals（MasterSignals と共用）で取得し、自前の fetch を持たない', ip.includes('useRulebookSignals(symbol)') && !ip.includes('fetch('))
  check('InvestorPanel: 区画に id', ip.includes('id="investor-panel"'))
  check('InvestorPanel: 5人のタブ（investors.map）が無い', !ip.includes('investors.map('))

  console.log('■ RulebookView（構成: 人物像 → ご本人とは無関係 → 表 → レール → 出どころ → 共通の免責）')
  const view = code('components/investors/RulebookView.tsx')
  // JSX の中の並びを見る（冒頭の注釈にも同じ語があるので、注釈を落としてから探す）
  const viewJsx = stripComments(view)
  const order = ['<InvestorLens', '<Disclaimer part="investor"', 'text="数字で確かめること"', '<RuleCheckList', 'text="ここから先は、あなたが答えます"', '<QuestionRail', '<SourceYears', '<Disclaimer part="general"']
  const positions = order.map(t => viewJsx.indexOf(t))
  check(`RulebookView: 並び順が ${order.join(' → ')}`, positions.every((p, i) => p > -1 && (i === 0 || p > positions[i - 1])), positions.join(','))
  check('RulebookView: 人物像の帯は --surface の面、名前は h2', view.includes('bg-surface rounded-card') && view.includes('<p className="text-h2 text-ink">{meta?.fullName'))
  check('RulebookView: 判定できない理由は --warning-ink の見出し＋--ink-2 の説明', view.includes('text-warning-ink') && view.includes('{why}'))
  check('RulebookView: 財務が全部無い（why）ときは表を出さない（帯で1回だけ伝える）', viewJsx.includes('!loading && !error && !why && checks && ('))
  check('RuleCheckList: 「目安との位置」の列は sm 以上で縮まない（min-w）', code('components/investors/RuleCheckList.tsx').includes('sm:min-w-[168px]'))
  check('MasterSignals: observed の値が有限の数でなければ observed を落とす（null が 0.0% にならない）', ms.includes('Number.isFinite(c.observed?.value)'))
  check('RulebookView: 取得失敗も --warning-ink で和文', view.includes('判定の材料を取得できませんでした') && view.includes('{error}'))
  check('RulebookView: 濃紺のベタ帯・主ボタン（bg-brand の塗り）を使わない', !/bg-brand(?!-tint)/.test(view))
  check('RulebookView: 小見出しの右の細線は --rule-line', view.includes('h-px flex-1 bg-rule-line'))
  check('RulebookView: 出どころは等幅の書体を使わない（DESIGN §5-2）', !/font-mono/.test(view))
  const { years, label } = sourceYears(published)
  check('出どころの年: 重複なく昇順（1979 1986 1987 1989 1992 1996 2007 2008 2014 2017）', JSON.stringify(years) === JSON.stringify([1979, 1986, 1987, 1989, 1992, 1996, 2007, 2008, 2014, 2017]), years.join(' '))
  check("出どころのラベル: 株主への手紙 1979–2017・Owner's Manual", label === "株主への手紙 1979–2017・Owner's Manual", label)

  console.log('■ RuleCheckList（表・値の書式）')
  const rc = code('components/investors/RuleCheckList.tsx')
  check('表1つ（table/thead/tbody）。見出し行は --surface の面', rc.includes('<table') && rc.includes('<thead className="bg-surface') && rc.includes('<tbody'))
  check('列は 見るところ｜いまの値｜目安との位置｜状態', ['見るところ', 'いまの値', '目安との位置', '状態'].every(h => rc.includes(`>${h}</th>`)))
  check('指標名（metricLabel）を title の横に出す', rc.includes('{rule.metricLabel}'))
  check('実測値は h1（24px/600）・tabular-nums', rc.includes('text-h1 tabular-nums'))
  check('390px では表を崩して縦積み（max-sm:block）。横スクロールにしない', rc.includes('max-sm:block') && !rc.includes('overflow-x-auto'))
  check('緑・赤・紺青を状態に使わない（success / danger / brand の class が無い）', !/text-success|text-danger|bg-success|bg-danger|bg-brand|text-brand/.test(rc))
  check('札・丸バツ・点数を出さない（rounded-full・◯・✕・点 が無い）', !/rounded-full|[◯✕○×]|\d+点/.test(rc))
  check('publishedRules（照合済みの出典を持つルール）だけを出す', rc.includes('publishedRules(book)'))
  check('D/E の倍率は yahooPctToRatio（/100 を書かない）', rc.includes('yahooPctToRatio(') && !/\/\s*100\b/.test(rc))
  check('軸の範囲外は点を描かず「軸の外（値）」と文字で', rc.includes('軸の外（{formatObserved(observed!)}）'))
  check('軸を持たないルールは「—」', rc.includes("if (!scale) return <span className=\"text-small text-muted\">—</span>"))
  check('軸の範囲はルールブックの scale（画面で発明しない）', rc.includes('rule.scale') && !/scale:\s*\{\s*min/.test(rc))
  const nl = code('components/investors/NumberLine.tsx')
  check('NumberLine: 軸は --axis、点はチャートの「あなた」の青（SERIES.you）', nl.includes('stroke="var(--axis)"') && nl.includes('fill={SERIES.you}'))
  check('NumberLine: 緑赤の塗り分けゾーンが無い（rect・success・danger が無い）', !/<rect|success|danger|#177A4F|#C03535/.test(nl))
  check('NumberLine: 両端に実値のラベル（format(min) / format(max)）', nl.includes('{format(min)}') && nl.includes('{format(max)}'))
  check('NumberLine: 文字は 12px 以上（DESIGN §5-2）', !/fontSize="(?:[0-9]|1[01])"/.test(nl))
  check('NumberLine: 範囲外は点を描かない（inRange のときだけ circle）', nl.includes('{inRange && <circle'))

  const b3 = published.rules.find(r => r.id === 'buffett.B3') as DataRule
  const b4 = published.rules.find(r => r.id === 'buffett.B4') as DataRule
  const b7 = published.rules.find(r => r.id === 'buffett.B7') as DataRule
  const at = new Date(2026, 8, 17, 10, 0, 0)
  check('ROE 0.162 → 16.2%', formatObserved({ metric: 'roe', value: 0.162, unit: 'ratio' }) === '16.2%')
  check('D/E 78.4（yahooPct）→ 0.78倍', formatObserved({ metric: 'debtToEquity', value: 78.4, unit: 'yahooPct' }) === '0.78倍')
  check('D/E −120 → −1.20倍（マイナスは U+2212）', formatObserved({ metric: 'debtToEquity', value: -120, unit: 'yahooPct' }) === '−1.20倍')
  check('FCF は金額を出さない（123 → プラス／−1 → マイナス／0 → ゼロ）',
    formatObserved({ metric: 'freeCashflow', value: 123, unit: 'amount' }) === 'プラス'
    && formatObserved({ metric: 'freeCashflow', value: -1, unit: 'amount' }) === 'マイナス'
    && formatObserved({ metric: 'freeCashflow', value: 0, unit: 'amount' }) === 'ゼロ')
  check('B3 の目安 → 15%以上', formatThreshold(b3) === '15%以上', formatThreshold(b3))
  check('B4 の目安 → 0〜0.5倍（下限と上限を1つに）', formatThreshold(b4) === '0〜0.5倍', formatThreshold(b4))
  check('B7 の目安 → プラス', formatThreshold(b7) === 'プラス', formatThreshold(b7))
  const d1 = describeCheck(b3, { ruleId: 'buffett.B3', state: 'meets', observed: { metric: 'roe', value: 0.162, unit: 'ratio' } }, at)
  // 「時点」だと「9/17 の値」と読まれる（ROE 等は直近決算の値。9/17 は取得した日）ので「取得」（reviewer W2・2026-09-18）
  check('「16.2%・目安 15%以上・9/17 取得」＋目安を満たす', d1.detail === '16.2%・目安 15%以上・9/17 取得' && d1.label === '目安を満たす' && d1.value === '16.2%', JSON.stringify(d1))
  const d2 = describeCheck(b4, { ruleId: 'buffett.B4', state: 'undecidable', reason: 'unknown-sector' }, at)
  check('判定できないときは値の代わりに理由「業種が分からないため」', d2.reason === '業種が分からないため' && d2.value === '—' && d2.label === '判定できない', JSON.stringify(d2))
  const d3 = describeCheck(b4, { ruleId: 'buffett.B4', state: 'undecidable', reason: 'excluded-sector' }, at)
  check('金融業「金融業は借入が事業の一部のため」', d3.reason === '金融業は借入が事業の一部のため', d3.detail)
  const d4 = describeCheck(b7, undefined, null)
  check('check が無い・時点が無い → 「データが取れないため・目安 プラス」', d4.detail === 'データが取れないため・目安 プラス' && d4.state === 'undecidable', JSON.stringify(d4))
  const d5 = describeCheck(b4, { ruleId: 'buffett.B4', state: 'misses', observed: { metric: 'debtToEquity', value: 78.4, unit: 'yahooPct' } }, at)
  check('D/E 78.4 → 「0.78倍・目安 0〜0.5倍・9/17 取得」＋目安を満たさない', d5.detail === '0.78倍・目安 0〜0.5倍・9/17 取得' && d5.label === '目安を満たさない', JSON.stringify(d5))
  check('「時点」の語を画面の文字に使わない（RuleCheckList / RulebookView。注釈は除く）', !stripComments(code('components/investors/RuleCheckList.tsx')).includes('時点') && !stripComments(code('components/investors/RulebookView.tsx')).includes('時点'))
  check('金額（$・円）が出ない', !/[$円]/.test(describeCheck(b7, { ruleId: 'buffett.B7', state: 'meets', observed: { metric: 'freeCashflow', value: 12345678, unit: 'amount' } }, at).detail))

  console.log('■ QuestionRail / InvestorLens / Disclaimer')
  const rail = code('components/investors/QuestionRail.tsx')
  check('QuestionRail: 左の縦線は --rule-line、丸は中空（bg-card ＋ 1.5px --brand）', rail.includes('border-l border-rule-line') && rail.includes('before:bg-card before:border-[1.5px] before:border-brand'))
  check('QuestionRail: 問いの文だけ h3（title・plain を出さない）', rail.includes('{rule.question}') && !rail.includes('{rule.title}') && !rail.includes('{rule.plain}'))
  check('QuestionRail: 書き込みの罫（--rule-line）とホバーで --brand（150ms）', rail.includes('border-b border-rule-line') && rail.includes('group-hover:border-brand') && rail.includes('duration-150'))
  check('QuestionRail: 行全体が /trade へのリンクで、銘柄だけ引き継ぐ（?symbol=）', rail.includes('`/trade?symbol=${encodeURIComponent(symbol)}`') && rail.includes('<Link'))
  check('QuestionRail: 「/trade で書く →」は caption/--muted', rail.includes('text-caption text-muted">/trade で書く →'))
  check('/trade は ?symbol= を受ける（app/trade/page.tsx）', code('app/trade/page.tsx').includes("params.get('symbol')"))
  const lens = code('components/investors/InvestorLens.tsx')
  check('InvestorLens: dl で3行（重く見る／重く見ない／見る期間）', lens.includes('<dl') && lens.includes('重く見る') && lens.includes('重く見ない') && lens.includes('見る期間'))
  check('InvestorLens: 写真・似顔絵・頭文字アイコンを使わない', !/<img|initial|avatar|backgroundColor/.test(lens))
  check('InvestorLens: dt は small/--muted、dd は body/--ink（16px に昇格）', lens.includes('text-small text-muted') && lens.includes('text-body text-ink'))
  // marketing/RULES.md はリポジトリに入れない別の持ち物（オーナーの手元にだけある）。無い環境（別のクローン・CI）では
  // 文言一致だけを省き、Disclaimer.tsx の定数そのものの検査は続ける（reviewer W1・2026-09-18）
  const rulesPath = path.join(ROOT, 'marketing/RULES.md')
  if (fs.existsSync(rulesPath)) {
    const rules = fs.readFileSync(rulesPath, 'utf8')
    const shortVersion = /\*\*短い版[^\n]*\n> ([^\n]+)/.exec(rules)?.[1]?.trim()
    check('Disclaimer: 文言が marketing/RULES.md §2(a) の短い版と一字も違わない', shortVersion != null && DISCLAIMER_TEXT === shortVersion, `rules=${shortVersion}`)
  } else {
    console.log('  情報: marketing/RULES.md が無いので文言一致は省略')
  }
  check('Disclaimer: 共通の免責は仮想資金・実際の売買はしない・推奨や助言ではない・個別の相談に答えない、の4点',
    DISCLAIMER_TEXT.includes('仮想資金') && DISCLAIMER_TEXT.includes('実際の売買・決済は行いません') && DISCLAIMER_TEXT.includes('投資助言・勧誘を目的とするものではなく') && DISCLAIMER_TEXT.includes('個別の投資相談にはお答えできません'))
  check('Disclaimer: ご本人とは無関係の1文', INVESTOR_DISCLAIMER_TEXT.includes('ご本人とは無関係です（公開されている考え方を当てはめたもの）') && INVESTOR_DISCLAIMER_TEXT.includes('ご本人の言葉や見解ではありません'))
  const disc = code('components/ui/Disclaimer.tsx')
  check('Disclaimer: 法的評価を自称しない（該当しません が無い）', !disc.includes('該当しません'))
  check('Disclaimer: small・--ink-2 に固定（caption・muted に下げない）', disc.includes('text-small text-ink-2') && !/text-caption|text-muted/.test(disc))
  check('Disclaimer: part が investor / general で分けられ、省くと両方', disc.includes("part?: DisclaimerPart") && disc.includes("part !== 'investor' ? DISCLAIMER_TEXT") && disc.includes("part !== 'general' ? INVESTOR_DISCLAIMER_TEXT"))

  console.log('■ 色のトークン・DESIGN.md')
  const css = code('app/globals.css')
  check('globals.css: --axis #8D9FB8 と --rule-line #C9D3E0 が :root にある', css.includes('--axis:          #8D9FB8;') && css.includes('--rule-line:     #C9D3E0;'))
  check('globals.css: Tailwind に登録（--color-axis / --color-rule-line）', css.includes('--color-axis:         var(--axis);') && css.includes('--color-rule-line:    var(--rule-line);'))
  const design = code('DESIGN.md')
  check('DESIGN.md: §5-1 の線の表に --axis と --rule-line', design.includes('| `--axis` | `#8D9FB8` |') && design.includes('| `--rule-line` | `#C9D3E0` |'))
  check('DESIGN.md: §6-6 C ノート型に名人欄の「あなたが答えること」', design.includes('名人欄の「あなたが答えること」'))
  check('DESIGN.md: 数直線の規則（最大2本・塗り分け禁止・実値ラベル・範囲外は文字）', design.includes('**数直線（名人欄の「目安との位置」）**') && design.includes('1画面に最大2本') && design.includes('緑・赤の塗り分けゾーンを作らない') && design.includes('軸の外（148.8%）'))
  check('DESIGN.md: §6-11 に免責の分け方（part="investor" / part="general"）', design.includes('`part="investor"` / `part="general"`'))
  check('DESIGN.md: 各追記に（2026-09-18 オーナー選択・DECISIONS.md 参照）', (design.match(/（2026-09-18 オーナー選択・DECISIONS\.md 参照）/g) ?? []).length >= 5)

  console.log('■ /watch・トップ・/simulate')
  const watch = code('app/watch/client.tsx')
  const msAt = watch.indexOf("<MasterSignals key=")
  const lowerAt = watch.indexOf('max-w-[760px] mx-auto mt-12')
  check('/watch: 名人欄は判断の免責の直後（下半分の運用の記録より前）', msAt > -1 && lowerAt > -1 && msAt < lowerAt, `MasterSignals@${msAt} lower@${lowerAt}`)
  check('/watch: MasterSignals は key で作り直す（既定銘柄が useState の初期値で固定されない）', watch.includes("<MasterSignals key={chartSymbol || 'AAPL'}"))
  // 2か所: セッションが無いときの画面（元からある `<MasterSignals />`）と、セッションがあるときの判断の免責の直後
  check('/watch: MasterSignals は2か所（セッション無しの画面＋判断の直後）で、旧のページ最下部には無い',
    watch.split('<MasterSignals').length - 1 === 2 && watch.includes('<MasterSignals />') && !watch.includes('<MasterSignals initialSymbol='))
  check('/watch: 見出し行に人格の caption（{姓}の考え方で判断／特定の投資家の考え方は使っていません）',
    watch.includes('の考え方で判断') && watch.includes('特定の投資家の考え方は使っていません') && watch.includes('session.persona'))
  const top = code('app/page.tsx')
  check('トップ: 同じ caption（persona が来ていれば姓、null なら汎用の文）', top.includes('persona: InvestorId | null') && top.includes('の考え方で判断') && top.includes('特定の投資家の考え方は使っていません'))
  // 2026-09-18: 取得の失敗を「まだ無い」と見せない（オーナーの友人がスマホで「取得できなかった」）
  const topCode = stripComments(top)
  check('トップ: 状態は loading / ready / empty / error の4つ', topCode.includes("'loading' | 'ready' | 'empty' | 'error'"))
  const catchLines = topCode.split('\n').filter(l => l.includes('.catch('))
  check("トップ: catch が 'empty' を立てない（失敗は 'error'）", catchLines.length === 1 && !catchLines[0].includes("setState('empty')") && catchLines[0].includes("setState('error')"), catchLines.join(' | '))
  check('トップ: HTTP が ok でないと throw（200 以外を空にしない）', topCode.includes('if (!r.ok) throw'))
  check('トップ: AbortController で時間切れ（15秒）・アンマウントで abort と clearTimeout', topCode.includes('new AbortController()') && topCode.includes('FETCH_TIMEOUT_MS = 15_000') && topCode.includes('return () => { alive = false; clearTimeout(timer); ctrl.abort() }'))
  check('トップ: error の三点（読み込めませんでした／記録は消えていません／時間をおいて）', top.includes('AIの判断記録を読み込めませんでした') && top.includes('記録は消えていません。通信やサーバーの一時的な問題です。') && top.includes('時間をおいて、もう一度読み込んでください。'))
  check('トップ: 文字ボタン「もう一度読み込む」が loading に戻して再取得', top.includes('もう一度読み込む') && top.includes("const retry = () => { setSession(null); setState('loading'); setAttempt(n => n + 1) }") && top.includes('onClick={retry}'))
  const errorAt = top.indexOf("state === 'error'")
  check('トップ: error は --warning-ink の見出し・赤い枠を使わない', errorAt > -1 && top.slice(errorAt, errorAt + 300).includes('text-warning-ink') && !/border-red|text-red|bg-danger|text-danger/.test(top))
  check("トップ: empty は 200 で判断が 0 件のときだけ（'empty' は then の中に1回）", topCode.split("setState('empty')").length - 1 === 1)
  check('トップ: 200 でも形が違えば error に倒す（isSessionSummary で throw）', topCode.includes('function isSessionSummary(v: unknown): v is SessionSummary') && topCode.includes("if (!isSessionSummary(body)) throw"))
  // 2026-09-18: 軽い API に切り替え（コミット 7806869 で本番に出た）。一覧の /api/ai-session は読まない
  check('トップ: fetch 先は /api/ai-session/latest（一覧の /api/ai-session は読まない）', topCode.includes("fetch('/api/ai-session/latest', { signal: ctrl.signal })") && !topCode.includes("fetch('/api/ai-session'"))
  check('トップ: 応答の形を確かめる（decisions が配列で各要素も正しい・tickCount が数・lastTickAt は文字列か null）', topCode.includes("Array.isArray(o.decisions) && o.decisions.every(isDecision) && typeof o.tickCount === 'number'") && topCode.includes("o.lastTickAt == null || typeof o.lastTickAt === 'string'"))
  check('トップ: 形が違えば error（throw）、decisions が空なら empty、1件以上なら ready', topCode.includes("if (!isSessionSummary(body)) throw") && topCode.includes('if (body.decisions.length > 0) {') && /setSession\(body\); setState\('ready'\)/.test(topCode))
  check('トップ: persona は null を受け、null なら汎用の文', topCode.includes('persona: InvestorId | null') && topCode.includes('personaCaption(persona: InvestorId | null | undefined)'))
  check('トップ: 旧の一覧の並べ替え（sort by lastTickAt）が無い', !topCode.includes('.sort((a, b) => Date.parse(b.lastTickAt)'))
  check('トップ: decisions の各要素も確かめる（symbol・name・reasoning が文字列、action が ACTION_LABEL のキー。壊れた成功を ready にしない）',
    topCode.includes('o.decisions.every(isDecision)') && topCode.includes("typeof d.symbol === 'string' && typeof d.name === 'string' && typeof d.reasoning === 'string'") && topCode.includes("typeof d.action === 'string' && d.action in ACTION_LABEL"))
  check('トップ: 古い注釈「/api/ai-session のまま」が残っていない', !top.includes('/api/ai-session のまま'))
  const sim = code('app/simulate/page.tsx')
  check('/simulate: 「簡易版で、ルールブックとは別」の注記（text-small text-ink-2）', sim.includes('このページの投資家の条件は簡易版で、ルールブックとは別のものです。') && /text-small text-ink-2[^>]*>このページの投資家の条件は簡易版/.test(sim))
}
async function main() {
  staticChecks()
  await behaviour()
  clientChecks()
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
