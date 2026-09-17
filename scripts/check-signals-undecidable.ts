// 名人の判定 API（app/api/signals/[symbol]/route.ts）が、財務データを取れなかったときに
// 「◇ 様子見」に見える偽の判断を返さず「判定できません」を返すことの検査（2026-09-17 スライス2）。
//
//  - 財務を材料にする名人（buffett / lynch / graham / dalio）の一覧が、lib/investors/*.ts の analyze() の
//    引数（{ fundamentals } か { quote, history } か）と一致していること（モデルを増やした・引数を変えたときの取りこぼし防止）
//  - 財務が空 `{}`（と、キーはあるが全項目 undefined）のとき、財務を使う名人が signals に入らず undecidable に理由つきで入ること
//  - 株価だけで判定する名人（soros）は従来どおり signals に入ること
//  - 財務があるときは5人とも従来どおり入り、undecidable が無く、各モデルを直接呼んだ結果と一致すること
//  - 判定できない名人が1人でもいる応答は長時間キャッシュされない（no-store）こと。全員判定できた応答は従来の5分のまま
//  - 画面側（MasterSignals / InvestorPanel）が undecidable を読み、HTTP の番号や取得元の生の英語を画面に出さないこと
//  - （2026-09-17 出荷前の仕上げ）0 だけの財務 `{ debtToEquity: 0 }` は「取れた」扱い（`!= null` の根拠）／一部だけ取れた
//    `{ marketCap: 1 }` で4人が hold を返す【既知の穴・スライス5で undecidable に変える】／502 の原因が console.error に出る／
//    MasterSignals が理由の同じ説明文を一覧の手前に1回だけ出す
//
// 実ネットワーク不要: `@/lib/market`（取得元）だけを Module._load で差し替え、route.ts の GET をそのまま呼ぶ。
// 差し替えで返す値は検査用の合成値で、製品コードには入れない（原則9の範囲内）。`server-only` は Next の外では
// import しただけで throw するので空に差し替える。
//
// 実行: npx tsx scripts/check-signals-undecidable.ts

import fs from 'fs'
import path from 'path'
import Module from 'module'
import investors from '../lib/investors'
import type { StockQuote, HistoricalBar, FundamentalsData, Signal } from '../types'

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
// 250 本・緩やかな上昇（soros の RSI / 200日MA / 50日MA が全部計算できる長さ）
const HISTORY: HistoricalBar[] = Array.from({ length: 250 }, (_, i) => ({
  time: 1_700_000_000 + i * 86_400, open: 200 + i * 0.4, high: 201 + i * 0.4, low: 199 + i * 0.4,
  close: 200 + i * 0.4 + (i % 3 === 0 ? -0.6 : 0.3), volume: 1_000_000,
}))
// yahoo2 が AAPL に返す形（debtToEquity は Yahoo 原値の%表記）
const FULL_FUNDAMENTALS: FundamentalsData = {
  pe: 38.2, pb: 45.16, pegRatio: 2.67, roe: 1.488, debtToEquity: 78.4, revenueGrowth: 0.164, earningsGrowth: 0.287,
}

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

type RouteModule = {
  GET: (req: Request, ctx: { params: Promise<{ symbol: string }> }) => Promise<Response>
}
async function callRoute(symbol = 'aapl') {
  // tsx（CommonJS）の require: route.ts の import は Module._load を通るので、上の差し替えが効く
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const route = require(path.join(ROOT, 'app/api/signals/[symbol]/route.ts')) as RouteModule
  const res = await route.GET(new Request(`http://localhost/api/signals/${symbol}`), { params: Promise.resolve({ symbol }) })
  const body = await res.json() as { symbol?: string; signals?: Record<string, Signal>; undecidable?: Record<string, string>; error?: string; listed?: boolean }
  return { status: res.status, cache: res.headers.get('cache-control') ?? '', body }
}

// ── 1. 財務を材料にする名人の一覧が、モデルの analyze() の引数と一致すること ──
function modelsByInput(): { needsFundamentals: string[]; priceOnly: string[]; all: string[] } {
  const dir = path.join(ROOT, 'lib/investors')
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts') && f !== 'index.ts' && f !== 'registry.ts')
  const needsFundamentals: string[] = []
  const priceOnly: string[] = []
  const all: string[] = []
  for (const f of files) {
    const src = fs.readFileSync(path.join(dir, f), 'utf8')
    const id = /\bid:\s*'([a-z]+)'/.exec(src)?.[1]
    const args = /\banalyze\(\s*\{([^}]*)\}\s*:\s*AnalysisInput\s*\)/.exec(src)?.[1]
    check(`lib/investors/${f}: id と analyze() の引数が読める`, Boolean(id && args), `id=${id} args=${args}`)
    if (!id || args == null) continue
    all.push(id)
    if (/\bfundamentals\b/.test(args)) needsFundamentals.push(id)
    else priceOnly.push(id)
  }
  return { needsFundamentals: needsFundamentals.sort(), priceOnly: priceOnly.sort(), all: all.sort() }
}

function staticChecks() {
  console.log('■ 財務を材料にする名人の一覧（route.ts）とモデルの引数の一致')
  const models = modelsByInput()
  const route = code('app/api/signals/[symbol]/route.ts')
  const listSrc = /FUNDAMENTALS_INVESTOR_IDS[^=]*=\s*new Set\(\[([^\]]*)\]\)/.exec(route)?.[1]
  const routeList = (listSrc ?? '').split(',').map(s => s.trim().replace(/['"]/g, '')).filter(Boolean).sort()
  check('route.ts: FUNDAMENTALS_INVESTOR_IDS がある', listSrc != null)
  check(`route.ts: 一覧 [${routeList}] ＝ analyze({ fundamentals }) のモデル [${models.needsFundamentals}]`,
    JSON.stringify(routeList) === JSON.stringify(models.needsFundamentals))
  check(`株価だけで判定する名人 [${models.priceOnly}] は一覧に入っていない`,
    models.priceOnly.length > 0 && models.priceOnly.every(id => !routeList.includes(id)))
  check('モデルは5人（buffett / dalio / graham / lynch / soros）',
    JSON.stringify(models.all) === JSON.stringify(['buffett', 'dalio', 'graham', 'lynch', 'soros']), models.all.join(','))
  check('route.ts: 財務の有無は「値が1つでも入っているか」で見る（{} と全項目 undefined の両方を「無い」に）',
    /Object\.values\(fundamentals\)\.some\(v => v != null\)/.test(route))
  check('route.ts: 判定できない名人がいる応答は no-store', /anyUndecidable \? 'no-store'/.test(route))
  check('route.ts: 全員判定できた応答は従来の5分のまま', route.includes("'public, s-maxage=300, stale-while-revalidate=60'"))
  check('route.ts: 502 の catch は変えていない（status: 502 ＋ no-store ＋ listed）',
    route.includes('status: 502') && route.includes("{ error: message, symbol, listed: Boolean(findStock(symbol)) }"))
  return models
}

// ── 2. 応答（route.ts の GET を実際に呼ぶ） ──
async function behaviour(models: { needsFundamentals: string[]; priceOnly: string[] }) {
  const fundamentalsUsers = models.needsFundamentals
  const priceOnly = models.priceOnly

  console.log('■ 財務データが空 {} のとき')
  state.fundamentals = {}
  {
    const r = await callRoute()
    check('200 で返る（502 にしない: 株価と足は取れている）', r.status === 200, String(r.status))
    check('symbol は大文字', r.body.symbol === 'AAPL', String(r.body.symbol))
    const sigIds = Object.keys(r.body.signals ?? {}).sort()
    const undIds = Object.keys(r.body.undecidable ?? {}).sort()
    check(`財務を使う名人 [${fundamentalsUsers}] が signals に本物の判断として入らない`,
      fundamentalsUsers.every(id => !(id in (r.body.signals ?? {}))), `signals=${sigIds}`)
    check(`財務を使う名人 [${fundamentalsUsers}] が undecidable に入る`,
      JSON.stringify(undIds) === JSON.stringify(fundamentalsUsers), `undecidable=${undIds}`)
    check('undecidable の理由が「財務データ」に触れ、「判定できません」と書いてある',
      Object.values(r.body.undecidable ?? {}).every(w => typeof w === 'string' && w.includes('財務データ') && w.includes('判定できません')))
    check('undecidable の理由に「どうすればいいか」がある（DESIGN.md §6-12 の三点形式: 時間をおいて再読み込み）',
      Object.values(r.body.undecidable ?? {}).every(w => w.includes('時間をおいて再読み込みしてください')))
    check(`株価だけで判定する名人 [${priceOnly}] は signals に入る`,
      JSON.stringify(sigIds) === JSON.stringify(priceOnly), `signals=${sigIds}`)
    const soros = r.body.signals?.soros
    check('soros の判定は buy/sell/hold のどれかで理由つき',
      soros != null && ['buy', 'sell', 'hold'].includes(soros.action) && Array.isArray(soros.reasons) && soros.reasons.length > 0,
      JSON.stringify(soros))
    check('soros は「取得中」のような仮の判定ではない', soros != null && !soros.reasons.some(x => x.includes('取得中')))
    check('「○○基準を満たす指標が不足」の hold が1つも無い',
      !Object.values(r.body.signals ?? {}).some(s => s.reasons.some(x => x.includes('指標が不足'))))
    check('判定できない名人がいる応答は no-store（5分のキャッシュに残さない）', r.cache === 'no-store', r.cache)
    check('s-maxage が付いていない', !/s-maxage/.test(r.cache), r.cache)
  }

  console.log('■ 財務データがキーだけあって全項目 undefined のとき（yahoodirect の空応答の形）')
  state.fundamentals = { pe: undefined, pb: undefined, roe: undefined, debtToEquity: undefined }
  {
    const r = await callRoute()
    check('財務を使う名人は signals に入らず undecidable に入る',
      fundamentalsUsers.every(id => !(id in (r.body.signals ?? {})) && id in (r.body.undecidable ?? {})),
      JSON.stringify({ signals: Object.keys(r.body.signals ?? {}), undecidable: Object.keys(r.body.undecidable ?? {}) }))
    check('soros は入る', r.body.signals?.soros != null)
    check('no-store', r.cache === 'no-store', r.cache)
  }

  console.log('■ 財務データが 0 だけのとき（0 は有効な値。「無い」の判定を `!= null` にした根拠を固定する）')
  state.fundamentals = { debtToEquity: 0 }
  {
    const r = await callRoute()
    const sigIds = Object.keys(r.body.signals ?? {}).sort()
    check('200', r.status === 200, String(r.status))
    check('0 を「無い」と誤らず、5人とも signals に入る',
      JSON.stringify(sigIds) === JSON.stringify(['buffett', 'dalio', 'graham', 'lynch', 'soros']), sigIds.join(','))
    check('undecidable キーが無い', !('undecidable' in r.body), JSON.stringify(Object.keys(r.body)))
    check('0 が値として使われる（dalio の理由に「負債資本比率 0.00」）',
      (r.body.signals?.dalio?.reasons ?? []).some(x => x.includes('負債資本比率 0.00')), JSON.stringify(r.body.signals?.dalio))
    check('従来の5分のキャッシュ', r.cache === 'public, s-maxage=300, stale-while-revalidate=60', r.cache)
  }

  console.log('■ 財務データが一部だけのとき（{ marketCap: 1 }）— 既知の穴を記録する')
  // 【既知の穴・reviewer W1・2026-09-17】判定に使わない項目（marketCap）だけ取れた場合、いまの route.ts は
  // 「値が1つでも入っている」で財務ありとみなし、4人のモデルが走って「○○基準を満たす指標が不足」の hold を返す
  // （画面では「◇ 様子見」＝本物の判断に見える）。スライス5で「名人ごとに必要な項目」を見て undecidable に変える計画。
  // そのとき、この検査を意図的に赤にして直すために、いまの振る舞いをそのまま固定しておく（直したら期待値を反転すること）。
  state.fundamentals = { marketCap: 1 }
  {
    const r = await callRoute()
    check('200', r.status === 200, String(r.status))
    check('【既知の穴】財務を使う4人が signals に入り undecidable が無い（スライス5で undecidable に変える）',
      fundamentalsUsers.every(id => id in (r.body.signals ?? {})) && !('undecidable' in r.body),
      JSON.stringify({ signals: Object.keys(r.body.signals ?? {}), keys: Object.keys(r.body) }))
    check('【既知の穴】4人とも hold（材料が無いのに「◇ 様子見」に見える）',
      fundamentalsUsers.every(id => r.body.signals?.[id]?.action === 'hold'),
      JSON.stringify(Object.fromEntries(fundamentalsUsers.map(id => [id, r.body.signals?.[id]?.action]))))
    check('【既知の穴】理由は「指標が不足」か「データなし」の定型文',
      fundamentalsUsers.every(id => (r.body.signals?.[id]?.reasons ?? []).some(x => x.includes('指標が不足') || x.includes('データなし'))),
      JSON.stringify(Object.fromEntries(fundamentalsUsers.map(id => [id, r.body.signals?.[id]?.reasons]))))
    check('【既知の穴】この偽の様子見が従来の5分キャッシュに乗る', r.cache === 'public, s-maxage=300, stale-while-revalidate=60', r.cache)
  }

  console.log('■ 財務データがあるとき（従来どおり）')
  state.fundamentals = FULL_FUNDAMENTALS
  {
    const r = await callRoute()
    const sigIds = Object.keys(r.body.signals ?? {}).sort()
    check('200', r.status === 200, String(r.status))
    check('5人とも signals に入る', JSON.stringify(sigIds) === JSON.stringify(['buffett', 'dalio', 'graham', 'lynch', 'soros']), sigIds.join(','))
    check('undecidable キーが無い（応答の形は修正前と同じ）', !('undecidable' in r.body), JSON.stringify(Object.keys(r.body)))
    check('従来の5分のキャッシュ', r.cache === 'public, s-maxage=300, stale-while-revalidate=60', r.cache)
    // 各モデルを直接呼んだ結果と一致（debtToEquity は /100 して渡す規約。2026-09-11）
    const forModels = { ...FULL_FUNDAMENTALS, debtToEquity: FULL_FUNDAMENTALS.debtToEquity! / 100 }
    for (const inv of investors) {
      const direct = inv.analyze({ quote: QUOTE, history: HISTORY, fundamentals: forModels })
      check(`${inv.id}: API の判定 ＝ モデルを直接呼んだ判定`, JSON.stringify(r.body.signals?.[inv.id]) === JSON.stringify(direct),
        `api=${JSON.stringify(r.body.signals?.[inv.id])} direct=${JSON.stringify(direct)}`)
    }
    check('buffett は本物の判定（AAPL 相当の値で buy）', r.body.signals?.buffett?.action === 'buy', JSON.stringify(r.body.signals?.buffett))
  }

  console.log('■ 株価が取れないとき（スライス1の 502 はそのまま。原因はサーバーのログに残す）')
  state.fundamentals = FULL_FUNDAMENTALS
  state.quoteFails = true
  {
    // 画面には生の英語を出さないぶん、原因が console.error でサーバーのログに残ること（reviewer S5）。
    // console.error を一時的に差し替えて捕まえ、呼び終わったら必ず戻す（check() の FAIL 表示も console.error を使う）。
    const logged: string[] = []
    const realError = console.error
    console.error = (...args: unknown[]) => { logged.push(args.map(String).join(' ')) }
    const r = await callRoute().finally(() => { console.error = realError })
    check('502', r.status === 502, String(r.status))
    check('no-store', r.cache === 'no-store', r.cache)
    check('error と listed がある', typeof r.body.error === 'string' && typeof r.body.listed === 'boolean', JSON.stringify(r.body))
    check('signals を返さない', r.body.signals == null)
    check('原因が console.error でサーバーのログに出る（[api/signals/[symbol]] ＋ 銘柄 ＋ 取得元の生の理由）',
      logged.some(l => l.includes('[api/signals/[symbol]]') && l.includes('AAPL') && l.includes('Real quote unavailable')),
      JSON.stringify(logged))
    check('ログは1行だけ（同じ原因を二重に出さない）', logged.length === 1, String(logged.length))
  }
  state.quoteFails = false
}

// ── 3. 画面側 ──
function clientChecks() {
  console.log('■ 画面側（MasterSignals / InvestorPanel）')
  const ms = code('components/MasterSignals.tsx')
  check('MasterSignals: undecidable を読む', ms.includes('readUndecidable') && ms.includes('undecidable?: Record<string, string>'))
  check('MasterSignals: 「判定できません」を --warning-ink で出す', /text-warning-ink[^>]*>判定できません</.test(ms))
  check('MasterSignals: 判定できない人に哲学の文（m.philosophy）を出す前に理由（why）を出す',
    ms.indexOf(') : why ? (') > 0 && ms.indexOf(') : why ? (') < ms.indexOf('{m.philosophy}'))
  // 同じ説明文を4行にくり返さない（MC 指摘・2026-09-17。再生画面の「記録なし」16→11 と同じ方針）
  check('MasterSignals: 理由が全員同じなら一覧の手前に1回だけ出す（sharedWhy の帯）',
    ms.includes('const sharedWhy') && /signals && sharedWhy && \(/.test(ms))
  check('MasterSignals: そのとき各行は「判定できません」の札だけ（行ごとの説明は出さない）', /sharedWhy \? null :/.test(ms))
  check('MasterSignals: 1回だけの説明は既存のエラー表示と同じ型（bg-card rounded-card px-4 py-5 space-y-1 の帯が2か所以上）',
    ms.split('bg-card rounded-card px-4 py-5 space-y-1').length - 1 >= 2)
  check('MasterSignals: 理由が名人ごとに違うときは行ごとに出す（sharedWhy は every で「全員同じ」のときだけ）',
    /pending\.every\(m => undecidable\[m\.id\] === undecidable\[pending\[0\]\.id\]\)/.test(ms))
  check('MasterSignals: 画面に HTTP の番号を出さない（`HTTP ${` が無い）', !ms.includes('HTTP ${'))
  check('MasterSignals: 取得失敗の文は和文（502 → データ源の文）', ms.includes("status === 502 ? MSG_UPSTREAM : MSG_SERVER"))
  check('MasterSignals: e.message を素通しで画面に出さない', !/setError\(e\.message\)/.test(ms))

  const ip = code('components/InvestorPanel.tsx')
  check('InvestorPanel: undecidable を読む', ip.includes('readUndecidable') && ip.includes('setUndecidable'))
  check('InvestorPanel: 「判定できません」を --warning-ink で出す', /text-warning-ink">判定できません</.test(ip))
  check('InvestorPanel: 旧「データ取得エラー: {生の英語}」の JSX が無い', !ip.includes('データ取得エラー: {error}'))
  check('InvestorPanel: API の error（生の英語）を Error に包んで画面に出さない', !ip.includes('throw new Error(d.error)') && !/setError\(e\.message\)/.test(ip))
  check('InvestorPanel: 取得失敗の文は和文（502 → データ源の文）', ip.includes("status === 502 ? MSG_UPSTREAM : MSG_SERVER"))
}

async function main() {
  const models = staticChecks()
  await behaviour(models)
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
