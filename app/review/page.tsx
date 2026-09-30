'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { LoginLink } from '@/components/LoginLink'
import { PriceSincePanel } from '@/components/review/PriceSincePanel'
import { buildJudgements, type Judgement } from '@/lib/review/judgement'
import { findPattern, keyOf, MIN_RECORDS, type Pattern } from '@/lib/review/patterns'
import { isNoRule, parseExitLevel } from '@/lib/review/exit-rule'
import { parseReason } from '@/lib/trade/reason'
import { MIN_ELAPSED_BUSINESS_DAYS } from '@/lib/entry/answer-examples'
import type { HistoricalBar } from '@/types'
import type { Period } from '@/lib/market'
import {
  fetchPortfolio,
  requestReset,
  getPortfolioValue,
  INITIAL_CASH,
  type Portfolio,
} from '@/lib/portfolio'

/**
 * 03 読み返す（S2b「振り返りの作り直し」・2026-09-30。S1「3段の道」の旧 5節 → 3節）。
 *
 * この画面はサイト全体の見返り（払い戻し）。オーナー原文（2026-09-29）「実際の振り返りでももっとわかりやすい文章それから
 * 視覚的にわかりやすいように工夫してほしい」。designer 2026-09-29 の設計 A〜F をそのまま実装する:
 *  - h1 の直下に **最初の1行**（記録の件数で変わる。0／1／2〜4／5件以上・偏りあり／5件以上・偏りなし）
 *  - 節1「あなたが書いたことと、そのあとの株価」: 判断記録カード（C ノート型）。並びは
 *      ①日付レール ②買う前に、あなたが書いたこと（主役・--ink） ③売るときに書いたこと ④そのあと、株価はこう動きました（図＋ずれの1文）
 *      ⑤数字はいちばん下。**図は最新3件まで**（Yahoo の 429 を避ける。4件目以降は図なし）
 *  - 節2「いまの仮想資金（実際のお金は1円も動きません）」: 資産と保有銘柄（最下部。金額をファーストビューに置かない）
 *  - 節3「記録を足す・やり直す」: /review/backfill への導線と「記録をすべて消す」（取り消しボタンは画面で唯一の --danger）
 *
 * 守っていること:
 *  - 合成スコア・点数・ランクを作らない（lib/review/judgement.ts は1文字も変えない）。クセは lib/review/patterns.ts の純関数が
 *    5件以上・4/5 以上のときだけ1つ返す。「あと◯件」のカウントダウンにしない（R12）
 *  - 成績の比較（あなた／AI）を出さない。損益に色を付けない（DECISIONS 2026-09-24）
 *  - 図の線は実データだけ。取れなければ「取得できませんでした」と書く（原則9）。架空のカードを1枚も描かない
 *  - 「取引履歴（最新10件）」の節は削除（同じ売買を2回出しており理由が無い。2026-09-29 オーナー承認）
 *  - 使わない語: 守れた／守れなかった／正しかった／判断ミス／的中／当たった／外れた／正解／見本／お手本
 * 検査: scripts/check-review.ts
 */

const DAY_MS = 86_400_000

function formatUSD(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

// 損益の書き方（DESIGN.md §6-4・§5-2）: 符号は必ず付け、マイナスは U+2212、ゼロは ±。割合は小数1桁。
function signOf(v: number): string {
  return v > 0 ? '+' : v < 0 ? '−' : '±'
}
function formatSignedUSD(v: number): string {
  return `${signOf(v)}${formatUSD(Math.abs(v))}`
}
function formatSignedPct(v: number): string {
  return `${signOf(v)}${Math.abs(v).toFixed(1)}%`
}
// 損益から色を外す（DECISIONS.md 2026-09-24「損益から色を外す」）。ゼロだけ text-muted。
function pnlClass(v: number): string {
  return v === 0 ? 'text-muted' : 'text-ink'
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/** 「9/11 15:00 時点」の短い書き方（§6-2）。 */
function formatClock(timestamp: number): string {
  const d = new Date(timestamp)
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${min}`
}

/** 「10月28日」 */
function formatMonthDay(timestamp: number): string {
  const d = new Date(timestamp)
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

/** 土日を除いて n 日進める（祝日は数えない近似。「ごろ」と添えて出す） */
function addBusinessDays(ms: number, n: number): number {
  const d = new Date(ms)
  let left = n
  while (left > 0) {
    d.setDate(d.getDate() + 1)
    const w = d.getDay()
    if (w !== 0 && w !== 6) left--
  }
  return d.getTime()
}

/**
 * 図に使う日足の期間。買った日の少し前（5営業日）から今日までを覆う最小の期間を選ぶ。
 * '2y' は週足なので使わない。5年より前の買いは '5y' でも覆えず、図は「取得できませんでした」になる。
 */
function periodFor(entryAt: number, now: number): Period {
  const days = (now - entryAt) / DAY_MS + 14
  if (days <= 33) return '1mo'
  if (days <= 95) return '3mo'
  if (days <= 190) return '6mo'
  if (days <= 370) return '1y'
  return '5y'
}

/** 図を付ける件数の上限（新しい順）。Yahoo の 429 を避ける（designer 2026-09-29 の推測値・未実測） */
const MAX_FIGURES = 3

/** 中央 760px に絞る。地は root の <body className="bg-background">（--bg・唯一の不透明な面）が塗る。 */
function Ground({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-1 pb-4 md:pb-5">
      <div className="max-w-[760px] mx-auto space-y-6">{children}</div>
    </div>
  )
}

function PageTitle() {
  return (
    <div>
      <p className="text-small text-muted">03 読み返す</p>
      <h1 className="text-h1 text-ink">書いたことを、株価と並べて読み返す</h1>
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

const NO_REASON = 'この回は、理由を書いていません'
const NO_EXIT_RULE = '降りる条件は決めていませんでした'

/** 見出し付きの理由から、見出しの本文を取る。見出しが無い（旧形式）なら null */
function sectionOf(text: string | null, label: string): string | null {
  if (!text) return null
  const s = parseReason(text).find(x => x.label === label)
  return s ? s.value : null
}
/** 見出し付きで書かれているか */
function isStructuredText(text: string | null): boolean {
  return !!text && parseReason(text).some(s => s.label !== null)
}

/**
 * 買う前に書いたこと（主役）。【見立て】と【降りる条件】を --ink、【注目】を --ink-2 で。
 * 見出しの無い古い記録はそのまま1つの文として出す（旧データを欠けたように見せない）。
 * 【降りる条件】が無いときは「決めていませんでした」（責めない言い方・DESIGN.md §6-15）。
 */
function EntryReadout({ text }: { text: string | null }) {
  if (!text) return <p className="text-small text-muted">{NO_REASON}</p>
  const sections = parseReason(text)
  if (sections.length === 1 && sections[0].label === null) {
    return <p className="text-body text-ink whitespace-pre-line max-w-[42rem]">{sections[0].value}</p>
  }
  const rows = [...sections]
  if (!sections.some(s => s.label === '降りる条件')) rows.push({ label: '降りる条件', value: NO_EXIT_RULE })
  return (
    <dl className="space-y-1">
      {rows.map((s, i) => (
        <div key={`${s.label ?? 'free'}-${i}`} className="flex flex-col sm:flex-row sm:gap-3">
          <dt className="shrink-0 text-small text-muted sm:w-20">{s.label ?? '—'}</dt>
          <dd className={`min-w-0 max-w-[42rem] text-body whitespace-pre-line ${s.label === '注目' ? 'text-ink-2' : 'text-ink'}`}>{s.value}</dd>
        </div>
      ))}
    </dl>
  )
}

/** 売るときに書いたこと（脇役・--ink-2） */
function ExitReadout({ text }: { text: string | null }) {
  if (!text) return <p className="text-small text-muted">{NO_REASON}</p>
  const sections = parseReason(text)
  if (sections.length === 1 && sections[0].label === null) {
    return <p className="text-body text-ink-2 whitespace-pre-line max-w-[42rem]">{sections[0].value}</p>
  }
  return (
    <dl className="space-y-1">
      {sections.map((s, i) => (
        <div key={`${s.label ?? 'free'}-${i}`} className="flex flex-col sm:flex-row sm:gap-3">
          <dt className="shrink-0 text-small text-muted sm:w-20">{s.label ?? '—'}</dt>
          <dd className="min-w-0 max-w-[42rem] text-body text-ink-2 whitespace-pre-line">{s.value}</dd>
        </div>
      ))}
    </dl>
  )
}

type Figure = { bars: HistoricalBar[] | null; at: number | null }

/**
 * 判断記録カード（DESIGN.md §6-15）を C ノート型で描く。
 * 並びは ①日付レール → ②買う前に書いたこと（主役）→ ③売るときに書いたこと → ④そのあとの株価（図＋ずれの1文）→ ⑤数字。
 * 損益を先頭にしない（P10）。
 */
function JudgementNote({
  j,
  last,
  figure,
  flagged,
}: {
  j: Judgement
  last: boolean
  /** 図の材料。'none'＝この回には図を付けない（4件目以降）。'loading'＝取得中。null＝取れなかった */
  figure: Figure | 'loading' | 'none'
  /** 「あなたのクセ」に該当した回 */
  flagged: boolean
}) {
  const closed = j.exitAt !== null && j.exitPrice !== null && j.pnlPct !== null
  const entry = new Date(j.entryAt)
  const pnlUSD = closed ? (j.exitPrice! - j.entryPrice) * j.shares : 0
  // 「決めていなかった」と書いた記録は、条件が空のときと同じに扱う（S2b レビュー W2・lib/review/exit-rule.ts の isNoRule）。
  // 過去の売買を入れる画面の記入例が「例: 決めていなかった / -10%で切るつもりだった」なので、実際にこう書く人がいる。
  const rawExitRule = sectionOf(j.entryReason, '降りる条件')
  const exitRuleText = isNoRule(rawExitRule) ? null : rawExitRule
  const exitLevel = exitRuleText ? parseExitLevel(exitRuleText, j.entryPrice, { yen: /\.T$/i.test(j.symbol) }) : null
  const changeText = closed ? sectionOf(j.exitReason, '変化') : null

  return (
    <li className="grid grid-cols-[48px_1fr]">
      {/* ① 左: 日付（年は caption、月日は small/600） */}
      <div className="pt-0.5">
        <span className="block text-caption text-muted tabular-nums">{entry.getFullYear()}</span>
        <span className="block text-small font-semibold text-ink tabular-nums">
          {entry.getMonth() + 1}/{entry.getDate()}
        </span>
      </div>

      {/* 右: 縦の線に沿って記録を置く。最後の記録は線を透明に */}
      <div className={`relative border-l pl-5 ${last ? 'border-transparent' : 'border-border pb-6'}`}>
        <span aria-hidden className="absolute -left-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-brand bg-card" />

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-body font-semibold text-ink">{j.symbol}</span>
            <span className="text-small text-muted">{j.name}</span>
            <span className="text-small text-muted tabular-nums">{j.shares.toLocaleString()}株</span>
            {/* 練習場の売買と «実際にやった取引の記録» を必ず見分けられるようにする */}
            {j.source === 'past' && (
              <span className="rounded-full bg-surface px-2 text-caption text-ink">実際の取引の記録</span>
            )}
            {flagged && <span className="rounded-full bg-surface px-2 text-caption text-ink">この回</span>}
          </div>

          {/* ② 買う前に、あなたが書いたこと（主役） */}
          <div>
            <p className="text-small text-muted">買う前に、あなたが書いたこと</p>
            <EntryReadout text={j.entryReason} />
          </div>

          {/* ③ 売るときに書いたこと */}
          {closed && (
            <div>
              <p className="text-small text-muted">売るときに書いたこと</p>
              <ExitReadout text={j.exitReason} />
            </div>
          )}

          {/* ④ そのあと、株価はこう動きました（図＋ずれの1文）。4件目以降は付けない */}
          {figure !== 'none' && (
            <PriceSincePanel
              symbol={j.symbol}
              entryAt={j.entryAt}
              entryPrice={j.entryPrice}
              exitAt={j.exitAt}
              exitPrice={j.exitPrice}
              exitRuleText={exitRuleText}
              exitLevel={exitLevel}
              bars={figure === 'loading' ? 'loading' : figure.bars}
              quotedAt={figure === 'loading' ? null : figure.at}
              changeText={changeText}
            />
          )}

          {/* ⑤ 数字はいちばん下（small・符号付き・色なし） */}
          {closed ? (
            <p className="text-small tabular-nums text-ink-2">
              買 {formatUSD(j.entryPrice)}<span className="text-muted">（{formatDate(j.entryAt)}）</span>
              {' → '}売 {formatUSD(j.exitPrice!)}<span className="text-muted">（{formatDate(j.exitAt!)}）</span>
              <span className={`ml-2 ${pnlClass(j.pnlPct!)}`}>{formatSignedUSD(pnlUSD)}（{formatSignedPct(j.pnlPct!)}）</span>
              <span className="text-muted">・{j.heldDays}日保有</span>
            </p>
          ) : (
            <p className="text-small tabular-nums text-ink-2">
              買 {formatUSD(j.entryPrice)}<span className="text-muted">（{formatDate(j.entryAt)}）</span>
              <span className="text-muted">・まだ売っていません（読み返すのはこれからです）</span>
            </p>
          )}
        </div>
      </div>
    </li>
  )
}

/**
 * h1 の直下の最初の1行（designer 2026-09-29 の設計 A）。記録の件数で変える。
 * 「あと◯件」のカウントダウンにしない（R12）。5件以上のクセは patterns.ts が返したときだけ。
 */
function Opening({ entryCount, first, pattern, now }: { entryCount: number; first: Judgement | null; pattern: Pattern | null; now: number }) {
  if (entryCount === 0) {
    return (
      <div className="space-y-1">
        <p className="text-h2 text-ink">読み返す材料は、まだありません。</p>
        <p className="text-small text-ink-2 max-w-[42rem]">
          株を買う前に理由を書くと、ここに残ります。{MIN_ELAPSED_BUSINESS_DAYS}営業日ほど（約1か月）あとに、その理由と実際の株価を並べて読み返せます。
        </p>
      </div>
    )
  }
  if (entryCount === 1 && first) {
    const thesis = sectionOf(first.entryReason, '見立て') ?? (first.entryReason && !isStructuredText(first.entryReason) ? first.entryReason : null)
    const noExitRule = isStructuredText(first.entryReason) && isNoRule(sectionOf(first.entryReason, '降りる条件'))
    const readableAt = addBusinessDays(first.entryAt, MIN_ELAPSED_BUSINESS_DAYS)
    return (
      <div className="space-y-2">
        <p className="text-h2 text-ink">{first.symbol} を買ったときに書いたことが、1件残っています。</p>
        {thesis ? (
          <p className="text-body text-ink whitespace-pre-line max-w-[42rem]">{thesis}</p>
        ) : (
          <p className="text-small text-muted">{NO_REASON}</p>
        )}
        {noExitRule && (
          <p className="text-body text-ink-2 max-w-[42rem]">{NO_EXIT_RULE}。それに気づけたことが、この記録のいちばんの中身です。</p>
        )}
        {readableAt > now && (
          <p className="text-small text-ink-2">{formatMonthDay(readableAt)}ごろ、この記録を実際の株価と並べて読み返せます。</p>
        )}
      </div>
    )
  }
  if (entryCount < MIN_RECORDS) {
    return (
      <div className="space-y-1">
        <p className="text-h2 text-ink">{entryCount}件の記録が残っています。</p>
        <p className="text-small text-ink-2 max-w-[42rem]">同じことを{MIN_RECORDS}回書くと、共通するところを1つだけ出します。いまは1件ずつ読み返せます。</p>
      </div>
    )
  }
  if (pattern) {
    return (
      <div className="space-y-1">
        <p className="text-h2 text-ink">あなたのクセが、1つ見えてきた。</p>
        <p className="text-body text-ink max-w-[42rem]">{pattern.text}</p>
      </div>
    )
  }
  return (
    <p className="text-h2 text-ink">{entryCount}件を読み返しましたが、同じ向きに寄っているものは見つかりませんでした。</p>
  )
}

export default function ReviewPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [prices, setPrices] = useState<Record<string, number>>({})
  // 各株価の時点（ms）。API の lastUpdated を使い、読めなければ取得した時刻。
  const [quotedAt, setQuotedAt] = useState<Record<string, number>>({})
  const [loadingPrices, setLoadingPrices] = useState(false)
  // 図の日足（銘柄ごと）。取れなかった銘柄は bars: null（仮の値で埋めない・原則9）
  const [figures, setFigures] = useState<Record<string, Figure>>({})
  const [loadingFigures, setLoadingFigures] = useState(false)
  // null = まだ判定中。false = 未ログイン（この面は «記録を見る» 面なのでログインが要る）。
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  const [now] = useState(() => Date.now())

  const applyPortfolio = (p: Portfolio) => {
    setPortfolio(p)

    // 保有銘柄の今の株価（仮想資金の合計に使う）
    const symbols = Array.from(new Set(p.positions.map(pos => pos.symbol)))
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
        setPrices(Object.fromEntries(got.map(([s, pr]) => [s, pr])))
        setQuotedAt(Object.fromEntries(got.map(([s, , at]) => [s, at])))
        setLoadingPrices(false)
      })
    } else {
      setPrices({})
      setQuotedAt({})
      setLoadingPrices(false)
    }

    // 図の日足: 新しい順に MAX_FIGURES 件まで。同じ銘柄は1回で、いちばん古い買いを覆う期間を取る
    const top = buildJudgements(p.trades).judgements.slice(0, MAX_FIGURES)
    const oldest = new Map<string, number>()
    for (const j of top) oldest.set(j.symbol, Math.min(oldest.get(j.symbol) ?? Infinity, j.entryAt))
    if (oldest.size > 0) {
      setLoadingFigures(true)
      Promise.all(
        Array.from(oldest.entries()).map(([symbol, entryAt]) =>
          fetch(`/api/stocks/${symbol}/history?period=${periodFor(entryAt, Date.now())}`)
            .then(async r => {
              if (!r.ok) return [symbol, { bars: null, at: null }] as [string, Figure]
              const body = (await r.json()) as unknown
              const bars = Array.isArray(body) ? (body as HistoricalBar[]) : null
              // 取得時点は応答の Date ヘッダ（サーバーが返した時刻）。読めなければ null＝「取得時点が分かりません」（時刻を作らない）
              const at = Date.parse(r.headers.get('date') ?? '')
              return [symbol, { bars, at: Number.isNaN(at) ? null : at }] as [string, Figure]
            })
            .catch(() => [symbol, { bars: null, at: null }] as [string, Figure])
        )
      ).then(entries => {
        setFigures(Object.fromEntries(entries))
        setLoadingFigures(false)
      })
    } else {
      setFigures({})
      setLoadingFigures(false)
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
    if (!confirm('記録をすべて消しますか？書いた理由も、前に売買したことの記録も、元に戻せません。')) return
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
            ここには、<strong className="font-semibold">あなたが</strong>買う前に書いた理由と、そのあとの株価が並びます。
          </p>
          <p className="text-small text-ink-2">
            記録はアカウントに保存されるので、ログインが必要です。「AIの判断を読む」「くらべる」はログインなしで使えます。
          </p>
          <div className="flex flex-wrap items-center gap-4 pt-1">
            <LoginLink className="inline-flex h-12 items-center justify-center rounded-card bg-brand px-5 text-body font-semibold text-on-brand transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2">
              ログインして記録を読み返す
            </LoginLink>
            <Link href="/watch" className="text-small text-brand hover:underline">
              ログインせずに「AIの判断」を読む
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
  const quotedAtLatest = portfolio.positions.reduce((m, pos) => Math.max(m, quotedAt[pos.symbol] ?? 0), 0)

  const { judgements, closedCount, openCount, withEntryReason, entryCount } = buildJudgements(portfolio.trades)
  const shown = judgements.slice(0, 12)
  // クセは5件以上のときだけ探す（純関数。時刻・ユーザーを入力にしない）
  const pattern = entryCount >= MIN_RECORDS ? findPattern(judgements) : null
  const flaggedKeys = new Set(pattern?.keys ?? [])

  return (
    <Ground>
      <PageTitle />
      <Opening entryCount={entryCount} first={judgements[judgements.length - 1] ?? null} pattern={pattern} now={now} />

      {/* 節1: あなたが書いたことと、そのあとの株価 — この面の主役。金額より先に出す（P10） */}
      <section className="space-y-2">
        <h2 className="text-small text-muted">あなたが書いたことと、そのあとの株価</h2>

        {entryCount === 0 ? (
          // 空: 何が無いか＋ここに並ぶものの見取り図（文字だけ）＋次の一手のボタン1つ（§6-12）。架空のカードで埋めない。
          <div className="bg-card rounded-card px-4 py-5 space-y-3">
            <p className="text-body text-ink">ここに並ぶもの</p>
            <ol className="space-y-1 text-body text-ink-2 max-w-[42rem]">
              <li>① あなたが書いた理由（見立て・注目・降りる条件）</li>
              <li>② そのあとの株価（買った日に印を付けた折れ線）</li>
              <li>③ 書いた条件と株価のずれを、1文で</li>
            </ol>
            <div className="pt-1">
              <Link
                href="/trade"
                className="inline-flex h-12 items-center justify-center rounded-card bg-brand px-5 text-body font-semibold text-on-brand transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
              >
                01 書く で最初の記録を書く
              </Link>
            </div>
            <p className="flex flex-wrap gap-x-4 gap-y-1 text-small">
              <Link href="/review/backfill" className="text-brand hover:underline">過去に買った株を、いま記録する</Link>
              <Link href="/watch" className="text-brand hover:underline">AIの判断を読む（ログイン不要）</Link>
            </p>
          </div>
        ) : (
          <>
            {/* 数えられる事実だけを1文で。判断の質を点数にはしない */}
            <p className="text-small text-muted max-w-[42rem]">
              買った記録は<span className="text-ink tabular-nums font-semibold">{entryCount}</span>件
              （理由が残っているもの <span className="text-ink tabular-nums">{withEntryReason}</span>件・
              売って終わったもの <span className="text-ink tabular-nums">{closedCount}</span>件・
              まだ売っていないもの <span className="text-ink tabular-nums">{openCount}</span>件）です。
            </p>

            {/* C ノート型: 左に日付・縦の線・丸印。記録同士は余白で分ける */}
            <ol className="bg-card rounded-card px-4 py-5">
              {shown.map((j, i) => {
                const figure: Figure | 'loading' | 'none' =
                  i >= MAX_FIGURES ? 'none'
                  : loadingFigures ? 'loading'
                  : figures[j.symbol] ?? { bars: null, at: null }
                return (
                  <JudgementNote
                    key={`${keyOf(j)}-${i}`}
                    j={j}
                    last={i === shown.length - 1}
                    figure={figure}
                    flagged={flaggedKeys.has(keyOf(j))}
                  />
                )
              })}
            </ol>

            <p className="text-small text-muted max-w-[42rem]">
              1つの銘柄を何回かに分けて売ったときは、古い買いから順に対応させています。
              練習場の売買と「実際の取引の記録」は別々に対応させます。
              {shown.length > MAX_FIGURES && `図は新しい${MAX_FIGURES}件に付けています。`}
              {judgements.length > shown.length && `新しい${shown.length}件を出しています。`}
            </p>
          </>
        )}
      </section>

      {/* 節2: いまの仮想資金（最下部寄り）。1行の数字＋保有銘柄の表。取れていない値は —。数字の近くに時点（§6-2） */}
      <section className="space-y-2">
        <div className="flex items-baseline justify-between gap-4 flex-wrap">
          <h2 className="text-small text-muted">いまの仮想資金（実際のお金は1円も動きません）</h2>
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
            <dt className="text-small text-muted">開始時からの増減</dt>
            <dd className={`text-body font-semibold tabular-nums ${totalsReady ? pnlClass(totalPnL) : 'text-muted'}`}>
              {totalsReady ? `${formatSignedUSD(totalPnL)}（${formatSignedPct(totalPnLPct)}）` : '—'}
            </dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-small text-muted">現金</dt>
            <dd className="text-body font-semibold text-ink tabular-nums">{formatUSD(portfolio.cash)}</dd>
          </div>
          <div className="flex items-baseline gap-2">
            <dt className="text-small text-muted">開始時</dt>
            <dd className="text-small text-ink-2 tabular-nums">{formatUSD(INITIAL_CASH)}</dd>
          </div>
        </dl>
        {!loadingPrices && priceMissing && (
          <p className="text-small text-warning-ink">一部の株価を取得できませんでした。総資産と増減は出していません。</p>
        )}

        {loadingPrices ? (
          <SkeletonBand rows={Math.max(1, portfolio.positions.length)} label="株価を取得しています" />
        ) : portfolio.positions.length === 0 ? (
          <p className="text-small text-muted">いま持っている銘柄はありません。</p>
        ) : (
          // 表（§6-18）: 見出し行は small/--muted を --surface の上に、数字は右揃え、行の区切りは --border。
          <div className="bg-card rounded-card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-small">
                <thead>
                  <tr className="bg-surface text-muted">
                    <th className="text-left px-4 py-2 font-normal whitespace-nowrap">持っている銘柄</th>
                    <th className="text-right px-4 py-2 font-normal whitespace-nowrap">株数</th>
                    <th className="text-right px-4 py-2 font-normal whitespace-nowrap">平均の買値</th>
                    <th className="text-right px-4 py-2 font-normal whitespace-nowrap">今の株価</th>
                    <th className="text-right px-4 py-2 font-normal whitespace-nowrap">時価</th>
                    <th className="text-right px-4 py-2 font-normal whitespace-nowrap">増減</th>
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

      {/* 節3: 記録を足す・やり直す（最下部）。取り消しボタン（§6-1）は副の形で文字だけ --danger＝この画面で唯一 */}
      <section className="space-y-2">
        <h2 className="text-small text-muted">記録を足す・やり直す</h2>
        <div className="bg-card rounded-card px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <p className="text-small text-ink-2 max-w-[42rem]">
            すでに実際に売買したことがあるなら、
            <Link href="/review/backfill" className="text-brand hover:underline">過去の取引を入れて、今日から読み返せます</Link>。
          </p>
          <button
            onClick={handleReset}
            className="shrink-0 whitespace-nowrap h-11 rounded-card border border-border-input bg-card px-4 text-small font-semibold text-danger transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
          >
            記録をすべて消す
          </button>
        </div>
      </section>
    </Ground>
  )
}
