'use client'

import { useState, useEffect, useCallback } from 'react'
import { getPortfolio, executeTrade } from '@/lib/portfolio'

interface TradeModalProps {
  symbol: string
  name: string
  price: number
  defaultAction?: 'buy' | 'sell'
  onClose: () => void
  onSuccess?: () => void
}

export function TradeModal({ symbol, name, price, defaultAction = 'buy', onClose, onSuccess }: TradeModalProps) {
  const [action, setAction] = useState<'buy' | 'sell'>(defaultAction)
  const [shares, setShares] = useState<number>(1)
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState(false)

  const portfolio = getPortfolio()
  const total = shares * price
  const cashAfter = action === 'buy' ? portfolio.cash - total : portfolio.cash + total

  const heldPosition = portfolio.positions.find((p) => p.symbol === symbol)
  const heldShares = heldPosition?.shares ?? 0

  const handleClose = useCallback(() => {
    setShares(1)
    setError('')
    setSuccess(false)
    onClose()
  }, [onClose])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleClose])

  const formatCurrency = (v: number) =>
    v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 })

  const handleExecute = () => {
    setError('')

    if (!Number.isInteger(shares) || shares < 1) {
      setError('株数は1以上の整数を入力してください')
      return
    }

    if (action === 'sell' && shares > heldShares) {
      setError(`保有株数が不足しています（保有: ${heldShares}株）`)
      return
    }

    const result = executeTrade(symbol, name, action, shares, price)

    if (!result.success) {
      setError(result.error ?? '取引に失敗しました')
      return
    }

    setSuccess(true)
    setTimeout(() => {
      onSuccess?.()
      onClose()
    }, 2000)
  }

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose() }}
    >
      <div className="bg-[#1e293b] border border-[#334155] rounded-2xl w-full max-w-sm mx-4 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#334155]">
          <div>
            <h2 className="text-white font-bold text-lg">
              {symbol} を{action === 'buy' ? '購入' : '売却'}
            </h2>
            <p className="text-sm text-slate-400">現在値: {formatCurrency(price)}</p>
          </div>
          <button
            onClick={handleClose}
            className="text-slate-400 hover:text-white transition-colors text-xl leading-none"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* Action tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => { setAction('buy'); setError('') }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                action === 'buy'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[#0f172a] text-slate-400 hover:text-white'
              }`}
            >
              購入
            </button>
            <button
              onClick={() => { setAction('sell'); setError('') }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                action === 'sell'
                  ? 'bg-red-600 text-white'
                  : 'bg-[#0f172a] text-slate-400 hover:text-white'
              }`}
            >
              売却
            </button>
          </div>

          {/* Shares input */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">株数</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={1}
                step={1}
                value={shares}
                onChange={(e) => {
                  const v = Math.floor(Number(e.target.value))
                  setShares(v > 0 ? v : 1)
                  setError('')
                }}
                className="flex-1 bg-[#0f172a] border border-[#334155] rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
              <span className="text-slate-400 text-sm">株</span>
            </div>
          </div>

          {/* Summary */}
          <div className="bg-[#0f172a] rounded-lg px-4 py-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-400">合計</span>
              <span className="text-white font-medium">{formatCurrency(total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-400">手数料</span>
              <span className="text-emerald-400">無料</span>
            </div>
            {action === 'sell' && (
              <div className="flex justify-between">
                <span className="text-slate-400">保有株数</span>
                <span className="text-white">{heldShares}株</span>
              </div>
            )}
            <div className="flex justify-between pt-1 border-t border-[#334155]">
              <span className="text-slate-400">残高</span>
              <span className="text-white">
                {formatCurrency(portfolio.cash)}
                <span className="text-slate-500 mx-1">→</span>
                <span className={cashAfter >= 0 ? 'text-white' : 'text-red-400'}>
                  {formatCurrency(cashAfter)}
                </span>
              </span>
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-red-400 text-sm text-center">{error}</p>
          )}

          {/* Success */}
          {success && (
            <p className="text-emerald-400 text-sm text-center font-medium">
              ✓ 取引完了しました
            </p>
          )}

          {/* Execute button */}
          {!success && (
            <button
              onClick={handleExecute}
              className={`w-full py-3 rounded-lg font-semibold text-sm transition-colors ${
                action === 'buy'
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-red-600 hover:bg-red-500 text-white'
              }`}
            >
              実行
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
