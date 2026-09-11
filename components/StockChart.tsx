'use client'

import { useEffect, useRef } from 'react'
import {
  createChart, createSeriesMarkers,
  CandlestickSeries, LineSeries, HistogramSeries,
  ColorType, CrosshairMode, LineStyle,
  type IChartApi, type Time,
} from 'lightweight-charts'
import type { HistoricalBar } from '@/types'
import { calcMA, calcBB, calcRSI, calcMACD } from '@/lib/technicals'

export interface Indicators {
  ma20?: boolean; ma50?: boolean; ma200?: boolean
  bb?: boolean; rsi?: boolean; macd?: boolean
}

interface Props {
  data: HistoricalBar[]
  height?: number
  indicators?: Indicators
  earningsDates?: number[]
}

export function StockChart({ data, height = 420, indicators = {}, earningsDates = [] }: Props) {
  const containerRef     = useRef<HTMLDivElement>(null)
  const rsiContainerRef  = useRef<HTMLDivElement>(null)
  const macdContainerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)
  const rsiChartRef  = useRef<IChartApi | null>(null)
  const macdChartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    // Cleanup previous
    chartRef.current?.remove(); chartRef.current = null
    rsiChartRef.current?.remove(); rsiChartRef.current = null
    macdChartRef.current?.remove(); macdChartRef.current = null

    const baseOpts = {
      layout: { background: { type: ColorType.Solid, color: '#FFFFFF' }, textColor: '#6B6862' },
      grid: { vertLines: { color: '#EFECE3' }, horzLines: { color: '#EFECE3' } },
      rightPriceScale: { borderColor: '#D6D0C3' },
      timeScale: { borderColor: '#D6D0C3', timeVisible: true, secondsVisible: false },
    }

    const t = (v: number) => v as unknown as Time

    // ローソク足の上げ/下げは損益なので --success / --danger を使う（DESIGN.md §6-4）。
    // lightweight-charts は canvas に描くため 'var(--success)' の文字列は解釈できない。
    // :root の値を getComputedStyle で読み出して渡す（フォールバックは同じ値の直書き）。
    const cssVar = (name: string, fallback: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback
    const upColor = cssVar('--success', '#177A4F')
    const downColor = cssVar('--danger', '#C03535')

    // ── Main Chart ──────────────────────────────────────────────────
    const chart = createChart(containerRef.current, {
      ...baseOpts, crosshair: { mode: CrosshairMode.Normal },
      width: containerRef.current.clientWidth, height,
    })

    const candles = chart.addSeries(CandlestickSeries, {
      upColor, downColor,
      borderUpColor: upColor, borderDownColor: downColor,
      wickUpColor: upColor, wickDownColor: downColor,
    })
    candles.setData(data.map(d => ({ time: t(d.time), open: d.open, high: d.high, low: d.low, close: d.close })))

    if (earningsDates.length > 0) {
      createSeriesMarkers(candles, earningsDates.map(ts => ({
        time: t(ts), position: 'aboveBar' as const,
        color: '#B45309', shape: 'arrowDown' as const, text: '決算',
      })))
    }

    if (indicators.ma20) {
      const s = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      s.setData(calcMA(data, 20).map(p => ({ time: t(p.time), value: p.value })))
    }
    if (indicators.ma50) {
      const s = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      s.setData(calcMA(data, 50).map(p => ({ time: t(p.time), value: p.value })))
    }
    if (indicators.ma200) {
      const s = chart.addSeries(LineSeries, { color: '#ef4444', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
      s.setData(calcMA(data, 200).map(p => ({ time: t(p.time), value: p.value })))
    }
    if (indicators.bb) {
      const bb = calcBB(data)
      const opts = { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false } as const
      chart.addSeries(LineSeries, { color: '#8b5cf6', ...opts }).setData(bb.map(p => ({ time: t(p.time), value: p.upper })))
      chart.addSeries(LineSeries, { color: '#3b82f6', ...opts }).setData(bb.map(p => ({ time: t(p.time), value: p.middle })))
      chart.addSeries(LineSeries, { color: '#8b5cf6', ...opts }).setData(bb.map(p => ({ time: t(p.time), value: p.lower })))
    }

    chart.timeScale().fitContent()
    chartRef.current = chart

    // ── RSI Chart ───────────────────────────────────────────────────
    // 以下の RSI 70/30 線・MACD ヒストグラムの #22c55e/#ef4444 は chartTheme スライスで一括して差し替える（今回は触らない）
    if (indicators.rsi && rsiContainerRef.current) {
      const rsiChart = createChart(rsiContainerRef.current, {
        ...baseOpts, width: rsiContainerRef.current.clientWidth, height: 120,
        crosshair: { mode: CrosshairMode.Normal },
        timeScale: { ...baseOpts.timeScale, visible: false },
      })
      const rsiData = calcRSI(data)
      rsiChart.addSeries(LineSeries, { color: '#8b5cf6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(rsiData.map(p => ({ time: t(p.time), value: p.value })))
      if (rsiData.length > 0) {
        const dOpts = { lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false } as const
        rsiChart.addSeries(LineSeries, { color: '#ef4444', ...dOpts }).setData(rsiData.map(p => ({ time: t(p.time), value: 70 })))
        rsiChart.addSeries(LineSeries, { color: '#22c55e', ...dOpts }).setData(rsiData.map(p => ({ time: t(p.time), value: 30 })))
      }
      rsiChart.timeScale().fitContent()
      rsiChartRef.current = rsiChart
      chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) rsiChart.timeScale().setVisibleLogicalRange(r) })
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) chart.timeScale().setVisibleLogicalRange(r) })
    }

    // ── MACD Chart ──────────────────────────────────────────────────
    if (indicators.macd && macdContainerRef.current) {
      const macdChart = createChart(macdContainerRef.current, {
        ...baseOpts, width: macdContainerRef.current.clientWidth, height: 100,
        crosshair: { mode: CrosshairMode.Normal },
        timeScale: { ...baseOpts.timeScale, visible: false },
      })
      const macdData = calcMACD(data)
      macdChart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(macdData.map(p => ({ time: t(p.time), value: p.macd })))
      macdChart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false })
        .setData(macdData.map(p => ({ time: t(p.time), value: p.signal })))
      macdChart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false })
        .setData(macdData.map(p => ({ time: t(p.time), value: p.histogram, color: p.histogram >= 0 ? '#22c55e' : '#ef4444' })))
      macdChart.timeScale().fitContent()
      macdChartRef.current = macdChart
      chart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) macdChart.timeScale().setVisibleLogicalRange(r) })
      macdChart.timeScale().subscribeVisibleLogicalRangeChange(r => { if (r) chart.timeScale().setVisibleLogicalRange(r) })
    }

    const handleResize = () => {
      if (containerRef.current)     chartRef.current?.applyOptions({ width: containerRef.current.clientWidth })
      if (rsiContainerRef.current)  rsiChartRef.current?.applyOptions({ width: rsiContainerRef.current.clientWidth })
      if (macdContainerRef.current) macdChartRef.current?.applyOptions({ width: macdContainerRef.current.clientWidth })
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chartRef.current?.remove(); chartRef.current = null
      rsiChartRef.current?.remove(); rsiChartRef.current = null
      macdChartRef.current?.remove(); macdChartRef.current = null
    }
  }, [data, height, indicators, earningsDates])

  return (
    <div className="w-full rounded-lg overflow-hidden space-y-0">
      <div ref={containerRef} className="w-full" />
      {indicators.rsi && (
        <div className="relative w-full">
          <span className="absolute top-1 left-2 z-10 text-xs text-purple-700 font-medium pointer-events-none">RSI(14)</span>
          <div ref={rsiContainerRef} className="w-full" />
        </div>
      )}
      {indicators.macd && (
        <div className="relative w-full">
          <span className="absolute top-1 left-2 z-10 text-xs text-blue-700 font-medium pointer-events-none">MACD</span>
          <div ref={macdContainerRef} className="w-full" />
        </div>
      )}
    </div>
  )
}
