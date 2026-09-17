// 前日比（前日の終値と比べた変化）の検査。
//  - lib/market/previous-close.ts の純関数（基準の決め方・変化の計算・数値の読み取り）
//  - 取得元の quote（yahoodirect・twelvedata）が古い基準を使わず、取れない値を 0 で埋めないこと
//  - 候補選び（lib/ai-trader/tick-record.ts の rankUniverse）が前日比の取れない銘柄を順位から外すこと
//  - 製品コードに古い基準（chartPreviousClose）・0 埋め・模擬データへのフォールバックが戻っていないこと
//  - 銘柄詳細（app/stocks/[symbol]）と名人の判定（app/api/signals/[symbol]）が模擬データに黙って
//    切り替わらないこと（2026-09-17 スライス1: 取れないときは「取得できませんでした」／502 で止める）
//  - AI の運用成績（lib/ai-trader/engine.ts）とバックテスト（lib/simulation.ts・app/simulate）が模擬データの
//    株価で成績を作らないこと（2026-09-17 スライス3・4: 取れない銘柄は除外し、全滅なら和文で止める）
// （2026-09-14 オーナー決定: 候補は前日比で選ぶ／取れなければ偽の値を使わず候補を減らす。原則9）
//
// globalThis.fetch はこの検査の中だけで差し替える（実ネットワーク不要）。差し替えで返す値は検査用の
// 合成値（AAPL 9/11 引け後の実測に形を合わせたもの）で、製品コードには入れない（原則9の範囲内）。
//
// 実行: npx tsx scripts/check-previous-close.ts

import fs from 'fs'
import path from 'path'
import {
  previousCloseFromBars, barsFromChartArrays, changeFromPrevClose, epochSeconds, toFiniteNumber, roundTo,
  type CloseBar,
} from '../lib/market/previous-close'
import { rankUniverse, candidatesNote, CHANGE_BASIS } from '../lib/ai-trader/tick-record'
import { UNIVERSE, TICK_CANDIDATE_COUNT } from '../lib/ai-trader/universe'
import { yfDirectGetQuote } from '../lib/market/providers/yahoodirect'
import { twelveDataGetQuote } from '../lib/market/providers/twelvedata'

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

type Row = [iso: string, close: number | null]
const sec = (iso: string) => Date.parse(iso) / 1000
const EDT = -4 * 60 * 60 // 米国東部・夏時間（meta.gmtoffset と同じ秒の単位）
const JST = 9 * 60 * 60
const toBars = (rows: Row[]): CloseBar[] => rows.map(([t, c]) => ({ time: sec(t), close: c }))
const j = (v: unknown) => JSON.stringify(v)

// AAPL の 9/4〜9/11（9/7 は米国の祝日）。9/11 引け後の本当の前日比は 326.57 → 332.27 の +1.75%。
// 旧 yahoodirect（range=5d の chartPreviousClose＝9/3 の終値 328.20）では +1.24% と出ていた。
const AAPL_WEEK: Row[] = [
  ['2026-09-04T13:30:00Z', 330.1],
  ['2026-09-08T13:30:00Z', 327.4],
  ['2026-09-09T13:30:00Z', 325.02],
  ['2026-09-10T13:30:00Z', 326.57],
  ['2026-09-11T13:30:00Z', 332.27],
]
const AFTER_CLOSE = sec('2026-09-11T20:00:00Z') // 9/11 16:00 EDT（最終取引時刻）
const OLD_5D_BASE = 328.2

function pureFunctions() {
  console.log('(a) 引け後の5本')
  {
    const pc = previousCloseFromBars(toBars(AAPL_WEEK), AFTER_CLOSE, EDT)
    check('基準は前日（9/10）の終値 326.57', pc === 326.57, String(pc))
    const ch = changeFromPrevClose(332.27, pc, 2)
    check('変化 +5.7・変化率 +1.75%', ch.change === 5.7 && ch.changePercent === 1.75, j(ch))
    const old = changeFromPrevClose(332.27, OLD_5D_BASE, 2)
    check('旧基準（5営業日前の終値）の +1.24% にならない', old.changePercent === 1.24 && ch.changePercent !== old.changePercent, j(old))
    check('最終取引時刻が無ければ最後の足の日で決める（同じ 326.57）',
      previousCloseFromBars(toBars(AAPL_WEEK), null, EDT) === 326.57)
  }

  console.log('(b) 場中（最新の足の終値が null・価格は regularMarketPrice）')
  {
    const rows: Row[] = [...AAPL_WEEK.slice(0, 4), ['2026-09-11T13:30:00Z', null]]
    const pc = previousCloseFromBars(toBars(rows), sec('2026-09-11T15:00:00Z'), EDT)
    check('基準は前日の終値 326.57', pc === 326.57, String(pc))
    const ch = changeFromPrevClose(330, pc, 2)
    check('330 なら +3.43・+1.05%', ch.change === 3.43 && ch.changePercent === 1.05, j(ch))
    const rows2: Row[] = [...AAPL_WEEK.slice(0, 4), ['2026-09-11T13:30:00Z', 329.5]]
    check('当日の足に途中の終値が入っていても基準にしない（326.57）',
      previousCloseFromBars(toBars(rows2), sec('2026-09-11T15:00:00Z'), EDT) === 326.57)
  }

  console.log('(c) 寄り付き前に当日の空の足が付く')
  {
    const rows: Row[] = [...AAPL_WEEK, ['2026-09-14T13:30:00Z', null]]
    const pc = previousCloseFromBars(toBars(rows), AFTER_CLOSE, EDT)
    check('最終取引日（9/11）の前日の終値 326.57（空の足の日を最新にしない）', pc === 326.57, String(pc))
    check('変化率は最終取引日の1日の変化 +1.75%（0% にならない）', changeFromPrevClose(332.27, pc).changePercent === 1.75)
  }

  console.log('(d) 同じ日の重複行')
  {
    const rows: Row[] = [
      ['2026-09-09T13:30:00Z', 325.02],
      ['2026-09-10T13:30:00Z', 326.0],
      ['2026-09-10T19:59:00Z', 326.57],
      ['2026-09-11T13:30:00Z', 330.1],
      ['2026-09-11T19:59:00Z', 332.27],
    ]
    const pc = previousCloseFromBars(toBars(rows), AFTER_CLOSE, EDT)
    check('当日の2行を飛ばし、前日の最後の行 326.57 を基準にする', pc === 326.57, String(pc))
  }

  console.log('(e) 祝日明け（前日の足が無い）')
  {
    const rows: Row[] = [
      ['2026-09-03T13:30:00Z', 300],
      ['2026-09-04T13:30:00Z', 310],
      ['2026-09-08T13:30:00Z', 320],
    ]
    const pc = previousCloseFromBars(toBars(rows), sec('2026-09-08T20:00:00Z'), EDT)
    check('9/8（火）の基準は直前の取引日 9/4（金）の 310', pc === 310, String(pc))
    check('変化率 +3.23%', changeFromPrevClose(320, pc).changePercent === 3.23)
    const gw: Row[] = [
      ['2026-04-27T15:00:00Z', 2980],
      ['2026-04-28T15:00:00Z', 3000],
      ['2026-05-06T15:00:00Z', 3090],
    ]
    check('連休（日本の大型連休）明けの 5/7 は 4/28 の終値 3000',
      previousCloseFromBars(toBars(gw), sec('2026-05-07T06:15:00Z'), JST) === 3000)
  }

  console.log('(f) 日本株の時差（gmtoffset 32400）')
  {
    // 日足の時刻が日本時間の0時（＝前日 15:00 UTC）で返る形
    const rows: Row[] = [
      ['2026-09-08T15:00:00Z', 2900],
      ['2026-09-09T15:00:00Z', 3000],
      ['2026-09-10T15:00:00Z', 3060],
    ]
    const mt = sec('2026-09-11T06:15:00Z') // 9/11 15:15 JST
    const pc = previousCloseFromBars(toBars(rows), mt, JST)
    check('9/11（日本時間）の基準は 9/10 の終値 3000', pc === 3000, String(pc))
    check('時差を無視すると当日の終値 3060 を基準にしてしまう（時差が効いている確認）',
      previousCloseFromBars(toBars(rows), mt, null) === 3060)
    const ch = changeFromPrevClose(3060, pc, 1)
    check('円は小数1桁: +60・+2%', ch.change === 60 && ch.changePercent === 2, j(ch))
    const morning: Row[] = [['2026-09-10T00:00:00Z', 3000], ['2026-09-11T00:00:00Z', null]]
    check('寄り付き直後（9:30 JST）で当日の足が空でも 3000',
      previousCloseFromBars(toBars(morning), sec('2026-09-11T00:30:00Z'), JST) === 3000)
  }

  console.log('(g) 決められないときは null')
  {
    check('足1本だけ', previousCloseFromBars(toBars([['2026-09-11T13:30:00Z', 332.27]]), AFTER_CLOSE, EDT) === null)
    check('終値が全部 null', previousCloseFromBars(toBars(AAPL_WEEK.map(([t]) => [t, null] as Row)), AFTER_CLOSE, EDT) === null)
    check('足が無い', previousCloseFromBars([], AFTER_CLOSE, EDT) === null)
    check('時刻が無く最後の足の時刻も数値でない', previousCloseFromBars([{ time: Number.NaN, close: 1 }], null, EDT) === null)
    const zero: Row[] = [['2026-09-09T13:30:00Z', 325.02], ['2026-09-10T13:30:00Z', 0], ['2026-09-11T13:30:00Z', 332.27]]
    check('終値 0 の足は飛ばす（325.02）', previousCloseFromBars(toBars(zero), AFTER_CLOSE, EDT) === 325.02)
    const nulls = { change: null, changePercent: null }
    check('前日の終値が null なら変化も変化率も null（0 にしない）', j(changeFromPrevClose(332.27, null)) === j(nulls))
    check('価格が null なら null', j(changeFromPrevClose(null, 326.57)) === j(nulls))
    check('前日の終値が 0 なら null', j(changeFromPrevClose(100, 0)) === j(nulls))
    check('価格が NaN なら null', j(changeFromPrevClose(Number.NaN, 100)) === j(nulls))
  }

  console.log('変化率は丸める前の差から計算する')
  {
    check('24.555 と 24.30 → +1.05%（差を 0.26 に丸めてからだと +1.07% になる）',
      changeFromPrevClose(24.555, 24.3, 2).changePercent === 1.05)
    check('-0 は 0 にする', Object.is(roundTo(-0.001, 2), 0))
  }

  console.log('数値の読み取り')
  {
    const bars = barsFromChartArrays([1, 2, 3], [10, null])
    check('barsFromChartArrays: 長さは短いほう・null の終値は null', bars.length === 2 && bars[1].close === null, j(bars))
    check('barsFromChartArrays: 配列でなければ []', barsFromChartArrays(undefined, [1]).length === 0)
    const odd = barsFromChartArrays(['x', 2], ['10', 20])
    check('barsFromChartArrays: 数値でない時刻は NaN・数値でない終値は null',
      Number.isNaN(odd[0].time) && odd[0].close === null && odd[1].time === 2 && odd[1].close === 20, j(odd))
    const iso = '2026-09-11T20:00:00Z'
    check('epochSeconds: Date → 秒', epochSeconds(new Date(iso)) === sec(iso))
    check('epochSeconds: 秒はそのまま・文字列は解釈', epochSeconds(sec(iso)) === sec(iso) && epochSeconds(iso) === sec(iso))
    check('epochSeconds: 不正な Date・undefined・空文字は null',
      epochSeconds(new Date('x')) === null && epochSeconds(undefined) === null && epochSeconds('') === null)
    check('toFiniteNumber: 数の文字列は数に', toFiniteNumber('1.75') === 1.75 && toFiniteNumber('-2.5') === -2.5 && toFiniteNumber('0') === 0)
    check('toFiniteNumber: null・undefined・空文字・文字は null（0 にしない）',
      [null, undefined, '', '  ', 'abc', Number.NaN].every(v => toFiniteNumber(v) === null))
  }
}

// ── 取得元（fetch の差し替え） ──
const realFetch = globalThis.fetch
let requested: string[] = []
function stubFetch(handler: (url: string) => Response | Promise<Response>) {
  requested = []
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    requested.push(url)
    return handler(url)
  }) as typeof fetch
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
function chartJson(meta: Record<string, unknown>, rows: Row[] | null) {
  const bars = rows
    ? { timestamp: rows.map(([t]) => sec(t)), indicators: { quote: [{ close: rows.map(([, c]) => c) }] } }
    : {}
  return json({ chart: { result: [{ meta, ...bars }], error: null } })
}

async function providers() {
  console.log('yahoodirect の quote')
  {
    stubFetch(() => chartJson({
      currency: 'USD', regularMarketPrice: 332.27, chartPreviousClose: OLD_5D_BASE, previousClose: OLD_5D_BASE,
      regularMarketTime: AFTER_CLOSE, gmtoffset: EDT, marketState: 'POSTPOST', regularMarketVolume: 1000,
    }, AAPL_WEEK))
    const q = await yfDirectGetQuote('AAPL')
    check('range=5d の日足を取りに行く', requested.length === 1 && requested[0].includes('range=5d&interval=1d'), j(requested))
    check('AAPL 引け後: +5.7・+1.75%（chartPreviousClose の +1.24% ではない）',
      q.price === 332.27 && q.change === 5.7 && q.changePercent === 1.75, j(q))

    stubFetch(() => chartJson({
      currency: 'JPY', regularMarketPrice: 3060, chartPreviousClose: 2800,
      regularMarketTime: sec('2026-09-11T06:15:00Z'), gmtoffset: JST,
    }, [['2026-09-08T15:00:00Z', 2900], ['2026-09-09T15:00:00Z', 3000], ['2026-09-10T15:00:00Z', 3060]]))
    const jp = await yfDirectGetQuote('7203.T')
    check('7203.T: 時差で日付を数え +60・+2%', jp.change === 60 && jp.changePercent === 2 && jp.currency === 'JPY', j(jp))

    stubFetch(() => chartJson({
      currency: 'USD', regularMarketPrice: 330, regularMarketTime: sec('2026-09-11T15:00:00Z'), gmtoffset: EDT,
    }, [...AAPL_WEEK.slice(0, 4), ['2026-09-11T13:30:00Z', null]]))
    const live = await yfDirectGetQuote('AAPL')
    check('場中: 当日の足が空でも +1.05%', live.changePercent === 1.05, j(live))

    stubFetch(() => chartJson({ currency: 'USD', regularMarketPrice: 332.27, chartPreviousClose: OLD_5D_BASE, regularMarketTime: AFTER_CLOSE }, null))
    const noBars = await yfDirectGetQuote('AAPL')
    check('日足が無い: change・changePercent は null（0 にも chartPreviousClose 比にもしない）',
      noBars.change === null && noBars.changePercent === null && noBars.price === 332.27, j(noBars))

    stubFetch(() => chartJson({ currency: 'USD', chartPreviousClose: OLD_5D_BASE, regularMarketTime: AFTER_CLOSE }, AAPL_WEEK))
    let threw = false
    let got: unknown = null
    try { got = await yfDirectGetQuote('AAPL') } catch { threw = true }
    check('価格が無い: 0 や古い終値で埋めず失敗にする（次の取得元へ回る）', threw, j(got))
  }

  console.log('twelvedata の quote')
  {
    const prevKey = process.env.TWELVE_DATA_API_KEY
    process.env.TWELVE_DATA_API_KEY = 'check-only'
    try {
      const base = { symbol: 'AAPL', name: 'Apple Inc', close: '332.27', volume: '100', currency: 'USD', is_market_open: false }
      stubFetch(() => json({ ...base, change: '5.70000', percent_change: '1.74542' }))
      const q = await twelveDataGetQuote('AAPL')
      check('数の文字列はそのまま数に', q.change === 5.7 && q.changePercent === 1.74542, j(q))
      stubFetch(() => json({ ...base, change: null, percent_change: '' }))
      const blank = await twelveDataGetQuote('AAPL')
      check('null・空文字は null（旧実装は 0）', blank.change === null && blank.changePercent === null, j(blank))
      stubFetch(() => json({ ...base }))
      const missing = await twelveDataGetQuote('AAPL')
      check('項目が無ければ null', missing.change === null && missing.changePercent === null, j(missing))
    } finally {
      if (prevKey === undefined) delete process.env.TWELVE_DATA_API_KEY
      else process.env.TWELVE_DATA_API_KEY = prevKey
    }
  }
}

function candidates() {
  console.log('候補選び（rankUniverse）')
  {
    const syms = ['A', 'B', 'C', 'D', 'E', 'F']
    const scanned = [
      { symbol: 'A', changePercent: 1 },
      { symbol: 'B', changePercent: -5 },
      { symbol: 'C', changePercent: null },
      { symbol: 'D', changePercent: 3 },
      // E は取得元がすべて失敗（scanned に無い）
      { symbol: 'F', changePercent: 0.5 },
    ]
    const r = rankUniverse(syms, scanned, 4)
    check('|前日比| の大きい順に4件: B, D, A, F', r.candidates.join(',') === 'B,D,A,F', j(r.candidates))
    check('行は symbols の順で6行', r.universe.map(x => x.symbol).join(',') === 'A,B,C,D,E,F', j(r.universe))
    const row = (s: string) => r.universe.find(x => x.symbol === s)
    check('取れた行は ok:true・値と順位', j(row('B')) === j({ symbol: 'B', changePercent: -5, ok: true, rank: 1 })
      && row('F')?.rank === 4, j(r.universe))
    check('前日比が null の行は ok:false・changePercent/rank null（順位に入れない）',
      j(row('C')) === j({ symbol: 'C', changePercent: null, ok: false, rank: null }))
    check('取得に失敗した行も ok:false・null', j(row('E')) === j({ symbol: 'E', changePercent: null, ok: false, rank: null }))

    const nan = rankUniverse(['X', 'Y'], [{ symbol: 'X', changePercent: Number.NaN }, { symbol: 'Y', changePercent: 0 }], 4)
    check('NaN は取れていない扱い・0（変わらず）は取れた値として順位に入る',
      nan.candidates.join(',') === 'Y' && nan.universe[0].ok === false && nan.universe[1].rank === 1, j(nan))

    const few = rankUniverse(syms, [{ symbol: 'D', changePercent: -2 }, { symbol: 'A', changePercent: 4 }], 4)
    check('取れた銘柄が4未満なら取れた分だけ候補にする（2件）', few.candidates.join(',') === 'A,D', j(few.candidates))

    const none = rankUniverse(UNIVERSE, [], TICK_CANDIDATE_COUNT)
    check('0件なら候補は []・40行すべて ok:false・null',
      none.candidates.length === 0 && none.universe.length === UNIVERSE.length
      && none.universe.every(x => x.ok === false && x.changePercent === null && x.rank === null), j(none.candidates))

    const tie = rankUniverse(['P', 'Q'], [{ symbol: 'Q', changePercent: -2 }, { symbol: 'P', changePercent: 2 }], 4)
    check('同じ大きさなら symbols の順', tie.candidates.join(',') === 'P,Q', j(tie.candidates))
  }

  console.log('段 candidates の note・基準の印')
  {
    const empty = candidatesNote(0, 40, 0, 2)
    check('0件: 取得できなかったことと、保有銘柄だけを分析したことを残す',
      empty.includes('前日比を取得できた銘柄が無く') && empty.includes('保有銘柄だけを分析') && empty.includes('2件'), empty)
    check('通常: 取得数・候補数・保有から足した数',
      candidatesNote(39, 40, 4, 1) === '39/40銘柄の前日比を取得・候補4件・保有から1件', candidatesNote(39, 40, 4, 1))
    check("基準の印は 'prev-close-v1'", CHANGE_BASIS === 'prev-close-v1')
  }
}

function productCode() {
  console.log('製品コードの静的な確認')
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), 'utf8')
  // コメント行を除いた本文（理由の説明に古い名前が出るのは構わない）
  const code = (f: string) => read(f).split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  for (const f of ['lib/market/providers/yahoodirect.ts', 'lib/market/providers/yahoo2.ts', 'app/api/markets/route.ts']) {
    const src = code(f)
    check(`${f}: chartPreviousClose を基準に読まない`, !src.includes('chartPreviousClose'))
    check(`${f}: 前日の終値を previousCloseFromBars で決める`, src.includes('previousCloseFromBars('))
    check(`${f}: 価格を 0 で埋めない`, !/const price[^\n]*\?\?\s*0\b/.test(src))
  }
  check('yahoo2.ts: 予備経路の取得期間は14日', code('lib/market/providers/yahoo2.ts').includes('14 * 86_400_000'))
  check('twelvedata.ts: change・percent_change を || 0 で埋めない', !/change\)\s*\|\|\s*0/.test(code('lib/market/providers/twelvedata.ts')))

  const engine = code('lib/ai-trader/engine.ts')
  check('engine.ts: 候補選びの quote は模擬データなし', engine.includes('getQuote(sym, { allowMock: false })'))
  check('engine.ts: 分析対象の材料も模擬データなし',
    engine.includes('getQuote(symbol, { allowMock: false })') && engine.includes("getHistory(symbol, '3mo', { allowMock: false })")
    && engine.includes('getFundamentals(symbol, { allowMock: false })'))
  check('engine.ts: 候補は rankUniverse で選ぶ', engine.includes('rankUniverse(UNIVERSE, scanned, n)'))
  check('engine.ts: 判断の change・price を ?? 0 で埋めない', !/changePercent \?\? 0/.test(engine) && !/quote\.price \?\? 0/.test(engine))
  check('engine.ts: 新しい記録と判断に基準の印を付ける',
    engine.includes('record.changeBasis = CHANGE_BASIS') && engine.includes('changeBasis:   CHANGE_BASIS'))
  check("engine.ts: AI には前日比が無いとき「取得できず」と渡す", engine.includes("前日比: ${quote.changePercent == null ? '取得できず'"))

  // 利用者の目と売買記録に直接届く経路（2026-09-17 スライス1・原則9）。
  // 銘柄詳細の quote は TradeButton → TradeModal を経て約定価格として記録に残る。
  // 「allowMock:false の呼び出しが1つある」だけでは、同じファイルに指定なしの呼び出し（既定は allowMock:true）が
  // 後から足されても通ってしまう。取得の呼び出し回数と allowMock:false の回数が一致すること（全呼び出しが
  // 守られていること）と、providers/mock を直接 import していないことも見る（2026-09-17 レビュー指摘 S1）。
  const count = (src: string, re: RegExp) => (src.match(re) ?? []).length
  const FETCH_CALL = /\b(?:getQuote|getHistory|getFundamentals)\(/g
  // allowMock:false は「取得呼び出しの引数の中」にあるものだけ数える。ファイル全体で数えると
  // `getQuote(sym) // allowMock: false` のような行末コメントで件数を合わせられてしまう（code() が除くのは
  // 行頭のコメント行だけ）。呼び出し1件と1対1で対応させる（2026-09-17 レビュー指摘 S1）。
  const NO_MOCK = /\b(?:getQuote|getHistory|getFundamentals)\([^)]*allowMock:\s*false/g
  const MOCK_IMPORT = /(?:from\s*|import\s*\(\s*)['"][^'"]*providers\/mock['"]/
  const everyCallNoMock = (label: string, src: string) => {
    const calls = count(src, FETCH_CALL)
    const noMock = count(src, NO_MOCK)
    check(`${label}: 取得の呼び出し全部に allowMock:false（呼び出し ${calls} 件＝allowMock:false ${noMock} 件）`,
      calls > 0 && calls === noMock)
    check(`${label}: providers/mock を import しない`, !MOCK_IMPORT.test(src))
  }
  const stockPage = code('app/stocks/[symbol]/page.tsx')
  check('stocks/[symbol]/page: 銘柄詳細の quote は模擬データなし', stockPage.includes('getQuote(symbol, { allowMock: false })'))
  everyCallNoMock('stocks/[symbol]/page', stockPage)
  const signalsRoute = code('app/api/signals/[symbol]/route.ts')
  check('api/signals: 名人の判定の材料3つとも模擬データなし',
    signalsRoute.includes('getQuote(symbol, { allowMock: false })') && signalsRoute.includes("getHistory(symbol, '1y', { allowMock: false })")
    && signalsRoute.includes('getFundamentals(symbol, { allowMock: false })'))
  everyCallNoMock('api/signals', signalsRoute)
  check('api/signals: 取れないときは 502 で止める（500 に戻さない）', signalsRoute.includes('status: 502') && !signalsRoute.includes('status: 500'))

  // AI の運用成績とベンチマーク比較（2026-09-17 スライス3・原則9）。engine.ts の3か所＝運用開始時の SPY
  // （ベンチマーク比較の起点。セッションの間ずっと使われる）／保有銘柄の評価額（総資産・損益・シャープレシオ・
  // 最大ドローダウンの元）／各 tick の SPY（比較点）。既定の allowMock:true のままだと実データ3経路が全滅した
  // とき乱数の株価が黙って入り、評価額は catch に入らないので「取得に失敗した件数」にも数えられなかった。
  check('engine.ts: 運用開始時と各 tick の SPY（ベンチマーク）は模擬データなし（2か所）',
    count(engine, /getQuote\('SPY', \{ allowMock: false \}\)/g) === 2 && !/getQuote\('SPY'\)/.test(engine))
  check('engine.ts: 保有銘柄の評価額の quote は模擬データなし（候補選びと合わせて2か所）',
    count(engine, /getQuote\(sym, \{ allowMock: false \}\)/g) === 2 && !/getQuote\(sym\)/.test(engine))
  check('engine.ts: 評価額の取得失敗は取得単価で代用し、件数を trade 段の note に残す',
    engine.includes('valuationFallbacks++') && engine.includes('評価額の株価取得に失敗${valuationFallbacks}銘柄（取得単価で代用）'))
  everyCallNoMock('engine.ts', engine)

  // /simulate のバックテスト（2026-09-17 スライス4・原則9）。getHistory/getFundamentals が既定の allowMock:true の
  // ままだと、実データ3経路が全滅した銘柄に providers/mock の種つき乱数の日足が入り、その損益・勝率・最大
  // ドローダウン・売買履歴が本物の成績として画面に出ていた。取れない銘柄は catch → [] → symbolsWithData（11本以上）で
  // 除外され、全滅のときだけ和文で止める（app/simulate/page.tsx がその文をそのまま見出しに出す）。
  const sim = code('lib/simulation.ts')
  check('simulation.ts: バックテストの日足は模擬データなし', sim.includes("getHistory(sym, '3mo', { allowMock: false })"))
  check('simulation.ts: 財務データも模擬データなし', sim.includes('getFundamentals(sym, { allowMock: false })'))
  everyCallNoMock('simulation.ts', sim)
  check('simulation.ts: 取れない銘柄は除外し、全滅のときは和文で止める（英語の例外文を残さない）',
    sim.includes("throw new Error('過去の株価を取得できませんでした')")
    && !sim.includes('No historical data available') && !sim.includes('Insufficient data for simulation'))
  check('simulation.ts: 合成 quote の change・changePercent は null（0 で埋めない・2か所）',
    count(sim, /change:\s*null,\s*changePercent:\s*null/g) === 2 && !/change(?:Percent)?:\s*0\b/.test(sim))
  const simPage = code('app/simulate/page.tsx')
  check('simulate/page: エラー帯は三点形式・--warning-ink（旧色 border-red-200 を残さない）',
    simPage.includes('text-warning-ink') && !simPage.includes('border-red-200')
    && simPage.includes('代わりの数字を作らずここで止めます') && simPage.includes('もう一度実行してください'))
  // 「含む」だけだと fetch より後にあっても通る。setResult(null) が fetch より前にあることを位置で見る（2026-09-17 レビュー指摘 S2）
  const resetAt = simPage.indexOf('setResult(null)')
  const fetchAt = simPage.indexOf("fetch('/api/simulate'")
  check('simulate/page: 実行のたびに、fetch より前に前回の結果を消す（エラー時に仮の数字を出さない）',
    resetAt > -1 && fetchAt > -1 && resetAt < fetchAt, `setResult(null)@${resetAt} fetch@${fetchAt}`)
  check('simulate/page: JSON でない応答・回線の失敗も和文にする',
    simPage.includes('サーバーから結果を受け取れませんでした') && simPage.includes('サーバーに接続できませんでした'))
  // 200 応答の本文が JSON でないとき（途中で切れた応答等）も英語の SyntaxError を見出しに出さない: res.json() は
  // すべて .catch( を伴うこと（2026-09-17 レビュー指摘 S3）
  check('simulate/page: res.json() はすべて .catch( を伴う（200 でも本文が JSON でなければ和文）',
    count(simPage, /res\.json\(\)/g) >= 2 && !/res\.json\(\)(?!\.catch\()/.test(simPage))

  // 除外した銘柄を黙って落とさない（2026-09-17 レビュー指摘 W1）: runSimulation が symbolsWithData に絞った残りを
  // excludedSymbols として返し、画面が結果の先頭で「N 銘柄は株価を取得できず、除外して計算しました」と注記する
  check('simulation.ts: SimResult に excludedSymbols（string[]）があり、symbolsWithData の残りを返す',
    sim.includes('excludedSymbols: string[]') && sim.includes('const excludedSymbols = symbols.filter(s => !symbolsWithData.includes(s))')
    && /^\s*excludedSymbols,\s*$/m.test(sim))
  check('simulate/page: excludedSymbols を読み、除外した銘柄を --warning-ink の帯で伝える',
    simPage.includes('result.excludedSymbols.length > 0') && simPage.includes("result.excludedSymbols.join('・')")
    && simPage.includes('は株価を取得できず、除外して計算しました'))
  // value ユニバースの 'BRK' は Yahoo に無い記号（providers/mock にしか無かった）。プロジェクトの表記は BRK-B
  // （lib/market/us-universe.ts）。単独の 'BRK' が戻ると value は常に19銘柄＋除外1件で走る（2026-09-17 レビュー指摘 W1-b）
  const simRoute = code('app/api/simulate/route.ts')
  check("api/simulate: value ユニバースはバークシャーを 'BRK-B' で持ち、単独の 'BRK' を残さない",
    simRoute.includes("'BRK-B'") && !/['"]BRK['"]/.test(simRoute))

  check("report/prompt.ts: 前日比が無いとき「取得できず」", code('lib/report/prompt.ts').includes("q.changePercent == null ? '取得できず'"))

  check('DecisionCard: null は「—」', code('components/watch/DecisionCard.tsx').includes('decision.change == null'))
  check('RealtimeQuote: null は「—」', code('components/RealtimeQuote.tsx').includes("basis == null ? '—'"))
  check('trade/page: null は「—」', code('app/trade/page.tsx').includes('quote.changePercent == null'))
}

async function main() {
  pureFunctions()
  await providers()
  candidates()
  productCode()
}

main()
  .catch(err => {
    failed++
    console.error(err)
  })
  .finally(() => {
    globalThis.fetch = realFetch
    console.log('')
    console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
    if (failed) process.exit(1)
    console.log('すべてPASS')
  })
