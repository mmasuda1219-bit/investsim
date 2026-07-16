// /report domain types (R1 redesign).
//
// Flow: ReportRequest (structured CompositeCondition — free-text theory and
// the Haiku interpret step were REMOVED from the pipeline in R1)
//   --(validate + fundamental AND-gate + real-data 5y backtest + snapshot
//      + AI-trader evidence)--> PreparedBundle
//   --(Opus, streaming)--> Markdown report.
// chartData (5y OHLC + equity curve + trade markers) is returned NEXT TO the
// bundle by /api/report/prepare for client-side charts — it is deliberately
// NOT part of the bundle so it never reaches the Opus prompt (token economy).
// Nothing is persisted.

import type {
  BacktestMetrics,
  BacktestPeriod,
  BacktestTrade,
  CompositeCondition,
  EquityPoint,
  BacktestCondition,
} from '@/lib/backtest/types'
import type { FundamentalGateResult } from '@/lib/backtest/fundamental'
import type { StockQuote, FundamentalsData, HistoricalBar } from '@/types'

/** Input of POST /api/report/prepare (v2 — structured condition, no free text). */
export interface ReportRequest {
  symbol: string
  /** One technical rule + fundamental AND-filters (current-value static gate). */
  condition: CompositeCondition
  /** Virtual starting capital (native currency). Defaults server-side. */
  initialCapital?: number
}

/**
 * Backtest summary carried into the Opus prompt. Deliberately does NOT include
 * the full equity curve (token economy) — metrics + trades only.
 */
export interface BacktestSummary {
  symbol: string
  currency: string
  period: BacktestPeriod
  startDate: number
  endDate: number
  barCount: number
  initialCapital: number
  finalValue: number
  metrics: BacktestMetrics
  trades: BacktestTrade[]
  /**
   * Same-window buy & hold return percent ((lastClose-firstClose)/firstClose),
   * computed from the SAME real bars — the report's baseline comparison.
   */
  buyHoldReturnPct: number
}

/** Present-day snapshot of the instrument (real data). */
export interface CurrentSnapshot {
  quote: StockQuote
  /** Human-readable technical summary with real values (MA20/50, RSI, MACD, BB). */
  technicals: string
  fundamentals: FundamentalsData
}

/** One recent closed trade of the AI trader on the report's symbol. */
export interface AiTraderRecentTrade {
  entryAt: string
  exitAt: string
  entryPrice: number
  exitPrice: number
  pnlPct: number
  holdingHours: number
  entryReasoning: string
  exitReasoning: string
  outcome: 'profit' | 'loss'
}

/**
 * Structured evidence from the AI trader's own virtual trading history on the
 * report's symbol (read-only across ALL sessions via lib/ai-trader/store).
 * hasData:false when no session has ever traded/judged this symbol.
 */
export interface AiTraderEvidence {
  hasData: boolean
  /** Closed round-trips on this symbol across all sessions. */
  tradeCount: number
  /** Win rate over those trades, percent 0–100 (0 when tradeCount=0). */
  winRate: number
  /** Mean pnlPct over those trades (0 when tradeCount=0). */
  avgPnlPct: number
  recentTrades: AiTraderRecentTrade[]
  /** Distilled lessons/insights that mention this symbol. */
  relevantLessons: string[]
  /** Formatted digest of recent per-tick decisions on this symbol ('' if none). */
  decisionsSummary: string
}

/** Output of prepare, input of generate. Never persisted. */
export interface PreparedBundle {
  request: ReportRequest
  /** Human-readable description of the composite condition (JA). */
  conditionDescription: string
  /** Backtest window — fixed to '5y' in R1. */
  period: BacktestPeriod
  /** Current-value fundamental AND-gate outcome (with per-filter evidence). */
  fundamentalGate: FundamentalGateResult
  /**
   * 5y real-data backtest. null ⇔ the fundamental gate did not pass
   * (backtest skipped; the report still gets written around that fact).
   */
  backtest: BacktestSummary | null
  /** Set when backtest is null — human-readable why the gate failed (JA). */
  gateFailReason?: string
  current: CurrentSnapshot
  /** AI trader's structured track record on this symbol. */
  aiEvidence: AiTraderEvidence
  /** Learning context distilled from the latest AI session ('' if none). */
  learningContext: string
  /** Data/analysis sources cited in the report. */
  sources: string[]
  /** ISO timestamp of preparation. */
  preparedAt: string
}

/**
 * Chart payload returned by prepare NEXT TO the bundle (never sent to Opus).
 * Shaped for lightweight-charts consumers (unix-seconds times, OHLC bars,
 * equity line, buy/sell markers).
 */
export interface ChartData {
  symbol: string
  period: BacktestPeriod
  /** Full 5y daily OHLC (real data). */
  bars: HistoricalBar[]
  /** Backtest equity curve ([] when the gate failed and no backtest ran). */
  equityCurve: EquityPoint[]
  /** Executed virtual trades for markers ([] when no backtest ran). */
  trades: BacktestTrade[]
}

/** Response shape of POST /api/report/prepare. */
export interface PrepareResponse {
  bundle: PreparedBundle
  chartData: ChartData
}

// ── Legacy types (v1 free-text flow) ────────────────────────────────────────
// Kept ONLY so lib/report/interpret.ts (parked file — no longer imported by
// any route) still compiles. Do not use in new code.

/** @deprecated v1 hint families for the removed Haiku interpret step. */
export type ReportIndicator = 'ma' | 'rsi' | 'macd' | 'bb' | 'stoch' | 'roc' | 'breakout'

/** @deprecated v1 free-text request shape (theoryText flow removed in R1). */
export interface LegacyReportRequest {
  symbol: string
  theoryText: string
  indicators: ReportIndicator[]
  maPeriod?: number
  initialCapital?: number
}

/** @deprecated Output of the removed Haiku interpret step. */
export interface InterpretedTheory {
  condition: BacktestCondition
  note: string
}
