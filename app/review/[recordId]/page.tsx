'use client'

import { use, useEffect, useState } from 'react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { LoginLink } from '@/components/LoginLink'
import { PriceSincePanel, PRICE_SOURCE, fmtPrice } from '@/components/review/PriceSincePanel'
import { PremiseChain } from '@/components/review/PremiseChain'
import { PlanVsActualBars } from '@/components/review/PlanVsActualBars'
import { findRecord, openShares, type ReviewRecord } from '@/lib/review/record'
import { computeBaseRates, type BaseRate } from '@/lib/review/base-rates'
import { parsePlannedHold } from '@/lib/review/planned-hold'
import { isNoRule, parseExitLevel } from '@/lib/review/exit-rule'
import { parseReason } from '@/lib/trade/reason'
import { fetchPortfolio } from '@/lib/portfolio'
import type { HistoricalBar } from '@/types'

/**
 * 「1件のふりかえり」（S3a・2026-09-30・DECISIONS 2026-09-30 3本目）。
 * 一覧（/review）の1件を、買いの `Trade.id`（uuid）で開く。**AI を使わず、Supabase のマイグレーションも無し**（費用ゼロ）。
 *
 * 上から: ヘッダー（記録 #N・銘柄・買った日 → 売った日・保有日数・バッジ「このサイトは良し悪しを判定しません」）
 *   → あなたが書いたこと（見立て／注目／降りる条件・原文のまま）→ 売るときに書いたこと
 *   → ロジックの検証（PremiseChain）→ 言ったこと vs やったこと（PlanVsActualBars＋PriceSincePanel）
 *   → 起きたことの頻度（base-rates・各項目に対象期間／本数／出所／取得時点）→ 数字（最下部）→ フッター
 * §6（逆の見方）と §7（次の問い）は S3a では節ごと出さない（S3c／S3b）。
 *
 * 守っていること:
 *  - 良し悪しを判定しない（バッジとフッターを常に出す）。点数・ランクを作らない。損益に色を付けない
 *  - 画面に出る株価の数字は図と同じ日足から（/api/stocks/{symbol}/history?period=5y・allowMock:false）。
 *    本人の記録の買値は「あなたの記録では $X」と出所を書いて表示だけにし、値動きの計算根拠にしない（DECISIONS (11)）
 *  - 未記入は「書かれていません」。原文は書き換えない。`--danger` を使わない
 *  - `lib/ai-trader/**`・`lib/investors/**` を import しない
 *
 * ルートの優先: `app/review/backfill/page.tsx`（固定の区切り）は、この動的な区切り `[recordId]` より優先される
 * （Next.js の規約: 固定の区切りが動的な区切りに勝つ）。したがって `/review/backfill` はこのページに来ない。
 * `recordId` が uuid の形でなければ `notFound()`（自分の記録に無い id も同じ）。
 * 検査: scripts/check-review-record.ts。
 */

const DAY_MS = 86_400_000
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOT_WRITTEN = '書かれていません'
const BADGE = 'このサイトは良し悪しを判定しません'
const FOOTER = 'このサイトは、あなたの判断の良し悪しを判定しません。出しているのは、あなたが書いたことと、実際に起きたことの記録だけです。'
const NO_PLANNED = '予定していた期間は、書かれた文からは読み取れません。'
const DISTRIBUTION_NOTE = '過去の分布であり、将来を予測するものではありません'

function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function formatDateTime(ms: number): string {
  const d = new Date(ms)
  return `${formatDate(ms)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
function monthDay(ms: number): string {
  const d = new Date(ms)
  return `${d.getMonth() + 1}/${d.getDate()}`
}
// 損益の書き方（DESIGN.md §6-4）: 符号は必ず付け、マイナスは U+2212。色は付けない（DECISIONS 2026-09-24）
function signOf(v: number): string {
  return v > 0 ? '+' : v < 0 ? '−' : '±'
}
function signedMoney(symbol: string, v: number): string {
  return `${signOf(v)}${fmtPrice(symbol, Math.abs(v))}`
}
function signedPct(v: number): string {
  return `${signOf(v)}${Math.abs(v).toFixed(1)}%`
}

/** 見出し付きの理由から、見出しの本文を取る。見出しが無い（旧形式）なら null */
function sectionOf(text: string | null, label: string): string | null {
  if (!text) return null
  const s = parseReason(text).find(x => x.label === label)
  return s ? s.value : null
}
function isLegacy(text: string | null): boolean {
  if (!text) return false
  const s = parseReason(text)
  return s.length === 1 && s[0].label === null
}

/** 中央 760px に絞る（一覧と同じ幅） */
function Ground({ children }: { children: React.ReactNode }) {
  return (
    <div className="pt-1 pb-4 md:pb-5">
      <div className="max-w-[760px] mx-auto space-y-6">{children}</div>
    </div>
  )
}

function Crumb() {
  return (
    <p className="text-small text-muted">
      <Link href="/review" className="text-brand hover:underline">03 読み返す</Link>
      <span aria-hidden> ／ </span>1件のふりかえり
    </p>
  )
}

/** 読み込み中は完成時と同じ形の薄い枠（§6-12）。動かない（R4） */
function LoadingFrame({ label }: { label: string }) {
  return (
    <div role="status" aria-busy="true" className="bg-card rounded-card border border-border min-h-24 flex items-center justify-center px-4">
      <span className="text-small text-muted">{label}</span>
    </div>
  )
}

type Figure = { bars: HistoricalBar[] | null; at: number | null }

/** 書いたことの1枚（見立て／注目／降りる条件）。原文のまま。未記入は「書かれていません」 */
function WrittenCard({ heading, hint, text, writtenAt, source, note }: {
  heading: string
  hint: string
  text: string | null
  writtenAt: number
  source: 'practice' | 'past'
  note?: string
}) {
  return (
    <div className="bg-card rounded-card border border-border px-4 py-3 space-y-1 min-w-0">
      <p className="text-small font-semibold text-ink">{heading}</p>
      <p className="text-caption text-muted">{hint}</p>
      {text ? (
        <p className="text-body text-ink whitespace-pre-line break-words">{text}</p>
      ) : (
        <p className="text-body text-warning-ink">{NOT_WRITTEN}</p>
      )}
      {note && <p className="text-caption text-muted">{note}</p>}
      <p className="text-caption text-muted tabular-nums">
        {source === 'past'
          ? `記録した買った日 ${formatDate(writtenAt)}（あとから入れた記録なので、書いた日時は残っていません）`
          : `記入日時 ${formatDateTime(writtenAt)}`}
      </p>
    </div>
  )
}

/** 売るときに書いたこと（【売る理由】【変化】）。見出しの無い旧形式は全文 */
function SellReadout({ text }: { text: string | null }) {
  if (!text) return <p className="text-body text-warning-ink">{NOT_WRITTEN}</p>
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

function BaseRateList({ items, at }: { items: BaseRate[]; at: number | null }) {
  const fetched = at !== null && Number.isFinite(at) ? `取得 ${formatClock(at)} 時点` : '取得時点が分かりません'
  return (
    <ul className="space-y-4">
      {items.map(r => (
        <li key={r.key} className="space-y-0.5">
          <p className="text-small text-muted max-w-[42rem]">{r.label}</p>
          <p className="text-body text-ink tabular-nums max-w-[42rem]">{r.value}</p>
          {/* 各項目の直下に、対象期間／本数／出所／取得時点（畳まない） */}
          <p className="text-caption text-muted tabular-nums">
            対象期間 {r.window.from}〜{r.window.to}／日足 {r.window.bars.toLocaleString()}本／{PRICE_SOURCE}／{fetched}
          </p>
        </li>
      ))}
    </ul>
  )
}

export default function ReviewRecordPage({ params }: { params: Promise<{ recordId: string }> }) {
  const { recordId } = use(params)
  // uuid の形でなければ 404（`/review/backfill` は固定の区切りが先に取るので、ここには来ない）
  if (!UUID_RE.test(recordId)) notFound()

  // null = まだ判定中。false = 未ログイン
  const [signedIn, setSignedIn] = useState<boolean | null>(null)
  // undefined = 読み込み中。null = 自分の記録に無い
  const [record, setRecord] = useState<ReviewRecord | null | undefined>(undefined)
  const [figure, setFigure] = useState<Figure | 'loading'>('loading')
  const [now] = useState(() => Date.now())

  useEffect(() => {
    let alive = true
    fetchPortfolio().then(r => {
      if (!alive) return
      setSignedIn(r.status === 'ok')
      if (r.status !== 'ok') return
      const rec = findRecord(r.portfolio.trades, recordId)
      setRecord(rec)
      if (!rec) return
      // 日足は常に 5y（基準率は取れた全期間で数える）。取得時点は応答の Date ヘッダ。読めなければ null（時刻を作らない）
      fetch(`/api/stocks/${rec.symbol}/history?period=5y`)
        .then(async res => {
          if (!res.ok) return { bars: null, at: null } as Figure
          const body = (await res.json()) as unknown
          const bars = Array.isArray(body) ? (body as HistoricalBar[]) : null
          const at = Date.parse(res.headers.get('date') ?? '')
          return { bars, at: Number.isNaN(at) ? null : at } as Figure
        })
        .catch(() => ({ bars: null, at: null }) as Figure)
        .then(f => { if (alive) setFigure(f) })
    })
    return () => { alive = false }
  }, [recordId])

  if (signedIn === false) {
    return (
      <Ground>
        <Crumb />
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

  if (record === undefined) {
    return (
      <Ground>
        <Crumb />
        <LoadingFrame label="記録を読み込んでいます" />
      </Ground>
    )
  }

  // ログイン済みだが、自分の記録にこの id が無い
  if (record === null) notFound()

  // ── 素材 ─────────────────────────────────────────────
  const sells = record.sells
  const closed = sells.length > 0 && openShares(record) <= 0
  const lastSell = sells.length > 0 ? sells[sells.length - 1] : null
  const exitAt = closed && lastSell ? lastSell.exitAt : null
  const exitPrice = closed && lastSell ? lastSell.exitPrice : null
  const heldDays = Math.max(0, Math.round(((exitAt ?? now) - record.entryAt) / DAY_MS))
  const yen = /\.T$/i.test(record.symbol)

  const legacy = isLegacy(record.entryReason)
  const thesis = legacy ? record.entryReason : sectionOf(record.entryReason, '見立て')
  const catalyst = legacy ? null : sectionOf(record.entryReason, '注目')
  const rawExitRule = legacy ? null : sectionOf(record.entryReason, '降りる条件')
  const exitRuleText = isNoRule(rawExitRule) ? null : rawExitRule
  const exitLevel = exitRuleText ? parseExitLevel(exitRuleText, record.entryPrice, { yen }) : null
  const plannedHold = parsePlannedHold(record.entryReason)
  const changeText = closed && lastSell ? sectionOf(lastSell.exitReason, '変化') : null

  const bars = figure === 'loading' ? null : figure.bars
  const quotedAt = figure === 'loading' ? null : figure.at
  const baseRates = bars ? computeBaseRates({ symbol: record.symbol, bars, entryAt: record.entryAt, exitAt, exitLevel, entryPrice: record.entryPrice }) : []

  const soldLine =
    sells.length === 0
      ? 'まだ売っていません'
      : !closed
        ? `${sells.length}回売っています（最後は ${monthDay(sells[sells.length - 1].exitAt)}・残り ${openShares(record).toLocaleString()}株は保有中）`
        : sells.length === 1
          ? `売った日 ${formatDate(sells[0].exitAt)}`
          : `${sells.length}回に分けて売っています（最後は ${monthDay(sells[sells.length - 1].exitAt)}）`

  return (
    <Ground>
      <Crumb />

      {/* ── ヘッダー ── */}
      <header className="space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h1 className="text-h1 text-ink">
              記録 #{record.seq}<span className="ml-3">{record.symbol}</span>
            </h1>
            <p className="text-small text-muted">{record.name}</p>
          </div>
          {/* 判定バッジ（常時）。「まだ」を書かない＝いつか判定する約束にしない */}
          <span className="shrink-0 rounded-full border border-border bg-surface px-3 py-1 text-caption text-ink">{BADGE}</span>
        </div>
        <p className="text-small text-ink-2 tabular-nums">
          買った日 {formatDate(record.entryAt)} → {soldLine}
          <span className="text-muted">
            {closed ? `（保有 ${heldDays}日＝暦日）` : `（保有中・${heldDays}日目＝暦日）`}
          </span>
        </p>
        <p className="flex flex-wrap gap-2">
          <span className="rounded-full bg-surface px-2 text-caption text-ink">{record.source === 'past' ? '実際の取引の記録' : '練習場の売買'}</span>
          <span className="rounded-full bg-surface px-2 text-caption text-ink tabular-nums">{record.shares.toLocaleString()}株</span>
        </p>
      </header>

      {/* ── あなたが書いたこと ── */}
      <section className="space-y-2">
        <h2 className="text-small text-muted">あなたが書いたこと</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <WrittenCard
            heading="見立て"
            hint="なぜ買うのか"
            text={thesis}
            writtenAt={record.entryAt}
            source={record.source}
            note={legacy ? '見出しの無い記録なので、全文をここに出しています。' : undefined}
          />
          <WrittenCard heading="注目" hint="これから何を見るか" text={catalyst} writtenAt={record.entryAt} source={record.source} />
          <WrittenCard
            heading="降りる条件"
            hint="＝間違いだと分かったら降りる条件"
            text={rawExitRule}
            writtenAt={record.entryAt}
            source={record.source}
            note={rawExitRule && !exitRuleText ? '条件としては書かれていません（あなたの記録のまま出しています）。' : undefined}
          />
        </div>
      </section>

      {/* ── 売るときに、あなたが書いたこと（売っていれば） ── */}
      {sells.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-small text-muted">売るときに、あなたが書いたこと</h2>
          <div className="bg-card rounded-card border border-border px-4 py-3 space-y-3">
            {sells.map((s, i) => (
              <div key={s.id + i} className="space-y-1">
                <p className="text-caption text-muted tabular-nums">
                  {sells.length > 1 ? `${i + 1}回目・` : ''}{formatDate(s.exitAt)}・{s.shares.toLocaleString()}株
                </p>
                <SellReadout text={s.exitReason} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── ロジックの検証 ── */}
      <section className="space-y-2">
        <h2 className="text-small text-muted">ロジックの検証</h2>
        <p className="text-small text-ink-2 max-w-[42rem]">
          書いたことを「前提 → だから → 結論 → 期間 → 注目 → 降りる条件」の順に並べ直したものです。付けるのは「書かれていません」だけで、良し悪しは付けません。
        </p>
        <PremiseChain
          symbol={record.symbol}
          shares={record.shares}
          thesis={thesis}
          catalyst={catalyst}
          exitRule={exitRuleText}
          exitRuleRaw={rawExitRule}
          plannedHold={plannedHold}
        />
      </section>

      {/* ── 言ったこと vs やったこと ── */}
      <section className="space-y-3">
        <h2 className="text-small text-muted">言ったこと vs やったこと</h2>
        <div className="bg-card rounded-card border border-border px-4 py-4 space-y-4">
          <div className="space-y-2">
            <p className="text-small text-muted">予定していた期間と、実際に持っていた期間</p>
            {plannedHold ? (
              <PlanVsActualBars planned={plannedHold} entryAt={record.entryAt} exitAt={exitAt} today={now} />
            ) : (
              <p className="text-small text-ink-2 max-w-[42rem]">{NO_PLANNED}</p>
            )}
          </div>
          <PriceSincePanel
            symbol={record.symbol}
            entryAt={record.entryAt}
            entryPrice={record.entryPrice}
            exitAt={exitAt}
            exitPrice={exitPrice}
            exitRuleText={exitRuleText}
            exitLevel={exitLevel}
            bars={figure === 'loading' ? 'loading' : figure.bars}
            quotedAt={quotedAt}
            changeText={changeText}
          />
        </div>
      </section>

      {/* ── 起きたことの頻度 ── */}
      <section className="space-y-2">
        <h2 className="text-small text-muted">起きたことの頻度</h2>
        <div className="bg-card rounded-card border border-border px-4 py-4 space-y-4">
          {figure === 'loading' ? (
            <LoadingFrame label="株価を取得しています" />
          ) : bars === null ? (
            <p className="text-small text-warning-ink">株価を取得できなかったので、この節の数字は出していません。</p>
          ) : baseRates.length === 0 ? (
            <p className="text-small text-ink-2 max-w-[42rem]">この記録では、日足から数えられる項目がありませんでした（買った日の日足がまだ無い、または5年より前の買いのため）。</p>
          ) : (
            <BaseRateList items={baseRates} at={quotedAt} />
          )}
          {/* 固定文言（--muted・12px・畳まない） */}
          <p className="text-caption text-muted">{DISTRIBUTION_NOTE}</p>
        </div>
      </section>

      {/* ── 数字はいちばん下（small・符号付き・色なし・P10）。「あなたの記録では」と出所を書く ── */}
      <section className="space-y-1">
        <h2 className="text-small text-muted">あなたの記録の数字</h2>
        <p className="text-small text-ink-2 tabular-nums">
          あなたの記録では 買 {fmtPrice(record.symbol, record.entryPrice)}<span className="text-muted">（{formatDate(record.entryAt)}）</span>
          {sells.length === 0 && <span className="text-muted">・まだ売っていません（読み返すのはこれからです）</span>}
        </p>
        {sells.map((s, i) => {
          const pnl = (s.exitPrice - record.entryPrice) * s.shares
          const pct = record.entryPrice > 0 ? ((s.exitPrice - record.entryPrice) / record.entryPrice) * 100 : null
          return (
            <p key={s.id + i} className="text-small text-ink-2 tabular-nums">
              {'→ '}売 {fmtPrice(record.symbol, s.exitPrice)}<span className="text-muted">（{formatDate(s.exitAt)}・{s.shares.toLocaleString()}株）</span>
              {pct !== null && <span className={`ml-2 ${pnl === 0 ? 'text-muted' : 'text-ink'}`}>{signedMoney(record.symbol, pnl)}（{signedPct(pct)}）</span>}
            </p>
          )
        })}
        {sells.length > 0 && openShares(record) > 0 && (
          <p className="text-small text-muted tabular-nums">残り {openShares(record).toLocaleString()}株は、まだ売っていません。</p>
        )}
      </section>

      {/* ── フッター ── */}
      <footer className="space-y-2 border-t border-border pt-4">
        <p className="text-small text-ink-2 max-w-[42rem]">{FOOTER}</p>
        <p className="text-small text-ink-2 max-w-[42rem]">
          {plannedHold
            ? `あなたが書いた期間は${plannedHold.label}です。${plannedHold.label}後にこの記録をもう一度開くと、そのときまでの株価が並びます。`
            : NO_PLANNED}
        </p>
        <p className="text-small">
          <Link href="/review" className="text-brand hover:underline">← 一覧に戻る</Link>
        </p>
      </footer>
    </Ground>
  )
}
