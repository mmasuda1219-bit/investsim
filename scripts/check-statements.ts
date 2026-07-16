// Unit smoke for the /report R2 earnings layer (pure functions, no network).
// Run: npx tsx scripts/check-statements.ts
import { computeDerived } from '../lib/statements/derived'
import type { StatementsData, PeriodStatement } from '../lib/statements/types'
import { evaluateDerivedGate, toRawDerivedValue, formatDerivedValue } from '../lib/backtest/fundamental'
import { parseDerivedFilters } from '../lib/report/validate'

let pass = 0, fail = 0
function ok(cond: boolean, msg: string) {
  if (cond) { pass++; console.log('  PASS', msg) } else { fail++; console.log('  FAIL', msg) }
}
function near(a: number | undefined, b: number, eps = 1e-6) {
  return a !== undefined && Math.abs(a - b) < eps
}

function mk(periods: Partial<PeriodStatement>[]): StatementsData {
  return {
    symbol: 'TEST', currency: 'USD', periodType: 'annual', source: 'test',
    periods: periods.map((p, i) => ({ endDate: `202${i}-12-31`, ...p })),
  }
}

console.log('computeDerived — growth / margins / streaks / quality')
{
  // 4 periods: revenue 100→110→121→133.1 (10% YoY), op income 10→12→15→18
  const st = mk([
    { totalRevenue: 100, operatingIncome: 10, netIncome: 8, dilutedEps: 1, freeCashFlow: 5, operatingCashFlow: 9 },
    { totalRevenue: 110, operatingIncome: 13, netIncome: 9, dilutedEps: 1.2, freeCashFlow: 6, operatingCashFlow: 10 },
    { totalRevenue: 121, operatingIncome: 16, netIncome: 11, dilutedEps: 1.4, freeCashFlow: 7, operatingCashFlow: 12 },
    { totalRevenue: 133.1, operatingIncome: 20, netIncome: 14, dilutedEps: 1.6, freeCashFlow: 8, operatingCashFlow: 16,
      stockholdersEquity: 70, totalAssets: 175, totalDebt: 40, cash: 10, ebitda: 25 },
  ])
  const d = computeDerived(st)
  ok(near(d.revenueCagr3y, Math.pow(133.1 / 100, 1 / 3) - 1), 'revenueCagr3y ≈ 10%')
  ok(near(d.revenueYoy, 133.1 / 121 - 1), 'revenueYoy')
  ok(near(d.operatingMarginLatest, 20 / 133.1), 'operatingMarginLatest = 20/133.1')
  ok(d.operatingMarginRisingStreak === 3, `opMargin rising streak = 3 (got ${d.operatingMarginRisingStreak})`)
  ok(near(d.fcfMargin, 8 / 133.1), 'fcfMargin = 8/133.1')
  ok(d.fcfPositiveYears === 4, 'fcfPositiveYears = 4')
  ok(near(d.profitQuality, 16 / 14), 'profitQuality = OCF/net = 16/14')
  ok(near(d.roeLatest, 14 / 70), 'roeLatest = 14/70')
  ok(near(d.equityRatio, 70 / 175), 'equityRatio = 70/175')
  ok(near(d.netDebtToEbitda, (40 - 10) / 25), 'netDebtToEbitda = (40-10)/25')
  ok(near(d.epsCagr3y, Math.pow(1.6 / 1, 1 / 3) - 1), 'epsCagr3y (1→1.6)')
}

console.log('computeDerived — missing data ⇒ metric absent (undefined)')
{
  const st = mk([{ totalRevenue: 100 }, { totalRevenue: 110 }]) // only 2 periods, no op/net/eps/fcf
  const d = computeDerived(st)
  ok(d.revenueCagr3y === undefined, 'revenueCagr3y undefined (<4 periods)')
  ok(d.operatingMarginLatest === undefined, 'operatingMarginLatest undefined (no opIncome)')
  ok(d.profitQuality === undefined, 'profitQuality undefined (no net income)')
  ok(near(d.revenueYoy, 110 / 100 - 1), 'revenueYoy still computed')
}

console.log('computeDerived — negative EPS ⇒ epsCagr3y undefined (not NaN)')
{
  const st = mk([{ dilutedEps: -1, totalRevenue: 1 }, { dilutedEps: 0.5, totalRevenue: 1 }, { dilutedEps: 1, totalRevenue: 1 }, { dilutedEps: 2, totalRevenue: 1 }])
  const d = computeDerived(st)
  ok(d.epsCagr3y === undefined, 'epsCagr3y undefined when a bound is <= 0')
}

console.log('evaluateDerivedGate — pass / fail / no_data / AND')
{
  const derived = { revenueCagr3y: 0.12, operatingMarginRisingStreak: 3 }
  const g1 = evaluateDerivedGate(derived, [{ metric: 'revenueCagr3y', operator: 'gte', value: 0.10 }])
  ok(g1.passed && g1.evaluations[0].result === 'pass', '12% ≥ 10% → pass')
  const g2 = evaluateDerivedGate(derived, [{ metric: 'revenueCagr3y', operator: 'gte', value: 0.20 }])
  ok(!g2.passed && g2.evaluations[0].result === 'fail', '12% ≥ 20% → fail')
  const g3 = evaluateDerivedGate(derived, [{ metric: 'fcfMargin', operator: 'gt', value: 0.1 }])
  ok(!g3.passed && g3.evaluations[0].result === 'no_data', 'missing metric → no_data (fail-closed)')
  const g4 = evaluateDerivedGate(derived, [])
  ok(g4.passed, '0 filters ⇒ passed=true')
  const g5 = evaluateDerivedGate(derived, [
    { metric: 'revenueCagr3y', operator: 'gte', value: 0.10 },
    { metric: 'operatingMarginRisingStreak', operator: 'gte', value: 2 },
  ])
  ok(g5.passed, 'AND of two passing filters → pass')
}

console.log('unit conversion + validation')
{
  ok(near(toRawDerivedValue('revenueCagr3y', 10), 0.10), 'percent metric: 10 → 0.10')
  ok(toRawDerivedValue('profitQuality', 1.2) === 1.2, 'ratio metric: 1.2 as-is')
  ok(toRawDerivedValue('fcfPositiveYears', 5) === 5, 'count metric: 5 as-is')
  ok(formatDerivedValue('operatingMarginLatest', 0.153) === '15.30%', 'format percent')
  ok(formatDerivedValue('profitQuality', 1.234) === '1.23x', 'format ratio')
  ok(formatDerivedValue('fcfPositiveYears', 5) === '5', 'format count')
  ok(parseDerivedFilters([]).length === 0, 'empty derivedFilters ok')
  ok(parseDerivedFilters(undefined).length === 0, 'undefined derivedFilters → []')
  let threw = false
  try { parseDerivedFilters([{ metric: 'bogus', operator: 'gt', value: 1 }]) } catch { threw = true }
  ok(threw, 'unknown derived metric → ValidationError')
  threw = false
  try { parseDerivedFilters([{ metric: 'roeLatest', operator: 'gt', value: 'x' }]) } catch { threw = true }
  ok(threw, 'non-numeric value → ValidationError')
}

console.log(`\n${fail === 0 ? 'OK' : 'FAILED'}: ${pass} passed, ${fail} failed (/report R2 earnings layer)`)
process.exit(fail === 0 ? 0 : 1)
