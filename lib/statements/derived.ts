// Derived fundamentals from multi-period annual statements (/report R2).
// Pure functions, no I/O. A metric is left UNDEFINED when the inputs it needs
// are missing/invalid — the caller renders those as 判定不能 (原則9: never
// invent a number). `periods` is expected ascending (oldest → newest).

import type { PeriodStatement, StatementsData, DerivedFundamentals, DerivedMetric } from './types'

function fin(v: number | undefined): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** CAGR over `years` spans (needs `years + 1` points); both ends must be > 0. */
function cagr(start: number | undefined, end: number | undefined, years: number): number | undefined {
  const s = fin(start), e = fin(end)
  if (s === undefined || e === undefined || s <= 0 || e <= 0 || years <= 0) return undefined
  return Math.pow(e / s, 1 / years) - 1
}

/** Ratio a/b, guarding a positive denominator (returns undefined otherwise). */
function ratioPosDen(a: number | undefined, b: number | undefined): number | undefined {
  const x = fin(a), y = fin(b)
  if (x === undefined || y === undefined || y <= 0) return undefined
  return x / y
}

/** Per-period margin series (value/revenue), undefined entries where not computable. */
function marginSeries(periods: PeriodStatement[], pick: (p: PeriodStatement) => number | undefined): (number | undefined)[] {
  return periods.map((p) => ratioPosDen(pick(p), p.totalRevenue))
}

/**
 * Count of consecutive RISES at the newest end of the series.
 * e.g. [.., 0.10, 0.12, 0.15] → 2 (two consecutive up-moves). Any undefined at
 * the newest end makes the streak unknowable → undefined.
 */
function risingStreak(series: (number | undefined)[]): number | undefined {
  if (series.length < 2) return undefined
  if (series[series.length - 1] === undefined) return undefined
  let streak = 0
  for (let i = series.length - 1; i > 0; i--) {
    const cur = series[i], prev = series[i - 1]
    if (cur === undefined || prev === undefined) break
    if (cur > prev) streak++
    else break
  }
  return streak
}

export function computeDerived(data: StatementsData): DerivedFundamentals {
  const p = data.periods // ascending
  const n = p.length
  const out: DerivedFundamentals = {}
  if (n === 0) return out

  const last = p[n - 1]
  const prev = n >= 2 ? p[n - 2] : undefined

  const set = (k: DerivedMetric, v: number | undefined) => { if (v !== undefined) out[k] = v }

  // Revenue growth
  if (n >= 4) set('revenueCagr3y', cagr(p[n - 4].totalRevenue, last.totalRevenue, 3))
  if (prev) set('revenueYoy', (() => {
    const r0 = fin(prev.totalRevenue), r1 = fin(last.totalRevenue)
    return r0 !== undefined && r1 !== undefined && r0 > 0 ? r1 / r0 - 1 : undefined
  })())

  // Operating margin (latest + rising streak)
  const opMargins = marginSeries(p, (x) => x.operatingIncome)
  set('operatingMarginLatest', opMargins[n - 1])
  set('operatingMarginRisingStreak', risingStreak(opMargins))

  // Net margin rising streak
  const netMargins = marginSeries(p, (x) => x.netIncome)
  set('netMarginRisingStreak', risingStreak(netMargins))

  // EPS CAGR (3y) — both ends must be positive
  if (n >= 4) set('epsCagr3y', cagr(p[n - 4].dilutedEps, last.dilutedEps, 3))

  // FCF margin + positive-year count
  set('fcfMargin', ratioPosDen(last.freeCashFlow, last.totalRevenue))
  const fcfVals = p.map((x) => fin(x.freeCashFlow)).filter((v): v is number => v !== undefined)
  if (fcfVals.length > 0) set('fcfPositiveYears', fcfVals.filter((v) => v > 0).length)

  // Profit quality = OCF / net income (needs positive net income)
  set('profitQuality', ratioPosDen(last.operatingCashFlow, last.netIncome))

  // ROE + equity ratio
  set('roeLatest', ratioPosDen(last.netIncome, last.stockholdersEquity))
  set('equityRatio', ratioPosDen(last.stockholdersEquity, last.totalAssets))

  // Net debt / EBITDA (needs positive EBITDA)
  {
    const debt = fin(last.totalDebt), cash = fin(last.cash), ebitda = fin(last.ebitda)
    if (debt !== undefined && ebitda !== undefined && ebitda > 0) {
      set('netDebtToEbitda', (debt - (cash ?? 0)) / ebitda)
    }
  }

  return out
}
