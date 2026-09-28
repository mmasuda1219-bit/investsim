'use client'

import { useState, useEffect } from 'react'
import { StockChart } from './StockChart'
import { SERIES, svgDash, type SeriesStyle } from '@/components/chartTheme'
import type { HistoricalBar } from '@/types'

interface Props {
  symbol: string
  period: string
}

/** 凡例の線の見本（16×2px）。色と線の形を実際の線と同じ SERIES から描く（DESIGN §6-14「凡例の色と線の色を一致させる」） */
function LineSwatch({ line }: { line: SeriesStyle }) {
  return (
    <svg width={16} height={4} viewBox="0 0 16 4" aria-hidden="true" className="shrink-0">
      <line x1={0} y1={2} x2={16} y2={2} stroke={line.color} strokeWidth={2} strokeDasharray={svgDash(line)} />
    </svg>
  )
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

  // 凡例の色と線の形は StockChart が実際に使う SERIES から取る（別の色を持たない）。
  // 系列色は図形にだけ使い文字には使わない（DESIGN §5-1）ので、文字は --ink / --muted、色は線の見本で出す
  const CONTROLS: { key: keyof typeof indicators; label: string; line: SeriesStyle }[] = [
    { key: 'ma20',  label: 'MA20',  line: SERIES.ma20 },
    { key: 'ma50',  label: 'MA50',  line: SERIES.ma50 },
    { key: 'ma200', label: 'MA200', line: SERIES.ma200 },
    { key: 'bb',    label: 'BB',    line: SERIES.band },
    { key: 'rsi',   label: 'RSI',   line: SERIES.rsi },
    { key: 'macd',  label: 'MACD',  line: SERIES.macd },
  ]

  return (
    <div className="bg-panel border border-border rounded-xl p-4 space-y-3">
      {/* Controls: 選択中は青緑の枠＋薄い下地（§5-1「選択中」）。線の色で塗らない */}
      <div className="flex flex-wrap gap-2">
        {CONTROLS.map(c => (
          <button
            key={c.key}
            type="button"
            aria-pressed={indicators[c.key]}
            onClick={() => toggle(c.key)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium border transition-colors ${
              indicators[c.key]
                ? 'border-brand bg-brand-tint text-ink'
                : 'border-border text-muted hover:text-ink'
            }`}
          >
            <LineSwatch line={c.line} />
            {c.label}
          </button>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center bg-surface rounded-lg text-muted gap-2" style={{ height: 420 }}>
          <div className="w-4 h-4 border-2 border-muted border-t-ink rounded-full animate-spin" />
          <span className="text-sm">チャートデータを取得中...</span>
        </div>
      )}

      {!loading && error && (
        <div className="flex items-center justify-center bg-surface rounded-lg text-muted" style={{ height: 420 }}>
          {/* 取得できなかった値の注記は --warning-ink（§5-1。--danger は入力の誤り・取り消せない操作だけ） */}
          <span className="text-sm text-warning-ink">{error}</span>
        </div>
      )}

      {!loading && !error && (
        <StockChart data={data} indicators={indicators} />
      )}
    </div>
  )
}
