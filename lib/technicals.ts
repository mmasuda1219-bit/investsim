import type { HistoricalBar } from '@/types'

export interface LinePoint { time: number; value: number }
export interface BBPoint   { time: number; upper: number; middle: number; lower: number }
export interface MACDPoint { time: number; macd: number; signal: number; histogram: number }

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
