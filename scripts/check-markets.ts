// /api/markets（app/api/markets/route.ts）と「いまの相場」の時点の文言の検査。
// 取得に失敗した指数を固定値で埋めず ok:false・null で返すこと、成功分に取得元の時刻が
// 付くこと、バフェット指標を返さないこと、失敗を含む応答のキャッシュが短いこと、
// 変化率の基準が前日の終値（日足から決める。chartPreviousClose は使わない）であることを確かめる
// （原則9。2026-09-14 オーナー決定「取れない時は『取得できず』と出す」）。
//
// globalThis.fetch はこの検査の中だけで差し替える（実ネットワーク不要）。差し替えで返す
// 指数値は検査用の合成値で、製品コードには入れない（原則9の範囲内）。
//
// 実行: npx tsx scripts/check-markets.ts

import fs from 'fs'
import path from 'path'
import { GET } from '../app/api/markets/route'
import type { IndexQuote, MarketsResponse } from '../app/api/markets/route'
import { asOfCaption, allFailedLine } from '../components/MarketOverview'

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

const SYMBOLS = ['^GSPC', '^IXIC', '^DJI', '^VIX', '^TNX']
const NAMES = ['S&P 500', 'NASDAQ', 'ダウ平均', 'VIX', '10年米国債利回り']
// 以前 route.ts に直書きされていた固定値（指数・VIX・10年債・Wilshire・GDP・指標の値）。
// 応答にも製品コードにも出てはいけない。
const OLD_FIXED = ['5428', '17397', '39308', '18.5', '4.28', '56200', '29200', '192.5']

// ── Yahoo chart API と同じ形の本文を作る（検査用の合成値。時刻は UTC） ──
const sec = (iso: string) => Date.parse(iso) / 1000
const EDT = -4 * 60 * 60 // 取引所の時差（米国東部・夏時間）。meta.gmtoffset と同じ秒の単位
type Bar = [iso: string, close: number | null]

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
/** 日足なし（meta だけ）の本文 */
const metaOnly = (meta: Record<string, unknown>) => json({ chart: { result: [{ meta }], error: null } })
/** 日足つきの本文 */
function chartWithBars(meta: Record<string, unknown>, bars: Bar[]) {
  return json({
    chart: {
      result: [{
        meta: { gmtoffset: EDT, ...meta },
        timestamp: bars.map(([t]) => sec(t)),
        indicators: { quote: [{ close: bars.map(([, c]) => c) }] },
      }],
      error: null,
    },
  })
}

// 各指数: 前日（9/10）の終値 prev → 最新（9/11）の価格 price。change/pct はその1日の変化の期待値。
const GOOD: Record<string, { price: number; prev: number; time: string; change: number; pct: number }> = {
  '^GSPC': { price: 7000.5,   prev: 7100.25, time: '2026-09-11T20:46:00.000Z', change: -99.75, pct: -1.4 },
  '^IXIC': { price: 21000.75, prev: 20900,   time: '2026-09-11T21:15:00.000Z', change: 100.75, pct: 0.48 },
  '^DJI':  { price: 45000,    prev: 45000,   time: '2026-09-11T20:30:00.000Z', change: 0,      pct: 0 },
  '^VIX':  { price: 21.3,     prev: 20.1,    time: '2026-09-11T20:15:00.000Z', change: 1.2,    pct: 5.97 },
  '^TNX':  { price: 3.97,     prev: 4.01,    time: '2026-09-11T19:00:00.000Z', change: -0.04,  pct: -1 },
}
const goodChart = (symbol: string, withTime = true) => {
  const g = GOOD[symbol]
  return chartWithBars(
    {
      regularMarketPrice: g.price,
      // 基準に使ってはいけない値（range=5d の期間の始まる前の終値）。わざと前日の終値と違う数にする
      chartPreviousClose: g.prev * 1.07,
      ...(withTime ? { regularMarketTime: sec(g.time) } : {}),
    },
    [
      ['2026-09-09T13:30:00Z', g.prev * 0.97],
      ['2026-09-10T13:30:00Z', g.prev],
      ['2026-09-11T13:30:00Z', g.price],
    ],
  )
}

// ── fetch の差し替え（この検査の中だけ） ──
const realFetch = globalThis.fetch
const realWarn = console.warn
let requested: string[] = []
let warns: string[] = []

function stubFetch(handler: (symbol: string) => Response | Promise<Response>) {
  requested = []
  warns = []
  console.warn = (...args: unknown[]) => { warns.push(args.map(String).join(' ')) }
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const m = url.match(/\/v8\/finance\/chart\/([^?]+)/)
    const symbol = m ? decodeURIComponent(m[1]) : ''
    requested.push(symbol)
    return handler(symbol)
  }) as typeof fetch
}

async function callGET() {
  const res = await GET()
  const text = await res.text()
  const raw = JSON.parse(text) as Record<string, unknown>
  const cache = res.headers.get('cache-control') ?? ''
  const sMaxage = Number(cache.match(/s-maxage=(\d+)/)?.[1] ?? NaN)
  return { raw, body: raw as unknown as MarketsResponse, text, cache, sMaxage, status: res.status }
}

const isFailedShape = (ix: IndexQuote) =>
  ix.ok === false && ix.price === null && ix.change === null && ix.changePercent === null
const noOldFixed = (text: string) => OLD_FIXED.filter(v => text.includes(v))
const noBuffett = (raw: Record<string, unknown>) => raw.buffettIndicator == null

async function main() {
  // ── (a) 全部失敗: どの失敗の仕方でも ok:false・null、固定値なし、キャッシュ短い ──
  console.log('(a) 全部失敗')
  const failureModes: Array<[string, (s: string) => Response | Promise<Response>]> = [
    ['HTTP 429', () => new Response('Too Many Requests', { status: 429 })],
    ['fetch が例外（ネットワーク断）', () => { throw new TypeError('fetch failed') }],
    ['200 だが meta が無い', () => json({ chart: { result: null, error: { code: 'Not Found' } } })],
    ['200 だが本文が JSON でない', () => new Response('<html>blocked</html>', { status: 200 })],
    ['価格（regularMarketPrice）が無い', s => chartWithBars(
      { regularMarketTime: sec(GOOD[s].time) },
      [['2026-09-10T13:30:00Z', GOOD[s].prev], ['2026-09-11T13:30:00Z', GOOD[s].price]],
    )],
    ['日足が無い（chartPreviousClose だけある）', s => metaOnly(
      { regularMarketPrice: GOOD[s].price, chartPreviousClose: GOOD[s].prev, regularMarketTime: sec(GOOD[s].time) },
    )],
  ]
  for (const [label, handler] of failureModes) {
    stubFetch(handler)
    const r = await callGET()
    const ix = r.body.indices
    check(`[${label}] HTTP 200 で指数5件・並びと名前が一致`,
      r.status === 200 && ix.length === 5 && ix.every((x, i) => x.symbol === SYMBOLS[i] && x.name === NAMES[i]),
      JSON.stringify(ix.map(x => [x.symbol, x.name])))
    check(`[${label}] すべて ok:false・price/change/changePercent が null`, ix.every(isFailedShape), r.text)
    check(`[${label}] 以前の固定値が応答のどこにも無い`, noOldFixed(r.text).length === 0, noOldFixed(r.text).join(','))
    check(`[${label}] buffettIndicator が無い`, noBuffett(r.raw), r.text)
    check(`[${label}] Cache-Control の s-maxage が60秒以下`, r.sMaxage <= 60, r.cache)
  }
  // 失敗の理由がサーバーのログに残る（本番で取れない原因を調べるため）
  stubFetch(() => new Response('Too Many Requests', { status: 429 }))
  await callGET()
  check('失敗した5件とも理由（HTTP 429）がログに残る',
    warns.length === 5 && warns.every(w => w.includes('HTTP 429')), JSON.stringify(warns))
  check('全部失敗の1行: 日本時間で「◯時◯分」（UTC 15:05 → 0時05分）',
    allFailedLine(new Date('2026-09-14T15:05:00Z')) === '株価指数を取得できませんでした（0時05分・日本時間）',
    allFailedLine(new Date('2026-09-14T15:05:00Z')))
  check('全部失敗の1行: UTC 05:37 → 14時37分',
    allFailedLine(new Date('2026-09-14T05:37:00Z')) === '株価指数を取得できませんでした（14時37分・日本時間）',
    allFailedLine(new Date('2026-09-14T05:37:00Z')))

  // ── (b) 一部失敗: 成功分は値と asOf、失敗分は null、キャッシュ短い ──
  console.log('(b) 一部失敗（S&P 500 と 10年債だけ取れる）')
  stubFetch(s => {
    if (s === '^GSPC' || s === '^TNX') return goodChart(s)
    if (s === '^IXIC') return new Response('Service Unavailable', { status: 503 })
    throw new TypeError('fetch failed')
  })
  {
    const r = await callGET()
    const by = Object.fromEntries(r.body.indices.map(x => [x.symbol, x]))
    for (const s of ['^GSPC', '^TNX']) {
      const x = by[s]
      const g = GOOD[s]
      check(`${s}: ok:true・価格・変化・変化率・asOf が取得元どおり`,
        x?.ok === true && x.price === g.price && x.change === g.change && x.changePercent === g.pct && x.asOf === g.time,
        JSON.stringify(x))
    }
    for (const s of ['^IXIC', '^DJI', '^VIX']) {
      check(`${s}: ok:false・値は null（0 や前回値で埋めない）`, !!by[s] && isFailedShape(by[s]), JSON.stringify(by[s]))
    }
    check('一部失敗: 以前の固定値が応答のどこにも無い', noOldFixed(r.text).length === 0, noOldFixed(r.text).join(','))
    check('一部失敗: buffettIndicator が無い', noBuffett(r.raw), r.text)
    check('一部失敗: Cache-Control の s-maxage が60秒以下', r.sMaxage <= 60, r.cache)
    check('一部失敗: 時点は取れた分のいちばん古い時刻（10年債 UTC 19:00 → 9/12 04:00）',
      asOfCaption(r.body.indices) === '9/12 04:00 時点・遅れている場合があります', asOfCaption(r.body.indices))
  }

  // ── (c) 全部成功: 値が入り、バフェット指標が無く、キャッシュは従来どおり ──
  console.log('(c) 全部成功')
  stubFetch(s => goodChart(s))
  {
    const r = await callGET()
    const ix = r.body.indices
    check('全部成功: 指数5件・並びと名前が一致',
      ix.length === 5 && ix.every((x, i) => x.symbol === SYMBOLS[i] && x.name === NAMES[i]))
    for (const x of ix) {
      const g = GOOD[x.symbol]
      check(`${x.symbol}: ok:true・価格 ${g.price}・変化 ${g.change}・変化率 ${g.pct}%・asOf ${g.time}`,
        x.ok === true && x.price === g.price && x.change === g.change && x.changePercent === g.pct && x.asOf === g.time,
        JSON.stringify(x))
    }
    check('全部成功: 応答のキーは indices だけ（buffettIndicator が無い）',
      JSON.stringify(Object.keys(r.raw)) === '["indices"]' && noBuffett(r.raw), JSON.stringify(Object.keys(r.raw)))
    check('全部成功: 取りに行くのは5指数だけ（Wilshire 5000 を取りに行かない）',
      JSON.stringify([...requested].sort()) === JSON.stringify([...SYMBOLS].sort()), JSON.stringify(requested))
    check('全部成功: 以前の固定値が応答のどこにも無い', noOldFixed(r.text).length === 0, noOldFixed(r.text).join(','))
    check('全部成功: Cache-Control は従来どおり（s-maxage=300）',
      r.cache === 'public, s-maxage=300, stale-while-revalidate=60', r.cache)
    check('全部成功: 時点はいちばん古い時刻（9/12 04:00）',
      asOfCaption(ix) === '9/12 04:00 時点・遅れている場合があります', asOfCaption(ix))
    check('全部成功: 何もログに出さない', warns.length === 0, JSON.stringify(warns))
  }

  // 取得元に時刻が無いときは asOf を null にし、時点は「不明」と書く（時刻を作らない）
  stubFetch(s => goodChart(s, false))
  {
    const r = await callGET()
    check('時刻なし: 値は ok:true のまま（最後の足の日を最新として前日比）asOf は null',
      r.body.indices.every(x => x.ok === true && x.asOf === null && x.change === GOOD[x.symbol].change && x.changePercent === GOOD[x.symbol].pct),
      r.text)
    check('時刻なし: 時点は「時点不明」', asOfCaption(r.body.indices) === '時点不明・遅れている場合があります', asOfCaption(r.body.indices))
  }

  // ── (e)(f)(g) 変化率の基準＝前日の終値（日足から決める。chartPreviousClose は使わない） ──
  // WEEK の終値は、2026-09-14 に取得した実際の S&P 500 の日足（9/7 は祝日で足なし）に合わせた検査用の値。
  const WEEK: Bar[] = [
    ['2026-09-04T13:30:00Z', 7718.60],
    ['2026-09-08T13:30:00Z', 7673.52],
    ['2026-09-09T13:30:00Z', 7636.36],
    ['2026-09-10T13:30:00Z', 7591.70],
    ['2026-09-11T13:30:00Z', 7656.98],
  ]
  const FRI_AFTER_CLOSE = '2026-09-11T20:46:20.000Z' // 金曜の引け後（米国東部 16:46）
  const MON_INTRADAY = '2026-09-14T15:00:00.000Z'    // 月曜の場中（米国東部 11:00）

  async function gspc(meta: Record<string, unknown>, bars: Bar[] | null) {
    stubFetch(() => (bars ? chartWithBars(meta, bars) : metaOnly(meta)))
    const r = await callGET()
    return r.body.indices.find(x => x.symbol === '^GSPC')
  }
  const is = (x: IndexQuote | undefined, price: number, change: number, pct: number, asOf: string | null) =>
    x?.ok === true && x.price === price && x.change === change && x.changePercent === pct && x.asOf === asOf

  console.log('(e) 変化率は前日の終値との比較')
  {
    const x = await gspc({ regularMarketPrice: 7656.98, regularMarketTime: sec(FRI_AFTER_CLOSE), chartPreviousClose: 7747.71 }, WEEK)
    check('場が閉まった後（最新の足＝直近の取引日 9/11）: 前日 7591.70 → 7656.98 で +65.28・+0.86%',
      is(x, 7656.98, 65.28, 0.86, FRI_AFTER_CLOSE), JSON.stringify(x))
    check('chartPreviousClose（7747.71＝5営業日前）との比較の −1.17% にならない',
      x?.ok === true && x.changePercent !== -1.17, JSON.stringify(x))
  }
  {
    const x = await gspc(
      { regularMarketPrice: 7700, regularMarketTime: sec(MON_INTRADAY), chartPreviousClose: 7747.71 },
      [...WEEK, ['2026-09-14T13:30:00Z', 7700]],
    )
    check('場中（最新の足＝当日 9/14）: 前日 9/11 の 7656.98 → 7700 で +43.02・+0.56%',
      is(x, 7700, 43.02, 0.56, MON_INTRADAY), JSON.stringify(x))
  }
  {
    const x = await gspc(
      { regularMarketPrice: 7700, regularMarketTime: sec(MON_INTRADAY) },
      [...WEEK, ['2026-09-14T13:30:00Z', 7690], ['2026-09-14T15:00:00Z', 7700]],
    )
    check('場中に当日の足が2本返っても、基準は前日 9/11 の終値（+0.56%。当日 7690 との比較にしない）',
      is(x, 7700, 43.02, 0.56, MON_INTRADAY), JSON.stringify(x))
  }

  console.log('(f) 終値が null の足')
  {
    const x = await gspc({ regularMarketPrice: 7700, regularMarketTime: sec(MON_INTRADAY) }, [...WEEK, ['2026-09-14T13:30:00Z', null]])
    check('場中で最後の足（当日）の終値が null: 基準は前日 9/11 の終値（+0.56%）',
      is(x, 7700, 43.02, 0.56, MON_INTRADAY), JSON.stringify(x))
  }
  {
    const x = await gspc({ regularMarketPrice: 7656.98, regularMarketTime: sec(FRI_AFTER_CLOSE) }, [...WEEK, ['2026-09-14T13:30:00Z', null]])
    check('寄り付き前に当日の空の足（null）が付き価格は 9/11 のまま: ±0 にせず 9/11 の1日の変化（+0.86%）',
      is(x, 7656.98, 65.28, 0.86, FRI_AFTER_CLOSE), JSON.stringify(x))
  }
  {
    const bars: Bar[] = [['2026-09-09T13:30:00Z', 7636.36], ['2026-09-10T13:30:00Z', null], ['2026-09-11T13:30:00Z', 7656.98]]
    const x = await gspc({ regularMarketPrice: 7656.98, regularMarketTime: sec(FRI_AFTER_CLOSE) }, bars)
    check('途中の足（9/10）の終値が null: 飛ばして 9/9 の 7636.36 を基準にする（+20.62・+0.27%）',
      is(x, 7656.98, 20.62, 0.27, FRI_AFTER_CLOSE), JSON.stringify(x))
  }
  {
    const x = await gspc({ regularMarketPrice: 7700 }, [...WEEK, ['2026-09-14T13:30:00Z', null]])
    check('取得元の時刻が無く最後の足が null: 最後の足の日（9/14）を最新とし 9/11 が基準（+0.56%・asOf は null）',
      is(x, 7700, 43.02, 0.56, null), JSON.stringify(x))
  }

  console.log('(g) 前日の終値が決められない → ok:false')
  const undecidable: Array<[string, Record<string, unknown>, Bar[] | null]> = [
    ['足が1本だけ（最新の日の足）',
      { regularMarketPrice: 7656.98, regularMarketTime: sec(FRI_AFTER_CLOSE) },
      [['2026-09-11T13:30:00Z', 7656.98]]],
    ['前の日の足の終値がすべて null',
      { regularMarketPrice: 7656.98, regularMarketTime: sec(FRI_AFTER_CLOSE) },
      [['2026-09-09T13:30:00Z', null], ['2026-09-10T13:30:00Z', null], ['2026-09-11T13:30:00Z', 7656.98]]],
    ['足がすべて当日（2本）',
      { regularMarketPrice: 7700, regularMarketTime: sec(MON_INTRADAY) },
      [['2026-09-14T13:30:00Z', 7690], ['2026-09-14T15:00:00Z', 7700]]],
    ['日足が無く chartPreviousClose だけある（代わりに使わない）',
      { regularMarketPrice: 7656.98, regularMarketTime: sec(FRI_AFTER_CLOSE), chartPreviousClose: 7747.71 },
      null],
  ]
  for (const [label, meta, bars] of undecidable) {
    const x = await gspc(meta, bars)
    check(`${label}: ok:false・値は null（変化を 0 で埋めない）`, !!x && isFailedShape(x), JSON.stringify(x))
  }
  {
    // timestamp はあるが終値の列が無い
    stubFetch(() => json({
      chart: {
        result: [{
          meta: { regularMarketPrice: 7656.98, regularMarketTime: sec(FRI_AFTER_CLOSE), gmtoffset: EDT },
          timestamp: WEEK.map(([t]) => sec(t)),
          indicators: { quote: [{}] },
        }],
        error: null,
      },
    }))
    const r = await callGET()
    const x = r.body.indices.find(i => i.symbol === '^GSPC')
    check('終値の列が無い: ok:false・値は null', !!x && isFailedShape(x), JSON.stringify(x))
    check('前日の終値が決められない理由がログに残る', warns.some(w => w.includes('前日の終値')), JSON.stringify(warns))
    check('前日の終値が決められないときもキャッシュは短い', r.sMaxage <= 60, r.cache)
  }

  // ── (d) 製品コードの静的な確認（固定値・バフェット指標の文言・古い基準が戻っていない） ──
  console.log('(d) 製品コード')
  const files = ['app/api/markets/route.ts', 'components/MarketOverview.tsx', 'app/markets/page.tsx']
  for (const f of files) {
    const src = fs.readFileSync(path.join(process.cwd(), f), 'utf8')
    const hits = OLD_FIXED.filter(v => src.includes(v))
    check(`${f}: 以前の固定値が無い`, hits.length === 0, hits.join(','))
    check(`${f}: buffettIndicator・割高/割安の文言が無い`, !/buffettIndicator|割高|割安/.test(src))
  }
  const routeCode = fs.readFileSync(path.join(process.cwd(), 'app/api/markets/route.ts'), 'utf8')
    .split('\n').filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  check('route.ts: コメント以外で chartPreviousClose を読まない', !routeCode.includes('chartPreviousClose'))
  const overview = fs.readFileSync(path.join(process.cwd(), 'components/MarketOverview.tsx'), 'utf8')
  check('MarketOverview: 取れなかった指数に「取得できませんでした」を出す', overview.includes('取得できませんでした'))
  check('MarketOverview: 時点は text-caption text-muted', overview.includes('text-caption text-muted'))
}

main()
  .catch(err => {
    failed++
    console.error(err)
  })
  .finally(() => {
    globalThis.fetch = realFetch
    console.warn = realWarn
    console.log('')
    console.log(`PASS ${passed} 件 / FAIL ${failed} 件`)
    if (failed) process.exit(1)
    console.log('すべてPASS')
  })
