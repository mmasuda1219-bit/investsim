export interface StockQuote {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
  volume: number
  currency: string
  market: 'US' | 'JP' | 'OTHER'
  isMarketOpen: boolean
  lastUpdated: string
}

export interface HistoricalBar {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface FundamentalsData {
  pe?: number
  pb?: number
  pegRatio?: number
  evToEbitda?: number
  roe?: number
  roa?: number
  operatingMargin?: number
  grossMargin?: number
  profitMargin?: number
  eps?: number
  freeCashflow?: number
  debtToEquity?: number
  currentRatio?: number
  revenueGrowth?: number
  earningsGrowth?: number
  marketCap?: number
  dividendYield?: number
  week52High?: number
  week52Low?: number
}

export interface SearchResult {
  symbol: string
  name: string
  type: string
  market: 'US' | 'JP' | 'OTHER'
}

export interface Signal {
  action: 'buy' | 'sell' | 'hold'
  strength: 1 | 2 | 3
  reasons: string[]
  targetPrice?: number
  stopLoss?: number
}

export interface AnalysisInput {
  quote: StockQuote
  fundamentals?: FundamentalsData
  history: HistoricalBar[]
}

export interface InvestorLogic {
  id: string
  name: string
  nameJa: string
  description: string
  philosophy: string
  avatarColor: string
  analyze(input: AnalysisInput): Signal
}
