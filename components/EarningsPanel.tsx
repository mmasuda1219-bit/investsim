'use client'

import { useState, useEffect } from 'react'

interface EarningsData {
  nextEarningsDate?: number
  nextEarningsDateStr?: string
  epsHistory: Array<{
    date: string
    actual: number | null
    estimate: number | null
    surprise: number | null
  }>
}

interface Props { symbol: string }

export function EarningsPanel({ symbol }: Props) {
  const [data, setData] = useState<EarningsData | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/stocks/${symbol}/earnings`)
      .then(r => r.json())
      .then(d => setData(d))
      .catch(() => setData({ epsHistory: [] }))
      .finally(() => setLoading(false))
  }, [symbol])

  if (loading) return (
    <div className="bg-panel border border-border rounded-xl p-5 animate-pulse">
      <div className="h-4 bg-surface rounded w-24 mb-3" />
      <div className="space-y-2">{[...Array(3)].map((_,i) => <div key={i} className="h-8 bg-surface rounded" />)}</div>
    </div>
  )

  const daysUntil = data?.nextEarningsDate
    ? Math.ceil((data.nextEarningsDate * 1000 - Date.now()) / 86400000)
    : null

  return (
    <div className="bg-panel border border-border rounded-xl p-5">
      <h2 className="text-white font-semibold mb-4">決算情報</h2>

      {/* Next earnings */}
      {data?.nextEarningsDateStr && (
        <div className="mb-4 flex items-center gap-3 bg-yellow-900/20 border border-yellow-700/40 rounded-lg px-4 py-3">
          <span className="text-yellow-400 text-lg">📅</span>
          <div>
            <div className="text-white text-sm font-medium">次回決算予定: {data.nextEarningsDateStr}</div>
            {daysUntil !== null && daysUntil > 0 && (
              <div className="text-yellow-400 text-xs">あと {daysUntil} 日</div>
            )}
          </div>
        </div>
      )}

      {/* EPS history table */}
      {data?.epsHistory && data.epsHistory.length > 0 && (
        <div>
          <p className="text-muted text-xs mb-2">EPS 実績 vs 予想（直近4四半期）</p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted text-xs border-b border-border">
                  <th className="text-left pb-2">四半期</th>
                  <th className="text-right pb-2">実績 EPS</th>
                  <th className="text-right pb-2">予想 EPS</th>
                  <th className="text-right pb-2">サプライズ</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.epsHistory.map(q => {
                  const beat = q.surprise !== null && q.surprise > 0
                  return (
                    <tr key={q.date} className="hover:bg-surface/50">
                      <td className="py-2 text-slate-300 font-mono text-xs">{q.date}</td>
                      <td className="py-2 text-right text-white font-mono">
                        {q.actual != null ? `$${q.actual.toFixed(2)}` : '—'}
                      </td>
                      <td className="py-2 text-right text-slate-400 font-mono">
                        {q.estimate != null ? `$${q.estimate.toFixed(2)}` : '—'}
                      </td>
                      <td className={`py-2 text-right font-mono text-xs ${
                        q.surprise == null ? 'text-muted'
                          : beat ? 'text-green-400' : 'text-red-400'
                      }`}>
                        {q.surprise != null
                          ? `${beat ? '+' : ''}${q.surprise.toFixed(1)}%`
                          : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {data?.epsHistory.length === 0 && (
        <p className="text-muted text-sm">決算データを取得できませんでした</p>
      )}
    </div>
  )
}
