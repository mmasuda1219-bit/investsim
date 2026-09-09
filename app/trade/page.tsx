'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { LoginLink } from '@/components/LoginLink'
import type { StockQuote } from '@/types'
import { fetchPortfolio, submitTrade, type Portfolio } from '@/lib/portfolio'
import { composeReason, validateParts, fieldsFor, type ReasonParts, type TradeAction } from '@/lib/trade/reason'
import { ReasonFields } from '@/components/ReasonFields'

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
 *
 * 2026-09-03: 理由の入力を «自由記述1つ» から «問いへの分解» に変えた
 * （JOURNEY.md 断絶2）。型を持っていない人に白紙を出すと書けずに離脱し、
 * 10文字の下限は「なんとなく上がりそう」を通してしまい、振り返る材料にならなかった。
 * 問いは買いと売りで違うので、先に売買を選んでから理由を書く順序にしている。
 */

/**
 * 最初に目に入る銘柄。ここを «選べる銘柄の全部» にはしない。
 *
 * 売買できるのは data/universe.json にある約5,500銘柄（公式の上場リストにあり、
 * かつ実価格が取れたもの）で、検索から全部に届く。それでも入口を数銘柄に絞るのは、
 * 初めて開いた人に5,500件を突きつけても «どれを見るか» を選べないため。
 * 原則11（ゴールは人間の投資スキル向上）に照らすと、選択肢の多さそのものは価値ではない。
 * 推奨ではなく «誰でも知っている会社» という基準で並べている。
 */
const PRESET = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'JPM']

interface SearchHit { symbol: string; name: string; market: 'US' | 'JP' | 'OTHER' }

const usd = (n: number) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/**
 * useSearchParams はビルド時のプリレンダリングを止めるため Suspense で包む必要がある。
 * 外側をページ、内側を本体に分ける。
 */
export default function TradePage() {
  return (
    <Suspense fallback={<div className="max-w-3xl mx-auto text-base text-muted">読み込み中…</div>}>
      <TradePageBody />
    </Suspense>
  )
}

const EMPTY: { buy: ReasonParts; sell: ReasonParts } = { buy: {}, sell: {} }

function TradePageBody() {
  // 「見る」「まねる」から ?symbol=XXX で銘柄を引き継げる（4段階を繋ぐ受け口）
  const params = useSearchParams()
  const handedOver = params.get('symbol')?.trim().toUpperCase()
  const [symbol, setSymbol] = useState(handedOver || 'AAPL')
  const [input, setInput] = useState('')
  const [quote, setQuote] = useState<StockQuote | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /** 公式の上場リスト由来の一覧に載っている銘柄か。null は判定前。 */
  const [listed, setListed] = useState<boolean | null>(null)
  const [matches, setMatches] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)

  const [action, setAction] = useState<TradeAction>('buy')
  const [shares, setShares] = useState('10')
  // 買いと売りで問いが違うので入力も別に持つ。切り替えで書いたものが消えない。
  const [parts, setParts] = useState(EMPTY)
  const [touched, setTouched] = useState<{ buy: Record<string, boolean>; sell: Record<string, boolean> }>({ buy: {}, sell: {} })
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
    // 失敗時もAPIは理由をJSONで返す（listed: 一覧に載っている銘柄か）。
    // r.ok だけ見て捨てると「知らない銘柄」と「データ源の障害」を画面で区別できない。
    fetch(`/api/stocks/${encodeURIComponent(symbol)}`)
      .then(async r => ({ ok: r.ok, body: await r.json().catch(() => ({})) }))
      .then(({ ok, body }: { ok: boolean; body: StockQuote & { error?: string; listed?: boolean } }) => {
        if (!alive) return
        if (!ok || body.error || typeof body.price !== 'number') {
          setListed(body.listed ?? null)
          throw new Error(body.error ?? '価格が取得できませんでした')
        }
        setListed(body.listed ?? null)
        setQuote(body)
      })
      .catch((e: Error) => { if (alive) setQuoteError(e.message) })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [symbol])

  // 入力に対する候補出し。/api/search はローカルのユニバースを一次ソースにしているので
  // ネットワーク往復なしで返り、Yahoo が 429 の間も候補は出続ける。
  useEffect(() => {
    const q = input.trim()
    if (q.length < 1) { setMatches([]); return }
    let alive = true
    setSearching(true)
    const timer = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`)
        .then(r => (r.ok ? r.json() : []))
        .then((hits: SearchHit[]) => { if (alive) setMatches(Array.isArray(hits) ? hits : []) })
        .catch(() => { if (alive) setMatches([]) })
        .finally(() => { if (alive) setSearching(false) })
    }, 250)
    return () => { alive = false; clearTimeout(timer) }
  }, [input])

  const pick = useCallback((s: string) => {
    setSymbol(s.trim().toUpperCase())
    setInput(''); setMatches([]); setResult(null)
  }, [])

  const sharesNum = Number(shares)
  const validShares = Number.isFinite(sharesNum) && sharesNum > 0

  const current = parts[action]
  const errors = useMemo(() => validateParts(action, current), [action, current])

  const held = portfolio?.positions.find(p => p.symbol === symbol)?.shares ?? 0
  const enoughShares = action === 'buy' || held >= sharesNum

  // 未ログイン（signedIn === false）でもボタンは押せるままにする。押した結果として
  // ログインを促すほうが、最初から押せない画面より «何をすれば使えるか» が伝わる。
  const canTrade = !!quote && validShares && errors.ok && enoughShares && !submitting

  const setPart = useCallback((key: string, value: string) => {
    setParts(p => ({ ...p, [action]: { ...p[action], [key]: value } }))
  }, [action])

  const markTouched = useCallback((key: string) => {
    setTouched(t => ({ ...t, [action]: { ...t[action], [key]: true } }))
  }, [action])

  // 残高・保有株数の判定はサーバー（execute_trade）が行う。ここで先に判定して
  // 出し分けると、判定が2か所に増えていつか食い違う。
  const submit = useCallback(async () => {
    if (!quote || submitting) return
    setSubmitting(true)
    try {
      const r = await submitTrade({
        symbol: quote.symbol, name: quote.name, action,
        shares: sharesNum, price: quote.price,
        reason: composeReason(action, parts[action]),
      })
      if (r.ok) {
        setResult({ ok: true, msg: `${action === 'buy' ? '買い' : '売り'} ${sharesNum}株を記録しました。書いた理由も一緒に残っています。` })
        setParts(p => ({ ...p, [action]: {} }))
        setTouched(t => ({ ...t, [action]: {} }))
        setPortfolio(r.portfolio)
        setSignedIn(true)
      } else {
        if (r.unauthenticated) setSignedIn(false)
        setResult({ ok: false, msg: r.message })
      }
    } finally {
      setSubmitting(false)
    }
  }, [quote, sharesNum, action, parts, submitting])

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      <header className="space-y-2">
        <p className="text-sm font-semibold tracking-[0.18em] text-emerald-700 uppercase">03 やる</p>
        <h1 className="text-2xl font-bold text-ink">自分で判断して売買する</h1>
        <p className="text-base text-ink-2 leading-relaxed max-w-[42rem]">
          仮想の資金で売買します。<strong className="text-ink">なぜそう判断したかを必ず書いてください。</strong>
          あとで「振り返る」を開いたとき、儲けた額ではなく判断の中身を見返せるようになります。
        </p>
      </header>

      {/* 未ログインの案内。判定が済むまで（signedIn === null）は出さない。
          先に出すとログイン済みの人にも一瞬ちらつく。 */}
      {signedIn === false && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700 flex items-center justify-between gap-3 flex-wrap">
          <span>売買の記録を残すにはログインが必要です。読むだけならログインは要りません。</span>
          <LoginLink className="shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg bg-accent text-on-accent text-sm font-medium transition-colors" />
        </div>
      )}

      {/* ── 銘柄を選ぶ ─────────────────────────────────────────── */}
      <section className="p-4 rounded-xl bg-surface border border-border space-y-3">
        <h2 className="text-xl font-semibold text-ink">銘柄</h2>
        <div className="flex flex-wrap gap-1.5">
          {PRESET.map(s => (
            <button
              key={s}
              type="button"
              onClick={() => { setSymbol(s); setResult(null) }}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                symbol === s ? 'bg-accent text-on-accent' : 'bg-panel text-ink-2 hover:text-ink'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
        <form
          className="relative"
          onSubmit={e => {
            e.preventDefault()
            // 候補が出ているなら先頭を採る。出ていなければ打った文字をそのまま銘柄として扱う
            // （新規上場などユニバース生成後の銘柄に手で到達できる余地を残す）。
            const v = matches[0]?.symbol ?? input.trim().toUpperCase()
            if (v) pick(v)
          }}
        >
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="銘柄名かティッカーで検索（例: Ford, BRK-B, 半導体銘柄のティッカー）"
            aria-label="銘柄を検索"
            autoComplete="off"
            className="w-full min-w-0 px-3 py-2 rounded-lg bg-panel border border-border text-base text-ink placeholder:text-muted focus:border-emerald-200 focus:outline-none"
          />

          {input.trim() && (
            <ul className="absolute z-20 mt-1 w-full max-h-72 overflow-y-auto rounded-lg border border-border bg-panel shadow-xl">
              {matches.map(m => (
                <li key={m.symbol}>
                  <button
                    type="button"
                    onClick={() => pick(m.symbol)}
                    className="w-full flex items-baseline gap-2 px-3 py-2 text-left hover:bg-border transition-colors"
                  >
                    <span className="text-base font-semibold text-ink shrink-0">{m.symbol}</span>
                    <span className="text-sm text-ink-2 truncate">{m.name}</span>
                    {m.market === 'JP' && <span className="ml-auto shrink-0 text-xs text-muted">東証</span>}
                  </button>
                </li>
              ))}
              {matches.length === 0 && (
                <li className="px-3 py-2 text-sm text-muted leading-relaxed">
                  {searching ? '検索中…' : '一覧に見つかりませんでした。ティッカーを直接入力して Enter でも表示できます。'}
                </li>
              )}
            </ul>
          )}
        </form>

        <p className="text-sm text-muted leading-relaxed max-w-[42rem]">
          米国の主要取引所（NYSE・NYSE American・Nasdaq）に上場している普通株から検索できます。
          一覧は取引所の公式リストをもとに作り、実際に値が付くことを確認した銘柄だけを載せています。
        </p>
      </section>

      {/* ── 現在値 ───────────────────────────────────────────── */}
      <section className="p-4 rounded-xl bg-surface border border-border">
        {loading && <p className="text-base text-muted">価格を取得中…</p>}

        {/* 「その銘柄を知らない」と「データ源が落ちている」は原因も対処も違うので分けて出す。
            listed は /api/stocks/:symbol が返す «公式リスト由来の一覧にあるか»。 */}
        {!loading && quoteError && (
          <div className="space-y-1">
            <p className="text-base text-rose-700 font-medium">
              {listed === false ? `${symbol} は一覧にありません` : '価格を取得できませんでした'}
            </p>
            <p className="text-base text-ink-2 leading-relaxed max-w-[42rem]">
              {listed === false ? (
                <>
                  米国の主要取引所に上場する普通株の一覧に、このティッカーが見当たりません。
                  綴りを確かめるか、上の検索から会社名で探してください
                  （ETF・優先株・新規上場直後の銘柄は一覧に入っていません）。
                </>
              ) : (
                <>
                  {quoteError} — 実データが取れないときは、代わりの数字を作らずここで止めます。
                  時間をおいて試すか、別の銘柄を選んでください。
                </>
              )}
            </p>
          </div>
        )}

        {!loading && quote && (
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-lg font-bold text-ink">{quote.symbol}</span>
            <span className="text-sm text-muted truncate">{quote.name}</span>
            <span className="text-2xl font-bold text-ink tabular-nums">{usd(quote.price)}</span>
            <span className={`text-sm font-semibold tabular-nums ${quote.change >= 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
              {quote.change >= 0 ? '+' : ''}{quote.changePercent.toFixed(2)}%
            </span>
            <span className="text-sm text-muted ml-auto tabular-nums">
              {quote.isMarketOpen ? '取引時間中' : '時間外'}・保有 {held}株
            </span>
          </div>
        )}
      </section>

      {/* ── 判断を記録する ─────────────────────────────────────── */}
      <section className="p-4 rounded-xl bg-surface border border-border space-y-4">
        <h2 className="text-xl font-semibold text-ink">あなたの判断</h2>

        {/* 買いと売りで «問うこと» が違うので、先にどちらかを選ぶ */}
        <div className="flex gap-2">
          {(['buy', 'sell'] as const).map(a => (
            <button
              key={a}
              type="button"
              aria-pressed={action === a}
              onClick={() => { setAction(a); setResult(null) }}
              className={`flex-1 py-2 rounded-lg text-sm font-semibold transition-colors ${
                action === a
                  ? (a === 'buy' ? 'bg-success text-ink' : 'bg-danger text-ink')
                  : 'bg-panel text-ink-2 hover:text-ink'
              }`}
            >
              {a === 'buy' ? '買う' : '売る'}
            </button>
          ))}
        </div>

        <div className="space-y-1.5">
          <label htmlFor="shares" className="block text-sm text-ink-2">株数</label>
          <input
            id="shares"
            type="number"
            min={1}
            value={shares}
            onChange={e => setShares(e.target.value)}
            className="w-32 px-3 py-2 rounded-lg bg-panel border border-border text-base text-ink tabular-nums focus:border-emerald-200 focus:outline-none"
          />
          {quote && validShares && (
            <p className="text-sm text-muted tabular-nums">概算 {usd(sharesNum * quote.price)}</p>
          )}
          {action === 'sell' && validShares && !enoughShares && (
            <p className="text-sm text-amber-700 tabular-nums">保有は{held}株です</p>
          )}
        </div>

        <ReasonFields
          fields={fieldsFor(action)}
          parts={current}
          onChange={setPart}
          errors={errors.byKey}
          touched={touched[action]}
          onBlur={markTouched}
          idPrefix={`trade-${action}`}
        />

        <button
          type="button"
          disabled={!canTrade}
          onClick={submit}
          className={`w-full py-2.5 rounded-lg text-sm font-bold transition-colors disabled:bg-surface disabled:text-muted disabled:border-transparent ${
            action === 'buy'
              ? 'bg-success hover:bg-emerald-100 text-ink'
              : 'bg-danger hover:bg-red-100 text-ink'
          }`}
        >
          {action === 'buy' ? '買いを記録する' : '売りを記録する'}
        </button>

        {!errors.ok && (
          <p className="text-sm text-muted text-center leading-relaxed">
            必須の問いを埋めると記録できます。理由のない取引は記録しません。
          </p>
        )}

        {result && (
          <p role="status" className={`text-sm leading-relaxed ${result.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
            {result.msg}
          </p>
        )}

        {portfolio && (
          <p className="text-sm text-muted tabular-nums pt-2 border-t border-border">
            仮想の残高 {usd(portfolio.cash)}・保有 {portfolio.positions.length}銘柄
            <Link href="/review" className="text-emerald-700 hover:text-emerald-800 ml-2">振り返る →</Link>
          </p>
        )}
      </section>

      <p className="text-sm text-ink-2 leading-relaxed max-w-[42rem]">
        仮想資金による練習です。実際の証券口座・決済とは一切連携しません。
        このページは特定の銘柄の売買を推奨するものではありません。
      </p>
    </div>
  )
}
