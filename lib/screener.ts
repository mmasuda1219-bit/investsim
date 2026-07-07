// Screener: filters stocks from the mock catalog by fundamentals + investor signals
import type { FundamentalsData, StockQuote } from '@/types'

export interface ScreenerFilters {
  maxPer?: number
  maxPbr?: number
  minRoe?: number
  maxDebtToEquity?: number
  minMarketCap?: number
  minRevenueGrowth?: number
  investorBuy?: string[]  // investor ids that must have 'buy' signal
}

export interface ScreenerStock {
  symbol: string
  name: string
  price: number
  marketCap?: number
  sector?: string
  fundamentals: FundamentalsData
  signals: Record<string, 'buy' | 'sell' | 'hold'>
}

export async function runScreener(filters: ScreenerFilters): Promise<ScreenerStock[]> {
  // Dynamically import SEEDS from mock provider
  const { mockGetQuote, mockGetFundamentals } = await import('@/lib/market/providers/mock')

  // We need access to SEEDS — use a helper that exposes US symbols
  const { getUSSymbols } = await import('@/lib/market/providers/mock')

  const symbols = getUSSymbols()

  // Load investors if investorBuy filter is specified
  let investorMap: Record<string, import('@/types').InvestorLogic> = {}
  if (filters.investorBuy && filters.investorBuy.length > 0) {
    const investorsModule = await import('@/lib/investors')
    const investors = investorsModule.default
    for (const inv of investors) {
      investorMap[inv.id] = inv
    }
  }

  const results: ScreenerStock[] = []

  for (const symbol of symbols) {
    const fundamentals = mockGetFundamentals(symbol)

    // Apply fundamental filters
    if (filters.maxPer !== undefined) {
      if (fundamentals.pe === undefined || fundamentals.pe <= 0 || fundamentals.pe > filters.maxPer) continue
    }
    if (filters.maxPbr !== undefined) {
      if (fundamentals.pb === undefined || fundamentals.pb <= 0 || fundamentals.pb > filters.maxPbr) continue
    }
    if (filters.minRoe !== undefined) {
      if (fundamentals.roe === undefined || fundamentals.roe < filters.minRoe) continue
    }
    if (filters.maxDebtToEquity !== undefined) {
      if (fundamentals.debtToEquity === undefined || fundamentals.debtToEquity > filters.maxDebtToEquity) continue
    }
    if (filters.minMarketCap !== undefined) {
      if (fundamentals.marketCap === undefined || fundamentals.marketCap < filters.minMarketCap) continue
    }
    if (filters.minRevenueGrowth !== undefined) {
      if (fundamentals.revenueGrowth === undefined || fundamentals.revenueGrowth < filters.minRevenueGrowth) continue
    }

    // Compute investor signals if needed
    const signals: Record<string, 'buy' | 'sell' | 'hold'> = {}

    if (filters.investorBuy && filters.investorBuy.length > 0) {
      let quote: StockQuote
      try {
        quote = mockGetQuote(symbol)
      } catch {
        continue
      }

      const analysisInput = { quote, fundamentals, history: [] }

      let allBuy = true
      for (const investorId of filters.investorBuy) {
        const investor = investorMap[investorId]
        if (!investor) {
          allBuy = false
          break
        }
        const signal = investor.analyze(analysisInput)
        signals[investorId] = signal.action
        if (signal.action !== 'buy') {
          allBuy = false
        }
      }

      if (!allBuy) continue
    }

    let quote: StockQuote
    try {
      quote = mockGetQuote(symbol)
    } catch {
      continue
    }

    results.push({
      symbol,
      name: quote.name,
      price: quote.price,
      marketCap: fundamentals.marketCap,
      fundamentals,
      signals,
    })
  }

  // Sort by marketCap descending (undefined last)
  results.sort((a, b) => {
    if (a.marketCap === undefined && b.marketCap === undefined) return 0
    if (a.marketCap === undefined) return 1
    if (b.marketCap === undefined) return -1
    return b.marketCap - a.marketCap
  })

  return results
}
