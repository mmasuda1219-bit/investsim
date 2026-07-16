// Primary real-data provider backed by the `yahoo-finance2` library.
//
// Why this exists: the hand-rolled query1/query2 fetch in providers/yahoodirect.ts
// now gets HTTP 429 from Yahoo for EVERY request (Yahoo hard-gates the public
// chart/quote hosts behind a cookie+crumb session). `yahoo-finance2` establishes
// and reuses that cookie/crumb session automatically, so it succeeds where the
// raw fetch fails. This module becomes the first real-data source in lib/market
// (COMPANY.md 原則9: real data first — mock stays a last-resort dev fallback).
//
// A single YahooFinance instance is memoised at module scope so the crumb/cookie
// is reused across the many parallel calls the AI-session tick makes. A small
// in-memory TTL cache further collapses duplicate lookups (same symbol fetched
// by quote+history+fundamentals within one request, or repeated page loads),
// which keeps us well under Yahoo's rate limits.

import type { StockQuote, HistoricalBar, FundamentalsData, SearchResult } from '@/types'

// ── Singleton library instance (reuses cookie/crumb session) ───────────────
// Typed loosely on purpose: yahoo-finance2 v3 ships its own types but we only
// touch a small, stable subset and map into our own domain types below.
/* eslint-disable @typescript-eslint/no-explicit-any */
let yfInstance: any = null
async function yf(): Promise<any> {
  if (yfInstance) return yfInstance
  const mod: any = await import('yahoo-finance2')
  const YahooFinance = mod.default ?? mod
  yfInstance = new YahooFinance({
    // Silence the survey + noisy validation logs (we tolerate schema drift).
    suppressNotices: ['yahooSurvey'],
    validation: { logErrors: false },
  })
  return yfInstance
}

// ── Tiny in-memory TTL cache ───────────────────────────────────────────────
interface CacheEntry { at: number; data: unknown }
const cache = new Map<string, CacheEntry>()

function readCache<T>(key: string, ttlMs: number): T | undefined {
  const hit = cache.get(key)
  if (!hit) return undefined
  if (Date.now() - hit.at > ttlMs) { cache.delete(key); return undefined }
  return hit.data as T
}

function writeCache(key: string, data: unknown): void {
  // Bound the map so a long-lived server process can't leak unboundedly.
  if (cache.size > 500) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, { at: Date.now(), data })
}

const QUOTE_TTL_MS = 20_000
const HISTORY_TTL_MS = 300_000
const FUNDAMENTALS_TTL_MS = 1_800_000
const SEARCH_TTL_MS = 600_000

function detectMarket(symbol: string): StockQuote['market'] {
  if (symbol.endsWith('.T')) return 'JP'
  if (/^[A-Z]{1,5}$/.test(symbol)) return 'US'
  return 'OTHER'
}

// ── Period → chart params ──────────────────────────────────────────────────
// yahoo-finance2's chart() takes a period1 start DATE (+ interval), so we
// translate the app's range tokens into a look-back window. Daily-bar ranges
// add slack days so warm-up-heavy backtests still receive enough bars.
const RANGE_MAP: Record<string, { days: number; interval: string }> = {
  '1m':  { days: 1,   interval: '1m' },
  '5m':  { days: 1,   interval: '5m' },
  '15m': { days: 5,   interval: '15m' },
  '30m': { days: 5,   interval: '30m' },
  '1h':  { days: 30,  interval: '60m' },
  '1d':  { days: 2,   interval: '5m' },
  '5d':  { days: 7,   interval: '30m' },
  '1mo': { days: 33,  interval: '1d' },
  '3mo': { days: 95,  interval: '1d' },
  '6mo': { days: 190, interval: '1d' },
  '1y':  { days: 370, interval: '1d' },
  '2y':  { days: 740, interval: '1wk' },
  // 5y daily bars (~1250 + warm-up slack) — used by /report backtests.
  '5y':  { days: 1835, interval: '1d' },
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

function toIso(t: unknown): string {
  if (!t) return new Date().toISOString()
  const d = t instanceof Date ? t : typeof t === 'number' ? new Date(t * 1000) : new Date(t as string)
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString()
}

/**
 * Derive a StockQuote from the chart() endpoint's `meta` block. The v8 chart
 * endpoint is far less aggressively blocked than the v7 quote endpoint (which
 * Yahoo 429s hardest from data-center / Vercel IPs), so this is the resilient
 * fallback when quote() fails. Uses a 1-month window to keep the payload tiny.
 */
async function yf2QuoteFromChartMeta(symbol: string): Promise<StockQuote> {
  const client = await yf()
  const period1 = new Date(Date.now() - 7 * 86_400_000)
  const c: any = await client.chart(symbol, { period1, interval: '1d' })
  const meta = c?.meta
  const price = num(meta?.regularMarketPrice)
  if (!meta || price === undefined) throw new Error(`yahoo-finance2: no chart meta for ${symbol}`)

  const currency: string = meta.currency ?? (symbol.endsWith('.T') ? 'JPY' : 'USD')
  const prevClose = num(meta.chartPreviousClose) ?? num(meta.previousClose) ?? price
  const dec = currency === 'JPY' ? 1 : 2
  const change = parseFloat((price - prevClose).toFixed(dec))
  const changePercent = parseFloat((prevClose ? (change / prevClose) * 100 : 0).toFixed(2))

  return {
    symbol,
    name: meta.longName ?? meta.shortName ?? symbol,
    price,
    change,
    changePercent,
    volume: num(meta.regularMarketVolume) ?? 0,
    currency,
    market: detectMarket(symbol),
    isMarketOpen: meta.currentTradingPeriod?.regular
      ? Date.now() / 1000 >= meta.currentTradingPeriod.regular.start &&
        Date.now() / 1000 < meta.currentTradingPeriod.regular.end
      : false,
    lastUpdated: toIso(meta.regularMarketTime),
  }
}

export async function yf2GetQuote(symbol: string): Promise<StockQuote> {
  const key = `q:${symbol}`
  const hit = readCache<StockQuote>(key, QUOTE_TTL_MS)
  if (hit) return hit

  let quote: StockQuote
  try {
    const client = await yf()
    const q: any = await client.quote(symbol)
    if (!q || num(q.regularMarketPrice) === undefined) {
      throw new Error(`yahoo-finance2: no quote for ${symbol}`)
    }
    const currency: string = q.currency ?? (symbol.endsWith('.T') ? 'JPY' : 'USD')
    const price = num(q.regularMarketPrice) ?? num(q.postMarketPrice) ?? num(q.preMarketPrice) ?? 0
    const prevClose = num(q.regularMarketPreviousClose) ?? price
    const dec = currency === 'JPY' ? 1 : 2
    const change = parseFloat((num(q.regularMarketChange) ?? price - prevClose).toFixed(dec))
    const changePercent = parseFloat(
      (num(q.regularMarketChangePercent) ?? (prevClose ? (change / prevClose) * 100 : 0)).toFixed(2),
    )
    quote = {
      symbol,
      name: q.longName ?? q.shortName ?? q.displayName ?? symbol,
      price,
      change,
      changePercent,
      volume: num(q.regularMarketVolume) ?? 0,
      currency,
      market: detectMarket(symbol),
      isMarketOpen: q.marketState === 'REGULAR',
      lastUpdated: toIso(q.regularMarketTime),
    }
  } catch {
    // v7 quote blocked/failed → derive from the more resilient v8 chart meta.
    quote = await yf2QuoteFromChartMeta(symbol)
  }

  writeCache(key, quote)
  return quote
}

export async function yf2GetHistory(symbol: string, period: string): Promise<HistoricalBar[]> {
  const { days, interval } = RANGE_MAP[period] ?? { days: 95, interval: '1d' }
  const key = `h:${symbol}:${period}`
  const hit = readCache<HistoricalBar[]>(key, HISTORY_TTL_MS)
  if (hit) return hit

  const client = await yf()
  const period1 = new Date(Date.now() - days * 86_400_000)
  const result: any = await client.chart(symbol, { period1, interval })

  const rows: any[] = result?.quotes ?? []
  const bars: HistoricalBar[] = rows
    .map((r) => ({
      time: Math.floor(new Date(r.date).getTime() / 1000),
      open: num(r.open) ?? num(r.close) ?? 0,
      high: num(r.high) ?? num(r.close) ?? 0,
      low: num(r.low) ?? num(r.close) ?? 0,
      close: num(r.close) ?? 0,
      volume: num(r.volume) ?? 0,
    }))
    .filter((b) => Number.isFinite(b.time) && b.close > 0)
    .sort((a, b) => a.time - b.time)

  if (bars.length === 0) throw new Error(`yahoo-finance2: no history for ${symbol}`)
  writeCache(key, bars)
  return bars
}

export async function yf2GetFundamentals(symbol: string): Promise<FundamentalsData> {
  const key = `f:${symbol}`
  const hit = readCache<FundamentalsData>(key, FUNDAMENTALS_TTL_MS)
  if (hit) return hit

  const client = await yf()
  const s: any = await client.quoteSummary(symbol, {
    modules: ['summaryDetail', 'defaultKeyStatistics', 'financialData'],
  })
  const sd = s?.summaryDetail ?? {}
  const ks = s?.defaultKeyStatistics ?? {}
  const fd = s?.financialData ?? {}

  // yahoo-finance2 v3 returns already-unwrapped numbers (no `.raw`). Only keep
  // defined values so callers can tell "real data" from "nothing came back"
  // (index.ts falls through to the next provider on an empty object).
  const raw: FundamentalsData = {
    pe: num(sd.trailingPE),
    pb: num(sd.priceToBook),
    pegRatio: num(ks.pegRatio),
    evToEbitda: num(ks.enterpriseToEbitda),
    roe: num(fd.returnOnEquity),
    roa: num(fd.returnOnAssets),
    operatingMargin: num(fd.operatingMargins),
    grossMargin: num(fd.grossMargins),
    profitMargin: num(fd.profitMargins),
    eps: num(ks.trailingEps),
    freeCashflow: num(fd.freeCashflow),
    debtToEquity: num(fd.debtToEquity),
    currentRatio: num(fd.currentRatio),
    revenueGrowth: num(fd.revenueGrowth),
    earningsGrowth: num(fd.earningsGrowth),
    marketCap: num(sd.marketCap),
    dividendYield: num(sd.dividendYield),
    week52High: num(sd.fiftyTwoWeekHigh),
    week52Low: num(sd.fiftyTwoWeekLow),
  }
  const data: FundamentalsData = Object.fromEntries(
    Object.entries(raw).filter(([, v]) => v !== undefined),
  )
  writeCache(key, data)
  return data
}

export async function yf2Search(query: string): Promise<SearchResult[]> {
  const key = `s:${query.toLowerCase()}`
  const hit = readCache<SearchResult[]>(key, SEARCH_TTL_MS)
  if (hit) return hit

  const client = await yf()
  const r: any = await client.search(query, { quotesCount: 10, newsCount: 0 })
  const quotes: any[] = r?.quotes ?? []
  const seen = new Set<string>()
  const results: SearchResult[] = quotes
    .filter((q) => (q.quoteType === 'EQUITY' || q.quoteType === 'ETF') && typeof q.symbol === 'string')
    .filter((q) => (seen.has(q.symbol) ? false : (seen.add(q.symbol), true)))
    .map((q) => ({
      symbol: q.symbol,
      name: q.longname ?? q.shortname ?? q.symbol,
      type: q.quoteType ?? 'EQUITY',
      market: detectMarket(q.symbol),
    }))
    .slice(0, 8)

  writeCache(key, results)
  return results
}

// Exposed for a targeted cache flush if ever needed (not used in hot paths).
export function _clearYahoo2Cache(): void {
  cache.clear()
}
