// /report domain types (slice 1).
//
// Flow: ReportRequest --(Haiku interpret + real-data backtest + snapshot)-->
// PreparedBundle --(Opus, streaming)--> Markdown report.
// Slice 1 does NOT persist anything (no local data store; Supabase in a later slice).

import type {
  BacktestCondition,
  BacktestMetrics,
  BacktestTrade,
} from '@/lib/backtest/types'
import type { StockQuote, FundamentalsData } from '@/types'

/**
 * Indicator families the user can check in the /report form.
 * These are OPTIONAL HINTS for the interpreter — since slice 2 the AI picks
 * from the FULL rule catalog regardless; checked families are only passed to
 * the prompt as a soft preference (empty array = fully automatic).
 */
export type ReportIndicator = 'ma' | 'rsi' | 'macd' | 'bb' | 'stoch' | 'roc' | 'breakout'

/** Input of POST /api/report/prepare. */
export interface ReportRequest {
  symbol: string
  /** Free-form theory text written by the user (Japanese OK). */
  theoryText: string
  /**
   * Optional hint: indicator families the user prefers. NOT a restriction —
   * the interpreter may pick any supported rule. Empty = no hint.
   */
  indicators: ReportIndicator[]
  /** Optional MA period hint (used when an MA-family rule is chosen). */
  maPeriod?: number
  /** Virtual starting capital (native currency). Defaults server-side. */
  initialCapital?: number
}

/** Haiku's interpretation of the user's theory into an executable condition. */
export interface InterpretedTheory {
  condition: BacktestCondition
  /** Short memo explaining how the theory was mapped to the condition. */
  note: string
}

/**
 * Backtest summary carried into the Opus prompt. Deliberately does NOT include
 * the full equity curve (token economy) — metrics + trades only.
 */
export interface BacktestSummary {
  symbol: string
  currency: string
  period: '1y'
  startDate: number
  endDate: number
  barCount: number
  initialCapital: number
  finalValue: number
  metrics: BacktestMetrics
  trades: BacktestTrade[]
}

/** Present-day snapshot of the instrument (real data). */
export interface CurrentSnapshot {
  quote: StockQuote
  /** Human-readable technical summary (MA/RSI/MACD/BB). */
  technicals: string
  fundamentals: FundamentalsData
}

/** Output of prepare, input of generate. Never persisted in slice 1. */
export interface PreparedBundle {
  request: ReportRequest
  interpreted: InterpretedTheory
  backtest: BacktestSummary
  current: CurrentSnapshot
  /** Learning context distilled from the latest AI session ('' if none). */
  learningContext: string
  /** Data/analysis sources cited in the report. */
  sources: string[]
  /** ISO timestamp of preparation. */
  preparedAt: string
}
