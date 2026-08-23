'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import {
  getPortfolio,
  resetPortfolio,
  getPortfolioValue,
  type Portfolio,
} from '@/lib/portfolio'

const INITIAL_CASH = 100_000

function formatUSD(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

export default function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [loadingPrices, setLoadingPrices] = useState(false)

  const loadPortfolio = () => {
    const p = getPortfolio()
    setPortfolio(p)
    if (p.positions.length > 0) {
      setLoadingPrices(true)
      Promise.all(
        p.positions.map(pos =>
          fetch(`/api/stocks/${pos.symbol}`)
            .then(r => r.json())
            .then(q => [pos.symbol, q.price] as [string, number])
            .catch(() => [pos.symbol, pos.avgCost] as [string, number])
        )
      ).then(entries => {
        setPrices(Object.fromEntries(entries))
        setLoadingPrices(false)
      })
    } else {
      setPrices({})
      setLoadingPrices(false)
    }
  }

  useEffect(() => {
    loadPortfolio()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleReset = () => {
    if (confirm('ポートフォリオをリセットしますか？全ての取引履歴と保有株が削除されます。')) {
      resetPortfolio()
      loadPortfolio()
    }
  }

  if (!portfolio) {
    return (
      <div className="space-y-6">
        <div className="bg-panel border border-border rounded-xl p-8 text-center text-muted text-sm animate-pulse">
          読み込み中...
        </div>
      </div>
    )
  }

  const totalValue = getPortfolioValue(portfolio.positions, prices)
  const totalAssets = totalValue + portfolio.cash
  const totalPnL = totalAssets - INITIAL_CASH
  const totalPnLPct = (totalPnL / INITIAL_CASH) * 100
  const pnlPositive = totalPnL >= 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-emerald-400 uppercase">04 振り返る</p>
          <h1 className="text-2xl font-bold text-white mt-1">判断を振り返る</h1>
          <p className="text-muted text-sm mt-1">
            見るべきは儲けた額ではなく、判断の中身です。初期資本 {formatUSD(INITIAL_CASH)}
          </p>
        </div>
        <button
          onClick={handleReset}
          className="px-4 py-2 bg-red-900/40 hover:bg-red-800/60 border border-red-700 text-red-300 hover:text-red-200 text-sm font-medium rounded-lg transition-colors"
        >
          リセット
        </button>
      </div>

      {/* 判断の記録 — この面の主役。金額より先に出す */}
      <div>
        <h2 className="text-white font-semibold text-sm mb-3">あなたの判断の記録</h2>
        {(() => {
          const withReason = portfolio.trades.filter(t => t.reason && t.reason.trim())
          const missing = portfolio.trades.length - withReason.length
          if (portfolio.trades.length === 0) {
            return (
              <div className="bg-panel border border-border rounded-xl p-8 text-center space-y-2">
                <p className="text-sm text-slate-300">まだ判断の記録がありません</p>
                <p className="text-xs text-muted">
                  「やる」で売買すると、そのときに書いた理由がここに並びます。
                </p>
                <Link href="/trade" className="inline-block text-xs text-emerald-400 hover:text-emerald-300 pt-1">
                  やってみる →
                </Link>
              </div>
            )
          }
          if (withReason.length === 0) {
            return (
              <div className="bg-panel border border-border rounded-xl p-6 space-y-1.5">
                <p className="text-sm text-slate-300">理由つきの取引はまだありません</p>
                <p className="text-xs text-muted leading-relaxed">
                  理由の記録は2026-08-23から始めました。それ以前の{portfolio.trades.length}件には理由が残っていません。
                </p>
              </div>
            )
          }
          return (
            <div className="space-y-2.5">
              {withReason.slice(0, 10).map(t => (
                <div key={t.id} className="bg-panel border border-border rounded-xl p-4 space-y-2">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
                      t.action === 'buy' ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'
                    }`}>
                      {t.action === 'buy' ? '買い' : '売り'}
                    </span>
                    <span className="font-mono font-bold text-white text-sm">{t.symbol}</span>
                    <span className="text-xs text-muted">{t.shares.toLocaleString()}株 @ {formatUSD(t.price)}</span>
                    <span className="text-xs text-muted ml-auto font-mono">{formatDate(t.timestamp)}</span>
                  </div>
                  <p className="text-sm text-slate-300 leading-relaxed">{t.reason}</p>
                </div>
              ))}
              {missing > 0 && (
                <p className="text-[11px] text-muted">
                  ほかに理由が残っていない取引が{missing}件あります（理由の記録を始める前のものです）。
                </p>
              )}
            </div>
          )
        })()}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-panel border border-border rounded-xl p-5">
          <p className="text-muted text-xs mb-1">総資産</p>
          <p className="text-white text-2xl font-bold font-mono">{formatUSD(totalAssets)}</p>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <p className="text-muted text-xs mb-1">損益</p>
          <p className={`text-2xl font-bold font-mono ${pnlPositive ? 'text-green-400' : 'text-red-400'}`}>
            {pnlPositive ? '+' : ''}{formatUSD(totalPnL)}
          </p>
          <p className={`text-sm font-mono ${pnlPositive ? 'text-green-400' : 'text-red-400'}`}>
            ({pnlPositive ? '+' : ''}{totalPnLPct.toFixed(2)}%)
          </p>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <p className="text-muted text-xs mb-1">現金</p>
          <p className="text-white text-2xl font-bold font-mono">{formatUSD(portfolio.cash)}</p>
        </div>
      </div>

      {/* Holdings Table */}
      <div>
        <h2 className="text-white font-semibold text-sm mb-3">保有銘柄</h2>
        {loadingPrices ? (
          <div className="bg-panel border border-border rounded-xl p-8 text-center text-muted text-sm animate-pulse">
            価格を取得中...
          </div>
        ) : portfolio.positions.length === 0 ? (
          <div className="bg-panel border border-border rounded-xl p-8 text-center text-muted text-sm space-y-3">
            <p>まだ保有銘柄がありません。</p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Link href="/" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors">
                銘柄を探す
              </Link>
              <Link href="/learn" className="px-4 py-2 bg-panel border border-border hover:border-blue-500 text-slate-300 hover:text-white text-xs font-medium rounded-lg transition-colors">
                スクリーナーで絞り込む
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-panel border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted text-xs">
                    <th className="text-left px-4 py-3 font-medium">シンボル</th>
                    <th className="text-left px-4 py-3 font-medium">社名</th>
                    <th className="text-right px-4 py-3 font-medium">株数</th>
                    <th className="text-right px-4 py-3 font-medium">平均コスト</th>
                    <th className="text-right px-4 py-3 font-medium">現在値</th>
                    <th className="text-right px-4 py-3 font-medium">評価額</th>
                    <th className="text-right px-4 py-3 font-medium">損益</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {portfolio.positions.map(pos => {
                    const currentPrice = prices[pos.symbol] ?? pos.avgCost
                    const marketValue = pos.shares * currentPrice
                    const pnl = (currentPrice - pos.avgCost) * pos.shares
                    const pnlPct = ((currentPrice - pos.avgCost) / pos.avgCost) * 100
                    const posPositive = pnl >= 0
                    return (
                      <tr key={pos.symbol} className="hover:bg-surface/50 transition-colors">
                        <td className="px-4 py-3">
                          <Link
                            href={`/stocks/${pos.symbol}`}
                            className="font-mono font-bold text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            {pos.symbol}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-300 max-w-[180px] truncate">
                          {pos.name}
                        </td>
                        <td className="px-4 py-3 text-right text-white font-mono">
                          {pos.shares.toLocaleString()}株
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300 font-mono">
                          {formatUSD(pos.avgCost)}
                        </td>
                        <td className="px-4 py-3 text-right text-white font-mono">
                          {formatUSD(currentPrice)}
                        </td>
                        <td className="px-4 py-3 text-right text-white font-mono">
                          {formatUSD(marketValue)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          <span className={posPositive ? 'text-green-400' : 'text-red-400'}>
                            {posPositive ? '+' : ''}{formatUSD(pnl)}<br />
                            <span className="text-xs">
                              ({posPositive ? '+' : ''}{pnlPct.toFixed(2)}%)
                            </span>
                          </span>
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

      {/* Trade History */}
      <div>
        <h2 className="text-white font-semibold text-sm mb-3">取引履歴（最新10件）</h2>
        {portfolio.trades.length === 0 ? (
          <div className="bg-panel border border-border rounded-xl p-8 text-center text-muted text-sm">
            取引履歴がありません。
          </div>
        ) : (
          <div className="bg-panel border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted text-xs">
                    <th className="text-left px-4 py-3 font-medium">日時</th>
                    <th className="text-left px-4 py-3 font-medium">種別</th>
                    <th className="text-left px-4 py-3 font-medium">シンボル</th>
                    <th className="text-left px-4 py-3 font-medium">社名</th>
                    <th className="text-right px-4 py-3 font-medium">株数</th>
                    <th className="text-right px-4 py-3 font-medium">単価</th>
                    <th className="text-right px-4 py-3 font-medium">合計</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {portfolio.trades.slice(0, 10).map(trade => (
                    <tr key={trade.id} className="hover:bg-surface/50 transition-colors">
                      <td className="px-4 py-3 text-slate-300 text-xs font-mono whitespace-nowrap">
                        {formatDate(trade.timestamp)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          trade.action === 'buy'
                            ? 'bg-green-900/40 text-green-400'
                            : 'bg-red-900/40 text-red-400'
                        }`}>
                          {trade.action === 'buy' ? 'BUY' : 'SELL'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/stocks/${trade.symbol}`}
                          className="font-mono font-bold text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          {trade.symbol}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-300 max-w-[160px] truncate">
                        {trade.name}
                      </td>
                      <td className="px-4 py-3 text-right text-white font-mono">
                        {trade.shares.toLocaleString()}株
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300 font-mono">
                        {formatUSD(trade.price)}
                      </td>
                      <td className="px-4 py-3 text-right text-white font-mono">
                        {formatUSD(trade.shares * trade.price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
