// Financial-statement domain types (/report R2 — earnings depth).
//
// Source-neutral shape: the MVP fills this from yahoo-finance2
// `fundamentalsTimeSeries` (annual only), but a later slice can fill the same
// StatementsData from SEC EDGAR (US) / J-Quants (JP) without touching the
// report/derived layers. Annual periods only — quarterly rows are excluded at
// the provider (原則9: mixing a quarterly value into a "yearly" figure would be
// a fabricated data point).

/** One annual fiscal period. All figures in the instrument's native currency. */
export interface PeriodStatement {
  /** Fiscal period end, 'YYYY-MM-DD'. */
  endDate: string
  // Income statement
  totalRevenue?: number
  operatingIncome?: number
  netIncome?: number
  /** Diluted EPS (falls back to basic EPS at the provider when diluted is absent). */
  dilutedEps?: number
  ebitda?: number
  // Balance sheet
  totalAssets?: number
  stockholdersEquity?: number
  totalDebt?: number
  cash?: number
  // Cash flow
  operatingCashFlow?: number
  /** Free cash flow (derived as OCF + capex when the provider omits it). */
  freeCashFlow?: number
  capitalExpenditure?: number
}

/** Multi-period annual statements for one symbol (oldest → newest). */
export interface StatementsData {
  symbol: string
  currency: string
  periodType: 'annual'
  /** Ascending by endDate (oldest first). */
  periods: PeriodStatement[]
  /** Human-readable provenance for citations. */
  source: string
}

/**
 * Derived fundamentals computed from StatementsData — trends and quality
 * ratios (the analytically valuable signals, per the research: direction and
 * consistency over multiple years rather than single-period absolutes).
 * A metric is ABSENT (undefined key) when it cannot be computed from the
 * available periods/fields — never guessed.
 */
export type DerivedMetric =
  | 'revenueCagr3y'
  | 'revenueYoy'
  | 'operatingMarginLatest'
  | 'operatingMarginRisingStreak'
  | 'epsCagr3y'
  | 'fcfMargin'
  | 'fcfPositiveYears'
  | 'profitQuality'
  | 'roeLatest'
  | 'equityRatio'
  | 'netDebtToEbitda'
  | 'netMarginRisingStreak'

export type DerivedFundamentals = Partial<Record<DerivedMetric, number>>
