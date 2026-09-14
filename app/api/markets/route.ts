import { NextResponse } from 'next/server'

/**
 * GET /api/markets — 主要指数の要約（/watch の「いまの相場」が読む）。
 *
 * 取得に失敗した指数は `ok: false` と null を返す。固定値・0・前回値で埋めない
 * （原則9。2026-09-14 オーナー決定「取れない時は『取得できず』と出す」）。
 * 以前は失敗すると直書きの指数値（変化はすべて 0）を印なしで返しており、本番の
 * サーバーから取得に失敗し続けた結果、本物のように見える固定値が表示されていた。
 *
 * 変化・変化率は前日の終値との比較（その取引日の1日の変化）。基準の決め方は
 * previousClose() を参照。以前は meta.chartPreviousClose を基準にしていたが、range=5d では
 * それが期間の始まる前（約5営業日前）の終値なので、5日分の変化を1日の変化のように
 * 出していた（2026-09-14 修正。S&P 500 が前日比 +0.86% の日に −1.17% と表示されていた）。
 *
 * バフェット指標（株式時価総額÷GDP）は応答から外した。Wilshire 5000 の指数値を
 * 時価総額とみなし、GDP は直書きしていたので、実データの指標ではなかったため。
 * 本物の時価総額と GDP を取る仕組みができるまで出さない。
 */

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'application/json',
}

export type IndexQuote =
  | {
      symbol: string
      name: string
      ok: true
      price: number
      change: number
      changePercent: number
      /** 取得元（Yahoo）の最終取引時刻（ISO 文字列）。取得元に無ければ null */
      asOf: string | null
    }
  | {
      symbol: string
      name: string
      ok: false
      price: null
      change: null
      changePercent: null
    }

export interface MarketsResponse {
  indices: IndexQuote[]
}

/** chart API の応答のうち使う所だけ。中身は信用せず、使う前に数値か確かめる。 */
interface ChartResult {
  meta?: {
    regularMarketPrice?: unknown
    regularMarketTime?: unknown
    gmtoffset?: unknown
  }
  timestamp?: unknown
  indicators?: { quote?: Array<{ close?: unknown }> }
}

// 表示名だけの対応表（値は持たない）。並び順がそのまま応答と表示の順。
const INDEX_NAMES: Record<string, string> = {
  '^GSPC': 'S&P 500',
  '^IXIC': 'NASDAQ',
  '^DJI':  'ダウ平均',
  '^VIX':  'VIX',
  '^TNX':  '10年米国債利回り',
}

// 全部取れたときは従来どおり5分。1つでも失敗を含む応答は、失敗を長く抱え込まないよう短くする。
const CACHE_ALL_OK = 'public, s-maxage=300, stale-while-revalidate=60'
const CACHE_WITH_FAILURE = 'public, s-maxage=60'

const DAY_SEC = 24 * 60 * 60

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * 前日の終値（変化の基準）。日足から「最新の取引日より前で、最後の有効な終値」を返す。
 * - 最新の取引日＝取得元の最終取引時刻（regularMarketTime）の日。時刻が無ければ最後の足の日。
 *   場中なら当日、場が閉まっていれば直近の取引日になるので、どちらでもその取引日の1日の変化になる。
 * - 日付は取引所の時差（meta.gmtoffset・秒）で数える。場中の足が同じ日の別の行で返るときも、
 *   寄り付き前に当日の空の足（終値 null）が付くときも、前日の終値を基準にできる。
 * - 終値が null の足は飛ばす。決められなければ null を返す（変化を 0 で埋めない）。
 * - meta.chartPreviousClose は使わない（range=5d では期間の始まる前＝約5営業日前の終値のため）。
 */
function previousClose(result: ChartResult, marketTime: number | null): number | null {
  const ts = result.timestamp
  const closes = result.indicators?.quote?.[0]?.close
  if (!Array.isArray(ts) || !Array.isArray(closes)) return null
  const n = Math.min(ts.length, closes.length)
  if (n === 0) return null
  const g = result.meta?.gmtoffset
  const offset = isNum(g) ? g : 0
  const dayOf = (t: number) => Math.floor((t + offset) / DAY_SEC)
  const lastTs: unknown = ts[n - 1]
  const latest = marketTime ?? (isNum(lastTs) ? lastTs : null)
  if (latest === null) return null
  const latestDay = dayOf(latest)
  for (let i = n - 1; i >= 0; i--) {
    const t: unknown = ts[i]
    const c: unknown = closes[i]
    if (isNum(t) && dayOf(t) < latestDay && isNum(c) && c > 0) return c
  }
  return null
}

function failed(symbol: string, reason: string): IndexQuote {
  // 本番で取得できない原因を後から調べられるよう、理由だけサーバーのログに残す
  console.warn(`[api/markets] ${symbol} を取得できませんでした: ${reason}`)
  return { symbol, name: INDEX_NAMES[symbol] ?? symbol, ok: false, price: null, change: null, changePercent: null }
}

async function fetchIndex(symbol: string): Promise<IndexQuote> {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`
    const res = await fetch(url, { headers: HEADERS, next: { revalidate: 300 } })
    if (!res.ok) return failed(symbol, `HTTP ${res.status}`)
    const json = await res.json()
    const result: ChartResult | undefined = json?.chart?.result?.[0]
    const meta = result?.meta
    if (!result || !meta) return failed(symbol, 'meta が無い')
    const price = meta.regularMarketPrice
    if (!isNum(price)) return failed(symbol, 'regularMarketPrice が無い')
    const t = meta.regularMarketTime
    const marketTime = isNum(t) ? t : null
    // 比較の基準（前日の終値）が決められなければ、変化を 0 で埋めずに「取得できず」とする
    const prevClose = previousClose(result, marketTime)
    if (prevClose === null) return failed(symbol, '前日の終値を日足から決められない')
    const change = parseFloat((price - prevClose).toFixed(2))
    const changePercent = parseFloat(((change / prevClose) * 100).toFixed(2))
    const asOfDate = marketTime !== null ? new Date(marketTime * 1000) : null
    return {
      symbol,
      name: INDEX_NAMES[symbol] ?? symbol,
      ok: true,
      price,
      change,
      changePercent,
      asOf: asOfDate && Number.isFinite(asOfDate.getTime()) ? asOfDate.toISOString() : null,
    }
  } catch (err) {
    return failed(symbol, err instanceof Error ? err.message : String(err))
  }
}

export async function GET() {
  const indices = await Promise.all(Object.keys(INDEX_NAMES).map(fetchIndex))
  const body: MarketsResponse = { indices }
  return NextResponse.json(body, {
    headers: { 'Cache-Control': indices.every(i => i.ok) ? CACHE_ALL_OK : CACHE_WITH_FAILURE },
  })
}
