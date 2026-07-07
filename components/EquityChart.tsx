'use client'

import { useEffect, useRef } from 'react'
import {
  createChart,
  LineSeries,
  LineStyle,
  ColorType,
  type IChartApi,
  type Time,
} from 'lightweight-charts'
import type { EquityPoint } from '@/lib/ai-trader/engine'

interface Props {
  history: EquityPoint[]
  capital: number
  height?: number
}

export function EquityChart({ history, capital, height = 220 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current || history.length < 2) return

    chartRef.current?.remove()
    chartRef.current = null

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: '#0a0f1e' },
        textColor: '#64748b',
      },
      grid: {
        vertLines: { color: '#1e293b' },
        horzLines: { color: '#1e293b' },
      },
      rightPriceScale: { borderColor: '#1e293b' },
      timeScale: { borderColor: '#1e293b', timeVisible: true },
      width:  containerRef.current.clientWidth,
      height,
    })

    const portfolioSeries = chart.addSeries(LineSeries, {
      color: '#22d3ee',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      title: 'AI',
    })

    const portfolioData = history.map(p => ({
      time:  Math.floor(new Date(p.timestamp).getTime() / 1000) as unknown as Time,
      value: p.totalValue,
    }))
    portfolioSeries.setData(portfolioData)

    const hasBenchmark = history.some(p => p.benchmarkPct != null)
    if (hasBenchmark) {
      const benchSeries = chart.addSeries(LineSeries, {
        color: '#475569',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: true,
        title: 'SPY',
      })
      const benchData = history
        .filter(p => p.benchmarkPct != null)
        .map(p => ({
          time:  Math.floor(new Date(p.timestamp).getTime() / 1000) as unknown as Time,
          value: capital * (1 + (p.benchmarkPct! / 100)),
        }))
      benchSeries.setData(benchData)
    }

    const baseSeries = chart.addSeries(LineSeries, {
      color: '#334155',
      lineWidth: 1,
      lineStyle: LineStyle.Dotted,
      priceLineVisible: false,
      lastValueVisible: false,
    })
    baseSeries.setData([
      { time: portfolioData[0].time, value: capital },
      { time: portfolioData[portfolioData.length - 1].time, value: capital },
    ])

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
  }, [history, capital, height])

  if (history.length < 2) {
    return (
      <div className="flex items-center justify-center text-slate-600 text-xs" style={{ height }}>
        Tick を実行するとエクイティカーブが表示されます
      </div>
    )
  }

  return <div ref={containerRef} className="w-full" />
}
