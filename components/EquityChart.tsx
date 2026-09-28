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
import { readChartTheme, SERIES, lineStyleOf } from '@/components/chartTheme'

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

    // 面・文字・線は globals.css の :root を実行時に読む（chartTheme.readChartTheme）。系列色は SERIES が正
    const th = readChartTheme()
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: th.background },
        textColor: th.text,
      },
      grid: {
        vertLines: { color: th.grid },
        horzLines: { color: th.grid },
      },
      rightPriceScale: { borderColor: th.border },
      timeScale: { borderColor: th.border, timeVisible: true },
      width:  containerRef.current.clientWidth,
      height,
    })

    // AI の資産曲線＝「AI」の系列（紫・破線 2px。DESIGN §5-1）。凡例（app/watch/client.tsx）も SERIES.ai から取ること
    const portfolioSeries = chart.addSeries(LineSeries, {
      color: SERIES.ai.color,
      lineWidth: SERIES.ai.width,
      lineStyle: lineStyleOf(SERIES.ai) as LineStyle,
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
      // SPY＝基準（指数）の系列（灰・細い実線 1px）
      const benchSeries = chart.addSeries(LineSeries, {
        color: SERIES.baseline.color,
        lineWidth: SERIES.baseline.width,
        lineStyle: lineStyleOf(SERIES.baseline) as LineStyle,
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

    // 元本＝基準（元本）。指数と同じ灰だが、同じ図で見分けるため点線にする
    const baseSeries = chart.addSeries(LineSeries, {
      color: SERIES.baseline.color,
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
      <div className="flex items-center justify-center text-muted text-base" style={{ height }}>
        Tick を実行するとエクイティカーブが表示されます
      </div>
    )
  }

  return <div ref={containerRef} className="w-full" />
}
