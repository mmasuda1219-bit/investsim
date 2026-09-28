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
import { readChartTheme, SERIES, lineStyleOf, fade, type SeriesStyle } from '@/components/chartTheme'

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

/** SERIES の見た目（色・線の形・太さ）を lightweight-charts の LineSeries の指定に直す */
const lineOpts = (s: SeriesStyle) => ({
  color: s.color,
  lineWidth: s.width,
  lineStyle: lineStyleOf(s) as LineStyle,
  priceLineVisible: false,
  lastValueVisible: false,
})

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

    // 面・文字・線は globals.css の :root を実行時に読む（chartTheme.readChartTheme）。
    // lightweight-charts は canvas に描くため 'var(--ink)' の文字列は解釈できない。
    // 系列色は chartTheme.SERIES が正（DESIGN.md §5-1・§6-14）。
    const th = readChartTheme()
    const baseOpts = {
      layout: { background: { type: ColorType.Solid, color: th.background }, textColor: th.text },
      // グリッドは --border をそのまま（薄めない: §6-14）
      grid: { vertLines: { color: th.grid }, horzLines: { color: th.grid } },
      rightPriceScale: { borderColor: th.border },
      timeScale: { borderColor: th.border, timeVisible: true, secondsVisible: false },
    }

    const t = (v: number) => v as unknown as Time

    // ── Main Chart ──────────────────────────────────────────────────
    const chart = createChart(containerRef.current, {
      ...baseOpts, crosshair: { mode: CrosshairMode.Normal },
      width: containerRef.current.clientWidth, height,
    })

    // ローソク足の上げ下げは緑赤で塗り分けない（DECISIONS 2026-09-24「損益から色を外す」・DESIGN §6-4）。
    // 上げ＝中空（面は --card 相当の薄い面。fade(--ink, .10)）／下げ＝--ink の塗り。向きは塗りの有無で読む。
    // th.background（--card、α .035）そのままだとグリッドが透けてほぼ見えないので、面はもう少し濃い薄塗りにする。
    // priceLineColor は明示指定が必須（SV1c W1）: lightweight-charts 5.2 は既定で「priceLineColor が無ければ
    // 最終足の barColor」を使うため、最終足が上げ足だと横線と価格軸ラベルがほぼ消えていた。--muted で固定する。
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: fade(th.ink, 0.10), downColor: th.ink,
      borderUpColor: th.ink, borderDownColor: th.ink,
      wickUpColor: th.ink, wickDownColor: th.ink,
      priceLineColor: th.muted,
    })
    candles.setData(data.map(d => ({ time: t(d.time), open: d.open, high: d.high, low: d.low, close: d.close })))

    if (earningsDates.length > 0) {
      createSeriesMarkers(candles, earningsDates.map(ts => ({
        time: t(ts), position: 'aboveBar' as const,
        color: SERIES.earnings.color, shape: 'arrowDown' as const, text: '決算',
      })))
    }

    if (indicators.ma20) {
      chart.addSeries(LineSeries, lineOpts(SERIES.ma20))
        .setData(calcMA(data, 20).map(p => ({ time: t(p.time), value: p.value })))
    }
    if (indicators.ma50) {
      chart.addSeries(LineSeries, lineOpts(SERIES.ma50))
        .setData(calcMA(data, 50).map(p => ({ time: t(p.time), value: p.value })))
    }
    if (indicators.ma200) {
      chart.addSeries(LineSeries, lineOpts(SERIES.ma200))
        .setData(calcMA(data, 200).map(p => ({ time: t(p.time), value: p.value })))
    }
    if (indicators.bb) {
      const bb = calcBB(data)
      // 上下のバンドは band（紫・破線）。中央線は 20 日平均そのものなので MA20 の色を破線にして重ねる
      chart.addSeries(LineSeries, lineOpts(SERIES.band)).setData(bb.map(p => ({ time: t(p.time), value: p.upper })))
      chart.addSeries(LineSeries, { ...lineOpts(SERIES.ma20), lineStyle: LineStyle.Dashed }).setData(bb.map(p => ({ time: t(p.time), value: p.middle })))
      chart.addSeries(LineSeries, lineOpts(SERIES.band)).setData(bb.map(p => ({ time: t(p.time), value: p.lower })))
    }

    chart.timeScale().fitContent()
    chartRef.current = chart

    // ── RSI Chart ───────────────────────────────────────────────────
    if (indicators.rsi && rsiContainerRef.current) {
      const rsiChart = createChart(rsiContainerRef.current, {
        ...baseOpts, width: rsiContainerRef.current.clientWidth, height: 120,
        crosshair: { mode: CrosshairMode.Normal },
        timeScale: { ...baseOpts.timeScale, visible: false },
      })
      const rsiData = calcRSI(data)
      rsiChart.addSeries(LineSeries, lineOpts(SERIES.rsi))
        .setData(rsiData.map(p => ({ time: t(p.time), value: p.value })))
      if (rsiData.length > 0) {
        // 70/30 の目安は補助線＝--muted の破線（旧: 赤/緑。DESIGN §4 P8 違反だったので廃止）。
        // LineSeries のままにしているのは、縦軸の範囲に 70/30 を必ず含めるため（priceLine では範囲に入らない）
        const dOpts = { color: th.muted, lineWidth: 1, lineStyle: LineStyle.Dashed, priceLineVisible: false, lastValueVisible: false } as const
        rsiChart.addSeries(LineSeries, dOpts).setData(rsiData.map(p => ({ time: t(p.time), value: 70 })))
        rsiChart.addSeries(LineSeries, dOpts).setData(rsiData.map(p => ({ time: t(p.time), value: 30 })))
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
      macdChart.addSeries(LineSeries, lineOpts(SERIES.macd))
        .setData(macdData.map(p => ({ time: t(p.time), value: p.macd })))
      macdChart.addSeries(LineSeries, lineOpts(SERIES.signal))
        .setData(macdData.map(p => ({ time: t(p.time), value: p.signal })))
      // ヒストグラムの正負は緑赤ではなく --ink 系の明るさの差で表す（DECISIONS 2026-09-24）:
      // ゼロ基準線から上＝--ink の塗り、下＝--muted（--ink の 55%）の塗り。HistogramSeries には
      // 「輪郭だけ」の描き方が無いので、明るさの差で向きを分ける。基準線は --muted の破線
      const hist = macdChart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false, base: 0 })
      hist.setData(macdData.map(p => ({ time: t(p.time), value: p.histogram, color: p.histogram >= 0 ? th.ink : th.muted })))
      hist.createPriceLine({ price: 0, color: th.muted, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: '' })
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

  // 図の名前は文字なので系列色を使わない（DESIGN §5-1「系列色は文字には使わない」）→ --muted
  return (
    <div className="w-full rounded-lg overflow-hidden space-y-0">
      <div ref={containerRef} className="w-full" />
      {indicators.rsi && (
        <div className="relative w-full">
          <span className="absolute top-1 left-2 z-10 text-xs text-muted font-medium pointer-events-none">RSI(14)</span>
          <div ref={rsiContainerRef} className="w-full" />
        </div>
      )}
      {indicators.macd && (
        <div className="relative w-full">
          <span className="absolute top-1 left-2 z-10 text-xs text-muted font-medium pointer-events-none">MACD</span>
          <div ref={macdContainerRef} className="w-full" />
        </div>
      )}
    </div>
  )
}
