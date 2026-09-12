'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { LoginLink } from '@/components/LoginLink'
import { buildJudgements, type Judgement } from '@/lib/review/judgement'
import { parseReason } from '@/lib/trade/reason'
import {
  fetchPortfolio,
  requestReset,
  getPortfolioValue,
  INITIAL_CASH,
  type Portfolio,
} from '@/lib/portfolio'

/**
 * 04 振り返る。
 *
 * 見た目は DESIGN.md §6-6 の見本（2026-09-11 切り分け3a）:
 *  - 一覧・操作の部分は「A アプリ型」: 地は --surface（灰）、内容は枠線なしの白い帯、
 *    見出しは帯の外に small/--muted、数字は右揃え・tabular-nums。
 *  - 判断の記録は「C ノート型」: 白い地に、左に日付・縦の線・丸印。枠線で囲わない。
 *  地の敷き方は app/page.tsx と同じ手書き。3回目が出たら components/ui/ へ抽出する（原則8）。
 */

function formatUSD(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 損益の書き方（DESIGN.md §6-4・§5-2）: 符号は必ず付け、マイナスは U+2212、ゼロは ±。
// 色だけに頼らない（色が見分けにくい人にも符号で伝わる）。割合は小数1桁。
function signOf(v: number): string {
  return v > 0 ? '+' : v < 0 ? '−' : '±'
}
function formatSignedUSD(v: number): string {
  return `${signOf(v)}${formatUSD(Math.abs(v))}`
}
function formatSignedPct(v: number): string {
  return `${signOf(v)}${Math.abs(v).toFixed(1)}%`
}
function pnlClass(v: number): string {
  return v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-muted'
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

/** 「9/11 15:00 時点」の短い書き方（§6-2）。表の日時は formatDate（年付き）のまま。 */
function formatClock(timestamp: number): string {
  const d = new Date(timestamp)
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${min}`
}

/** A アプリ型の地。<main> が max-w-6xl で中央に絞られているため、同色・広がり 100vmax の
 *  box-shadow で画面の左右の端・下端まで塗る（インクのはみ出しなのでレイアウトにも
 *  スクロール範囲にも入らず、横スクロールが出ない。上はヘッダーが上に描かれて隠れる）。
 *  中央 760px に絞る。理由の詳細は app/page.tsx の同じ箇所（同じ手書き）。 */
function Ground({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-surface shadow-[0_0_0_100vmax_var(--surface)] pt-1 pb-4 md:pb-5">
      <div className="max-w-[760px] mx-auto space-y-6">{children}</div>
    </div>
  )
}

function PageTitle() {
  return (
    <div>
      <p className="text-small text-muted">04 振り返る</p>
      <h1 className="text-h1 text-ink">判断を振り返る</h1>
    </div>
  )
}

/** 読み込み中は「完成時と同じ形の薄い枠」（§6-12）。画面全体をぐるぐるで覆わない。 */
function SkeletonBand({ rows, label }: { rows: number; label: string }) {
  return (
    <ul className="bg-card rounded-card motion-safe:animate-pulse" aria-busy="true" aria-label={label}>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i} className="mx-4 border-t border-border first:border-t-0 min-h-14 flex items-center justify-between gap-3 py-3">
          <div className="h-4 w-32 rounded-field bg-surface" />
          <div className="h-4 w-20 rounded-field bg-surface" />
        </li>
      ))}
    </ul>
  )
}

/**
 * 保存された理由を表示する。
 *
 * 2026-09-03 から `/trade`・TradeModal は理由を «問いへの分解» で保存する
 * （見出し付きテキスト・lib/trade/reason.ts）。見出しがあれば問いごとに分けて出し、
 * 無ければ旧形式の自由記述としてそのまま出す。**旧データを欠けたように見せない。**
 *
 * 買いの記録で「降りる条件」が無いとき（過去の取引をあとから入れた記録では任意）は
 * 「決めていなかった」と出す。責める言い方にしない（DESIGN.md §6-15）。
 */
function ReasonReadout({ text, kind }: { text: string; kind: 'entry' | 'exit' }) {
  const sections = parseReason(text)
  if (sections.length === 1 && sections[0].label === null) {
    return <p className="text-body text-ink-2 whitespace-pre-line max-w-[42rem]">{sections[0].value}</p>
  }
  const rows = [...sections]
  if (kind === 'entry' && !sections.some(s => s.label === '降りる条件')) {
    rows.push({ label: '降りる条件', value: '決めていなかった' })
  }
  return (
    <dl className="space-y-1">
      {/* スマホ幅（日付列 48px＋線の余白で本文が狭い）では見出しを上に積み、PC では横に並べる */}
      {rows.map((s, i) => (
        <div key={`${s.label ?? 'free'}-${i}`} className="flex flex-col sm:flex-row sm:gap-3">
          <dt className="shrink-0 text-small text-muted sm:w-20">{s.label ?? '—'}</dt>
          <dd className="min-w-0 max-w-[42rem] text-body text-ink-2 whitespace-pre-line">{s.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * 判断記録カード（DESIGN.md §6-15）を C ノート型で描く。
 * 並びは ①書いた理由 → ②その後の値動き（時点付き）→ ③損益（small）。損益を先頭にしない（P10）。
 * ④ずれのメモは未実装なので出さない。
 */
function JudgementNote({
  j,
  last,
  current,
}: {
  j: Judgement
  last: boolean
  /**
   * 保有中の銘柄の今の株価と時点。取得中は 'loading'、取れなかったら null（仮の値で埋めない・原則9）。
   * 取得中を null と同じに扱うと「失敗していないのに失敗」と表示してしまう（§6-12）。
   */
  current: 'loading' | { price: number; at: number } | null
}) {
  const closed = j.exitAt !== null && j.exitPrice !== null && j.pnlPct !== null
  const entry = new Date(j.entryAt)
  const pnlUSD = closed ? (j.exitPrice! - j.entryPrice) * j.shares : 0

  return (
    <li className="grid grid-cols-[48px_1fr]">
      {/* 左: 日付（年は caption、月日は small/600） */}
      <div className="pt-0.5">
        <span className="block text-caption text-muted tabular-nums">{entry.getFullYear()}</span>
        <span className="block text-small font-semibold text-ink tabular-nums">
          {entry.getMonth() + 1}/{entry.getDate()}
        </span>
      </div>

      {/* 右: 縦の線に沿って記録を置く。最後の記録は線を透明に */}
      <div className={`relative border-l pl-5 ${last ? 'border-transparent' : 'border-border pb-6'}`}>
        <span aria-hidden className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-brand bg-card" />

        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-body font-semibold text-ink">{j.symbol}</span>
            <span className="text-small text-muted">{j.name}</span>
            <span className="text-small text-muted tabular-nums">{j.shares.toLocaleString()}株</span>
            {/* 練習場の売買と «実際にやった取引の記録» を必ず見分けられるようにする。
                混ぜて見せると、どれが練習でどれが本物か本人にも分からなくなる。 */}
            {j.source === 'past' && (
              <span className="rounded-full bg-surface px-2 text-caption text-ink">実際の取引の記録</span>
            )}
          </div>

          {/* ① 書いた理由 */}
          <div className="space-y-2">
            <div>
              <p className="text-small text-muted">買ったときに考えていたこと</p>
              {j.entryReason ? (
                <ReasonReadout text={j.entryReason} kind="entry" />
              ) : (
                <p className="text-small text-muted">理由が残っていません（記録を始める前の取引です）</p>
              )}
            </div>
            {closed && (
              <div>
                <p className="text-small text-muted">売ったときに考えていたこと</p>
                {j.exitReason ? (
                  <ReasonReadout text={j.exitReason} kind="exit" />
                ) : (
                  <p className="text-small text-muted">理由が残っていません</p>
                )}
              </div>
            )}
          </div>

          {/* ② その後の値動き（それぞれ時点付き） */}
          <div>
            <p className="text-small text-muted">その後の値動き</p>
            <p className="text-body text-ink tabular-nums">
              買 {formatUSD(j.entryPrice)}
              <span className="text-caption text-muted">（{formatDate(j.entryAt)}）</span>
              {' → '}
              {closed ? (
                <>
                  売 {formatUSD(j.exitPrice!)}
                  <span className="text-caption text-muted">（{formatDate(j.exitAt!)}）</span>
                </>
              ) : current === 'loading' ? (
                <span className="text-small text-muted">株価を取得しています</span>
              ) : current ? (
                <>
                  今 {formatUSD(current.price)}
                  <span className="text-caption text-muted">（{formatDate(current.at)} 時点）</span>
                </>
              ) : (
                <span className="text-small text-warning-ink">今の株価を取得できませんでした</span>
              )}
            </p>
          </div>

          {/* ③ 損益（small・符号＋色）。保有中は結果が出ていないと書く */}
          {closed ? (
            <p className={`text-small tabular-nums ${pnlClass(j.pnlPct!)}`}>
              {formatSignedUSD(pnlUSD)}（{formatSignedPct(j.pnlPct!)}）
              <span className="text-muted">・{j.heldDays}日保有</span>
            </p>
          ) : (
            <p className="text-small text-muted">保有中（結果はまだ出ていません）</p>
          )}
        </div>
      </div>
    </li>
  )
}

export default function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [prices, setPrices] = useState<Record<string, number>>({})
  // 各株価の時点（ms）。API の lastUpdated を使い、読めなければ取得した時刻。
  const [quotedAt, setQuotedAt] = useState<Record<string, number>>({})
  const [loadingPrices, setLoadingPrices] = useState(false)
  // null = まだ判定中。false = 未ログイン（この面は «記録を見る» 面なのでログインが要る）。
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  const applyPortfolio = (p: Portfolio) => {
    setPortfolio(p)
    // 株価を取りに行く銘柄 = 保有中の銘柄 ∪ 未決済の判断記録の銘柄（重複除去）。
    // 「実際の取引の記録」（source='past'）の未決済分は positions に無いので、
    // positions だけを見ると常に「取得できませんでした」になってしまう。
    const openSymbols = buildJudgements(p.trades).judgements
      .filter(j => j.exitAt === null)
      .map(j => j.symbol)
    const symbols = Array.from(new Set([...p.positions.map(pos => pos.symbol), ...openSymbols]))
    if (symbols.length > 0) {
      setLoadingPrices(true)
      Promise.all(
        symbols.map(symbol =>
          fetch(`/api/stocks/${symbol}`)
            .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
            .then((q: { price: number; lastUpdated?: string }) => {
              const at = q.lastUpdated ? Date.parse(q.lastUpdated) : NaN
              return [symbol, q.price, Number.isNaN(at) ? Date.now() : at] as [string, number, number]
            })
            // 取れなかった銘柄は値を作らず、欠けたまま返す（原則9）。表示側が「取得できませんでした」と出す。
            .catch(() => null)
        )
      ).then(entries => {
        const got = entries.filter((e): e is [string, number, number] => e !== null)
        setPrices(Object.fromEntries(got.map(([s, p]) => [s, p])))
        setQuotedAt(Object.fromEntries(got.map(([s, , at]) => [s, at])))
        setLoadingPrices(false)
      })
    } else {
      setPrices({})
      setQuotedAt({})
      setLoadingPrices(false)
    }
  }

  useEffect(() => {
    let alive = true
    fetchPortfolio().then(r => {
      if (!alive) return
      setSignedIn(r.status === 'ok')
      if (r.status === 'ok') applyPortfolio(r.portfolio)
    })
    return () => { alive = false }
  }, [])

  const handleReset = async () => {
    if (!confirm('ポートフォリオをリセットしますか？全ての取引履歴と保有株が削除されます。')) return
    const r = await requestReset()
    if (r.status === 'ok') applyPortfolio(r.portfolio)
    else if (r.status === 'unauthenticated') setSignedIn(false)
  }

  if (signedIn === false) {
    return (
      <Ground>
        <PageTitle />
        <div className="bg-card rounded-card px-4 py-5 space-y-3">
          <p className="text-body text-ink">
            ここには<strong className="font-semibold">あなたの</strong>判断の記録が並びます。
          </p>
          <p className="text-small text-ink-2">
            記録はアカウントに保存されるので、ログインが必要です。「見る」「まねる」はログインなしで使えます。
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <LoginLink className="inline-flex h-12 items-center justify-center rounded-card bg-brand px-5 text-body font-semibold text-on-brand transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2">
              ログインして記録を見る
            </LoginLink>
            <Link href="/watch" className="text-small text-brand hover:underline">
              ログインせずに「見る」を開く
            </Link>
          </div>
        </div>
      </Ground>
    )
  }

  if (!portfolio) {
    return (
      <Ground>
        <PageTitle />
        <SkeletonBand rows={3} label="記録を読み込んでいます" />
      </Ground>
    )
  }

  // 株価が1つでも取れていない間は合計を出さない（avgCost で埋めた合計を実勢のように見せない）。
  const priceMissing = portfolio.positions.some(pos => prices[pos.symbol] === undefined)
  const totalsReady = !loadingPrices && !priceMissing
  const totalValue = getPortfolioValue(portfolio.positions, prices)
  const totalAssets = totalValue + portfolio.cash
  const totalPnL = totalAssets - INITIAL_CASH
  const totalPnLPct = (totalPnL / INITIAL_CASH) * 100
  // 総資産に使った株価のうち、いちばん新しい時点（保有銘柄の分だけ）。
  const quotedAtLatest = portfolio.positions.reduce((m, pos) => Math.max(m, quotedAt[pos.symbol] ?? 0), 0)

  const { judgements, closedCount, openCount, withEntryReason, entryCount } =
    buildJudgements(portfolio.trades)
  const shown = judgements.slice(0, 12)

  return (
    <Ground>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <PageTitle />
          <p className="text-body text-ink-2 mt-1 max-w-[42rem]">
            見るべきは儲けた額ではなく、判断の中身です。初期資本 <span className="tabular-nums">{formatUSD(INITIAL_CASH)}</span>
          </p>
        </div>
        {/* 元に戻せない操作＝取り消しボタン（§6-1）: 副の形で文字だけ --danger。
            whitespace-nowrap と shrink-0 が無いと、スマホ幅で見出しに押されて
            「リセ / ッ / ト」の3行に折れる（実測 64x58px）。 */}
        <button
          onClick={handleReset}
          className="shrink-0 whitespace-nowrap h-11 rounded-card border border-border-input bg-card px-4 text-small font-semibold text-danger transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
        >
          リセット
        </button>
      </div>

      {/* 判断と結果の突き合わせ — この面の主役。金額より先に出す（P10） */}
      <section className="space-y-2">
        <h2 className="text-small text-muted">判断と、その結果</h2>

        {entryCount === 0 ? (
          // 空: 何が無いか＋次の一手のボタン1つ（§6-12）。見本の架空データで埋めない。
          <div className="bg-card rounded-card px-4 py-5 space-y-2">
            <p className="text-body font-semibold text-ink">まだ判断の記録がありません</p>
            <p className="text-body text-ink-2 max-w-[42rem]">
              「やる」で売買すると、そのときに書いた理由と、あとで出た結果がここに並びます。
            </p>
            {/* 結果が出るまで待たずに始められる道を、空の状態でこそ見せる。
                すでに実際に売買している人は、来た時点で振り返る材料を持っている。 */}
            <p className="text-body text-ink-2 max-w-[42rem]">
              すでに実際に売買したことがあるなら、
              <Link href="/review/backfill" className="text-brand hover:underline">過去の取引を入れれば今日から振り返れます</Link>。
            </p>
            <div className="pt-2">
              <Link
                href="/trade"
                className="inline-flex h-12 items-center justify-center rounded-card bg-brand px-5 text-body font-semibold text-on-brand transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
              >
                03 やる で最初の記録を書く
              </Link>
            </div>
          </div>
        ) : (
          <>
            {/* 数えられる事実だけを出す。判断の質を点数にはしない */}
            <p className="flex flex-wrap gap-x-5 gap-y-1 text-small text-muted">
              <span>買った回数 <span className="text-ink tabular-nums font-semibold">{entryCount}</span></span>
              <span>うち理由が残っているもの <span className="text-ink tabular-nums font-semibold">{withEntryReason}</span></span>
              <span>結果が出たもの <span className="text-ink tabular-nums font-semibold">{closedCount}</span></span>
              <span>保有中 <span className="text-ink tabular-nums font-semibold">{openCount}</span></span>
            </p>

            {/* C ノート型: 白い地に、左に日付・縦の線・丸印。記録同士は余白で分ける */}
            <ol className="bg-card rounded-card px-4 py-5">
              {shown.map((j, i) => {
                const at = quotedAt[j.symbol]
                const price = prices[j.symbol]
                const current = loadingPrices
                  ? 'loading'
                  : price !== undefined && at !== undefined ? { price, at } : null
                return (
                  <JudgementNote
                    key={`${j.symbol}-${j.entryAt}-${i}`}
                    j={j}
                    last={i === shown.length - 1}
                    current={current}
                  />
                )
              })}
            </ol>

            <p className="text-small text-muted max-w-[42rem]">
              買いと売りは「買った順に売れていく」とみなして対応づけています。
              練習場の売買と「実際の取引の記録」は別々に突き合わせます。
              {openCount > 0 && '「今」の株価は取得時点のもので、遅れている場合があります。'}
              {closedCount < 3 && '結果が出た取引が3件未満のため、傾向としてはまだ読めません。'}
              <Link href="/review/backfill" className="text-brand hover:underline ml-1">
                過去の取引を記録する →
              </Link>
            </p>
          </>
        )}
      </section>

      {/* 資産: 数字タイル3枚の格子ではなく、1行の数字（§2）。取れていない値は —。
          数字の近くに「いつ時点の値か」を書く（§6-2）。仮想資金の札（§6-3）は 3d で。 */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className="text-small text-muted">資産（仮想資金）</h2>
          {totalsReady && quotedAtLatest > 0 && (
            <span className="text-caption text-muted tabular-nums">{formatClock(quotedAtLatest)} 時点</span>
          )}
        </div>
        <dl className="bg-card rounded-card px-4 py-3 min-h-14 flex flex-wrap items-center gap-x-6 gap-y-1">
          <div className="flex items-baseline gap-2">
            <dt className="text-small text-muted">総資産</dt>
            <dd className="text-body font-semibold text-ink tabular-nums">{totalsReady ? formatUSD(totalAssets) : '—'}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-small text-muted">損益（開始時から）</dt>
            <dd className={`text-body font-semibold tabular-nums ${totalsReady ? pnlClass(totalPnL) : 'text-muted'}`}>
              {totalsReady ? `${formatSignedUSD(totalPnL)}（${formatSignedPct(totalPnLPct)}）` : '—'}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-small text-muted">現金</dt>
            <dd className="text-body font-semibold text-ink tabular-nums">{formatUSD(portfolio.cash)}</dd>
          </div>
        </dl>
        {!loadingPrices && priceMissing && (
          <p className="text-small text-warning-ink">一部の株価を取得できませんでした。総資産と損益は出していません。</p>
        )}
      </section>

      {/* Holdings Table */}
      <section className="space-y-2">
        <h2 className="text-small text-muted">保有銘柄</h2>
        {loadingPrices ? (
          <SkeletonBand rows={Math.max(1, portfolio.positions.length)} label="株価を取得しています" />
        ) : portfolio.positions.length === 0 ? (
          <div className="bg-card rounded-card px-4 py-5 space-y-2">
            <p className="text-body text-ink">まだ保有銘柄がありません。</p>
            {/* 「銘柄を探す」は `/`（LP）に戻るだけで銘柄を探せず、「スクリーナー」は
                導線から外した `/screener` の旧名だった。実データで銘柄を出せるのは
                `/learn` の自動スクリーニングだけなので、文言と行き先を揃える。
                主ボタン（bg-brand）は1画面に1つ（§6-1）で、記録0のときは上の
                「判断と、その結果」が持つ。ここは文字リンクにとどめる。 */}
            <p className="text-small text-ink-2">
              買いたい銘柄が決まっていなければ、<Link href="/learn" className="text-brand hover:underline">条件から銘柄を探す</Link>こともできます。
            </p>
            <Link href="/trade" className="inline-block text-small text-brand hover:underline">
              自分で判断して売買する →
            </Link>
          </div>
        ) : (
          // 表（§6-18）: 見出し行は small/--muted を --surface の上に、数字は右揃え、
          // 行の区切りは --border。スマホでは帯の中だけで横にスクロール。
          <div className="bg-card rounded-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-small">
                <thead>
                  <tr className="bg-surface text-muted">
                    <th className="text-left px-4 py-2 font-normal whitespace-nowrap">銘柄</th>
                    <th className="text-right px-4 py-2 font-normal whitespace-nowrap">株数</th>
                    <th className="text-right px-4 py-2 font-normal whitespace-nowrap">平均コスト</th>
                    <th className="text-right px-4 py-2 font-normal whitespace-nowrap">現在値</th>
                    <th className="text-right px-4 py-2 font-normal whitespace-nowrap">評価額</th>
                    <th className="text-right px-4 py-2 font-normal whitespace-nowrap">損益</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.positions.map(pos => {
                    const currentPrice = prices[pos.symbol]
                    const has = currentPrice !== undefined
                    const marketValue = has ? pos.shares * currentPrice : null
                    const pnl = has ? (currentPrice - pos.avgCost) * pos.shares : null
                    const pnlPct = has ? ((currentPrice - pos.avgCost) / pos.avgCost) * 100 : null
                    return (
                      <tr key={pos.symbol} className="border-t border-border">
                        <td className="px-4 py-3 min-w-[10rem]">
                          <Link href={`/stocks/${pos.symbol}`} className="block text-body font-semibold text-brand hover:underline">
                            {pos.symbol}
                          </Link>
                          <span className="block text-small text-muted max-w-[180px] truncate">{pos.name}</span>
                        </td>
                        <td className="px-4 py-3 text-right text-ink tabular-nums whitespace-nowrap">{pos.shares.toLocaleString()}株</td>
                        <td className="px-4 py-3 text-right text-ink-2 tabular-nums">{formatUSD(pos.avgCost)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {has ? (
                            <span className="text-ink">{formatUSD(currentPrice)}</span>
                          ) : (
                            <span className="text-warning-ink whitespace-nowrap">取得できませんでした</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right text-ink tabular-nums">{marketValue !== null ? formatUSD(marketValue) : '—'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          {pnl !== null && pnlPct !== null ? (
                            <span className={pnlClass(pnl)}>
                              {formatSignedUSD(pnl)}<br />
                              <span className="text-caption">（{formatSignedPct(pnlPct)}）</span>
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>

      {/* Trade History */}
      <section className="space-y-2">
        <h2 className="text-small text-muted">取引履歴（最新10件）</h2>
        {portfolio.trades.length === 0 ? (
          <div className="bg-card rounded-card px-4 py-5">
            <p className="text-body text-ink">取引履歴がありません。</p>
          </div>
        ) : (
          <div className="bg-card rounded-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-small">
                <thead>
                  <tr className="bg-surface text-muted">
                    <th className="text-left px-4 py-2 font-normal whitespace-nowrap">日時</th>
                    <th className="text-left px-4 py-2 font-normal whitespace-nowrap">種別</th>
                    <th className="text-left px-4 py-2 font-normal whitespace-nowrap">銘柄</th>
                    <th className="text-right px-4 py-2 font-normal whitespace-nowrap">株数</th>
                    <th className="text-right px-4 py-2 font-normal whitespace-nowrap">単価</th>
                    <th className="text-right px-4 py-2 font-normal whitespace-nowrap">合計</th>
                  </tr>
                </thead>
                <tbody>
                  {portfolio.trades.slice(0, 10).map(trade => (
                    <tr key={trade.id} className="border-t border-border">
                      <td className="px-4 py-3 text-ink-2 tabular-nums whitespace-nowrap">{formatDate(trade.timestamp)}</td>
                      {/* 方向は記号＋文字、色は付けない（P8・§6-5） */}
                      <td className="px-4 py-3 text-ink whitespace-nowrap">{trade.action === 'buy' ? '▲ 買い' : '▼ 売り'}</td>
                      <td className="px-4 py-3 min-w-[10rem]">
                        <Link href={`/stocks/${trade.symbol}`} className="block text-body font-semibold text-brand hover:underline">
                          {trade.symbol}
                        </Link>
                        <span className="block text-small text-muted max-w-[160px] truncate">{trade.name}</span>
                      </td>
                      <td className="px-4 py-3 text-right text-ink tabular-nums whitespace-nowrap">{trade.shares.toLocaleString()}株</td>
                      <td className="px-4 py-3 text-right text-ink-2 tabular-nums">{formatUSD(trade.price)}</td>
                      <td className="px-4 py-3 text-right text-ink tabular-nums">{formatUSD(trade.shares * trade.price)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </section>
    </Ground>
  )
}
