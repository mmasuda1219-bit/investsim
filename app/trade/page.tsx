'use client'

import { Suspense, useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import type { StockQuote } from '@/types'
import { fetchPortfolio, submitTrade, MIN_REASON, type Portfolio } from '@/lib/portfolio'

/**
 * 「やる」— 自分で判断して売買する練習場。
 *
 * COMPANY.md 原則11（ゴールは人間の投資スキル向上）に対応する中核の面。
 * 「見る」「まねる」で得た材料をもとに、**自分が**判断する。
 *
 * 設計上の要（外さないこと）:
 *  - 売買のたびに理由を日本語で書かせる。理由のない取引は受け付けない。
 *    これが無いと「振り返る」で判断の質を見る材料が残らず、ただの売買ごっこになる。
 *  - 価格は実データのみ。取得に失敗したらモックで代替せず、その旨を表示して止める
 *    （原則9・過去に tick がモックで動いていた経緯があるため明示的に禁止する）。
 *  - ここに「おすすめ」「買い時」の類は一切出さない。判断するのは利用者であり、
 *    アプリが推奨すると投資助言に接近する。
 */

const PRESET = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'JPM']

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * useSearchParams はビルド時のプリレンダリングを止めるため Suspense で包む必要がある。
 * 外側をページ、内側を本体に分ける。
 */
export default function TradePage() {
  return (
    <Suspense fallback={<div className="max-w-3xl mx-auto text-sm text-slate-500">読み込み中…</div>}>
      <TradePageBody />
    </Suspense>
  )
}

function TradePageBody() {
  // 「見る」「まねる」から ?symbol=XXX で銘柄を引き継げる（4段階を繋ぐ受け口）
  const params = useSearchParams()
  const handedOver = params.get('symbol')?.trim().toUpperCase()
  const [symbol, setSymbol] = useState(handedOver || 'AAPL')
  const [input, setInput] = useState('')
  const [quote, setQuote] = useState<StockQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [shares, setShares] = useState('10')
  const [reason, setReason] = useState('')
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  // 未ログインでも «画面は見せる»（見るのは自由）。売買しようとした時点でログインを促す。
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

  useEffect(() => {
    let alive = true
    setLoading(true); setQuote(null); setQuoteError(null)
    fetch(`/api/stocks/${encodeURIComponent(symbol)}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((q: StockQuote & { error?: string }) => {
        if (!alive) return
        if (q.error || typeof q.price !== 'number') throw new Error(q.error ?? '価格が取得できませんでした')
        setQuote(q)
      })
      .catch((e: Error) => { if (alive) setQuoteError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [symbol])

  const sharesNum = Number(shares)
  const validShares = Number.isFinite(sharesNum) && sharesNum > 0
  const reasonOk = reason.trim().length >= MIN_REASON
  // 未ログイン（signedIn === false）でもボタンは押せるままにする。押した結果として
  // ログインを促すほうが、最初から押せない画面より «何をすれば使えるか» が伝わる。
  const canTrade = !!quote && validShares && reasonOk && !submitting

  const held = portfolio?.positions.find(p => p.symbol === symbol)?.shares ?? 0

  // 残高・保有株数の判定はサーバー（execute_trade）が行う。ここで先に判定して
  // 出し分けると、判定が2か所に増えていつか食い違う。
  const submit = useCallback(async (action: 'buy' | 'sell') => {
    if (!quote || submitting) return
    setSubmitting(true)
    try {
      const r = await submitTrade({
        symbol: quote.symbol, name: quote.name, action,
        shares: sharesNum, price: quote.price, reason,
      })
      if (r.ok) {
        setResult({ ok: true, msg: `${action === 'buy' ? '買い' : '売り'} ${sharesNum}株を記録しました。理由も一緒に残しています。` })
        setReason('')
        setPortfolio(r.portfolio)
        setSignedIn(true)
      } else {
        if (r.unauthenticated) setSignedIn(false)
        setResult({ ok: false, msg: r.message })
      }
    } finally {
      setSubmitting(false)
    }
  }, [quote, sharesNum, reason, submitting])

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-[0.18em] text-emerald-400 uppercase">03 やる</p>
        <h1 className="text-2xl font-bold text-white">自分で判断して売買する</h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          仮想の資金で売買します。<strong className="text-slate-200">なぜそう判断したかを必ず書いてください。</strong>
          あとで「振り返る」を開いたとき、儲けた額ではなく判断の中身を見返せるようになります。
        </p>
      </header>

      {/* 未ログインの案内。判定が済むまで（signedIn === null）は出さない。
          先に出すとログイン済みの人にも一瞬ちらつく。 */}
      {signedIn === false && (
        <div className="rounded-lg border border-amber-800/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-200 flex items-center justify-between gap-3 flex-wrap">
          <span>売買の記録を残すにはログインが必要です。読むだけならログインは要りません。</span>
          <Link
            href="/auth/login"
            className="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg bg-white text-gray-900 text-xs font-medium hover:bg-gray-100 transition-colors"
          >
            ログイン
          </Link>
        </div>
      )}

      {/* ── 銘柄を選ぶ ─────────────────────────────────────────── */}
      <section className="p-4 rounded-xl bg-surface border border-border space-y-3">
        <h2 className="text-xs font-semibold text-slate-300">銘柄</h2>
        <div className="flex flex-wrap gap-1.5">
          {PRESET.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => { setSymbol(s); setResult(null) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                symbol === s ? 'bg-emerald-500 text-gray-950' : 'bg-panel text-slate-400 hover:text-white'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault()
            const v = input.trim().toUpperCase()
            if (v) { setSymbol(v); setInput(''); setResult(null) }
          }}
        >
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="他の銘柄（例: BRK-B）"
            aria-label="銘柄コード"
            className="flex-1 min-w-0 px-3 py-2 rounded-lg bg-panel border border-border text-sm text-white placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
          />
          <button type="submit" className="px-4 py-2 rounded-lg border border-border text-xs font-semibold text-slate-300 hover:text-white hover:border-gray-500 transition-colors">
            表示
          </button>
        </form>
      </section>

      {/* ── 現在値 ───────────────────────────────────────────── */}
      <section className="p-4 rounded-xl bg-surface border border-border">
        {loading && <p className="text-sm text-slate-500">価格を取得中…</p>}

        {!loading && quoteError && (
          <div className="space-y-1">
            <p className="text-sm text-rose-400 font-medium">価格を取得できませんでした</p>
            <p className="text-xs text-slate-500 leading-relaxed">
              {quoteError} — 実データが取れないときは、代わりの数字を作らずここで止めます。
              時間をおいて試すか、別の銘柄を選んでください。
            </p>
          </div>
        )}

        {!loading && quote && (
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-lg font-bold text-white">{quote.symbol}</span>
            <span className="text-xs text-slate-500 truncate">{quote.name}</span>
            <span className="text-2xl font-bold text-white tabular-nums">{usd(quote.price)}</span>
            <span className={`text-sm font-semibold tabular-nums ${quote.change >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
              {quote.change >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%
            </span>
            <span className="text-[11px] text-slate-600 ml-auto">
              {quote.isMarketOpen ? '取引時間中' : '時間外'}・保有 {held}株
            </span>
          </div>
        )}
      </section>

      {/* ── 判断を記録する ─────────────────────────────────────── */}
      <section className="p-4 rounded-xl bg-surface border border-border space-y-4">
        <h2 className="text-xs font-semibold text-slate-300">あなたの判断</h2>

        <div className="space-y-1.5">
          <label htmlFor="shares" className="block text-xs text-slate-400">株数</label>
          <input
            id="shares"
            type="number"
            min={1}
            value={shares}
            onChange={e => setShares(e.target.value)}
            className="w-32 px-3 py-2 rounded-lg bg-panel border border-border text-sm text-white tabular-nums focus:border-emerald-600 focus:outline-none"
          />
          {quote && validShares && (
            <p className="text-[11px] text-slate-500 tabular-nums">概算 {usd(sharesNum * quote.price)}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="reason" className="block text-xs text-slate-400">
            なぜそう判断したか <span className="text-emerald-400">（必須）</span>
          </label>
          <textarea
            id="reason"
            rows={3}
            value={reason}
            onChange={e => setReason(e.target.value)}
            placeholder="例: 決算が良く、売上の伸びが続いている。ここ数日下げたので拾いたい。"
            className="w-full px-3 py-2 rounded-lg bg-panel border border-border text-sm text-white leading-relaxed placeholder:text-slate-600 focus:border-emerald-600 focus:outline-none"
          />
          <p className={`text-[11px] ${reasonOk ? 'text-slate-600' : 'text-amber-500'}`}>
            {reasonOk ? '記録できます' : `あと${Math.max(0, MIN_REASON - reason.trim().length)}文字。理由のない取引は記録しません`}
          </p>
        </div>

        <div className="flex gap-2.5">
          <button
            type="button"
            disabled={!canTrade}
            onClick={() => submit('buy')}
            className="flex-1 py-2.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:bg-gray-800 disabled:text-gray-600 text-gray-950 text-sm font-bold transition-colors"
          >
            買う
          </button>
          <button
            type="button"
            disabled={!canTrade || held < sharesNum}
            onClick={() => submit('sell')}
            className="flex-1 py-2.5 rounded-lg border border-rose-500/50 hover:bg-rose-500/10 disabled:border-gray-800 disabled:text-gray-600 text-rose-400 text-sm font-bold transition-colors"
          >
            売る
          </button>
        </div>

        {result && (
          <p role="status" className={`text-xs ${result.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
            {result.msg}
          </p>
        )}

        {portfolio && (
          <p className="text-[11px] text-slate-500 tabular-nums pt-1 border-t border-border">
            仮想の残高 {usd(portfolio.cash)}・保有 {portfolio.positions.length}銘柄
            <Link href="/review" className="text-emerald-400 hover:text-emerald-300 ml-2">振り返る →</Link>
          </p>
        )}
      </section>

      <p className="text-[11px] text-slate-500 leading-relaxed">
        仮想資金による練習です。実際の証券口座・決済とは一切連携しません。
        このページは特定の銘柄の売買を推奨するものではありません。
      </p>
    </div>
  )
}
