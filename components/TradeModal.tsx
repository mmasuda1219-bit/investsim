'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { LoginLink } from '@/components/LoginLink'
import { fetchPortfolio, submitTrade, type Portfolio } from '@/lib/portfolio'
import { composeReason, validateParts, fieldsFor, type ReasonParts } from '@/lib/trade/reason'
import { ReasonFields } from './ReasonFields'

/**
 * 銘柄詳細から直接売買するモーダル。
 *
 * 「やる」(/trade) と同じく**理由の記入を必須**にする。入口が違っても規律を
 * 変えない。ここだけ理由なしで通せると「振り返る」の材料に穴が空き、
 * 判断の質を見返すという面の前提が崩れる。
 *
 * 2026-09-03: 保存先がブラウザからDBへ移り、残高・保有株数の判定もサーバー
 * （execute_trade）に移った。ここでの事前チェックは «入力ミスをその場で気づかせる»
 * ための表示上のものに留め、成否の権威はサーバーの応答とする。
 *
 * 2026-09-03(2): 理由の入力を /trade と同時に «問いへの分解» へ変更（JOURNEY.md 断絶2）。
 * 問いの定義と検証は lib/trade/reason.ts に1か所化し、UIは ReasonFields を共有する。
 * ここに独自の問いを書かないこと（入口ごとに規律が変わるのを防ぐ）。
 */

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
  // 買いと売りで問いが違うので入力も別に持つ。切り替えで書いたものが消えない。
  const [parts, setParts] = useState<{ buy: ReasonParts; sell: ReasonParts }>({ buy: {}, sell: {} })
  const [touched, setTouched] = useState<{ buy: Record<string, boolean>; sell: Record<string, boolean> }>({ buy: {}, sell: {} })
  const [error, setError] = useState<string>('')
  const [success, setSuccess] = useState(false)
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    let alive = true
    fetchPortfolio().then(r => {
      if (!alive) return
      setSignedIn(r.status === 'ok')
      if (r.status === 'ok') setPortfolio(r.portfolio)
    })
    return () => { alive = false }
  }, [])

  const total = shares * price
  const cash = portfolio?.cash ?? 0
  const cashAfter = action === 'buy' ? cash - total : cash + total

  const heldPosition = portfolio?.positions.find((p) => p.symbol === symbol)
  const heldShares = heldPosition?.shares ?? 0

  const current = parts[action]
  const errors = useMemo(() => validateParts(action, current), [action, current])

  const setPart = useCallback((key: string, value: string) => {
    setParts(p => ({ ...p, [action]: { ...p[action], [key]: value } }))
    setError('')
  }, [action])

  const markTouched = useCallback((key: string) => {
    setTouched(t => ({ ...t, [action]: { ...t[action], [key]: true } }))
  }, [action])

  const handleClose = useCallback(() => {
    setShares(1)
    setParts({ buy: {}, sell: {} })
    setTouched({ buy: {}, sell: {} })
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

  const handleExecute = async () => {
    setError('')
    if (submitting) return

    if (!Number.isInteger(shares) || shares < 1) {
      setError('株数は1以上の整数を入力してください')
      return
    }

    if (!errors.ok) {
      // どの問いが足りないかは各入力の下に出る。ここでは «触っていない» 項目にも
      // 印を出せるよう、全項目を touched にしてから止める。
      setTouched(t => ({ ...t, [action]: Object.fromEntries(Object.keys(errors.byKey).map(k => [k, true])) }))
      setError('必須の問いを埋めてください')
      return
    }

    setSubmitting(true)
    try {
      const result = await submitTrade({
        symbol, name, action, shares, price,
        reason: composeReason(action, current),
      })
      if (!result.ok) {
        if (result.unauthenticated) setSignedIn(false)
        setError(result.message)
        return
      }
      setPortfolio(result.portfolio)
      setSuccess(true)
      setTimeout(() => {
        onSuccess?.()
        onClose()
      }, 2000)
    } finally {
      setSubmitting(false)
    }
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
            <h2 className="text-ink font-bold text-lg">
              {symbol} を{action === 'buy' ? '購入' : '売却'}
            </h2>
            <p className="text-sm text-ink-2">現在値: {formatCurrency(price)}</p>
          </div>
          <button
            onClick={handleClose}
            className="text-ink-2 hover:text-ink transition-colors text-xl leading-none"
            aria-label="閉じる"
          >
            ✕
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {/* 未ログインの案内。判定中（null）は出さない＝ログイン済みの人にちらつかせない。 */}
          {signedIn === false && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm leading-relaxed text-amber-700 flex items-center justify-between gap-2 flex-wrap">
              <span>記録を残すにはログインが必要です</span>
              <LoginLink className="shrink-0 whitespace-nowrap px-2.5 py-1 rounded-md bg-accent text-on-accent font-medium transition-colors" />
            </div>
          )}

          {/* Action tabs */}
          <div className="flex gap-2">
            <button
              onClick={() => { setAction('buy'); setError('') }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                action === 'buy'
                  ? 'bg-success text-ink'
                  : 'bg-[#0f172a] text-ink-2 hover:text-ink'
              }`}
            >
              購入
            </button>
            <button
              onClick={() => { setAction('sell'); setError('') }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                action === 'sell'
                  ? 'bg-danger text-ink'
                  : 'bg-[#0f172a] text-ink-2 hover:text-ink'
              }`}
            >
              売却
            </button>
          </div>

          {/* Shares input */}
          <div>
            <label className="text-sm text-ink-2 mb-1 block">株数</label>
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
                className="flex-1 bg-[#0f172a] border border-[#334155] rounded-lg px-3 py-2 text-ink text-sm focus:outline-none focus:border-blue-200"
              />
              <span className="text-ink-2 text-sm">株</span>
            </div>
          </div>

          {/* 理由（必須）— /trade と同じ規律・同じ問い。入口が違っても変えない */}
          <div className="space-y-2">
            <ReasonFields
              fields={fieldsFor(action)}
              parts={current}
              onChange={setPart}
              errors={errors.byKey}
              touched={touched[action]}
              onBlur={markTouched}
              compact
              idPrefix={`modal-${action}`}
            />
            <p className="text-sm text-muted leading-relaxed">
              あとで「振り返る」で、この判断と結果を見比べられます。
            </p>
          </div>

          {/* Summary */}
          <div className="bg-[#0f172a] rounded-lg px-4 py-3 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-ink-2">合計</span>
              <span className="text-ink font-medium">{formatCurrency(total)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-2">手数料</span>
              <span className="text-emerald-700">無料</span>
            </div>
            {action === 'sell' && (
              <div className="flex justify-between">
                <span className="text-ink-2">保有株数</span>
                <span className="text-ink">{heldShares}株</span>
              </div>
            )}
            {/* 残高は «自分の記録» なので、ログインして取得できたときだけ出す。
                未ログインで 0 と表示すると、残高ゼロだと誤解させる。 */}
            <div className="flex justify-between pt-1 border-t border-[#334155]">
              <span className="text-ink-2">残高</span>
              {portfolio ? (
                <span className="text-ink">
                  {formatCurrency(portfolio.cash)}
                  <span className="text-muted mx-1">→</span>
                  <span className={cashAfter >= 0 ? 'text-ink' : 'text-red-700'}>
                    {formatCurrency(cashAfter)}
                  </span>
                </span>
              ) : (
                <span className="text-muted">{signedIn === false ? '—（未ログイン）' : '…'}</span>
              )}
            </div>
          </div>

          {/* Error */}
          {error && (
            <p className="text-red-700 text-sm text-center">{error}</p>
          )}

          {/* Success */}
          {success && (
            <p className="text-emerald-700 text-sm text-center font-medium">
              ✓ 取引完了しました
            </p>
          )}

          {/* Execute button */}
          {!success && (
            <button
              onClick={handleExecute}
              className={`w-full py-3 rounded-lg font-semibold text-sm transition-colors ${
                action === 'buy'
                  ? 'bg-success hover:bg-emerald-100 text-ink'
                  : 'bg-danger hover:bg-red-100 text-ink'
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
