import type { StockQuote, HistoricalBar, FundamentalsData, SearchResult } from '@/types'

type Period = '1d' | '5d' | '1mo' | '3mo' | '6mo' | '1y' | '2y'

const PROVIDER = process.env.NEXT_PUBLIC_DATA_PROVIDER ?? 'yahoo'

export async function getQuote(symbol: string): Promise<StockQuote> {
  if (PROVIDER !== 'mock') {
    try {
      const { yfDirectGetQuote } = await import('./providers/yahoodirect')
      return await yfDirectGetQuote(symbol)
    } catch { /* fall through */ }
  }
  const { mockGetQuote } = await import('./providers/mock')
  return mockGetQuote(symbol)
}

export async function getHistory(symbol: string, period: Period = '3mo'): Promise<HistoricalBar[]> {
  if (PROVIDER !== 'mock') {
    try {
      const { yfDirectGetHistory } = await import('./providers/yahoodirect')
      return await yfDirectGetHistory(symbol, period)
    } catch { /* fall through */ }
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
