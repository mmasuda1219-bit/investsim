// Pure metric functions computed from an equity curve + trade log.
// No I/O, no external data — fully deterministic and unit-testable.

import type { EquityPoint, BacktestTrade, BacktestMetrics } from './types'

const round2 = (n: number) => Math.round(n * 100) / 100

/** Trading days per year, used to annualize the Sharpe ratio. */
const TRADING_DAYS = 252

/** (last - first) / first, in percent. */
export function totalReturnPct(values: number[]): number {
  if (values.length < 2) return 0
  const first = values[0]
  const last = values[values.length - 1]
  if (first === 0) return 0
  return ((last - first) / first) * 100
}

/**
 * Maximum peak-to-trough decline as a positive percent.
 * A monotonically non-decreasing curve returns 0.
 */
export function maxDrawdownPct(values: number[]): number {
  let peak = -Infinity
  let maxDd = 0
  for (const v of values) {
    if (v > peak) peak = v
    if (peak > 0) {
      const dd = ((peak - v) / peak) * 100
      if (dd > maxDd) maxDd = dd
    }
  }
  return maxDd
}

/**
 * Annualized Sharpe ratio of daily equity returns (risk-free rate = 0).
 * Returns 0 when there is no variance or too few points.
 */
export function sharpeRatio(values: number[]): number {
  if (values.length < 2) return 0
  const returns: number[] = []
  for (let i = 1; i < values.length; i++) {
    const prev = values[i - 1]
    returns.push(prev === 0 ? 0 : (values[i] - prev) / prev)
  }
  const mean = returns.reduce((s, r) => s + r, 0) / returns.length
  const variance =
    returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length
  const std = Math.sqrt(variance)
  if (std === 0) return 0
  return (mean / std) * Math.sqrt(TRADING_DAYS)
}

/**
 * Pair buy->sell executions into closed round-trips.
 * A round-trip is a "win" when the exit cash value exceeds the entry cash value.
 * An open position at the end (a buy with no matching sell) is ignored.
 */
export function roundTrips(trades: BacktestTrade[]): { wins: number; total: number } {
  let wins = 0
  let total = 0
  let entry: BacktestTrade | null = null
  for (const t of trades) {
    if (t.action === 'buy') {
      entry = t
    } else if (t.action === 'sell' && entry) {
      total++
      if (t.value > entry.value) wins++
      entry = null
    }
  }
  return { wins, total }
}

/** Compose all summary metrics from an equity curve and trade log. */
export function computeMetrics(
  equityCurve: EquityPoint[],
  trades: BacktestTrade[],
): BacktestMetrics {
  const values = equityCurve.map(p => p.value)
  const { wins, total } = roundTrips(trades)
  return {
    totalReturnPct: round2(totalReturnPct(values)),
    winRate: total > 0 ? round2((wins / total) * 100) : 0,
    maxDrawdownPct: round2(maxDrawdownPct(values)),
    sharpeRatio: round2(sharpeRatio(values)),
    tradeCount: trades.length,
  }
}
