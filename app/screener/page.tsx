'use client'

import { useState, useEffect } from 'react'

interface ScreenerStock {
  symbol: string
  name: string
  price: number
  marketCap?: number
  fundamentals: {
    pe?: number
    pb?: number
    roe?: number
    debtToEquity?: number
    revenueGrowth?: number
    marketCap?: number
  }
  signals: Record<string, 'buy' | 'sell' | 'hold'>
}

const INVESTORS = [
  { id: 'buffett', label: 'バフェット', initial: 'B' },
  { id: 'soros', label: 'ソロス', initial: 'S' },
  { id: 'lynch', label: 'リンチ', initial: 'L' },
  { id: 'graham', label: 'グレアム', initial: 'G' },
  { id: 'dalio', label: 'ダリオ', initial: 'D' },
]

const badgeColors: Record<string, string> = {
  buy: 'bg-green-500',
  sell: 'bg-red-500',
  hold: 'bg-gray-500',
}

function formatMarketCap(value?: number): string {
  if (value == null) return '—'
  if (value >= 1e12) return `$${(value / 1e12).toFixed(1)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(0)}B`
  return `$${(value / 1e6).toFixed(0)}M`
}

function formatPercent(value?: number): string {
  if (value == null) return '—'
  return `${(value * 100).toFixed(1)}%`
}

function formatNumber(value?: number, decimals = 1): string {
  if (value == null) return '—'
  return value.toFixed(decimals)
}

export default function ScreenerPage() {
  const [maxPer, setMaxPer] = useState('')
  const [maxPbr, setMaxPbr] = useState('')
  const [minRoe, setMinRoe] = useState('')
  const [maxDe, setMaxDe] = useState('')
  const [minMcap, setMinMcap] = useState('')
  const [selectedInvestors, setSelectedInvestors] = useState<string[]>([])
  const [results, setResults] = useState<ScreenerStock[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searched, setSearched] = useState(false)

  const runScreener = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/screener', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxPer: maxPer ? Number(maxPer) : undefined,
          maxPbr: maxPbr ? Number(maxPbr) : undefined,
          minRoe: minRoe ? Number(minRoe) / 100 : undefined,
          maxDebtToEquity: maxDe ? Number(maxDe) : undefined,
          minMarketCap: minMcap ? Number(minMcap) * 1e9 : undefined,
          investorBuy: selectedInvestors.length > 0 ? selectedInvestors : undefined,
        }),
      })
      if (!res.ok) {
        throw new Error(`APIエラー: ${res.status}`)
      }
      const data = await res.json()
      setResults(data.results)
      setSearched(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    runScreener()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleInvestor = (id: string) => {
    setSelectedInvestors((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">米国株スクリーナー</h1>
        <p className="text-muted text-sm mt-1">著名投資家の条件で絞り込む</p>
      </div>

      {/* Filter Panel */}
      <div className="bg-panel border border-border rounded-xl p-5 space-y-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs text-muted mb-1">PER 上限</label>
            <input
              type="number"
              min="0"
              placeholder="例: 30"
              value={maxPer}
              onChange={(e) => setMaxPer(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">PBR 上限</label>
            <input
              type="number"
              min="0"
              placeholder="例: 5"
              value={maxPbr}
              onChange={(e) => setMaxPbr(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">ROE 下限 (%)</label>
            <input
              type="number"
              min="0"
              placeholder="例: 15"
              value={minRoe}
              onChange={(e) => setMinRoe(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">D/E 上限</label>
            <input
              type="number"
              min="0"
              placeholder="例: 1.0"
              value={maxDe}
              onChange={(e) => setMaxDe(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div className="max-w-xs">
          <label className="block text-xs text-muted mb-1">時価総額 下限（十億ドル）</label>
          <input
            type="number"
            min="0"
            placeholder="例: 100"
            value={minMcap}
            onChange={(e) => setMinMcap(e.target.value)}
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
          />
        </div>

        <div>
          <label className="block text-xs text-muted mb-2">投資家シグナル（BUY のみ）</label>
          <div className="flex flex-wrap gap-3">
            {INVESTORS.map((inv) => (
              <label
                key={inv.id}
                className="flex items-center gap-2 cursor-pointer group"
              >
                <input
                  type="checkbox"
                  checked={selectedInvestors.includes(inv.id)}
                  onChange={() => toggleInvestor(inv.id)}
                  className="w-4 h-4 accent-blue-500 cursor-pointer"
                />
                <span className="text-sm text-slate-300 group-hover:text-white transition-colors">
                  {inv.label}
                </span>
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={runScreener}
          disabled={loading}
          className="px-5 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-900 disabled:cursor-not-allowed text-white text-sm font-medium rounded-lg transition-colors"
        >
          {loading ? '検索中...' : 'スクリーニング実行'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Results */}
      {!loading && searched && (
        <div>
          <h2 className="text-white font-semibold text-sm mb-3">
            結果: <span className="text-blue-400">{results.length}</span> 銘柄
          </h2>

          {results.length === 0 ? (
            <div className="bg-panel border border-border rounded-xl p-8 text-center text-muted text-sm space-y-3">
              <p>条件に合う銘柄がありません</p>
              <button
                onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                className="text-blue-400 hover:text-blue-300 text-xs underline underline-offset-2"
              >
                フィルターを変更する ↑
              </button>
            </div>
          ) : (
            <div className="bg-panel border border-border rounded-xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-muted text-xs">
                      <th className="text-left px-4 py-3 font-medium">シンボル</th>
                      <th className="text-left px-4 py-3 font-medium">社名</th>
                      <th className="text-right px-4 py-3 font-medium">株価</th>
                      <th className="text-right px-4 py-3 font-medium">時価総額</th>
                      <th className="text-right px-4 py-3 font-medium">PER</th>
                      <th className="text-right px-4 py-3 font-medium">PBR</th>
                      <th className="text-right px-4 py-3 font-medium">ROE</th>
                      <th className="text-left px-4 py-3 font-medium">シグナル</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {results.map((stock) => {
                      const mcap = stock.marketCap ?? stock.fundamentals.marketCap
                      return (
                        <tr
                          key={stock.symbol}
                          className="hover:bg-surface/50 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <a
                              href={`/stocks/${stock.symbol}`}
                              className="font-mono font-bold text-blue-400 hover:text-blue-300 transition-colors"
                            >
                              {stock.symbol}
                            </a>
                          </td>
                          <td className="px-4 py-3 text-slate-300 max-w-[180px] truncate">
                            {stock.name}
                          </td>
                          <td className="px-4 py-3 text-right text-white font-mono">
                            ${stock.price.toFixed(2)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-300">
                            {formatMarketCap(mcap)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-300">
                            {formatNumber(stock.fundamentals.pe)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-300">
                            {formatNumber(stock.fundamentals.pb)}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-300">
                            {formatPercent(stock.fundamentals.roe)}
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-1">
                              {INVESTORS.map((inv) => {
                                const signal = stock.signals[inv.id]
                                if (!signal) return null
                                return (
                                  <span
                                    key={inv.id}
                                    title={`${inv.label}: ${signal}`}
                                    className={`w-5 h-5 rounded-full flex items-center justify-center text-white text-[10px] font-bold ${badgeColors[signal]}`}
                                  >
                                    {inv.initial}
                                  </span>
                                )
                              })}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="bg-panel border border-border rounded-xl p-8 text-center text-muted text-sm animate-pulse">
          検索中...
        </div>
      )}
    </div>
  )
}
