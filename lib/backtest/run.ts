// Backtest driver (slice 1).
//
// Fetches REAL daily bars via lib/market with allowMock:false, so a data-fetch
// failure throws instead of silently falling back to mock data (COMPANY.md
// principle 9). Then evaluates the technical condition day by day, runs a
// simple all-in virtual trading loop, and returns a self-contained result.

import { getHistory } from '@/lib/market'
import { evaluateTechnical } from './rules'
import { computeMetrics } from './metrics'
import type {
  BacktestParams,
  BacktestResult,
  EquityPoint,
  BacktestTrade,
} from './types'

/** Native currency of the instrument, derived like the Yahoo provider does. */
function currencyOf(symbol: string): string {
  return symbol.endsWith('.T') ? 'JPY' : 'USD'
}

/**
 * Run one backtest. Slice 1 supports technical conditions only; fundamental
 * conditions throw (their evaluator arrives in a later slice).
 *
 * Trading model: when a 'buy' signal fires and we are flat, go all-in with
 * fractional virtual shares; when a 'sell' signal fires and we hold, exit fully.
 * Equity is marked to market on every bar with that bar's close.
 */
export async function runBacktest(params: BacktestParams): Promise<BacktestResult> {
  const { symbol, condition, initialCapital } = params

  if (condition.type !== 'technical') {
    throw new Error('Slice 1 supports technical conditions only')
  }

  // Real data, 1-year daily bars. getHistory('1y') maps to range=1y interval=1d.
  // allowMock:false => throw on fetch failure rather than returning fake data.
  const rawBars = await getHistory(symbol, '1y', { allowMock: false })
  // Guard against bad/zero/non-finite closes so NaN/Infinity can't propagate
  // into share sizing, the equity curve, or the metrics.
  const bars = rawBars.filter(b => Number.isFinite(b.close) && b.close > 0)
  if (bars.length === 0) {
    throw new Error(`No historical data available for ${symbol}`)
  }

  const signals = evaluateTechnical(bars, condition)

  let cash = initialCapital
  let shares = 0
  const trades: BacktestTrade[] = []
  const equityCurve: EquityPoint[] = []

  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    const sig = signals[i].signal

    if (sig === 'buy' && shares === 0 && cash > 0) {
      shares = cash / bar.close // fractional virtual shares, all-in
      trades.push({ time: bar.time, action: 'buy', price: bar.close, shares, value: cash })
      cash = 0
    } else if (sig === 'sell' && shares > 0) {
      const value = shares * bar.close
      trades.push({ time: bar.time, action: 'sell', price: bar.close, shares, value })
      cash = value
      shares = 0
    }

    equityCurve.push({ time: bar.time, value: cash + shares * bar.close, price: bar.close })
  }

  const finalValue = equityCurve[equityCurve.length - 1].value

  return {
    symbol,
    currency: currencyOf(symbol),
    period: '1y',
    condition,
    initialCapital,
    finalValue,
    startDate: bars[0].time,
    endDate: bars[bars.length - 1].time,
    equityCurve,
    trades,
    metrics: computeMetrics(equityCurve, trades),
  }
}
