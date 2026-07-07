'use client'

import { useState, useEffect } from 'react'
import investors from '@/lib/investors'
import type { Signal } from '@/types'

interface Props {
  symbol: string
}

const ACTION_LABEL: Record<Signal['action'], string> = {
  buy: '買い',
  sell: '売り',
  hold: '保有',
}

const ACTION_COLOR: Record<Signal['action'], string> = {
  buy: 'text-bull bg-green-950 border-green-800',
  sell: 'text-bear bg-red-950 border-red-800',
  hold: 'text-yellow-400 bg-yellow-950 border-yellow-800',
}

const STRENGTH_DOTS = (n: Signal['strength']) => Array.from({ length: 3 }, (_, i) => i < n)

export function InvestorPanel({ symbol }: Props) {
  const [selectedId, setSelectedId] = useState(investors[0].id)
  const [signals, setSignals] = useState<Record<string, Signal>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setError(null)
    fetch(`/api/signals/${symbol}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.error) throw new Error(d.error)
        setSignals(d.signals ?? {})
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol])

  const selected = investors.find((i) => i.id === selectedId)!
  const signal = signals[selectedId]

  return (
    <div className="bg-panel border border-border rounded-xl p-5">
      <h2 className="text-white font-semibold mb-4">著名投資家シミュレーション</h2>

      {/* Investor tabs */}
      <div className="flex gap-2 mb-5 flex-wrap">
        {investors.map((inv) => (
          <button
            key={inv.id}
            onClick={() => setSelectedId(inv.id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border ${
              selectedId === inv.id
                ? 'text-white border-transparent'
                : 'text-muted border-border hover:text-white'
            }`}
            style={selectedId === inv.id ? { backgroundColor: inv.avatarColor + '33', borderColor: inv.avatarColor } : {}}
          >
            {inv.nameJa}
          </button>
        ))}
      </div>

      {/* Investor info */}
      <div className="flex items-start gap-3 mb-5">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold text-sm shrink-0"
          style={{ backgroundColor: selected.avatarColor }}
        >
          {selected.name.charAt(0)}
        </div>
        <div>
          <div className="text-white font-medium">{selected.name}</div>
          <div className="text-muted text-xs mt-0.5">{selected.description}</div>
          <div className="text-slate-400 text-xs mt-1 italic">「{selected.philosophy}」</div>
        </div>
      </div>

      {/* Signal */}
      {loading && (
        <div className="flex items-center gap-2 text-muted text-sm">
          <div className="w-4 h-4 border-2 border-muted border-t-white rounded-full animate-spin" />
          シグナルを分析中...
        </div>
      )}

      {error && (
        <div className="text-bear text-sm bg-red-950 border border-red-800 rounded-lg px-4 py-3">
          データ取得エラー: {error}
        </div>
      )}

      {!loading && !error && !signal && (
        <div className="text-muted text-sm py-2">
          このシンボルのシグナルデータが取得できませんでした
        </div>
      )}

      {!loading && !error && signal && (
        <div>
          <div className={`inline-flex items-center gap-3 px-4 py-2.5 rounded-lg border mb-4 ${ACTION_COLOR[signal.action]}`}>
            <span className="text-lg font-bold">{ACTION_LABEL[signal.action]}</span>
            <div className="flex gap-1">
              {STRENGTH_DOTS(signal.strength).map((filled, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full ${filled ? 'bg-current' : 'bg-current opacity-30'}`}
                />
              ))}
            </div>
            <span className="text-xs opacity-70">
              強度 {signal.strength}/3
            </span>
          </div>

          <ul className="space-y-2">
            {signal.reasons.map((r, i) => (
              <li key={i} className="flex items-start gap-2 text-sm text-slate-300">
                <span className="text-muted mt-0.5 shrink-0">▸</span>
                {r}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
