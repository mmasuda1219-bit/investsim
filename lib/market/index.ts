import type { StockQuote, HistoricalBar, FundamentalsData, SearchResult } from '@/types'
import type { StatementsData } from '@/lib/statements/types'
import type { NewsItem } from '@/lib/report/types'

type Period = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y' | '5y'

const PROVIDER = process.env.NEXT_PUBLIC_DATA_PROVIDER ?? 'yahoo'

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

// ── Real-data failover chain ───────────────────────────────────────────────
// 1. yahoo-finance2 (providers/yahoo2) — PRIMARY. Uses a cookie+crumb session,
//    so it succeeds where the raw query1/query2 fetch now gets a blanket 429.
// 2. Yahoo Direct (providers/yahoodirect) — legacy raw fetch, kept as a cheap
//    secondary in case the library breaks; typically fails fast on 429.
// 3. Twelve Data (US stocks) — only when TWELVE_DATA_API_KEY is set.
// 4. Mock — dev-only last resort, and ONLY when allowMock (COMPANY.md 原則9:
//    real-data-required callers pass allowMock:false and get an error instead).
function twelveDataEnabled(): boolean {
  return Boolean(process.env.TWELVE_DATA_API_KEY)
}

export async function getQuote(
  symbol: string,
  opts: { allowMock?: boolean } = {},
): Promise<StockQuote> {
  const { allowMock = true } = opts // default unchanged — existing callers unaffected
  if (PROVIDER !== 'mock') {
    const errors: string[] = []
    // 1. yahoo-finance2 (primary — cookie/crumb session avoids the 429 wall)
    try {
      const { yf2GetQuote } = await import('./providers/yahoo2')
      return await yf2GetQuote(symbol)
    } catch (e) { errors.push(`yahoo2: ${toError(e).message}`) }
    // 2. Yahoo Direct (legacy raw fetch — usually fails fast on 429)
    try {
      const { yfDirectGetQuote } = await import('./providers/yahoodirect')
      return await yfDirectGetQuote(symbol)
    } catch (e) { errors.push(`yahoodirect: ${toError(e).message}`) }
    // 3. Twelve Data (US stocks only, when a key is configured)
    if (twelveDataEnabled()) {
      try {
        const { twelveDataGetQuote } = await import('./providers/twelvedata')
        return await twelveDataGetQuote(symbol)
      } catch (e) { errors.push(`twelvedata: ${toError(e).message}`) }
    }
    // Real-data-required callers (e.g. /report — COMPANY.md 原則9) never get mock.
    if (!allowMock) {
      throw new Error(`Real quote unavailable for ${symbol} — ${errors.join(' / ')}`)
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
    const errors: string[] = []
    // 1. yahoo-finance2 (primary — cookie/crumb session avoids the 429 wall)
    try {
      const { yf2GetHistory } = await import('./providers/yahoo2')
      return await yf2GetHistory(symbol, period)
    } catch (e) { errors.push(`yahoo2: ${toError(e).message}`) }
    // 2. Yahoo Direct (legacy raw fetch — usually fails fast on 429)
    try {
      const { yfDirectGetHistory } = await import('./providers/yahoodirect')
      return await yfDirectGetHistory(symbol, period)
    } catch (e) { errors.push(`yahoodirect: ${toError(e).message}`) }
    // 3. Twelve Data (US stocks only, when a key is configured)
    if (twelveDataEnabled()) {
      try {
        const { twelveDataGetHistory } = await import('./providers/twelvedata')
        return await twelveDataGetHistory(symbol, period)
      } catch (e) { errors.push(`twelvedata: ${toError(e).message}`) }
    }
    // Real-data-required callers (backtests etc. — COMPANY.md 原則9) never get mock.
    if (!allowMock) {
      throw new Error(`Real market data unavailable for ${symbol} — ${errors.join(' / ')}`)
    }
  }
  if (!allowMock) {
    throw new Error(`Real market data unavailable for ${symbol} (mock fallback disabled)`)
  }
  const { mockGetHistory } = await import('./providers/mock')
  return mockGetHistory(symbol, period)
}

export async function getFundamentals(
  symbol: string,
  opts: { allowMock?: boolean } = {},
): Promise<FundamentalsData> {
  const { allowMock = true } = opts // default unchanged — existing callers unaffected
  if (PROVIDER !== 'mock') {
    // 1. yahoo-finance2 (primary). Returns {} inside itself only on schema gaps;
    //    a thrown/empty result here falls through to the legacy provider.
    try {
      const { yf2GetFundamentals } = await import('./providers/yahoo2')
      const f = await yf2GetFundamentals(symbol)
      if (Object.keys(f).length > 0) return f
    } catch { /* fall through */ }
    // 2. Yahoo Direct (legacy). 原則9: on failure it returns {} (never mock).
    try {
      const { yfDirectGetFundamentals } = await import('./providers/yahoodirect')
      return await yfDirectGetFundamentals(symbol)
    } catch { /* fall through */ }
    // Real-data-required callers (e.g. /report fundamental gate — 原則9) get an
    // EMPTY object (= "no data", distinguishable) instead of mock numbers.
    if (!allowMock) return {}
  }
  if (!allowMock) return {}
  const { mockGetFundamentals } = await import('./providers/mock')
  return mockGetFundamentals(symbol)
}

// Multi-period annual financial statements (/report R2 — earnings depth).
// Real data only; returns null when unavailable (statements are OPTIONAL report
// enrichment — never a hard failure, and never mock-synthesised: 原則9).
export async function getStatements(symbol: string): Promise<StatementsData | null> {
  if (PROVIDER === 'mock') return null
  try {
    const { yf2GetStatements } = await import('./providers/yahoo2')
    return await yf2GetStatements(symbol)
  } catch {
    return null
  }
}

// Recent real news for a symbol (/report R3). [] on failure — news is optional
// enrichment (never mock-synthesised). Routed through yahoo2 (search), which
// works on Vercel where the raw lib/ai-trader/news.ts fetch gets 429'd.
export async function getNews(symbol: string, count = 6): Promise<NewsItem[]> {
  if (PROVIDER === 'mock') return []
  try {
    const { yf2GetNews } = await import('./providers/yahoo2')
    return await yf2GetNews(symbol, count)
  } catch {
    return []
  }
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
      const { yf2Search } = await import('./providers/yahoo2')
      merge(await yf2Search(query))
    } catch { /* fall through */ }
    try {
      const { yfDirectSearch } = await import('./providers/yahoodirect')
      merge(await yfDirectSearch(query))
    } catch { /* fall through */ }
  }

  // Mock catalog augments real results (adds JP aliases / offline dev support).
  const { mockSearch } = await import('./providers/mock')
  merge(mockSearch(query))

  return results.slice(0, 10)
}
