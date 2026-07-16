// Twelve Data provider — real-data failover for US stocks when Yahoo Direct
// is blocked (Vercel IPs get persistent HTTP 429 from Yahoo).
// Docs: https://twelvedata.com/docs
//
// Free tier limits: 8 requests/min, 800 requests/day. To conserve quota:
//  - responses are cached via Next data cache (revalidate: 300s)
//  - rate limits (429) get at most 2 short retries, then throw — the caller
//    chain in lib/market/index.ts decides what happens next. No long waits:
//    this path is shared with the AI-session tick under Vercel's time limit.
//  - JP symbols (.T) are rejected immediately (unsupported on free tier) so
//    they don't burn API calls; the caller falls through to its next option.
import type { StockQuote, HistoricalBar } from '@/types'

const BASE = 'https://api.twelvedata.com'

const MAX_ATTEMPTS = 3 // 1 initial try + up to 2 retries on rate limit
const BACKOFF_MS = [400, 800] // wait before retry #1, #2 (total <= 1.2s)

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function apiKey(): string {
  const key = process.env.TWELVE_DATA_API_KEY
  if (!key) throw new Error('twelvedata: TWELVE_DATA_API_KEY is not set')
  return key
}

/** Free tier does not cover Tokyo Stock Exchange — fail fast, no API call. */
function assertNotJpSymbol(symbol: string): void {
  if (symbol.toUpperCase().endsWith('.T')) {
    throw new Error('twelvedata: JP symbols unsupported on free tier')
  }
}

// Same heuristic as yahoodirect's detectMarket (JP never reaches here).
function detectMarket(symbol: string): StockQuote['market'] {
  if (symbol.endsWith('.T')) return 'JP'
  if (/^[A-Z]{1,5}$/.test(symbol)) return 'US'
  return 'OTHER'
}

/**
 * Fetch a Twelve Data endpoint. Twelve Data signals errors two ways:
 *  - normal HTTP errors (incl. 429 rate limit)
 *  - HTTP 200 with body { status: "error", code, message } (incl. code 429)
 * Both throw. Rate limits are retried at most twice with short backoff.
 */
async function tdFetch(path: string): Promise<any> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(
      `${BASE}${path}`,
      // Retries bypass the data cache so a cached error body is not replayed.
      attempt === 1 ? { next: { revalidate: 300 } } : { cache: 'no-store' },
    )

    let json: any = null
    if (res.ok) json = await res.json().catch(() => null)

    const rateLimited = res.status === 429 || Number(json?.code) === 429
    if (rateLimited && attempt < MAX_ATTEMPTS) {
      if (!res.ok) void res.body?.cancel().catch(() => {})
      await sleep(BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)])
      continue
    }

    if (!res.ok) throw new Error(`Twelve Data HTTP ${res.status}`)
    if (!json) throw new Error('Twelve Data: invalid JSON response')
    if (json.status === 'error' || (json.code !== undefined && Number(json.code) !== 200)) {
      throw new Error(`Twelve Data error ${json.code ?? ''}: ${json.message ?? 'unknown error'}`)
    }
    return json
  }
}

export async function twelveDataGetQuote(symbol: string): Promise<StockQuote> {
  assertNotJpSymbol(symbol)
  const data = await tdFetch(`/quote?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey()}`)

  // Numeric fields arrive as strings — convert explicitly.
  const price = Number(data.close)
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Twelve Data: no valid price for ${symbol}`)
  }

  return {
    symbol,
    name:          data.name ?? symbol,
    price,
    change:        Number(data.change) || 0,
    changePercent: Number(data.percent_change) || 0,
    volume:        Number(data.volume) || 0,
    currency:      data.currency ?? 'USD',
    market:        detectMarket(symbol),
    isMarketOpen:  data.is_market_open === true,
    lastUpdated:   new Date().toISOString(),
  }
}

// Daily bars only (free tier failover). Bar count sized to the period.
function periodToOutputSize(period: string): number {
  const map: Record<string, number> = {
    '1d':  5,
    '5d':  7,
    '1mo': 25,
    '3mo': 70,
    '6mo': 135,
    '1y':  300,
    '2y':  520,
    '5y':  1300,
  }
  return map[period] ?? 70
}

export async function twelveDataGetHistory(symbol: string, period: string): Promise<HistoricalBar[]> {
  assertNotJpSymbol(symbol)
  const outputsize = periodToOutputSize(period)
  const data = await tdFetch(
    `/time_series?symbol=${encodeURIComponent(symbol)}&interval=1day&outputsize=${outputsize}&order=ASC&apikey=${apiKey()}`,
  )

  const values: any[] = Array.isArray(data.values) ? data.values : []
  return values
    .map((v: any) => ({
      time:   Math.floor(new Date(v.datetime).getTime() / 1000),
      open:   Number(v.open),
      high:   Number(v.high),
      low:    Number(v.low),
      close:  Number(v.close),
      volume: Number(v.volume) || 0,
    }))
    .filter(b => Number.isFinite(b.time) && b.close > 0)
    // order=ASC is requested, but sort defensively in case it is ignored.
    .sort((a, b) => a.time - b.time)
}
