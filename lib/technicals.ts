import type { HistoricalBar } from '@/types'

export interface LinePoint { time: number; value: number }
export interface BBPoint   { time: number; upper: number; middle: number; lower: number }
export interface MACDPoint { time: number; macd: number; signal: number; histogram: number }
export interface StochPoint    { time: number; k: number; d: number }
export interface DonchianPoint { time: number; upper: number; lower: number }

export function calcMA(data: HistoricalBar[], period: number): LinePoint[] {
  const result: LinePoint[] = []
  for (let i = period - 1; i < data.length; i++) {
    const avg = data.slice(i - period + 1, i + 1).reduce((s, b) => s + b.close, 0) / period
    result.push({ time: data[i].time, value: parseFloat(avg.toFixed(2)) })
  }
  return result
}

export function calcRSI(data: HistoricalBar[], period = 14): LinePoint[] {
  if (data.length < period + 1) return []
  const result: LinePoint[] = []
  let gains = 0; let losses = 0
  for (let i = 1; i <= period; i++) {
    const d = data[i].close - data[i - 1].close
    if (d > 0) gains += d; else losses -= d
  }
  let avgGain = gains / period; let avgLoss = losses / period
  for (let i = period; i < data.length; i++) {
    if (i > period) {
      const d = data[i].close - data[i - 1].close
      avgGain = (avgGain * (period - 1) + (d > 0 ? d : 0)) / period
      avgLoss = (avgLoss * (period - 1) + (d < 0 ? -d : 0)) / period
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss
    result.push({ time: data[i].time, value: parseFloat((100 - 100 / (1 + rs)).toFixed(2)) })
  }
  return result
}

export function calcBB(data: HistoricalBar[], period = 20, stdDev = 2): BBPoint[] {
  const result: BBPoint[] = []
  for (let i = period - 1; i < data.length; i++) {
    const slice = data.slice(i - period + 1, i + 1).map(b => b.close)
    const mean = slice.reduce((s, v) => s + v, 0) / period
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period
    const sd = Math.sqrt(variance)
    result.push({
      time: data[i].time,
      upper:  parseFloat((mean + stdDev * sd).toFixed(2)),
      middle: parseFloat(mean.toFixed(2)),
      lower:  parseFloat((mean - stdDev * sd).toFixed(2)),
    })
  }
  return result
}

/**
 * Slow Stochastic %K/%D. Raw %K over kPeriod highs/lows, smoothed by
 * kSmooth-SMA (=slow %K), then dPeriod-SMA of slow %K (=%D).
 * First point appears at bar index (kPeriod + kSmooth + dPeriod - 3).
 */
export function calcStochastic(
  data: HistoricalBar[],
  kPeriod = 14,
  kSmooth = 3,
  dPeriod = 3,
): StochPoint[] {
  if (data.length < kPeriod + kSmooth + dPeriod - 2) return []

  const rawK: LinePoint[] = []
  for (let i = kPeriod - 1; i < data.length; i++) {
    const slice = data.slice(i - kPeriod + 1, i + 1)
    let hh = -Infinity; let ll = Infinity
    for (const b of slice) {
      if (b.high > hh) hh = b.high
      if (b.low < ll) ll = b.low
    }
    const range = hh - ll
    // Flat range (hh === ll): neutral 50 rather than division by zero.
    const k = range === 0 ? 50 : ((data[i].close - ll) / range) * 100
    rawK.push({ time: data[i].time, value: k })
  }

  const sma = (pts: LinePoint[], period: number): LinePoint[] => {
    const out: LinePoint[] = []
    for (let i = period - 1; i < pts.length; i++) {
      const avg = pts.slice(i - period + 1, i + 1).reduce((s, p) => s + p.value, 0) / period
      out.push({ time: pts[i].time, value: avg })
    }
    return out
  }

  const slowK = sma(rawK, kSmooth)
  const dLine = sma(slowK, dPeriod)
  const kByTime = new Map<number, number>()
  for (const p of slowK) kByTime.set(p.time, p.value)

  return dLine.map(p => ({
    time: p.time,
    k: parseFloat((kByTime.get(p.time) ?? p.value).toFixed(2)),
    d: parseFloat(p.value.toFixed(2)),
  }))
}

/** Rate of Change, percent: (close[i] - close[i-period]) / close[i-period] * 100. */
export function calcROC(data: HistoricalBar[], period = 12): LinePoint[] {
  const result: LinePoint[] = []
  for (let i = period; i < data.length; i++) {
    const base = data[i - period].close
    if (base === 0) continue // guard: avoid division by zero on bad bars
    const roc = ((data[i].close - base) / base) * 100
    result.push({ time: data[i].time, value: parseFloat(roc.toFixed(2)) })
  }
  return result
}

/**
 * Donchian channel of the PREVIOUS `period` bars — the value at bar i is the
 * highest high / lowest low of bars [i-period, i-1], deliberately EXCLUDING
 * bar i itself (look-ahead avoidance: "break above the prior N-day high").
 * First point appears at bar index `period`.
 */
export function calcDonchian(data: HistoricalBar[], period = 20): DonchianPoint[] {
  const result: DonchianPoint[] = []
  for (let i = period; i < data.length; i++) {
    let upper = -Infinity; let lower = Infinity
    for (let j = i - period; j < i; j++) { // excludes data[i]
      if (data[j].high > upper) upper = data[j].high
      if (data[j].low < lower) lower = data[j].low
    }
    result.push({
      time: data[i].time,
      upper: parseFloat(upper.toFixed(2)),
      lower: parseFloat(lower.toFixed(2)),
    })
  }
  return result
}

export function calcMACD(data: HistoricalBar[]): MACDPoint[] {
  if (data.length < 35) return []
  function ema(closes: number[], period: number): number[] {
    const k = 2 / (period + 1); const result = [closes[0]]
    for (let i = 1; i < closes.length; i++) result.push(closes[i] * k + result[i - 1] * (1 - k))
    return result
  }
  const closes = data.map(b => b.close)
  const ema12 = ema(closes, 12); const ema26 = ema(closes, 26)
  const macdLine = ema12.map((v, i) => v - ema26[i]).slice(25)
  const signalLine = ema(macdLine, 9)
  return macdLine.map((macd, i) => ({
    time:      data[i + 25].time,
    macd:      parseFloat(macd.toFixed(4)),
    signal:    parseFloat(signalLine[i].toFixed(4)),
    histogram: parseFloat((macd - signalLine[i]).toFixed(4)),
  }))
}
