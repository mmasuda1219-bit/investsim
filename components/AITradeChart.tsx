'use client'

import { useEffect, useRef } from 'react'
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type Time,
} from 'lightweight-charts'
import { calcMA } from '@/lib/technicals'
import type { HistoricalBar } from '@/types'

export interface TradeMarker {
  time:      number
  action:    'buy' | 'sell'
  price:     number
  shares:    number
  total:     number
  reason:    string
  timestamp: string
}

interface Props {
  data:    HistoricalBar[]
  trades:  TradeMarker[]
  height?: number
  symbol:  string
}

export function AITradeChart({ data, trades, height = 380, symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current || data.length === 0) return

    chartRef.current?.remove()
    chartRef.current = null

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0f1e' },
        textColor: '#94a3b8',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: {
        borderColor: '#334155',
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      width:  containerRef.current.clientWidth,
      height,
    })

    const candles = chart.addSeries(CandlestickSeries, {
      upColor:        '#22c55e',
      downColor:      '#ef4444',
      borderUpColor:  '#22c55e',
      borderDownColor:'#ef4444',
      wickUpColor:    '#22c55e',
      wickDownColor:  '#ef4444',
    })
    candles.setData(
      data.map(d => ({
        time:  d.time as unknown as Time,
        open:  d.open,
        high:  d.high,
        low:   d.low,
        close: d.close,
      }))
    )

    const ma20data = calcMA(data, 20)
    const ma20series = chart.addSeries(LineSeries, {
      color: '#3b82f6', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
    })
    ma20series.setData(ma20data.map(p => ({ time: p.time as unknown as Time, value: p.value })))

    const ma50data = calcMA(data, 50)
    const ma50series = chart.addSeries(LineSeries, {
      color: '#f59e0b', lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
    })
    ma50series.setData(ma50data.map(p => ({ time: p.time as unknown as Time, value: p.value })))

    if (trades.length > 0) {
      const markers = trades
        .map(t => ({
          time:     t.time as unknown as Time,
          position: t.action === 'buy' ? 'belowBar' as const : 'aboveBar' as const,
          color:    t.action === 'buy' ? '#22c55e' : '#ef4444',
          shape:    t.action === 'buy' ? 'arrowUp' as const : 'arrowDown' as const,
          text:     t.action === 'buy' ? `B $${t.price.toFixed(0)}` : `S $${t.price.toFixed(0)}`,
        }))
        .sort((a, b) => String(a.time).localeCompare(String(b.time)))
      createSeriesMarkers(candles, markers)
    }

    chart.timeScale().fitContent()
    chartRef.current = chart

    const handleResize = () => {
      if (containerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: containerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chartRef.current?.remove()
      chartRef.current = null
    }
  }, [data, trades, height, symbol])

  return (
    <div className="w-full rounded-lg overflow-hidden relative">
      <div className="absolute top-2 left-3 z-10 flex items-center gap-3 pointer-events-none">
        <span className="text-xs font-bold text-white bg-black/40 px-2 py-0.5 rounded">{symbol}</span>
        <span className="flex items-center gap-1 text-xs text-blue-400">
          <span className="w-3 h-0.5 bg-blue-400 inline-block" /> MA20
        </span>
        <span className="flex items-center gap-1 text-xs text-yellow-400">
          <span className="w-3 h-0.5 bg-yellow-400 inline-block" /> MA50
        </span>
        <span className="flex items-center gap-1 text-xs text-green-400">▲ 買い</span>
        <span className="flex items-center gap-1 text-xs text-red-400">▼ 売り</span>
      </div>
      <div ref={containerRef} className="w-full" />
    </div>
  )
}
