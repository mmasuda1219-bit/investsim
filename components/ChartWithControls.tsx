'use client'

import { useState, useEffect } from 'react'
import { StockChart } from './StockChart'
import type { HistoricalBar } from '@/types'

interface Props {
  symbol: string
  period: string
}

export function ChartWithControls({ symbol, period }: Props) {
  const [data, setData] = useState<HistoricalBar[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [indicators, setIndicators] = useState({
    ma20: true,
    ma50: true,
    ma200: false,
    bb: false,
    rsi: false,
    macd: false,
  })

  useEffect(() => {
    setLoading(true)
    setError(null)
    setData([])
    fetch(`/api/stocks/${symbol}/history?period=${period}`)
      .then(r => r.json())
      .then(d => {
        if (Array.isArray(d)) {
          setData(d)
        } else {
          setError(d.error ?? 'データ取得失敗')
        }
      })
      .catch(() => setError('ネットワークエラー'))
      .finally(() => setLoading(false))
  }, [symbol, period])

  const toggle = (key: keyof typeof indicators) =>
    setIndicators(prev => ({ ...prev, [key]: !prev[key] }))

  const CONTROLS = [
    { key: 'ma20',  label: 'MA20',  color: 'text-blue-400' },
    { key: 'ma50',  label: 'MA50',  color: 'text-yellow-400' },
    { key: 'ma200', label: 'MA200', color: 'text-red-400' },
    { key: 'bb',    label: 'BB',    color: 'text-purple-400' },
    { key: 'rsi',   label: 'RSI',   color: 'text-purple-300' },
    { key: 'macd',  label: 'MACD',  color: 'text-blue-300' },
  ] as const

  return (
    <div className="bg-panel border border-border rounded-xl p-4 space-y-3">
      {/* Controls */}
      <div className="flex flex-wrap gap-2">
        {CONTROLS.map(c => (
          <button
            key={c.key}
            onClick={() => toggle(c.key)}
            className={`px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
              indicators[c.key]
                ? `border-current ${c.color} bg-current/10`
                : 'border-border text-muted hover:text-white'
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center bg-surface rounded-lg text-muted gap-2" style={{ height: 420 }}>
          <div className="w-4 h-4 border-2 border-muted border-t-blue-400 rounded-full animate-spin" />
          <span className="text-sm">チャートデータを取得中...</span>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center justify-center bg-surface rounded-lg text-muted" style={{ height: 420 }}>
          <span className="text-sm text-red-400">{error}</span>
        </div>
      )}

      {!loading && !error && (
        <StockChart data={data} indicators={indicators} />
      )}
    </div>
  )
}
