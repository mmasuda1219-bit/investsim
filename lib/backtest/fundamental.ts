// Fundamental AND-gate evaluator (/report R1).
//
// Evaluates FundamentalFilter[] against the CURRENT FundamentalsData snapshot.
// This is a STATIC gate: fundamentals are today's values only and are NOT
// applied retroactively over the backtest window (the UI and the Opus prompt
// must state this explicitly).
//
// Semantics:
// - Filters are combined with AND. Zero filters => passed (technical-only).
// - A metric with no real data => result 'no_data' and the gate FAILS
//   (fail-closed, COMPANY.md 原則9 — we never invent a value), but 'no_data'
//   stays distinguishable from 'fail' so the UI/report can show 判定不能.
// - Contradictory filters (e.g. PER<10 AND PER>20) are NOT an error — each is
//   simply evaluated and the gate fails.
//
// Pure functions only — no I/O (unit-smoked in scripts/check-report-r1.ts).

import type { FundamentalsData } from '@/types'
import type { FundamentalFilter, FundamentalMetric } from './types'

/** One filter's outcome. `actual` is the real current value (absent on no_data). */
export interface FundamentalEvaluation {
  filter: FundamentalFilter
  actual?: number
  result: 'pass' | 'fail' | 'no_data'
}

export interface FundamentalGateResult {
  /** AND over all filters. true when every filter passes (or there are none). */
  passed: boolean
  evaluations: FundamentalEvaluation[]
}

const OPERATORS: Record<FundamentalFilter['operator'], (a: number, b: number) => boolean> = {
  gt:  (a, b) => a > b,
  lt:  (a, b) => a < b,
  gte: (a, b) => a >= b,
  lte: (a, b) => a <= b,
}

/** Evaluate all filters (AND) against the current fundamentals snapshot. */
export function evaluateFundamentalGate(
  fundamentals: FundamentalsData,
  filters: FundamentalFilter[],
): FundamentalGateResult {
  const evaluations: FundamentalEvaluation[] = filters.map((filter) => {
    const raw = fundamentals[filter.metric]
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      return { filter, result: 'no_data' as const }
    }
    const ok = OPERATORS[filter.operator](raw, filter.value)
    return { filter, actual: raw, result: ok ? ('pass' as const) : ('fail' as const) }
  })
  return { passed: evaluations.every((e) => e.result === 'pass'), evaluations }
}

// ── Metric metadata (single source of truth for UI input + display) ────────
// `unit` defines how a HUMAN-facing number maps to the raw FundamentalsData
// value stored in FundamentalFilter.value:
//   ratio    … raw as-is（倍率など） / percent … human % ⇔ raw fraction (×0.01)
//   billions … human 10億(B) ⇔ raw native-currency units (×1e9)
export type MetricUnit = 'ratio' | 'percent' | 'billions'

export interface MetricInfo {
  label: string
  unit: MetricUnit
  /** Short input hint for the UI (Japanese). */
  hint: string
}

export const METRIC_INFO: Record<FundamentalMetric, MetricInfo> = {
  pe:             { label: 'PER（株価収益率）',        unit: 'ratio',    hint: '倍（例: 15）' },
  pb:             { label: 'PBR（株価純資産倍率）',    unit: 'ratio',    hint: '倍（例: 1.5）' },
  roe:            { label: 'ROE（自己資本利益率）',    unit: 'percent',  hint: '%（例: 15）' },
  debtToEquity:   { label: 'D/E（負債資本比率）',      unit: 'ratio',    hint: 'Yahoo原値（例: 150 ≒ 150%）' },
  dividendYield:  { label: '配当利回り',               unit: 'percent',  hint: '%（例: 3）' },
  marketCap:      { label: '時価総額',                 unit: 'billions', hint: '10億単位・現地通貨（例: 100 = 1000億）' },
  revenueGrowth:  { label: '売上成長率',               unit: 'percent',  hint: '%（例: 10）' },
  earningsGrowth: { label: '利益成長率',               unit: 'percent',  hint: '%（例: 10）' },
  profitMargin:   { label: '純利益率',                 unit: 'percent',  hint: '%（例: 20）' },
  currentRatio:   { label: '流動比率',                 unit: 'ratio',    hint: '倍（例: 1.5）' },
}

export const FUNDAMENTAL_METRICS = Object.keys(METRIC_INFO) as FundamentalMetric[]

/** Human input number → raw FundamentalsData unit (what the gate compares). */
export function toRawValue(metric: FundamentalMetric, humanValue: number): number {
  switch (METRIC_INFO[metric].unit) {
    case 'percent':  return humanValue / 100
    case 'billions': return humanValue * 1e9
    case 'ratio':    return humanValue
  }
}

/** Raw FundamentalsData value → human-readable string (for UI and prompt). */
export function formatMetricValue(metric: FundamentalMetric, raw: number): string {
  switch (METRIC_INFO[metric].unit) {
    case 'percent':  return `${(raw * 100).toFixed(2)}%`
    case 'billions': return `${(raw / 1e9).toFixed(1)}B`
    case 'ratio':    return `${raw.toFixed(2)}x`
  }
}

export const OPERATOR_LABEL: Record<FundamentalFilter['operator'], string> = {
  gt: '>', lt: '<', gte: '≥', lte: '≤',
}

/** Human-readable one-liner: 「ROE（自己資本利益率） > 15.00%」 */
export function describeFundamentalFilter(f: FundamentalFilter): string {
  return `${METRIC_INFO[f.metric].label} ${OPERATOR_LABEL[f.operator]} ${formatMetricValue(f.metric, f.value)}`
}
