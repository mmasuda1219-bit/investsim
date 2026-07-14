import type { StockQuote, HistoricalBar, FundamentalsData, SearchResult } from '@/types'

type Period = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y'

const PROVIDER = process.env.NEXT_PUBLIC_DATA_PROVIDER ?? 'yahoo'

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

// ── Real-data failover: Yahoo Direct → Twelve Data (US stocks) ─────────────
// Yahoo persistently blocks Vercel's egress IPs with HTTP 429, so allowMock:false
// paths (e.g. /report) need a second real-data provider (COMPANY.md 原則9).
// The Twelve Data stage is skipped entirely when TWELVE_DATA_API_KEY is unset
// (keyless environments keep the legacy Yahoo→Mock behaviour), and its module
// is only loaded on demand. JP (.T) symbols throw inside the provider without
// consuming API quota (free tier is US-only; JP failover is a separate slice).
function twelveDataEnabled(): boolean {
  return Boolean(process.env.TWELVE_DATA_API_KEY)
}

export async function getQuote(
  symbol: string,
  opts: { allowMock?: boolean } = {},
): Promise<StockQuote> {
  const { allowMock = true } = opts // default unchanged — existing callers unaffected
  if (PROVIDER !== 'mock') {
    try {
      const { yfDirectGetQuote } = await import('./providers/yahoodirect')
      return await yfDirectGetQuote(symbol)
    } catch (yahooErr) {
      if (twelveDataEnabled()) {
        try {
          const { twelveDataGetQuote } = await import('./providers/twelvedata')
          return await twelveDataGetQuote(symbol)
        } catch (tdErr) {
          // Real-data-required callers (e.g. /report — COMPANY.md 原則9) pass
          // allowMock:false so a fake "current price" never reaches the user.
          if (!allowMock) {
            throw new Error(
              `Real quote unavailable for ${symbol} — yahoo: ${toError(yahooErr).message} / twelvedata: ${toError(tdErr).message}`,
            )
          }
          /* else fall through to mock */
        }
      } else {
        if (!allowMock) throw toError(yahooErr)
        /* else fall through to mock */
      }
    }
  }
  if (!allowMock) {
    throw new Error(`Real quote unavailable for ${symbol} (mock fallback disabled)`)
  }
  const { mockGetQuote } = await import('./providers/mock')
  return mockGetQuote(symbol)
}

export async function getHistory(
  symbol: string,
  period: Period = '3mo',
  opts: { allowMock?: boolean } = {},
): Promise<HistoricalBar[]> {
  const { allowMock = true } = opts
  if (PROVIDER !== 'mock') {
    try {
      const { yfDirectGetHistory } = await import('./providers/yahoodirect')
      return await yfDirectGetHistory(symbol, period)
    } catch (yahooErr) {
      if (twelveDataEnabled()) {
        try {
          const { twelveDataGetHistory } = await import('./providers/twelvedata')
          return await twelveDataGetHistory(symbol, period)
        } catch (tdErr) {
          // Callers that require real data (e.g. backtests, COMPANY.md 原則9) pass
          // allowMock:false so we surface the error instead of silently returning mock data.
          if (!allowMock) {
            throw new Error(
              `Real market data unavailable for ${symbol} — yahoo: ${toError(yahooErr).message} / twelvedata: ${toError(tdErr).message}`,
            )
          }
          /* else fall through to mock */
        }
      } else {
        if (!allowMock) throw toError(yahooErr)
        /* else fall through to mock */
      }
    }
  }
  if (!allowMock) {
    throw new Error(`Real market data unavailable for ${symbol} (mock fallback disabled)`)
  }
  const { mockGetHistory } = await import('./providers/mock')
  return mockGetHistory(symbol, period)
}

export async function getFundamentals(symbol: string): Promise<FundamentalsData> {
  if (PROVIDER !== 'mock') {
    try {
      const { yfDirectGetFundamentals } = await import('./providers/yahoodirect')
      return await yfDirectGetFundamentals(symbol)
    } catch { /* fall through */ }
  }
  const { mockGetFundamentals } = await import('./providers/mock')
  return mockGetFundamentals(symbol)
}

export async function searchStocks(query: string): Promise<SearchResult[]> {
  const results: SearchResult[] = []
  const seen = new Set<string>()

  const merge = (items: SearchResult[]) => {
    for (const s of items) {
      if (!seen.has(s.symbol)) { seen.add(s.symbol); results.push(s) }
    }
  }

  if (PROVIDER !== 'mock') {
    try {
      const { yfDirectSearch } = await import('./providers/yahoodirect')
      merge(await yfDirectSearch(query))
    } catch { /* fall through */ }
  }

  const { mockSearch } = await import('./providers/mock')
  merge(mockSearch(query))

  return results.slice(0, 10)
}
