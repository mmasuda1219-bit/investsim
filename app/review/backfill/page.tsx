'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { LoginLink } from '@/components/LoginLink'
import { ReasonFields } from '@/components/ReasonFields'
import { composeFrom, validateFrom, pastFieldsFor, type ReasonParts } from '@/lib/trade/reason'
import {
  fetchPortfolio,
  submitPastTrade,
  deletePastTrade,
  type Portfolio,
  type Trade,
} from '@/lib/portfolio'

/**
 * 「振り返る」の材料を、過去にさかのぼって入れる面（JOURNEY.md 断絶3・案C）。
 *
 * なぜ要るか: 突き合わせは «買い→売りの往復» が閉じてはじめて材料になるので、
 * 今日はじめた人は数週間なにも見られない。一方で主ペルソナ P1 は、来た時点で
 * すでに実口座の取引履歴を持っている。それを入れれば初日から振り返りが始まる。
 *
 * 外さないこと:
 *  - **仮想の残高・持ち株は動かさない。** ここは «実際にやったことの記録» であって
 *    練習場の売買ではない（migration 0007 の record_past_trade）。
 *  - 価格・日付は本人の自己申告をそのまま受ける。こちらで «正しい実勢価格» に
 *    書き換えない（本人の記録でなくなる）。
 *  - 「降りる条件」を必須にしない。決めていなかった人に書かせると、その場で作った
 *    条件が記録に残って嘘になる。決めていなかったと気づくこと自体が振り返りの中身。
 *  - ここでも「おすすめ」「買い時」の類は出さない。
 */

const todayISO = () => new Date().toISOString().slice(0, 10)

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function fmtDay(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export default function BackfillPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  const [symbol, setSymbol] = useState('')
  const [shares, setShares] = useState('10')
  const [buyDay, setBuyDay] = useState('')
  const [buyPrice, setBuyPrice] = useState('')
  const [sold, setSold] = useState(false)
  const [sellDay, setSellDay] = useState('')
  const [sellPrice, setSellPrice] = useState('')

  const [entryParts, setEntryParts] = useState<ReasonParts>({})
  const [exitParts, setExitParts] = useState<ReasonParts>({})
  const [entryTouched, setEntryTouched] = useState<Record<string, boolean>>({})
  const [exitTouched, setExitTouched] = useState<Record<string, boolean>>({})

  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const entryFields = pastFieldsFor('entry')
  const exitFields = pastFieldsFor('exit')
  const entryErrors = useMemo(() => validateFrom(entryFields, entryParts), [entryFields, entryParts])
  const exitErrors = useMemo(() => validateFrom(exitFields, exitParts), [exitFields, exitParts])

  useEffect(() => {
    let alive = true
    fetchPortfolio().then(r => {
      if (!alive) return
      setSignedIn(r.status === 'ok')
      if (r.status === 'ok') setPortfolio(r.portfolio)
    })
    return () => { alive = false }
  }, [])

  const recorded: Trade[] = useMemo(
    () => (portfolio?.trades ?? []).filter(t => t.source === 'past'),
    [portfolio],
  )

  const sharesNum = Number(shares)
  const buyPriceNum = Number(buyPrice)
  const sellPriceNum = Number(sellPrice)

  const dateOrder = !sold || !buyDay || !sellDay || sellDay >= buyDay
  const baseOk =
    symbol.trim().length > 0 &&
    Number.isFinite(sharesNum) && sharesNum > 0 &&
    Number.isFinite(buyPriceNum) && buyPriceNum > 0 &&
    !!buyDay && buyDay <= todayISO() &&
    entryErrors.ok
  const sellOk =
    !sold || (
      Number.isFinite(sellPriceNum) && sellPriceNum > 0 &&
      !!sellDay && sellDay <= todayISO() &&
      exitErrors.ok
    )
  const canSubmit = baseOk && sellOk && dateOrder && !submitting

  const reset = () => {
    setSymbol(''); setShares('10'); setBuyDay(''); setBuyPrice('')
    setSold(false); setSellDay(''); setSellPrice('')
    setEntryParts({}); setExitParts({})
    setEntryTouched({}); setExitTouched({})
  }

  const submit = useCallback(async () => {
    if (submitting) return
    setSubmitting(true)
    setResult(null)
    const sym = symbol.trim().toUpperCase()
    try {
      const buy = await submitPastTrade({
        symbol: sym, name: sym, action: 'buy',
        shares: sharesNum, price: buyPriceNum,
        reason: composeFrom(entryFields, entryParts),
        executedOn: buyDay,
      })
      if (!buy.ok) {
        if (buy.unauthenticated) setSignedIn(false)
        setResult({ ok: false, msg: buy.message })
        return
      }
      setPortfolio(buy.portfolio)

      if (!sold) {
        setResult({ ok: true, msg: `${sym} の買いを記録しました。売ったときに、また戻ってきて売りを足せます。` })
        reset()
        return
      }

      const sell = await submitPastTrade({
        symbol: sym, name: sym, action: 'sell',
        shares: sharesNum, price: sellPriceNum,
        reason: composeFrom(exitFields, exitParts),
        executedOn: sellDay,
      })
      if (!sell.ok) {
        // 買いだけ残る。取り消せる場所を伝える（黙って «成功» にしない）。
        setResult({ ok: false, msg: `買いは記録できましたが、売りが記録できませんでした（${sell.message}）。下の一覧から買いを消してやり直せます。` })
        return
      }
      setPortfolio(sell.portfolio)
      setResult({ ok: true, msg: `${sym} の往復を記録しました。「振り返る」で結果と突き合わせられます。` })
      reset()
    } finally {
      setSubmitting(false)
    }
  }, [submitting, symbol, sharesNum, buyPriceNum, buyDay, sold, sellPriceNum, sellDay,
      entryFields, entryParts, exitFields, exitParts])

  const remove = useCallback(async (id: string) => {
    if (!confirm('この記録を消しますか？')) return
    const r = await deletePastTrade(id)
    if (r.ok) setPortfolio(r.portfolio)
    else setResult({ ok: false, msg: r.message })
  }, [])

  if (signedIn === false) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-emerald-400 uppercase">04 振り返る</p>
          <h1 className="text-2xl font-bold text-white mt-1">過去の取引を記録する</h1>
        </div>
        <div className="bg-panel border border-border rounded-xl p-8 text-center space-y-4">
          <p className="text-slate-300 text-sm">記録はアカウントに保存されるので、ログインが必要です。</p>
          <LoginLink className="inline-block px-4 py-2 bg-white text-gray-900 text-xs font-medium rounded-lg hover:bg-gray-100 transition-colors" />
        </div>
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-[0.18em] text-emerald-400 uppercase">04 振り返る</p>
        <h1 className="text-2xl font-bold text-white">過去の取引を記録する</h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          すでに実際にやった売買を入れると、<strong className="text-slate-200">今日から振り返りを始められます。</strong>
          結果が出るまで数週間待つ必要がありません。
        </p>
        <p className="text-[11px] text-muted leading-relaxed">
          ここで入れた記録は<strong className="text-slate-300">練習場の仮想残高を動かしません</strong>。
          「やる」で使う $100,000 とは別に、記録としてだけ残ります。
        </p>
      </header>

      {/* ── 取引の中身 ─────────────────────────────────────────── */}
      <section className="p-4 rounded-xl bg-surface border border-border space-y-4">
        <h2 className="text-xs font-semibold text-slate-300">何を、いくらで</h2>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label htmlFor="bf-symbol" className="block text-xs text-slate-400">銘柄</label>
            <input
              id="bf-symbol"
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              placeholder="AAPL"
              className="w-full px-3 py-2 rounded-lg bg-panel border border-border text-sm text-white placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bf-shares" className="block text-xs text-slate-400">株数</label>
            <input
              id="bf-shares"
              type="number"
              min={0}
              step="any"
              value={shares}
              onChange={e => setShares(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-panel border border-border text-sm text-white tabular-nums focus:border-emerald-600 focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bf-buyday" className="block text-xs text-slate-400">買った日</label>
            <input
              id="bf-buyday"
              type="date"
              max={todayISO()}
              value={buyDay}
              onChange={e => setBuyDay(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-panel border border-border text-sm text-white tabular-nums focus:border-emerald-600 focus:outline-none"
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="bf-buyprice" className="block text-xs text-slate-400">買値（1株あたり）</label>
            <input
              id="bf-buyprice"
              type="number"
              min={0}
              step="any"
              value={buyPrice}
              onChange={e => setBuyPrice(e.target.value)}
              placeholder="180.50"
              className="w-full px-3 py-2 rounded-lg bg-panel border border-border text-sm text-white tabular-nums placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
            />
          </div>
        </div>
      </section>

      {/* ── 買ったときの理由 ───────────────────────────────────── */}
      <section className="p-4 rounded-xl bg-surface border border-border space-y-4">
        <h2 className="text-xs font-semibold text-slate-300">買ったときのこと</h2>
        <ReasonFields
          fields={entryFields}
          parts={entryParts}
          onChange={(k, v) => setEntryParts(p => ({ ...p, [k]: v }))}
          errors={entryErrors.byKey}
          touched={entryTouched}
          onBlur={k => setEntryTouched(t => ({ ...t, [k]: true }))}
          idPrefix="bf-entry"
        />
      </section>

      {/* ── 売ったか ───────────────────────────────────────────── */}
      <section className="p-4 rounded-xl bg-surface border border-border space-y-4">
        <h2 className="text-xs font-semibold text-slate-300">その後</h2>

        <div className="flex gap-2">
          {([false, true] as const).map(v => (
            <button
              key={String(v)}
              type="button"
              aria-pressed={sold === v}
              onClick={() => { setSold(v); setResult(null) }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                sold === v ? 'bg-emerald-500 text-gray-950' : 'bg-panel text-slate-400 hover:text-white'
              }`}
            >
              {v ? 'もう売った' : 'まだ持っている'}
            </button>
          ))}
        </div>

        {!sold && (
          <p className="text-[11px] text-muted leading-relaxed">
            まだ持っている取引も記録できます。結果はまだ出ていないものとして「振り返る」に並びます。
            売ったあとに、また戻ってきて売りを足してください。
          </p>
        )}

        {sold && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label htmlFor="bf-sellday" className="block text-xs text-slate-400">売った日</label>
                <input
                  id="bf-sellday"
                  type="date"
                  max={todayISO()}
                  min={buyDay || undefined}
                  value={sellDay}
                  onChange={e => setSellDay(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-panel border border-border text-sm text-white tabular-nums focus:border-emerald-600 focus:outline-none"
                />
                {!dateOrder && (
                  <p className="text-[11px] text-amber-500">売った日は買った日より後にしてください</p>
                )}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="bf-sellprice" className="block text-xs text-slate-400">売値（1株あたり）</label>
                <input
                  id="bf-sellprice"
                  type="number"
                  min={0}
                  step="any"
                  value={sellPrice}
                  onChange={e => setSellPrice(e.target.value)}
                  placeholder="162.00"
                  className="w-full px-3 py-2 rounded-lg bg-panel border border-border text-sm text-white tabular-nums placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
                />
              </div>
            </div>

            <div className="pt-1">
              <h3 className="text-xs font-semibold text-slate-300 mb-3">売ったときのこと</h3>
              <ReasonFields
                fields={exitFields}
                parts={exitParts}
                onChange={(k, v) => setExitParts(p => ({ ...p, [k]: v }))}
                errors={exitErrors.byKey}
                touched={exitTouched}
                onBlur={k => setExitTouched(t => ({ ...t, [k]: true }))}
                idPrefix="bf-exit"
              />
            </div>
          </>
        )}
      </section>

      <div className="space-y-2">
        <button
          type="button"
          disabled={!canSubmit}
          onClick={submit}
          className="w-full py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-800 disabled:text-gray-600 text-gray-950 text-sm font-bold transition-colors"
        >
          {submitting ? '記録しています…' : 'この取引を記録する'}
        </button>
        {!canSubmit && !submitting && (
          <p className="text-[11px] text-muted text-center">
            銘柄・株数・買った日・買値と、買ったときに考えていたことを埋めてください。
          </p>
        )}
        {result && (
          <p role="status" className={`text-xs text-center ${result.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
            {result.msg}
          </p>
        )}
      </div>

      {/* ── 記録済み ───────────────────────────────────────────── */}
      <section className="p-4 rounded-xl bg-surface border border-border space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <h2 className="text-xs font-semibold text-slate-300">記録した過去の取引（{recorded.length}件）</h2>
          <Link href="/review" className="text-xs text-emerald-400 hover:text-emerald-300">振り返る →</Link>
        </div>

        {recorded.length === 0 ? (
          <p className="text-xs text-muted">まだありません。</p>
        ) : (
          <ul className="space-y-1.5">
            {recorded.map(t => (
              <li key={t.id} className="flex items-center gap-3 text-xs bg-panel border border-border rounded-lg px-3 py-2">
                <span className="font-mono font-bold text-white">{t.symbol}</span>
                <span className={t.action === 'buy' ? 'text-emerald-400' : 'text-rose-400'}>
                  {t.action === 'buy' ? '買' : '売'}
                </span>
                <span className="text-slate-400 tabular-nums">{t.shares}株 @ {usd(t.price)}</span>
                <span className="text-muted tabular-nums ml-auto">{fmtDay(t.timestamp)}</span>
                <button
                  type="button"
                  onClick={() => remove(t.id)}
                  className="shrink-0 text-muted hover:text-rose-400 transition-colors"
                  aria-label={`${t.symbol} の記録を消す`}
                >
                  消す
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        入力された価格・日付は本人の申告をそのまま保存します（こちらで実勢価格に書き換えません）。
        実際の証券口座・決済とは一切連携しません。このページは特定の銘柄の売買を推奨するものではありません。
      </p>
    </div>
  )
}
