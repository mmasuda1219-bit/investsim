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
  TechnicalCondition,
} from './types'

/**
 * Thrown when the symbol's real history is empty or too short for the chosen
 * rule (delisted / brand-new listing / bad ticker). Distinguishable from a
 * data-FETCH failure so API routes can answer 422 instead of 502.
 */
export class BacktestDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BacktestDataError'
  }
}

/**
 * Minimum daily bars needed for the rule's indicator warm-up plus at least one
 * bar where a cross can actually be detected. Guard only — signal behaviour
 * for sufficient data is unchanged.
 */
function minBarsFor(condition: TechnicalCondition): number {
  switch (condition.indicator) {
    case 'ma_cross':     return condition.period + 2
    case 'rsi_reversal': return condition.period + 2
    case 'bb_break':     return condition.period + 2
    case 'macd_cross':   return 26 + 9 + 2 // slow EMA + signal EMA warm-up
    case 'ma_cross_dual': return condition.longPeriod + 2
    case 'hl_break':     return condition.period + 3  // channel starts at bar[period], cross needs one more
    case 'stoch_cross':  return condition.period + 5  // + kSmooth(3) + dPeriod(3) - 2 warm-up, +1 for cross
    case 'roc_signal':   return condition.period + 3  // first ROC at bar[period], cross needs one more
  }
}

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
    throw new BacktestDataError(
      `銘柄「${symbol}」の価格履歴を取得できませんでした。ティッカーシンボル（例: AAPL, 7203.T）が正しいか確認してください。`,
    )
  }
  const minBars = minBarsFor(condition)
  if (bars.length < minBars) {
    throw new BacktestDataError(
      `銘柄「${symbol}」は履歴データが不足しています（${bars.length}本 / このルールには${minBars}本以上必要）。上場して間もない銘柄の可能性があります。`,
    )
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
