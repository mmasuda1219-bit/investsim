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
  /** PBR。summaryDetail からは取れなくなっている疑い（2026-09-11 実測で AAPL/7203.T/4063.T の3銘柄とも undefined） */
  pb?: number
  pegRatio?: number
  evToEbitda?: number
  roe?: number
  roa?: number
  operatingMargin?: number
  grossMargin?: number
  profitMargin?: number
  eps?: number
  /** 銘柄の通貨単位の実額（`.T` は円、米国株はドル）。通貨記号は `StockQuote.currency` から決める */
  freeCashflow?: number
  /**
   * Yahoo 原値の%表記（例: 78.4 ＝ 負債が自己資本の 0.78 倍）。倍率にするなら /100。
   * `lib/backtest/fundamental.ts:76` の hint と同じ規約。スクリーニング側の閾値（investor-presets の `lte 200`）はこの%前提。
   */
  debtToEquity?: number
  currentRatio?: number
  revenueGrowth?: number
  earningsGrowth?: number
  /** 銘柄の通貨単位の実額（`.T` は円、米国株はドル）。通貨記号は `StockQuote.currency` から決める */
  marketCap?: number
  dividendYield?: number
  week52High?: number
  week52Low?: number
}

export type InvestorId = 'buffett' | 'soros' | 'lynch' | 'graham' | 'dalio'

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
