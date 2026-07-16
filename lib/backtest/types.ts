// Backtest domain types (Lab / slice 1)
//
// Slice 1 scope: a single symbol, a single technical condition, 1-year daily data.
// FundamentalCondition is a PLACEHOLDER for a future slice — declared here so that
// BacktestCondition is a proper discriminated union (`type` field), but it is NOT
// evaluated anywhere in slice 1.

/** Close crossing its moving average (lab slice 1 rule — unchanged). */
export interface MaCrossCondition {
  type: 'technical'
  indicator: 'ma_cross'
  /** Moving-average look-back period (e.g. 20). */
  period: number
}

/**
 * RSI mean-reversion (report slice 1):
 * buy when RSI crosses back ABOVE 30 from oversold, sell when RSI crosses
 * back BELOW 70 from overbought.
 */
export interface RsiReversalCondition {
  type: 'technical'
  indicator: 'rsi_reversal'
  /** RSI look-back period (typically 14). */
  period: number
}

/**
 * MACD line / signal line cross (report slice 1):
 * buy on MACD crossing above its signal line, sell on crossing below.
 * Uses the fixed 12/26/9 parameters of lib/technicals#calcMACD.
 */
export interface MacdCrossCondition {
  type: 'technical'
  indicator: 'macd_cross'
}

/**
 * Bollinger Band breakout (report slice 1):
 * buy when the close crosses ABOVE the upper band, sell when it crosses
 * BELOW the lower band. Bands are period-SMA ± 2σ (calcBB default).
 */
export interface BbBreakCondition {
  type: 'technical'
  indicator: 'bb_break'
  /** Band look-back period (typically 20). */
  period: number
}

/**
 * Dual moving-average cross (report slice 2):
 * buy when the SHORT MA crosses above the LONG MA (golden cross),
 * sell when it crosses below (dead cross).
 * Constraint: shortPeriod < longPeriod; longPeriod <= 100 (1y-daily warm-up).
 */
export interface MaCrossDualCondition {
  type: 'technical'
  indicator: 'ma_cross_dual'
  /** Short MA period (typically 20). */
  shortPeriod: number
  /** Long MA period (typically 50; max 100 for 1y daily data). */
  longPeriod: number
}

/**
 * High/low breakout — Donchian style (report slice 2):
 * buy when the close breaks ABOVE the prior N-day high, sell when it breaks
 * BELOW the prior N-day low. The channel EXCLUDES the current bar
 * (look-ahead avoidance). period range 5–100.
 */
export interface HlBreakCondition {
  type: 'technical'
  indicator: 'hl_break'
  /** Channel look-back period (typically 20). */
  period: number
}

/**
 * Slow Stochastic %K/%D cross with zone filter (report slice 2):
 * buy when %K crosses above %D while %K <= 30 (oversold),
 * sell when %K crosses below %D while %K >= 70 (overbought).
 * Smoothing fixed at kSmooth=3 / dPeriod=3 (calcStochastic defaults).
 */
export interface StochCrossCondition {
  type: 'technical'
  indicator: 'stoch_cross'
  /** %K look-back period (typically 14). */
  period: number
}

/**
 * Rate-of-Change zero-line cross (report slice 2):
 * buy when ROC crosses above 0 (momentum turns positive),
 * sell when it crosses below 0.
 */
export interface RocSignalCondition {
  type: 'technical'
  indicator: 'roc_signal'
  /** ROC look-back period (typically 12). */
  period: number
}

/**
 * Technical rule — discriminated on `indicator`.
 * `ma_cross` keeps its original shape/behaviour; rsi/macd/bb were added for
 * the /report slice 1, and ma_cross_dual/hl_break/stoch_cross/roc_signal for
 * slice 2. Additions never affect existing ma_cross callers (/lab etc.).
 */
export type TechnicalCondition =
  | MaCrossCondition
  | RsiReversalCondition
  | MacdCrossCondition
  | BbBreakCondition
  | MaCrossDualCondition
  | HlBreakCondition
  | StochCrossCondition
  | RocSignalCondition

/**
 * Fundamental rule — PLACEHOLDER ONLY (future slice).
 * No evaluator exists for this in slice 1.
 */
export interface FundamentalCondition {
  type: 'fundamental'
  /** Fundamentals field name, e.g. 'pe', 'roe'. */
  metric: string
  operator: 'gt' | 'lt' | 'gte' | 'lte'
  value: number
}

/** Discriminated union — narrow on `.type`. */
export type BacktestCondition = TechnicalCondition | FundamentalCondition

// ── Composite condition (/report R1) ────────────────────────────────────────
// ONE technical trigger + zero-or-more fundamental AND-filters evaluated on
// CURRENT values only (static gate — fundamentals are NOT applied
// retroactively over the backtest window; the UI/prompt must state this).

/** Fundamentals fields selectable as gate filters (all exist on FundamentalsData). */
export type FundamentalMetric =
  | 'pe'
  | 'pb'
  | 'roe'
  | 'debtToEquity'
  | 'dividendYield'
  | 'marketCap'
  | 'revenueGrowth'
  | 'earningsGrowth'
  | 'profitMargin'
  | 'currentRatio'

/**
 * One fundamental AND-filter. `value` is in the SAME raw unit as
 * FundamentalsData (e.g. roe 0.15 = 15%, marketCap in native currency units).
 * Unit conversion for human input/display lives in lib/backtest/fundamental.ts.
 */
export interface FundamentalFilter {
  metric: FundamentalMetric
  operator: 'gt' | 'lt' | 'gte' | 'lte'
  value: number
}

/** /report R1 condition: one technical rule gated by fundamental AND-filters. */
export interface CompositeCondition {
  technical: TechnicalCondition
  fundamentalFilters: FundamentalFilter[]
}

/** Supported backtest windows (daily bars). '5y' added for /report R1. */
export type BacktestPeriod = '1y' | '5y'

/** Input to a single backtest run. */
export interface BacktestParams {
  symbol: string
  /** Daily-bar window. Optional — defaults to '1y' (existing callers unchanged). */
  period?: BacktestPeriod
  condition: BacktestCondition
  /** Virtual starting capital in the symbol's native currency (仮想資金). */
  initialCapital: number
}

/** One point on the equity (asset) curve. */
export interface EquityPoint {
  /** Unix timestamp, seconds (matches HistoricalBar.time). */
  time: number
  /** Portfolio value = cash + shares * close, in native currency. */
  value: number
  /** Underlying close price on that bar. */
  price: number
}

/** A single virtual buy or sell execution. */
export interface BacktestTrade {
  time: number
  action: 'buy' | 'sell'
  price: number
  /** Fractional virtual shares (all-in sizing in slice 1). */
  shares: number
  /** Cash value moved by this execution, in native currency. */
  value: number
}

/** Summary metrics derived purely from the equity curve + trades. */
export interface BacktestMetrics {
  /** (final - initial) / initial, percent. */
  totalReturnPct: number
  /** Winning closed round-trips / total round-trips, percent (0–100). */
  winRate: number
  /** Max peak-to-trough decline of equity value, percent (>= 0). */
  maxDrawdownPct: number
  /** Annualized Sharpe of daily equity returns (rf = 0). */
  sharpeRatio: number
  /** Number of trade executions (buys + sells). */
  tradeCount: number
}

/**
 * Result of ONE backtest run. Self-contained on purpose: a future slice can
 * collect an array of these to compare runs, but run.ts itself knows nothing
 * about multi-run orchestration.
 */
export interface BacktestResult {
  symbol: string
  /** Native currency of the instrument (e.g. 'USD', 'JPY'). */
  currency: string
  period: BacktestPeriod
  condition: BacktestCondition
  initialCapital: number
  finalValue: number
  /** Unix seconds of first / last bar. */
  startDate: number
  endDate: number
  equityCurve: EquityPoint[]
  trades: BacktestTrade[]
  metrics: BacktestMetrics
}
