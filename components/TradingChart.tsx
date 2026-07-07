'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createSeriesMarkers,
  IChartApi,
  CandlestickData,
  UTCTimestamp,
  SeriesMarker,
  Time,
  CrosshairMode,
} from 'lightweight-charts'

export interface TradeReference {
  summary: string
  analysis: string
  macroContext?: string
  indicators: {
    name: string
    value: string
    signal: 'bullish' | 'bearish' | 'neutral'
    note: string
  }[]
  sources: {
    title: string
    url?: string
    type: 'filing' | 'news' | 'model' | 'earnings' | 'macro'
  }[]
}

export interface Trade {
  id: string
  symbol: string
  investor: string
  action: 'BUY' | 'SELL'
  date: string
  price: number
  shares: number
  pairedTradeId?: string
  reference?: TradeReference
}

interface Props {
  symbol?: string
  // viewPeriod controls visible range. Data always fetches 10y.
  viewPeriod?: '1y' | '5y' | '10y'
  trades?: Trade[]
  onTradeClick?: (trade: Trade) => void
}

interface OHLCBar extends CandlestickData<UTCTimestamp> {
  volume: number
}

function computePnl(bars: OHLCBar[], trades: Trade[]) {
  const sorted = [...trades].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  )
  const points: { time: UTCTimestamp; value: number }[] = []
  let running = 0
  const open = new Map<string, Trade>()

  for (const t of sorted) {
    if (t.action === 'BUY') {
      open.set(t.id, t)
    } else if (t.action === 'SELL' && t.pairedTradeId) {
      const buy = open.get(t.pairedTradeId)
      if (buy) {
        running += (t.price - buy.price) * t.shares
        points.push({
          time: Math.floor(new Date(t.date).getTime() / 1000) as UTCTimestamp,
          value: running,
        })
        open.delete(t.pairedTradeId)
      }
    }
  }
  return points
}

const DAYS_MAP: Record<string, number> = { '1y': 365, '5y': 365 * 5, '10y': 365 * 10 }

export default function TradingChart({
  symbol = 'AAPL',
  viewPeriod = '10y',
  trades = [],
  onTradeClick,
}: Props) {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const pnlContainerRef = useRef<HTMLDivElement>(null)
  const chartsRef = useRef<{ main: IChartApi; pnl: IChartApi } | null>(null)

  const [bars, setBars] = useState<OHLCBar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [totalPnl, setTotalPnl] = useState(0)
  const [tooltip, setTooltip] = useState<{
    x: number; y: number; date: string
    open: number; high: number; low: number; close: number
    volume: number; change: number; changeP: number
  } | null>(null)

  // Always fetch 10y so user can scroll freely
  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/chart?symbol=${symbol}&period=10y`)
      const data = await res.json()
      if (data.error) throw new Error(data.error)
      setBars(data.quotes as OHLCBar[])
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => { fetchData() }, [fetchData])

  useEffect(() => {
    let pnl = 0
    const buys = new Map(trades.filter((t) => t.action === 'BUY').map((t) => [t.id, t]))
    for (const t of trades.filter((t) => t.action === 'SELL')) {
      if (t.pairedTradeId) {
        const buy = buys.get(t.pairedTradeId)
        if (buy) pnl += (t.price - buy.price) * t.shares
      }
    }
    setTotalPnl(pnl)
  }, [trades])

  // Build / rebuild chart when data changes
  useEffect(() => {
    if (!chartContainerRef.current || !pnlContainerRef.current || bars.length === 0) return

    if (chartsRef.current) {
      try { chartsRef.current.main.remove() } catch { /* disposed */ }
      try { chartsRef.current.pnl.remove() } catch { /* disposed */ }
      chartsRef.current = null
    }

    const chartEl = chartContainerRef.current
    const pnlEl = pnlContainerRef.current

    // ── Main chart ────────────────────────────────────────────────
    const chart = createChart(chartEl, {
      width: chartEl.clientWidth,
      height: 500,
      layout: { background: { color: '#0f1117' }, textColor: '#d1d5db' },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#374151' },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
        rightOffset: 5,
        barSpacing: 6,
        minBarSpacing: 0.1,
      },
    })

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })
    candleSeries.setData(bars)

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    })
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.87, bottom: 0 } })
    volumeSeries.setData(
      bars.map((b) => ({
        time: b.time,
        value: b.volume,
        color: b.close >= b.open ? '#26a69a55' : '#ef535055',
      }))
    )

    // ── Trade markers ─────────────────────────────────────────────
    if (trades.length > 0) {
      const markers: SeriesMarker<Time>[] = trades
        .map((t) => {
          const isBuy = t.action === 'BUY'
          let pnlLabel = ''
          if (!isBuy && t.pairedTradeId) {
            const buy = trades.find((b) => b.id === t.pairedTradeId)
            if (buy) {
              const pnl = (t.price - buy.price) * t.shares
              pnlLabel = ` (${pnl >= 0 ? '+' : ''}$${pnl.toFixed(0)})`
            }
          }
          return {
            time: (Math.floor(new Date(t.date).getTime() / 1000)) as Time,
            position: isBuy ? ('belowBar' as const) : ('aboveBar' as const),
            color: isBuy ? '#26a69a' : '#ef5350',
            shape: isBuy ? ('arrowUp' as const) : ('arrowDown' as const),
            text: `${isBuy ? '▲ BUY' : '▼ SELL'} $${t.price.toFixed(2)} ×${t.shares}${pnlLabel}`,
            size: 2,
          }
        })
        .sort((a, b) => (a.time as number) - (b.time as number))
      createSeriesMarkers(candleSeries, markers)
    }

    // ── Crosshair tooltip ─────────────────────────────────────────
    chart.subscribeCrosshairMove((param) => {
      if (!param.time || !param.point) { setTooltip(null); return }
      const bar = param.seriesData.get(candleSeries) as OHLCBar | undefined
      const vol = param.seriesData.get(volumeSeries) as { value: number } | undefined
      if (!bar) { setTooltip(null); return }
      const idx = bars.findIndex((b) => b.time === param.time)
      const prev = idx > 0 ? bars[idx - 1] : null
      const change = prev ? bar.close - prev.close : 0
      const changeP = prev ? (change / prev.close) * 100 : 0
      const rect = chartEl.getBoundingClientRect()
      setTooltip({
        x: param.point.x + rect.left,
        y: param.point.y + rect.top,
        date: new Date((param.time as number) * 1000).toLocaleDateString('ja-JP'),
        open: bar.open, high: bar.high, low: bar.low, close: bar.close,
        volume: vol?.value ?? 0, change, changeP,
      })
    })

    // ── P&L chart ─────────────────────────────────────────────────
    const pnlChart = createChart(pnlEl, {
      width: pnlEl.clientWidth,
      height: 160,
      layout: { background: { color: '#0f1117' }, textColor: '#d1d5db' },
      grid: { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#374151' },
      timeScale: { borderColor: '#374151', visible: false, barSpacing: 6, minBarSpacing: 0.1 },
    })

    const pnlSeries = pnlChart.addSeries(LineSeries, {
      color: totalPnl >= 0 ? '#26a69a' : '#ef5350',
      lineWidth: 2,
      priceFormat: { type: 'price', precision: 0, minMove: 1 },
    })

    // Anchor P&L data to full bar range so pnlChart can render any visible period
    const pnlData = computePnl(bars, trades)
    const firstTs = bars[0].time
    const lastBarTs = bars[bars.length - 1].time
    const anchoredPnlData = [
      { time: firstTs, value: 0 },
      ...pnlData,
      // keep trailing zero at last bar so pnlChart time range matches main chart
      ...(pnlData.length === 0 || pnlData[pnlData.length - 1].time !== lastBarTs
        ? [{ time: lastBarTs, value: pnlData.length > 0 ? pnlData[pnlData.length - 1].value : 0 }]
        : []),
    ]
    pnlSeries.setData(anchoredPnlData)

    // Sync zoom/scroll: main → pnl only (one-way).
    // Two-way sync breaks when pnl data is sparse — pnl auto-clamps its range
    // and then forcibly resets the main chart's view to the pnl data extent.
    chart.timeScale().subscribeVisibleTimeRangeChange((range) => {
      if (!range) return
      try { pnlChart.timeScale().setVisibleRange(range) } catch { /* ignore */ }
    })

    // Set visible range based on viewPeriod
    const lastTs = bars[bars.length - 1].time as number
    const daysBack = DAYS_MAP[viewPeriod] ?? DAYS_MAP['10y']
    const fromTs = (lastTs - daysBack * 86400) as UTCTimestamp
    chart.timeScale().setVisibleRange({ from: fromTs, to: lastTs as UTCTimestamp })
    pnlChart.timeScale().setVisibleRange({ from: fromTs, to: lastTs as UTCTimestamp })

    // Resize
    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: chartEl.clientWidth })
      pnlChart.applyOptions({ width: pnlEl.clientWidth })
    })
    ro.observe(chartEl)
    ro.observe(pnlEl)

    chartsRef.current = { main: chart, pnl: pnlChart }

    return () => {
      ro.disconnect()
      chartsRef.current = null
      try { chart.remove() } catch { /* disposed */ }
      try { pnlChart.remove() } catch { /* disposed */ }
    }
  // viewPeriod included so chart rebuilds (and resets visible range) on period change
  }, [bars, trades, totalPnl, viewPeriod])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-72 bg-[#0f1117] rounded-xl text-gray-400 animate-pulse">
        チャートデータ読み込み中…
      </div>
    )
  }
  if (error) {
    return (
      <div className="flex items-center justify-center h-72 bg-[#0f1117] rounded-xl text-red-400">
        {error}
      </div>
    )
  }

  const latestBar = bars[bars.length - 1]
  const prevBar = bars[bars.length - 2]
  const dayChange = latestBar && prevBar ? latestBar.close - prevBar.close : 0
  const dayChangeP = prevBar ? (dayChange / prevBar.close) * 100 : 0

  return (
    <div className="bg-[#0f1117] rounded-xl border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-gray-800 flex flex-wrap items-center gap-6">
        <div className="flex items-baseline gap-3">
          <span className="text-2xl font-bold text-white">{symbol}</span>
          {latestBar && (
            <span className="text-2xl font-semibold text-white">${latestBar.close.toFixed(2)}</span>
          )}
        </div>
        {latestBar && (
          <div className={dayChange >= 0 ? 'text-emerald-400' : 'text-red-400'}>
            {dayChange >= 0 ? '+' : ''}{dayChange.toFixed(2)} ({dayChange >= 0 ? '+' : ''}{dayChangeP.toFixed(2)}%)
          </div>
        )}
        {trades.length > 0 && (
          <div className="ml-auto flex items-center gap-3">
            <span className="text-sm text-gray-400">累積損益</span>
            <span className={`text-xl font-bold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
              {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
            </span>
          </div>
        )}
      </div>

      {/* Trade badges with reference button */}
      {trades.length > 0 && (
        <div className="px-5 py-3 border-b border-gray-800 flex flex-wrap gap-2">
          {trades.map((t) => {
            let pnl: number | null = null
            if (t.action === 'SELL' && t.pairedTradeId) {
              const buy = trades.find((b) => b.id === t.pairedTradeId)
              if (buy) pnl = (t.price - buy.price) * t.shares
            }
            return (
              <button
                key={t.id}
                onClick={() => onTradeClick?.(t)}
                className={`text-xs px-2.5 py-1 rounded-full border font-mono flex items-center gap-1.5 transition-all hover:brightness-125 cursor-pointer
                  ${t.action === 'BUY'
                    ? 'bg-emerald-900/40 border-emerald-700 text-emerald-300'
                    : 'bg-red-900/40 border-red-700 text-red-300'}`}
              >
                <span>{t.action === 'BUY' ? '▲' : '▼'}</span>
                <span>{t.action}</span>
                <span className="text-gray-500">{t.date}</span>
                <span>${t.price.toFixed(2)}</span>
                <span className="text-gray-600">×{t.shares}</span>
                {pnl !== null && (
                  <span className={`font-bold ${pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}
                  </span>
                )}
                {t.reference && (
                  <span className="ml-0.5 text-gray-600 border border-gray-700 rounded px-1 text-[10px]">
                    分析
                  </span>
                )}
              </button>
            )
          })}
          <div className="text-xs text-gray-700 self-center ml-1">← クリックで分析を表示</div>
        </div>
      )}

      {/* Main chart — min-height prevents layout collapse during chart rebuild */}
      <div ref={chartContainerRef} className="w-full" style={{ minHeight: 500 }} />

      {/* P&L panel label */}
      <div className="px-5 py-1.5 border-t border-gray-800 flex items-center gap-2 bg-gray-900/30">
        <span className="text-xs text-gray-600 font-medium tracking-widest uppercase">累積損益 P&L</span>
        {totalPnl !== 0 && (
          <span className={`text-xs font-bold ${totalPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
            {totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}
          </span>
        )}
      </div>

      {/* P&L chart */}
      <div ref={pnlContainerRef} className="w-full" style={{ minHeight: 160 }} />

      {/* Legend */}
      <div className="px-5 py-3 border-t border-gray-800 flex flex-wrap gap-5 text-xs text-gray-600">
        <span className="flex items-center gap-1.5"><span className="text-emerald-400">▲</span> BUY（バー下）</span>
        <span className="flex items-center gap-1.5"><span className="text-red-400">▼</span> SELL（バー上）損益表示</span>
        <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 bg-emerald-400 inline-block" /> 累積損益ライン</span>
        <span className="ml-auto">ドラッグで移動 │ スクロールでズーム │ 左に遡れます</span>
      </div>

      {/* Floating tooltip */}
      {tooltip && (
        <div
          className="fixed z-50 pointer-events-none bg-gray-900/95 border border-gray-700 rounded-lg px-3 py-2 text-xs font-mono shadow-xl backdrop-blur"
          style={{ left: tooltip.x + 16, top: tooltip.y - 60 }}
        >
          <div className="text-gray-400 mb-1.5 font-sans">{tooltip.date}</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
            <span className="text-gray-600">始値</span><span className="text-gray-200">${tooltip.open.toFixed(2)}</span>
            <span className="text-gray-600">高値</span><span className="text-emerald-400">${tooltip.high.toFixed(2)}</span>
            <span className="text-gray-600">安値</span><span className="text-red-400">${tooltip.low.toFixed(2)}</span>
            <span className="text-gray-600">終値</span><span className="text-white font-semibold">${tooltip.close.toFixed(2)}</span>
            <span className="text-gray-600">前日比</span>
            <span className={tooltip.change >= 0 ? 'text-emerald-400' : 'text-red-400'}>
              {tooltip.change >= 0 ? '+' : ''}{tooltip.change.toFixed(2)} ({tooltip.changeP.toFixed(2)}%)
            </span>
            <span className="text-gray-600">出来高</span>
            <span className="text-gray-400">{(tooltip.volume / 1_000_000).toFixed(2)}M</span>
          </div>
        </div>
      )}
    </div>
  )
}
