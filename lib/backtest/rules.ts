// Technical condition evaluators.
//
// Reuses calcMA / calcRSI / calcMACD / calcBB from lib/technicals (does NOT
// reimplement indicators). `ma_cross` behaviour is unchanged from lab slice 1;
// `rsi_reversal` / `macd_cross` / `bb_break` were ADDED for the /report slice.

import type { HistoricalBar } from '@/types'
import { calcMA, calcRSI, calcMACD, calcBB } from '@/lib/technicals'
import type { TechnicalCondition } from './types'

export interface DailySignal {
  /** Unix seconds, aligned 1:1 with the input bars. */
  time: number
  signal: 'buy' | 'sell' | 'hold'
}

type SignalValue = DailySignal['signal']

/**
 * Evaluate a technical condition against daily bars.
 *
 * All rules are cross-based: a signal fires only when the relevant value moves
 * from one side of a threshold/line to the other between consecutive bars, so
 * nothing fires on the first bar or before the indicator warm-up completes.
 *
 * Returns one signal per input bar, in the same order.
 */
export function evaluateTechnical(
  bars: HistoricalBar[],
  condition: TechnicalCondition,
): DailySignal[] {
  switch (condition.indicator) {
    case 'ma_cross':      return evaluateMaCross(bars, condition.period)
    case 'rsi_reversal':  return evaluateRsiReversal(bars, condition.period)
    case 'macd_cross':    return evaluateMacdCross(bars)
    case 'bb_break':      return evaluateBbBreak(bars, condition.period)
    default: {
      const never: never = condition
      throw new Error(`Unsupported technical indicator: ${JSON.stringify(never)}`)
    }
  }
}

// ── ma_cross（lab slice 1 の挙動そのまま・不変）───────────────────────────
// Close crossing ABOVE its MA => 'buy'; crossing BELOW => 'sell'.
function evaluateMaCross(bars: HistoricalBar[], period: number): DailySignal[] {
  const ma = calcMA(bars, period)
  const maByTime = new Map<number, number>()
  for (const p of ma) maByTime.set(p.time, p.value)

  const signals: DailySignal[] = []
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    const prev = bars[i - 1]
    const maNow = maByTime.get(bar.time)
    const maPrev = prev ? maByTime.get(prev.time) : undefined

    let signal: SignalValue = 'hold'
    if (prev && maNow !== undefined && maPrev !== undefined) {
      const crossedUp = prev.close <= maPrev && bar.close > maNow
      const crossedDown = prev.close >= maPrev && bar.close < maNow
      if (crossedUp) signal = 'buy'
      else if (crossedDown) signal = 'sell'
    }
    signals.push({ time: bar.time, signal })
  }
  return signals
}

// ── rsi_reversal ──────────────────────────────────────────────────────────
// Mean reversion: RSI recovering from oversold (crosses back above 30) => buy;
// RSI falling out of overbought (crosses back below 70) => sell.
function evaluateRsiReversal(bars: HistoricalBar[], period: number): DailySignal[] {
  const OVERSOLD = 30
  const OVERBOUGHT = 70

  const rsi = calcRSI(bars, period)
  const rsiByTime = new Map<number, number>()
  for (const p of rsi) rsiByTime.set(p.time, p.value)

  const signals: DailySignal[] = []
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    const prev = bars[i - 1]
    const now = rsiByTime.get(bar.time)
    const before = prev ? rsiByTime.get(prev.time) : undefined

    let signal: SignalValue = 'hold'
    if (now !== undefined && before !== undefined) {
      if (before <= OVERSOLD && now > OVERSOLD) signal = 'buy'
      else if (before >= OVERBOUGHT && now < OVERBOUGHT) signal = 'sell'
    }
    signals.push({ time: bar.time, signal })
  }
  return signals
}

// ── macd_cross ────────────────────────────────────────────────────────────
// MACD line crossing above its signal line => buy; crossing below => sell.
// Fixed 12/26/9 parameters from calcMACD.
function evaluateMacdCross(bars: HistoricalBar[]): DailySignal[] {
  const macd = calcMACD(bars)
  const histByTime = new Map<number, number>()
  for (const p of macd) histByTime.set(p.time, p.histogram) // histogram = macd - signal

  const signals: DailySignal[] = []
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    const prev = bars[i - 1]
    const now = histByTime.get(bar.time)
    const before = prev ? histByTime.get(prev.time) : undefined

    let signal: SignalValue = 'hold'
    if (now !== undefined && before !== undefined) {
      if (before <= 0 && now > 0) signal = 'buy'
      else if (before >= 0 && now < 0) signal = 'sell'
    }
    signals.push({ time: bar.time, signal })
  }
  return signals
}

// ── bb_break ──────────────────────────────────────────────────────────────
// Breakout: close crossing ABOVE the upper band => buy; close crossing BELOW
// the lower band => sell. Bands are period-SMA ± 2σ (calcBB default stdDev=2).
function evaluateBbBreak(bars: HistoricalBar[], period: number): DailySignal[] {
  const bb = calcBB(bars, period)
  const bandByTime = new Map<number, { upper: number; lower: number }>()
  for (const p of bb) bandByTime.set(p.time, { upper: p.upper, lower: p.lower })

  const signals: DailySignal[] = []
  for (let i = 0; i < bars.length; i++) {
    const bar = bars[i]
    const prev = bars[i - 1]
    const now = bandByTime.get(bar.time)
    const before = prev ? bandByTime.get(prev.time) : undefined

    let signal: SignalValue = 'hold'
    if (prev && now && before) {
      const brokeUp = prev.close <= before.upper && bar.close > now.upper
      const brokeDown = prev.close >= before.lower && bar.close < now.lower
      if (brokeUp) signal = 'buy'
      else if (brokeDown) signal = 'sell'
    }
    signals.push({ time: bar.time, signal })
  }
  return signals
}
