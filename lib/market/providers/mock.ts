// Mock data provider — realistic prices + generated candlesticks
// Switch to yahoo provider once API key / rate limit resolves
import type { StockQuote, HistoricalBar, FundamentalsData, SearchResult } from '@/types'

interface StockSeed {
  name: string
  market: 'US' | 'JP'
  currency: string
  price: number
  sigma: number          // daily volatility (e.g. 0.018 = 1.8%)
  fundamentals: FundamentalsData
}

const SEEDS: Record<string, StockSeed> = {
  AAPL:   { name: 'Apple Inc.',          market: 'US', currency: 'USD', price: 211.5,  sigma: 0.015, fundamentals: { pe: 33.2, pb: 49.8, roe: 1.60, eps: 6.42, debtToEquity: 1.77, revenueGrowth: 0.04, earningsGrowth: 0.11, pegRatio: 3.0 } },
  NVDA:   { name: 'NVIDIA Corporation',  market: 'US', currency: 'USD', price: 892.3,  sigma: 0.025, fundamentals: { pe: 72.1, pb: 38.5, roe: 0.55, eps: 12.38, debtToEquity: 0.43, revenueGrowth: 1.22, earningsGrowth: 1.68, pegRatio: 0.43 } },
  MSFT:   { name: 'Microsoft Corp.',     market: 'US', currency: 'USD', price: 420.6,  sigma: 0.013, fundamentals: { pe: 36.8, pb: 12.9, roe: 0.35, eps: 11.43, debtToEquity: 0.71, revenueGrowth: 0.17, earningsGrowth: 0.22, pegRatio: 1.67 } },
  GOOGL:  { name: 'Alphabet Inc.',       market: 'US', currency: 'USD', price: 174.2,  sigma: 0.016, fundamentals: { pe: 22.1, pb: 6.8,  roe: 0.31, eps: 7.88,  debtToEquity: 0.09, revenueGrowth: 0.15, earningsGrowth: 0.29, pegRatio: 0.76 } },
  AMZN:   { name: 'Amazon.com Inc.',     market: 'US', currency: 'USD', price: 188.4,  sigma: 0.018, fundamentals: { pe: 43.5, pb: 7.9,  roe: 0.18, eps: 4.33,  debtToEquity: 0.52, revenueGrowth: 0.10, earningsGrowth: 2.25, pegRatio: 1.93 } },
  TSLA:   { name: 'Tesla Inc.',          market: 'US', currency: 'USD', price: 175.8,  sigma: 0.035, fundamentals: { pe: 55.3, pb: 9.2,  roe: 0.17, eps: 3.18,  debtToEquity: 0.18, revenueGrowth: 0.19, earningsGrowth: -0.18, pegRatio: undefined } },
  META:   { name: 'Meta Platforms',      market: 'US', currency: 'USD', price: 533.1,  sigma: 0.020, fundamentals: { pe: 26.0, pb: 8.4,  roe: 0.32, eps: 20.50, debtToEquity: 0.30, revenueGrowth: 0.27, earningsGrowth: 0.73, pegRatio: 0.36 } },
  BRK:    { name: 'Berkshire Hathaway',  market: 'US', currency: 'USD', price: 445200, sigma: 0.008, fundamentals: { pe: 21.5, pb: 1.49, roe: 0.07, eps: 20720, debtToEquity: 0.25, revenueGrowth: 0.03, earningsGrowth: 0.15, pegRatio: 1.43 } },
  // Finance
  JPM:  { name: 'JPMorgan Chase & Co.',    market: 'US', currency: 'USD', price: 198.5,  sigma: 0.016, fundamentals: { pe: 11.8, pb: 1.85, roe: 0.16, eps: 16.23, debtToEquity: 1.28, revenueGrowth: 0.12, earningsGrowth: 0.26, pegRatio: 0.45, marketCap: 571e9 } },
  BAC:  { name: 'Bank of America Corp.',   market: 'US', currency: 'USD', price: 38.2,   sigma: 0.018, fundamentals: { pe: 12.5, pb: 1.05, roe: 0.09, eps: 3.06,  debtToEquity: 1.53, revenueGrowth: 0.08, earningsGrowth: 0.15, pegRatio: 0.83, marketCap: 303e9 } },
  V:    { name: 'Visa Inc.',               market: 'US', currency: 'USD', price: 278.3,  sigma: 0.013, fundamentals: { pe: 31.2, pb: 14.1, roe: 0.45, eps: 8.92,  debtToEquity: 0.52, revenueGrowth: 0.10, earningsGrowth: 0.17, pegRatio: 1.84, marketCap: 570e9 } },
  MA:   { name: 'Mastercard Inc.',         market: 'US', currency: 'USD', price: 472.1,  sigma: 0.013, fundamentals: { pe: 37.8, pb: 60.2, roe: 1.68, eps: 12.49, debtToEquity: 1.78, revenueGrowth: 0.12, earningsGrowth: 0.20, pegRatio: 1.89, marketCap: 443e9 } },
  GS:   { name: 'Goldman Sachs Group',     market: 'US', currency: 'USD', price: 512.3,  sigma: 0.020, fundamentals: { pe: 14.2, pb: 1.52, roe: 0.11, eps: 36.10, debtToEquity: 2.81, revenueGrowth: 0.16, earningsGrowth: 0.68, pegRatio: 0.21, marketCap: 176e9 } },
  // Healthcare
  JNJ:  { name: 'Johnson & Johnson',       market: 'US', currency: 'USD', price: 158.4,  sigma: 0.010, fundamentals: { pe: 24.3, pb: 5.18, roe: 0.21, eps: 5.79,  debtToEquity: 0.48, revenueGrowth: 0.04, earningsGrowth: 0.07, pegRatio: 3.47, marketCap: 381e9 } },
  UNH:  { name: 'UnitedHealth Group',      market: 'US', currency: 'USD', price: 512.7,  sigma: 0.014, fundamentals: { pe: 20.1, pb: 5.82, roe: 0.29, eps: 25.48, debtToEquity: 0.73, revenueGrowth: 0.08, earningsGrowth: 0.11, pegRatio: 1.83, marketCap: 473e9 } },
  ABBV: { name: 'AbbVie Inc.',             market: 'US', currency: 'USD', price: 168.2,  sigma: 0.013, fundamentals: { pe: 55.8, pb: 25.3, roe: 0.47, eps: 3.01,  debtToEquity: 3.52, revenueGrowth: 0.04, earningsGrowth: -0.18, pegRatio: undefined, marketCap: 297e9 } },
  PFE:  { name: 'Pfizer Inc.',             market: 'US', currency: 'USD', price: 26.8,   sigma: 0.015, fundamentals: { pe: 14.2, pb: 1.35, roe: 0.09, eps: 1.88,  debtToEquity: 0.63, revenueGrowth: -0.42, earningsGrowth: -0.91, pegRatio: undefined, marketCap: 151e9 } },
  MRK:  { name: 'Merck & Co.',             market: 'US', currency: 'USD', price: 89.4,   sigma: 0.013, fundamentals: { pe: 14.8, pb: 5.12, roe: 0.35, eps: 6.02,  debtToEquity: 0.67, revenueGrowth: 0.07, earningsGrowth: 0.52, pegRatio: 0.29, marketCap: 226e9 } },
  // Consumer Staples / Discretionary
  KO:   { name: 'Coca-Cola Company',       market: 'US', currency: 'USD', price: 63.2,   sigma: 0.008, fundamentals: { pe: 22.1, pb: 9.78, roe: 0.44, eps: 2.86,  debtToEquity: 1.71, revenueGrowth: 0.03, earningsGrowth: 0.05, pegRatio: 4.42, marketCap: 273e9 } },
  PG:   { name: 'Procter & Gamble Co.',    market: 'US', currency: 'USD', price: 168.5,  sigma: 0.009, fundamentals: { pe: 26.8, pb: 7.42, roe: 0.28, eps: 6.28,  debtToEquity: 0.59, revenueGrowth: 0.03, earningsGrowth: 0.12, pegRatio: 2.23, marketCap: 397e9 } },
  WMT:  { name: 'Walmart Inc.',            market: 'US', currency: 'USD', price: 91.3,   sigma: 0.011, fundamentals: { pe: 37.2, pb: 7.38, roe: 0.20, eps: 2.45,  debtToEquity: 0.67, revenueGrowth: 0.05, earningsGrowth: 0.13, pegRatio: 2.86, marketCap: 733e9 } },
  HD:   { name: 'Home Depot Inc.',         market: 'US', currency: 'USD', price: 340.8,  sigma: 0.014, fundamentals: { pe: 23.8, pb: undefined, roe: undefined, eps: 14.31, debtToEquity: undefined, revenueGrowth: -0.03, earningsGrowth: -0.02, pegRatio: undefined, marketCap: 338e9 } },
  MCD:  { name: "McDonald's Corp.",        market: 'US', currency: 'USD', price: 285.4,  sigma: 0.010, fundamentals: { pe: 23.5, pb: undefined, roe: undefined, eps: 12.14, debtToEquity: undefined, revenueGrowth: 0.02, earningsGrowth: 0.07, pegRatio: 3.36, marketCap: 204e9 } },
  NKE:  { name: 'Nike Inc.',               market: 'US', currency: 'USD', price: 73.2,   sigma: 0.018, fundamentals: { pe: 22.1, pb: 7.82, roe: 0.35, eps: 3.31,  debtToEquity: 0.82, revenueGrowth: -0.10, earningsGrowth: -0.24, pegRatio: undefined, marketCap: 112e9 } },
  // Energy
  XOM:  { name: 'Exxon Mobil Corp.',       market: 'US', currency: 'USD', price: 114.3,  sigma: 0.018, fundamentals: { pe: 13.8, pb: 2.01, roe: 0.15, eps: 8.28,  debtToEquity: 0.19, revenueGrowth: -0.05, earningsGrowth: -0.04, pegRatio: undefined, marketCap: 500e9 } },
  CVX:  { name: 'Chevron Corp.',           market: 'US', currency: 'USD', price: 154.2,  sigma: 0.017, fundamentals: { pe: 14.1, pb: 1.78, roe: 0.13, eps: 10.93, debtToEquity: 0.17, revenueGrowth: -0.09, earningsGrowth: -0.15, pegRatio: undefined, marketCap: 280e9 } },
  // Industrial
  CAT:  { name: 'Caterpillar Inc.',        market: 'US', currency: 'USD', price: 348.2,  sigma: 0.016, fundamentals: { pe: 16.2, pb: 9.81, roe: 0.62, eps: 21.52, debtToEquity: 1.63, revenueGrowth: -0.04, earningsGrowth: 0.05, pegRatio: 3.24, marketCap: 172e9 } },
  RTX:  { name: 'RTX Corp.',               market: 'US', currency: 'USD', price: 118.4,  sigma: 0.013, fundamentals: { pe: 34.8, pb: 2.38, roe: 0.07, eps: 3.40,  debtToEquity: 0.78, revenueGrowth: 0.10, earningsGrowth: 0.20, pegRatio: 1.74, marketCap: 158e9 } },
  // Tech additional
  AMD:  { name: 'Advanced Micro Devices',  market: 'US', currency: 'USD', price: 151.2,  sigma: 0.030, fundamentals: { pe: 98.5, pb: 3.71, roe: 0.04, eps: 1.54,  debtToEquity: 0.05, revenueGrowth: 0.24, earningsGrowth: 2.52, pegRatio: 0.39, marketCap: 245e9 } },
  INTC: { name: 'Intel Corp.',             market: 'US', currency: 'USD', price: 20.8,   sigma: 0.025, fundamentals: { pe: undefined, pb: 0.84, roe: -0.12, eps: -4.38, debtToEquity: 0.49, revenueGrowth: -0.02, earningsGrowth: undefined, pegRatio: undefined, marketCap: 89e9 } },
  ORCL: { name: 'Oracle Corp.',            market: 'US', currency: 'USD', price: 128.4,  sigma: 0.018, fundamentals: { pe: 22.5, pb: undefined, roe: undefined, eps: 5.70,  debtToEquity: undefined, revenueGrowth: 0.07, earningsGrowth: 0.20, pegRatio: 1.12, marketCap: 352e9 } },
  CRM:  { name: 'Salesforce Inc.',         market: 'US', currency: 'USD', price: 278.3,  sigma: 0.022, fundamentals: { pe: 43.2, pb: 4.38, roe: 0.10, eps: 6.44,  debtToEquity: 0.20, revenueGrowth: 0.09, earningsGrowth: 0.67, pegRatio: 0.65, marketCap: 268e9 } },
  NFLX: { name: 'Netflix Inc.',            market: 'US', currency: 'USD', price: 635.8,  sigma: 0.025, fundamentals: { pe: 43.8, pb: 13.8, roe: 0.32, eps: 14.52, debtToEquity: 0.72, revenueGrowth: 0.16, earningsGrowth: 0.72, pegRatio: 0.61, marketCap: 274e9 } },
  ADBE: { name: 'Adobe Inc.',              market: 'US', currency: 'USD', price: 382.1,  sigma: 0.020, fundamentals: { pe: 23.5, pb: 11.2, roe: 0.48, eps: 16.22, debtToEquity: 0.45, revenueGrowth: 0.11, earningsGrowth: 0.15, pegRatio: 1.57, marketCap: 167e9 } },
  // Telecom / Utilities
  T:    { name: 'AT&T Inc.',               market: 'US', currency: 'USD', price: 22.3,   sigma: 0.012, fundamentals: { pe: 9.8,  pb: 1.23, roe: 0.12, eps: 2.27,  debtToEquity: 1.09, revenueGrowth: 0.01, earningsGrowth: -0.04, pegRatio: undefined, marketCap: 159e9 } },
  VZ:   { name: 'Verizon Communications',  market: 'US', currency: 'USD', price: 40.8,   sigma: 0.011, fundamentals: { pe: 9.2,  pb: 1.65, roe: 0.18, eps: 4.43,  debtToEquity: 1.57, revenueGrowth: 0.01, earningsGrowth: 0.02, pegRatio: 4.60, marketCap: 172e9 } },
  NEE:  { name: 'NextEra Energy Inc.',     market: 'US', currency: 'USD', price: 72.4,   sigma: 0.013, fundamentals: { pe: 21.5, pb: 3.12, roe: 0.15, eps: 3.37,  debtToEquity: 1.12, revenueGrowth: 0.08, earningsGrowth: 0.09, pegRatio: 2.39, marketCap: 148e9 } },
  // Value stocks Buffett/Graham would like
  KHC:  { name: 'Kraft Heinz Co.',         market: 'US', currency: 'USD', price: 29.8,   sigma: 0.015, fundamentals: { pe: 10.2, pb: 0.78, roe: 0.07, eps: 2.91,  debtToEquity: 0.55, revenueGrowth: 0.01, earningsGrowth: -0.10, pegRatio: undefined, marketCap: 36e9 } },
  WFC:  { name: 'Wells Fargo & Co.',       market: 'US', currency: 'USD', price: 65.3,   sigma: 0.017, fundamentals: { pe: 13.2, pb: 1.28, roe: 0.10, eps: 4.95,  debtToEquity: 1.12, revenueGrowth: 0.01, earningsGrowth: 0.13, pegRatio: 1.01, marketCap: 219e9 } },
  OXY:  { name: 'Occidental Petroleum',   market: 'US', currency: 'USD', price: 47.2,   sigma: 0.025, fundamentals: { pe: 12.8, pb: 1.42, roe: 0.11, eps: 3.68,  debtToEquity: 0.72, revenueGrowth: -0.14, earningsGrowth: -0.34, pegRatio: undefined, marketCap: 44e9 } },
  // Healthcare additional
  LLY:  { name: 'Eli Lilly & Co.',        market: 'US', currency: 'USD', price: 825.4,  sigma: 0.022, fundamentals: { pe: 72.8, pb: 55.2, roe: 0.76, eps: 11.34, debtToEquity: 1.91, revenueGrowth: 0.32, earningsGrowth: 1.02, pegRatio: 0.71, marketCap: 780e9 } },
  AMGN: { name: 'Amgen Inc.',             market: 'US', currency: 'USD', price: 312.5,  sigma: 0.015, fundamentals: { pe: 18.2, pb: undefined, roe: undefined, eps: 17.18, debtToEquity: undefined, revenueGrowth: 0.19, earningsGrowth: 0.08, pegRatio: undefined, marketCap: 168e9 } },
  GILD: { name: 'Gilead Sciences Inc.',   market: 'US', currency: 'USD', price: 84.2,   sigma: 0.014, fundamentals: { pe: 22.8, pb: 5.62, roe: 0.25, eps: 3.70,  debtToEquity: 1.25, revenueGrowth: 0.06, earningsGrowth: 0.28, pegRatio: undefined, marketCap: 106e9 } },
  CVS:  { name: 'CVS Health Corp.',       market: 'US', currency: 'USD', price: 52.1,   sigma: 0.016, fundamentals: { pe: 8.4,  pb: 0.82, roe: 0.10, eps: 6.19,  debtToEquity: 0.89, revenueGrowth: 0.04, earningsGrowth: -0.22, pegRatio: undefined, marketCap: 68e9 } },
  BMY:  { name: 'Bristol-Myers Squibb',   market: 'US', currency: 'USD', price: 46.8,   sigma: 0.015, fundamentals: { pe: 16.2, pb: 3.42, roe: 0.21, eps: 2.89,  debtToEquity: 1.52, revenueGrowth: 0.05, earningsGrowth: -0.08, pegRatio: undefined, marketCap: 96e9 } },
  // Consumer additional
  COST: { name: 'Costco Wholesale Corp.', market: 'US', currency: 'USD', price: 912.3,  sigma: 0.014, fundamentals: { pe: 52.8, pb: 18.2, roe: 0.34, eps: 17.27, debtToEquity: 0.38, revenueGrowth: 0.08, earningsGrowth: 0.17, pegRatio: 3.11, marketCap: 403e9 } },
  SBUX: { name: 'Starbucks Corp.',        market: 'US', currency: 'USD', price: 82.4,   sigma: 0.018, fundamentals: { pe: 28.4, pb: undefined, roe: undefined, eps: 2.90,  debtToEquity: undefined, revenueGrowth: 0.01, earningsGrowth: -0.07, pegRatio: undefined, marketCap: 93e9 } },
  UBER: { name: 'Uber Technologies Inc.', market: 'US', currency: 'USD', price: 68.2,   sigma: 0.025, fundamentals: { pe: 18.2, pb: 8.12, roe: 0.45, eps: 3.75,  debtToEquity: 0.92, revenueGrowth: 0.20, earningsGrowth: undefined, pegRatio: undefined, marketCap: 145e9 } },
  TGT:  { name: 'Target Corp.',           market: 'US', currency: 'USD', price: 98.4,   sigma: 0.018, fundamentals: { pe: 14.2, pb: 4.82, roe: 0.34, eps: 6.93,  debtToEquity: 1.02, revenueGrowth: -0.03, earningsGrowth: -0.11, pegRatio: undefined, marketCap: 45e9 } },
  // Finance additional
  AXP:  { name: 'American Express Co.',   market: 'US', currency: 'USD', price: 278.4,  sigma: 0.016, fundamentals: { pe: 21.2, pb: 7.82, roe: 0.37, eps: 13.14, debtToEquity: 1.81, revenueGrowth: 0.10, earningsGrowth: 0.23, pegRatio: 0.92, marketCap: 200e9 } },
  BLK:  { name: 'BlackRock Inc.',         market: 'US', currency: 'USD', price: 1002.5, sigma: 0.015, fundamentals: { pe: 22.8, pb: 3.12, roe: 0.14, eps: 43.97, debtToEquity: 0.58, revenueGrowth: 0.14, earningsGrowth: 0.12, pegRatio: 1.90, marketCap: 156e9 } },
  C:    { name: 'Citigroup Inc.',         market: 'US', currency: 'USD', price: 68.4,   sigma: 0.020, fundamentals: { pe: 12.8, pb: 0.62, roe: 0.05, eps: 5.34,  debtToEquity: 1.42, revenueGrowth: 0.05, earningsGrowth: 0.28, pegRatio: undefined, marketCap: 131e9 } },
  MS:   { name: 'Morgan Stanley',         market: 'US', currency: 'USD', price: 104.2,  sigma: 0.018, fundamentals: { pe: 17.8, pb: 1.82, roe: 0.10, eps: 5.86,  debtToEquity: 2.42, revenueGrowth: 0.10, earningsGrowth: 0.19, pegRatio: 0.94, marketCap: 174e9 } },
  SCHW: { name: 'Charles Schwab Corp.',   market: 'US', currency: 'USD', price: 78.2,   sigma: 0.018, fundamentals: { pe: 24.8, pb: 3.22, roe: 0.13, eps: 3.15,  debtToEquity: 0.62, revenueGrowth: -0.12, earningsGrowth: -0.18, pegRatio: undefined, marketCap: 139e9 } },
  PYPL: { name: 'PayPal Holdings Inc.',   market: 'US', currency: 'USD', price: 72.4,   sigma: 0.025, fundamentals: { pe: 18.2, pb: 3.82, roe: 0.21, eps: 3.97,  debtToEquity: 0.52, revenueGrowth: 0.07, earningsGrowth: 0.03, pegRatio: 6.07, marketCap: 75e9 } },
  SPGI: { name: 'S&P Global Inc.',        market: 'US', currency: 'USD', price: 502.3,  sigma: 0.013, fundamentals: { pe: 44.2, pb: 16.8, roe: 0.38, eps: 11.37, debtToEquity: 1.42, revenueGrowth: 0.14, earningsGrowth: 0.18, pegRatio: 2.46, marketCap: 166e9 } },
  // Industrial additional
  BA:   { name: 'Boeing Co.',             market: 'US', currency: 'USD', price: 172.8,  sigma: 0.028, fundamentals: { pe: undefined, pb: undefined, roe: undefined, eps: -5.12, debtToEquity: undefined, revenueGrowth: 0.17, earningsGrowth: undefined, pegRatio: undefined, marketCap: 131e9 } },
  GE:   { name: 'GE Aerospace',           market: 'US', currency: 'USD', price: 172.4,  sigma: 0.020, fundamentals: { pe: 28.4, pb: 8.42, roe: 0.30, eps: 6.07,  debtToEquity: 0.52, revenueGrowth: 0.15, earningsGrowth: 0.55, pegRatio: 0.52, marketCap: 187e9 } },
  LMT:  { name: 'Lockheed Martin Corp.',  market: 'US', currency: 'USD', price: 456.2,  sigma: 0.013, fundamentals: { pe: 18.4, pb: undefined, roe: undefined, eps: 24.79, debtToEquity: undefined, revenueGrowth: 0.05, earningsGrowth: 0.09, pegRatio: undefined, marketCap: 109e9 } },
  HON:  { name: 'Honeywell Intl Inc.',    market: 'US', currency: 'USD', price: 222.4,  sigma: 0.013, fundamentals: { pe: 24.8, pb: 8.52, roe: 0.34, eps: 8.97,  debtToEquity: 1.62, revenueGrowth: 0.04, earningsGrowth: 0.06, pegRatio: 4.13, marketCap: 144e9 } },
  UPS:  { name: 'United Parcel Service',  market: 'US', currency: 'USD', price: 112.4,  sigma: 0.016, fundamentals: { pe: 18.2, pb: undefined, roe: undefined, eps: 6.18,  debtToEquity: undefined, revenueGrowth: -0.09, earningsGrowth: -0.43, pegRatio: undefined, marketCap: 96e9 } },
  FDX:  { name: 'FedEx Corp.',            market: 'US', currency: 'USD', price: 248.2,  sigma: 0.018, fundamentals: { pe: 15.8, pb: 2.82, roe: 0.18, eps: 15.73, debtToEquity: 0.82, revenueGrowth: -0.03, earningsGrowth: 0.17, pegRatio: undefined, marketCap: 63e9 } },
  MMM:  { name: '3M Company',             market: 'US', currency: 'USD', price: 118.4,  sigma: 0.015, fundamentals: { pe: 14.2, pb: 4.62, roe: 0.33, eps: 8.34,  debtToEquity: 0.82, revenueGrowth: -0.05, earningsGrowth: 0.22, pegRatio: undefined, marketCap: 65e9 } },
  DE:   { name: 'Deere & Company',        market: 'US', currency: 'USD', price: 398.2,  sigma: 0.017, fundamentals: { pe: 14.8, pb: 5.42, roe: 0.37, eps: 26.92, debtToEquity: 2.32, revenueGrowth: -0.16, earningsGrowth: -0.29, pegRatio: undefined, marketCap: 119e9 } },
  // Real Estate (REIT)
  AMT:  { name: 'American Tower Corp.',   market: 'US', currency: 'USD', price: 218.4,  sigma: 0.015, fundamentals: { pe: 48.2, pb: undefined, roe: 0.12, eps: 4.53,  debtToEquity: undefined, revenueGrowth: 0.05, earningsGrowth: -0.30, pegRatio: undefined, marketCap: 102e9 } },
  PLD:  { name: 'Prologis Inc.',          market: 'US', currency: 'USD', price: 128.4,  sigma: 0.015, fundamentals: { pe: 38.2, pb: 2.22, roe: 0.06, eps: 3.36,  debtToEquity: 0.72, revenueGrowth: 0.08, earningsGrowth: -0.15, pegRatio: undefined, marketCap: 122e9 } },
  // Tech additional (growth)
  COIN: { name: 'Coinbase Global Inc.',   market: 'US', currency: 'USD', price: 228.4,  sigma: 0.055, fundamentals: { pe: 28.2, pb: 8.42, roe: 0.30, eps: 8.10,  debtToEquity: 0.52, revenueGrowth: 1.12, earningsGrowth: undefined, pegRatio: undefined, marketCap: 58e9 } },
  PLTR: { name: 'Palantir Technologies',  market: 'US', currency: 'USD', price: 32.4,   sigma: 0.045, fundamentals: { pe: 162.0, pb: 14.2, roe: 0.09, eps: 0.20, debtToEquity: 0.00, revenueGrowth: 0.21, earningsGrowth: undefined, pegRatio: undefined, marketCap: 69e9 } },
  SNOW: { name: 'Snowflake Inc.',         market: 'US', currency: 'USD', price: 142.4,  sigma: 0.040, fundamentals: { pe: undefined, pb: 6.82, roe: -0.10, eps: -1.62, debtToEquity: 0.00, revenueGrowth: 0.29, earningsGrowth: undefined, pegRatio: undefined, marketCap: 47e9 } },
  SHOP: { name: 'Shopify Inc.',           market: 'US', currency: 'USD', price: 98.4,   sigma: 0.035, fundamentals: { pe: 72.8, pb: 12.2, roe: 0.17, eps: 1.35,  debtToEquity: 0.08, revenueGrowth: 0.26, earningsGrowth: undefined, pegRatio: undefined, marketCap: 126e9 } },
  TSMC: { name: 'Taiwan Semiconductor',   market: 'US', currency: 'USD', price: 192.4,  sigma: 0.022, fundamentals: { pe: 22.4, pb: 6.82, roe: 0.30, eps: 8.59,  debtToEquity: 0.23, revenueGrowth: 0.34, earningsGrowth: 0.58, pegRatio: 0.39, marketCap: 994e9 } },
  QCOM: { name: 'Qualcomm Inc.',          market: 'US', currency: 'USD', price: 148.4,  sigma: 0.020, fundamentals: { pe: 14.8, pb: 8.02, roe: 0.54, eps: 10.02, debtToEquity: 0.72, revenueGrowth: 0.18, earningsGrowth: 0.35, pegRatio: 0.44, marketCap: 165e9 } },
  AVGO: { name: 'Broadcom Inc.',          market: 'US', currency: 'USD', price: 198.4,  sigma: 0.020, fundamentals: { pe: 34.2, pb: 12.2, roe: 0.36, eps: 5.80,  debtToEquity: 1.12, revenueGrowth: 0.51, earningsGrowth: 0.14, pegRatio: 2.38, marketCap: 928e9 } },
  NOW:  { name: 'ServiceNow Inc.',        market: 'US', currency: 'USD', price: 982.4,  sigma: 0.022, fundamentals: { pe: 142.8, pb: 22.2, roe: 0.16, eps: 6.88, debtToEquity: 0.12, revenueGrowth: 0.21, earningsGrowth: 0.51, pegRatio: 2.79, marketCap: 205e9 } },
  // ETFs
  SPY:  { name: 'SPDR S&P 500 ETF',      market: 'US', currency: 'USD', price: 568.4,  sigma: 0.010, fundamentals: {} },
  QQQ:  { name: 'Invesco QQQ ETF',        market: 'US', currency: 'USD', price: 482.4,  sigma: 0.013, fundamentals: {} },
  '7203.T': { name: 'トヨタ自動車（株）',   market: 'JP', currency: 'JPY', price: 3285,   sigma: 0.013, fundamentals: { pe: 9.8,  pb: 1.12, roe: 0.12, eps: 335,  debtToEquity: 0.89, revenueGrowth: 0.12, earningsGrowth: 0.10, pegRatio: 0.98 } },
  '6758.T': { name: 'ソニーグループ（株）', market: 'JP', currency: 'JPY', price: 2798,   sigma: 0.015, fundamentals: { pe: 16.4, pb: 2.10, roe: 0.13, eps: 170,  debtToEquity: 0.51, revenueGrowth: 0.11, earningsGrowth: 0.08, pegRatio: 2.05 } },
  '9984.T': { name: 'ソフトバンクG（株）', market: 'JP', currency: 'JPY', price: 9420,   sigma: 0.022, fundamentals: { pe: undefined, pb: 1.85, roe: -0.05, eps: undefined, debtToEquity: 2.33, revenueGrowth: -0.02, earningsGrowth: undefined, pegRatio: undefined } },
  '6861.T': { name: 'キーエンス（株）',     market: 'JP', currency: 'JPY', price: 66800,  sigma: 0.012, fundamentals: { pe: 40.1, pb: 6.55, roe: 0.17, eps: 1665, debtToEquity: 0.02, revenueGrowth: 0.06, earningsGrowth: 0.03, pegRatio: undefined } },
  '8306.T': { name: '三菱UFJフィナンシャルG', market: 'JP', currency: 'JPY', price: 1654, sigma: 0.014, fundamentals: { pe: 12.1, pb: 0.85, roe: 0.07, eps: 136, debtToEquity: 0.88, revenueGrowth: 0.08, earningsGrowth: 0.12, pegRatio: 1.01 } },
}

interface CatalogEntry extends SearchResult { aliases?: string[] }

const SEARCH_CATALOG: CatalogEntry[] = [
  { symbol: 'AAPL',  name: 'Apple Inc.',             type: 'EQUITY', market: 'US', aliases: ['apple', 'アップル'] },
  { symbol: 'NVDA',  name: 'NVIDIA Corporation',     type: 'EQUITY', market: 'US', aliases: ['nvidia', 'エヌビディア', 'nvidea'] },
  { symbol: 'MSFT',  name: 'Microsoft Corp.',        type: 'EQUITY', market: 'US', aliases: ['microsoft', 'マイクロソフト'] },
  { symbol: 'GOOGL', name: 'Alphabet Inc.',          type: 'EQUITY', market: 'US', aliases: ['google', 'alphabet', 'グーグル', 'アルファベット'] },
  { symbol: 'AMZN',  name: 'Amazon.com Inc.',        type: 'EQUITY', market: 'US', aliases: ['amazon', 'アマゾン'] },
  { symbol: 'TSLA',  name: 'Tesla Inc.',             type: 'EQUITY', market: 'US', aliases: ['tesla', 'テスラ'] },
  { symbol: 'META',  name: 'Meta Platforms',         type: 'EQUITY', market: 'US', aliases: ['meta', 'facebook', 'メタ', 'フェイスブック'] },
  { symbol: 'BRK',   name: 'Berkshire Hathaway',     type: 'EQUITY', market: 'US', aliases: ['berkshire', 'buffett', 'バークシャー', 'バフェット'] },
  // Finance
  { symbol: 'JPM',   name: 'JPMorgan Chase & Co.',   type: 'EQUITY', market: 'US', aliases: ['jpmorgan', 'chase', 'JPモルガン', 'ジェイピーモルガン'] },
  { symbol: 'BAC',   name: 'Bank of America Corp.',  type: 'EQUITY', market: 'US', aliases: ['bank of america', 'bofa', 'バンク・オブ・アメリカ', 'バンカメ'] },
  { symbol: 'V',     name: 'Visa Inc.',              type: 'EQUITY', market: 'US', aliases: ['visa', 'ビザ'] },
  { symbol: 'MA',    name: 'Mastercard Inc.',        type: 'EQUITY', market: 'US', aliases: ['mastercard', 'マスターカード'] },
  { symbol: 'GS',    name: 'Goldman Sachs Group',    type: 'EQUITY', market: 'US', aliases: ['goldman', 'goldman sachs', 'ゴールドマン', 'ゴールドマン・サックス'] },
  { symbol: 'AXP',   name: 'American Express Co.',   type: 'EQUITY', market: 'US', aliases: ['american express', 'amex', 'アメックス', 'アメリカン・エキスプレス'] },
  { symbol: 'BLK',   name: 'BlackRock Inc.',         type: 'EQUITY', market: 'US', aliases: ['blackrock', 'ブラックロック'] },
  { symbol: 'C',     name: 'Citigroup Inc.',         type: 'EQUITY', market: 'US', aliases: ['citi', 'citigroup', 'シティ', 'シティグループ'] },
  { symbol: 'MS',    name: 'Morgan Stanley',         type: 'EQUITY', market: 'US', aliases: ['morgan stanley', 'モルガン・スタンレー', 'モルスタ'] },
  { symbol: 'SCHW',  name: 'Charles Schwab Corp.',   type: 'EQUITY', market: 'US', aliases: ['schwab', 'charles schwab', 'シュワブ'] },
  { symbol: 'PYPL',  name: 'PayPal Holdings Inc.',   type: 'EQUITY', market: 'US', aliases: ['paypal', 'ペイパル'] },
  { symbol: 'SPGI',  name: 'S&P Global Inc.',        type: 'EQUITY', market: 'US', aliases: ['s&p global', 'spglobal', 'S&Pグローバル'] },
  // Healthcare
  { symbol: 'JNJ',   name: 'Johnson & Johnson',      type: 'EQUITY', market: 'US', aliases: ['johnson', 'ジョンソン・エンド・ジョンソン', 'J&J'] },
  { symbol: 'UNH',   name: 'UnitedHealth Group',     type: 'EQUITY', market: 'US', aliases: ['unitedhealth', 'united health', 'ユナイテッドヘルス'] },
  { symbol: 'LLY',   name: 'Eli Lilly & Co.',        type: 'EQUITY', market: 'US', aliases: ['eli lilly', 'lilly', 'イーライリリー', 'リリー'] },
  { symbol: 'ABBV',  name: 'AbbVie Inc.',            type: 'EQUITY', market: 'US', aliases: ['abbvie', 'アッヴィ'] },
  { symbol: 'PFE',   name: 'Pfizer Inc.',            type: 'EQUITY', market: 'US', aliases: ['pfizer', 'ファイザー'] },
  { symbol: 'MRK',   name: 'Merck & Co.',            type: 'EQUITY', market: 'US', aliases: ['merck', 'メルク'] },
  { symbol: 'AMGN',  name: 'Amgen Inc.',             type: 'EQUITY', market: 'US', aliases: ['amgen', 'アムジェン'] },
  { symbol: 'GILD',  name: 'Gilead Sciences Inc.',   type: 'EQUITY', market: 'US', aliases: ['gilead', 'ギリアド'] },
  { symbol: 'CVS',   name: 'CVS Health Corp.',       type: 'EQUITY', market: 'US', aliases: ['cvs', 'cvs health', 'CVSヘルス'] },
  { symbol: 'BMY',   name: 'Bristol-Myers Squibb',   type: 'EQUITY', market: 'US', aliases: ['bristol myers', 'bms', 'ブリストル・マイヤーズ'] },
  // Consumer Staples / Discretionary
  { symbol: 'KO',    name: 'Coca-Cola Company',      type: 'EQUITY', market: 'US', aliases: ['coca cola', 'coke', 'コカ・コーラ', 'コカコーラ'] },
  { symbol: 'PG',    name: 'Procter & Gamble Co.',   type: 'EQUITY', market: 'US', aliases: ['procter', 'p&g', 'P&G', 'プロクター・アンド・ギャンブル'] },
  { symbol: 'WMT',   name: 'Walmart Inc.',           type: 'EQUITY', market: 'US', aliases: ['walmart', 'ウォルマート'] },
  { symbol: 'COST',  name: 'Costco Wholesale Corp.', type: 'EQUITY', market: 'US', aliases: ['costco', 'コストコ'] },
  { symbol: 'HD',    name: 'Home Depot Inc.',        type: 'EQUITY', market: 'US', aliases: ['home depot', 'ホーム・デポ'] },
  { symbol: 'TGT',   name: 'Target Corp.',           type: 'EQUITY', market: 'US', aliases: ['target', 'ターゲット'] },
  { symbol: 'MCD',   name: "McDonald's Corp.",       type: 'EQUITY', market: 'US', aliases: ['mcdonalds', 'mcdonald', 'マクドナルド', 'マック'] },
  { symbol: 'SBUX',  name: 'Starbucks Corp.',        type: 'EQUITY', market: 'US', aliases: ['starbucks', 'スターバックス', 'スタバ'] },
  { symbol: 'NKE',   name: 'Nike Inc.',              type: 'EQUITY', market: 'US', aliases: ['nike', 'ナイキ'] },
  { symbol: 'UBER',  name: 'Uber Technologies Inc.', type: 'EQUITY', market: 'US', aliases: ['uber', 'ウーバー'] },
  // Energy
  { symbol: 'XOM',   name: 'Exxon Mobil Corp.',     type: 'EQUITY', market: 'US', aliases: ['exxon', 'exxon mobil', 'エクソンモービル', 'エクソン'] },
  { symbol: 'CVX',   name: 'Chevron Corp.',          type: 'EQUITY', market: 'US', aliases: ['chevron', 'シェブロン'] },
  // Industrial
  { symbol: 'CAT',   name: 'Caterpillar Inc.',       type: 'EQUITY', market: 'US', aliases: ['caterpillar', 'キャタピラー'] },
  { symbol: 'RTX',   name: 'RTX Corp.',              type: 'EQUITY', market: 'US', aliases: ['rtx', 'raytheon', 'レイセオン'] },
  { symbol: 'BA',    name: 'Boeing Co.',             type: 'EQUITY', market: 'US', aliases: ['boeing', 'ボーイング'] },
  { symbol: 'GE',    name: 'GE Aerospace',           type: 'EQUITY', market: 'US', aliases: ['ge', 'general electric', 'GEアエロスペース'] },
  { symbol: 'LMT',   name: 'Lockheed Martin Corp.',  type: 'EQUITY', market: 'US', aliases: ['lockheed', 'ロッキード・マーチン'] },
  { symbol: 'HON',   name: 'Honeywell Intl Inc.',    type: 'EQUITY', market: 'US', aliases: ['honeywell', 'ハネウェル'] },
  { symbol: 'UPS',   name: 'United Parcel Service',  type: 'EQUITY', market: 'US', aliases: ['ups', 'united parcel', 'UPS'] },
  { symbol: 'FDX',   name: 'FedEx Corp.',            type: 'EQUITY', market: 'US', aliases: ['fedex', 'フェデックス'] },
  { symbol: 'MMM',   name: '3M Company',             type: 'EQUITY', market: 'US', aliases: ['3m', 'スリーエム'] },
  { symbol: 'DE',    name: 'Deere & Company',        type: 'EQUITY', market: 'US', aliases: ['deere', 'john deere', 'ディア', 'ジョン・ディア'] },
  // Telecom / Utilities
  { symbol: 'T',     name: 'AT&T Inc.',              type: 'EQUITY', market: 'US', aliases: ['at&t', 'att', 'エーティーアンドティー'] },
  { symbol: 'VZ',    name: 'Verizon Communications', type: 'EQUITY', market: 'US', aliases: ['verizon', 'ベライゾン'] },
  { symbol: 'NEE',   name: 'NextEra Energy Inc.',    type: 'EQUITY', market: 'US', aliases: ['nextera', 'next era', 'ネクステラ'] },
  // Real Estate
  { symbol: 'AMT',   name: 'American Tower Corp.',   type: 'EQUITY', market: 'US', aliases: ['american tower', 'アメリカン・タワー'] },
  { symbol: 'PLD',   name: 'Prologis Inc.',          type: 'EQUITY', market: 'US', aliases: ['prologis', 'プロロジス'] },
  // Value stocks
  { symbol: 'KHC',   name: 'Kraft Heinz Co.',        type: 'EQUITY', market: 'US', aliases: ['kraft', 'heinz', 'クラフト・ハインツ'] },
  { symbol: 'WFC',   name: 'Wells Fargo & Co.',      type: 'EQUITY', market: 'US', aliases: ['wells fargo', 'ウェルズ・ファーゴ'] },
  { symbol: 'OXY',   name: 'Occidental Petroleum',   type: 'EQUITY', market: 'US', aliases: ['occidental', 'oxy', 'オクシデンタル'] },
  // Tech
  { symbol: 'AMD',   name: 'Advanced Micro Devices', type: 'EQUITY', market: 'US', aliases: ['amd', 'エーエムディー'] },
  { symbol: 'INTC',  name: 'Intel Corp.',            type: 'EQUITY', market: 'US', aliases: ['intel', 'インテル'] },
  { symbol: 'ORCL',  name: 'Oracle Corp.',           type: 'EQUITY', market: 'US', aliases: ['oracle', 'オラクル'] },
  { symbol: 'CRM',   name: 'Salesforce Inc.',        type: 'EQUITY', market: 'US', aliases: ['salesforce', 'セールスフォース'] },
  { symbol: 'NFLX',  name: 'Netflix Inc.',           type: 'EQUITY', market: 'US', aliases: ['netflix', 'ネットフリックス'] },
  { symbol: 'ADBE',  name: 'Adobe Inc.',             type: 'EQUITY', market: 'US', aliases: ['adobe', 'アドビ'] },
  { symbol: 'COIN',  name: 'Coinbase Global Inc.',   type: 'EQUITY', market: 'US', aliases: ['coinbase', 'コインベース'] },
  { symbol: 'PLTR',  name: 'Palantir Technologies',  type: 'EQUITY', market: 'US', aliases: ['palantir', 'パランティア'] },
  { symbol: 'SNOW',  name: 'Snowflake Inc.',         type: 'EQUITY', market: 'US', aliases: ['snowflake', 'スノーフレーク'] },
  { symbol: 'SHOP',  name: 'Shopify Inc.',           type: 'EQUITY', market: 'US', aliases: ['shopify', 'ショッピファイ'] },
  { symbol: 'TSMC',  name: 'Taiwan Semiconductor',   type: 'EQUITY', market: 'US', aliases: ['tsmc', 'taiwan semi', 'TSMCタイワン'] },
  { symbol: 'QCOM',  name: 'Qualcomm Inc.',          type: 'EQUITY', market: 'US', aliases: ['qualcomm', 'クアルコム'] },
  { symbol: 'AVGO',  name: 'Broadcom Inc.',          type: 'EQUITY', market: 'US', aliases: ['broadcom', 'ブロードコム'] },
  { symbol: 'NOW',   name: 'ServiceNow Inc.',        type: 'EQUITY', market: 'US', aliases: ['servicenow', 'サービスナウ'] },
  // ETF
  { symbol: 'SPY',   name: 'SPDR S&P 500 ETF',      type: 'ETF',    market: 'US', aliases: ['spy', 's&p500', 's&p 500', 'S&P500 ETF', 'S&Pごひゃく'] },
  { symbol: 'QQQ',   name: 'Invesco QQQ ETF',        type: 'ETF',    market: 'US', aliases: ['qqq', 'nasdaq100', 'ナスダック100 ETF'] },
  // JP
  { symbol: '7203.T', name: 'トヨタ自動車',              type: 'EQUITY', market: 'JP', aliases: ['toyota', 'トヨタ'] },
  { symbol: '6758.T', name: 'ソニーグループ',             type: 'EQUITY', market: 'JP', aliases: ['sony', 'ソニー'] },
  { symbol: '9984.T', name: 'ソフトバンクグループ',        type: 'EQUITY', market: 'JP', aliases: ['softbank', 'ソフトバンク'] },
  { symbol: '6861.T', name: 'キーエンス',                type: 'EQUITY', market: 'JP', aliases: ['keyence', 'キーエンス'] },
  { symbol: '8306.T', name: '三菱UFJフィナンシャルグループ', type: 'EQUITY', market: 'JP', aliases: ['mufg', '三菱', 'mitsubishi'] },
]

// Seeded random — same symbol always produces same chart shape
function seededRandom(seed: number): number {
  const x = Math.sin(seed) * 10000
  return x - Math.floor(x)
}

function generateHistory(symbol: string, days: number): HistoricalBar[] {
  const seed = SEEDS[symbol] ?? { price: 100, sigma: 0.015, currency: 'USD', name: symbol, market: 'US', fundamentals: {} }
  const bars: HistoricalBar[] = []
  let price = seed.price * 0.7  // start 30% lower for upward-ish trend
  const now = Date.now()
  let seedN = symbol.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0)

  for (let i = days; i >= 0; i--) {
    const date = new Date(now - i * 86_400_000)
    if (date.getDay() === 0 || date.getDay() === 6) continue  // skip weekends

    seedN++
    const rand1 = (seededRandom(seedN * 1.1) - 0.5) * 2
    const rand2 = (seededRandom(seedN * 2.3) - 0.5) * 2
    const rand3 = (seededRandom(seedN * 3.7) - 0.5) * 2

    const dailyReturn = rand1 * seed.sigma + 0.0003  // slight upward drift
    const open  = price
    const close = price * (1 + dailyReturn)
    const high  = Math.max(open, close) * (1 + Math.abs(rand2) * seed.sigma * 0.5)
    const low   = Math.min(open, close) * (1 - Math.abs(rand3) * seed.sigma * 0.5)

    bars.push({
      time:   Math.floor(date.getTime() / 1000),
      open:   parseFloat(open.toFixed(2)),
      high:   parseFloat(high.toFixed(2)),
      low:    parseFloat(low.toFixed(2)),
      close:  parseFloat(close.toFixed(2)),
      volume: Math.floor(seed.price * 1_000_000 * (0.5 + seededRandom(seedN * 4.1))),
    })

    price = close
  }
  return bars
}

export function mockGetQuote(symbol: string): StockQuote {
  const s = SEEDS[symbol]
  if (!s) {
    return {
      symbol,
      name: symbol,
      price: 0,
      change: 0,
      changePercent: 0,
      volume: 0,
      currency: 'USD',
      market: /^[0-9]{4}\.T$/.test(symbol) ? 'JP' : 'US',
      isMarketOpen: false,
      lastUpdated: new Date().toISOString(),
    }
  }

  // Add small random noise to price (±0.5%)
  const noise = 1 + (Math.random() - 0.5) * 0.01
  const price = parseFloat((s.price * noise).toFixed(2))
  const change = parseFloat((s.price * (Math.random() - 0.48) * 0.015).toFixed(2))

  return {
    symbol,
    name: s.name,
    price,
    change,
    changePercent: parseFloat(((change / price) * 100).toFixed(2)),
    volume: Math.floor(s.price * 800_000),
    currency: s.currency,
    market: s.market,
    isMarketOpen: true,
    lastUpdated: new Date().toISOString(),
  }
}

export function mockGetHistory(symbol: string, period: string): HistoricalBar[] {
  if (!SEEDS[symbol]) return []
  const daysMap: Record<string, number> = {
    '1d': 2, '5d': 7, '1mo': 31, '3mo': 92, '6mo': 183, '1y': 365, '2y': 730,
  }
  return generateHistory(symbol, daysMap[period] ?? 92)
}

export function mockGetFundamentals(symbol: string): FundamentalsData {
  return SEEDS[symbol]?.fundamentals ?? {}
}

export function mockSearch(query: string): SearchResult[] {
  const q = query.toLowerCase()
  return SEARCH_CATALOG.filter(
    (s) =>
      s.symbol.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      s.aliases?.some((a) => a.toLowerCase().includes(q))
  ).map(({ aliases: _a, ...s }) => s).slice(0, 8)
}

export function getUSSymbols(): string[] {
  return Object.entries(SEEDS)
    .filter(([, seed]) => seed.market === 'US')
    .map(([symbol]) => symbol)
}
