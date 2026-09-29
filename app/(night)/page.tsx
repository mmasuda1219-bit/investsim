'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { NAV } from '@/components/SiteNav'
import { Disclaimer } from '@/components/ui/Disclaimer'
import { pickSamples } from '@/lib/entry/samples'
import type { InvestorId } from '@/types'

/**
 * トップページ＝入口画面。
 *
 * S1「3段の道」（2026-09-29・DECISIONS.md 同日）の**最小追従**の状態。S1c（2026-09-25）で作った
 * 「できることは3つ」の選択カード3枚・プレビュー右列・選択に連動する主ボタンの分岐は撤去し、主ボタンは `/trade` 固定
 * （着地点は1つ＝MARKETING.md §4）。**全面の作り直し（実際の3画面を順に見せるプレゼン型）は S2** で行う。
 *
 * いまの構成（上から順に・1列）:
 *   分類ラベル → 52px の見出し → リード → 主ボタン1つ（/trade「1件目のメモを書く」）
 *   → 3つの画面の一列（NAV から。/trade だけ大きい）→ AIの見本2件 → 免責（共通部品）
 *
 * 守っていること:
 *  - AIの判断は **保存済みデータの読み出しだけ**（/api/ai-session/latest）。AI推論は走らせない
 *    （最も人が来る面を最も安い面にする。AI費用は自己負担）。架空の判断で埋めない（原則9）
 *  - 画面に出す AI の理由文は、禁止語（lib/investors/rulebooks/forbidden.ts の FORBIDDEN_IN_OUTPUT）に触れないものだけ。
 *    見本2件は全文を置いて line-clamp で見た目だけ切るので**全文**で見る（pickSamples → isFullyShowable。reviewer W1・2026-09-25）。
 *    ヒットしたら出さずに次の候補へ。候補が無ければ節ごと出さない（法務 F1）。選び方は lib/entry/samples.ts（純関数）
 *  - 見本2件は「買い」以外を1件以上含める（買いだけ並べると成績訴求に見える）。最新3件の中に無ければ節ごと出さない
 *  - 色付きの影は主ボタンの1か所だけ（DESIGN §4-2 R1）。札は光らせない
 *  - 注記（C）は半透明の面の上ではなく地の上に、small・--ink-2 で、畳まない（R7・R11）
 *  - 入場アニメはファーストビューの4要素だけ・65ms 刻み・`prefers-reduced-motion` では動かさない（§5-6）。
 *    3つの画面の一列より下は静止（`opacity: 1`）。IntersectionObserver は使わない
 *  - 取得の状態は loading / ready / empty / error の4つ（2026-09-18）。**S1 では ready 以外の表示を持たない**
 *    （プレビュー②が持っていた error／empty の表示は右列ごと撤去した。S2 で読み口 /api/entry/examples の4状態として戻す）
 *  - ログイン状態・記録の有無・時刻・流入元で並び・中身を変えない（legal-compliance 2026-09-25 C3〜C5）
 *
 * DESIGN.md §7・§4-2 R6 の語は書かない（legal-compliance 2026-09-25。語の一覧はそちらが正。ここに列挙しない＝grep の偽ヒット防止）。
 * 検査: scripts/check-entry.ts（法務 (G)）・check-signals-undecidable.ts（状態機械）・check-night-theme.ts（R4・目印）
 */

interface Decision {
  symbol: string
  name: string
  action: 'buy' | 'sell' | 'hold' | 'watch'
  reasoning: string
}
/**
 * GET /api/ai-session/latest の応答（app/api/ai-session/latest/route.ts・2026-09-18）。
 *  記録あり: { lastTickAt, tickCount, persona, decisions（最大3件） }／記録なし: { lastTickAt: null, tickCount: 0, persona: null, decisions: [] }
 * 旧: /api/ai-session がセッション全体（343KB）を返し、スマホの遅い回線で取得しきれなかった。
 */
interface SessionSummary {
  lastTickAt: string | null
  tickCount: number
  /** 判断に使った投資家の人格。null なら特定の投資家の考え方は使っていない。
   *  画面には出さない（名人を隠している間・S1b。本番は null）。API の形はそのまま受ける */
  persona: InvestorId | null
  decisions: Decision[]
}

// 方向の札は無彩色＋記号（DESIGN.md §6-5）。買い＝緑・売り＝赤で運ばない（DECISIONS 2026-09-10）。
// 4種とも同じ形（--surface の面・--ink の文字・ピル型）なので class は1つで足りる。影を付けない（R1）。
const ACTION_LABEL: Record<Decision['action'], string> = {
  buy: '▲ 買い', sell: '▼ 売り', hold: '＝ 保有継続', watch: '◇ 様子見',
}
const ACTION_BADGE = 'shrink-0 rounded-full bg-surface px-2 text-caption font-semibold text-ink'

/** 判断1件の形。action は ACTION_LABEL のキーのどれか（札の文字が引けない値を通さない） */
function isDecision(v: unknown): v is Decision {
  if (v == null || typeof v !== 'object') return false
  const d = v as Record<string, unknown>
  return typeof d.symbol === 'string' && typeof d.name === 'string' && typeof d.reasoning === 'string'
    && typeof d.action === 'string' && d.action in ACTION_LABEL
}

/** 応答の形を確かめる。形が違えば（要素が壊れていても）失敗（error）として扱い、「まだ無い」にも ready にも倒さない */
function isSessionSummary(v: unknown): v is SessionSummary {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  return Array.isArray(o.decisions) && o.decisions.every(isDecision) && typeof o.tickCount === 'number'
    && (o.lastTickAt == null || typeof o.lastTickAt === 'string')
}

function formatWhen(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const min = Math.floor((Date.now() - t) / 60_000)
  if (min < 1) return 'たった今'
  if (min < 60) return `${min}分前`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h}時間前`
  return `${Math.floor(h / 24)}日前`
}

// 見本2件の選び方（pickSamples → 全文で isFullyShowable）は lib/entry/samples.ts（純関数）。
// scripts/check-entry.ts がそれを実際に呼んで検査する。

// 取得の打ち切り。スマホの弱い回線で応答が返らないとき、いつまでも薄い枠のままにしない
// （2026-09-18: オーナーの友人がスマホで「取得できなかった」。当時は失敗を「まだ無い」と見せていた）。
const FETCH_TIMEOUT_MS = 15_000

/**
 * 状態は4つ（DESIGN §6-12）:
 *  loading … 薄い枠／ready … 判断あり／empty … 200 で判断が 0 件のときだけ「まだ無い」／
 *  error   … HTTP が ok でない・JSON で読めない・回線の失敗・時間切れ。**失敗を「記録が無い」と見せない**（原則9 の隣）
 * 取得先は軽い /api/ai-session/latest（最新1件・判断3件・4項目だけ。2026-09-18 に一覧の /api/ai-session から切り替え済み）。
 */
type HomeState = 'loading' | 'ready' | 'empty' | 'error'

/**
 * 入場アニメ（DESIGN §5-6）: translateY(18px)→0 ＋ opacity 0→1・.85s・65ms 刻み・最大7要素（合計 390ms ≤ 420ms）。
 * @keyframes rise と animate-rise は app/globals.css。motion-safe: なので「動きを減らす」設定では
 * 動かさず即時 opacity 1（クラスが当たらない＝素の表示）。fill-mode backwards は animate-rise の中。
 * ファーストビューの要素にだけ当てる（S1 では4つ）。3つの画面の一列より下には当てない。
 */
const RISE = [
  'motion-safe:animate-rise',
  'motion-safe:animate-rise [animation-delay:65ms]',
  'motion-safe:animate-rise [animation-delay:130ms]',
  'motion-safe:animate-rise [animation-delay:195ms]',
  'motion-safe:animate-rise [animation-delay:260ms]',
  'motion-safe:animate-rise [animation-delay:325ms]',
  'motion-safe:animate-rise [animation-delay:390ms]',
] as const

const FOCUS_RING = 'focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2'

export default function Home() {
  const [session, setSession] = useState<SessionSummary | null>(null)
  const [state, setState] = useState<HomeState>('loading')

  useEffect(() => {
    let alive = true
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    // 軽い API（最新1件・判断3件・4項目だけ）。一覧の /api/ai-session は読まない（2026-09-18 切り替え）
    fetch('/api/ai-session/latest', { signal: ctrl.signal })
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status))
        // 本文が JSON でない（途中で切れた応答・HTML のエラーページ）も失敗として扱う
        return r.json() as Promise<unknown>
      })
      .then((body: unknown) => {
        if (!alive) return
        // 形が違う（decisions が配列でない等）は失敗として扱う。200 で decisions が空のときだけ「まだ無い」と出す
        if (!isSessionSummary(body)) throw new Error('unexpected shape')
        if (body.decisions.length > 0) {
          setSession(body); setState('ready')
        } else {
          setState('empty')
        }
      })
      .catch(() => { if (alive) setState('error') })
      .finally(() => clearTimeout(timer))
    return () => { alive = false; clearTimeout(timer); ctrl.abort() }
  }, [])

  const when = session ? formatWhen(session.lastTickAt ?? '') : ''
  const samples = state === 'ready' && session ? pickSamples(session.decisions) : null

  return (
    // 地の塗りとにじみは app/(night)/layout.tsx（S1a）。フッターは app/layout.tsx（全ページ共通）。
    // 余白は <main> の pt-5 / pb-20 md:pb-5 と合わせる。
    <div className="pt-1 pb-4 md:pb-5">

      {/* ── ファーストビュー（1列。S1 で右列のプレビューと選択カードを撤去した） ───────────── */}
      <div className="max-w-[760px]">
        <p className={`text-small text-muted ${RISE[0]}`}>投資判断の練習場</p>
        {/* display＝52px / 1.26 / 900 / 字間 −0.035em（DESIGN §5-2。1画面に1つ）。
            640px 未満は font-size だけ 40px（行間・太さ・字間は .text-display から継承）。390px で3行以内に収める（reviewer W2） */}
        <h1 className={`mt-5 text-display text-ink text-balance ${RISE[1]} max-sm:text-[40px]`}>
          買う理由を書いて残し、あとで株価と読み返す。
        </h1>
        {/* リードは h3 の大きさを太さ 400・行間 1.9 で（§5-2。新しい段階を足さない） */}
        <p className={`mt-7 max-w-[540px] text-h3 font-normal leading-[1.9] text-ink-2 ${RISE[2]}`}>
          なぜ買うのか、何が起きたらやめるのかを書いて記録し、数週間後に実際の株価と並べて読み返します。実際のお金は1円も動きません。
        </p>

        {/* 主ボタンは1画面に1つ（§6-1・56px）。行き先は /trade 固定（着地点は1つ・DECISIONS 2026-09-29 決定(3)）。
            ログイン状態・記録の有無で文言も行き先も変えない。発光の影（R1 で許された唯一の場所） */}
        <div className={`mt-9 ${RISE[3]}`}>
          <Link
            href="/trade"
            className={`inline-flex h-14 w-full items-center justify-center rounded-card bg-brand px-8 text-body font-semibold text-on-brand shadow-[0_16px_40px_-14px_rgb(45_212_191_/_.70)] transition-colors duration-150 hover:bg-brand-strong sm:w-auto ${FOCUS_RING}`}
          >
            1件目のメモを書く
          </Link>
        </div>
      </div>

      {/* ── ここから下は静止（入場アニメを当てない） ─────────────────────────────── */}
      <div className="mt-16 max-w-[760px] space-y-12">

        {/* ── 3つの画面の一列 ───────────────────────────────────────── */}
        {/* 同形カードの格子ではなく、番号付きの一列（§2・§3）。01 書く が心臓なので
            一回り大きく（text-h2 対 text-h3、行も高く）描く。--brand-tint の下地は
            §5-1 で「現在地・選択中だけ」なのでここでは使わない。並びと文言は NAV が唯一の出所。 */}
        <section aria-labelledby="stages-heading" className="space-y-2">
          <h2 id="stages-heading" className="text-small text-muted">このサイトは、3つの画面でできています</h2>
          <ol className="overflow-hidden rounded-card border border-border bg-card">
            {NAV.map(({ href, label, hint }, i) => {
              const heart = href === '/trade'
              return (
                // 区切り線は文字の左端から（li に mx-4）。押せる範囲は帯の端まで（Link に -mx-4）。
                <li key={href} className="mx-4 border-t border-border first:border-t-0">
                  <Link
                    href={href}
                    className={`-mx-4 flex items-center gap-4 px-4 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2 ${
                      heart ? 'min-h-20 py-4' : 'min-h-14 py-3'
                    }`}
                  >
                    <span className="w-6 shrink-0 text-small text-muted tabular-nums">
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-ink ${heart ? 'text-h2' : 'text-h3'}`}>{label}</span>
                      <span className={`block text-ink-2 ${heart ? 'text-body' : 'text-small'}`}>{hint}</span>
                    </span>
                  </Link>
                </li>
              )
            })}
          </ol>
        </section>

        {/* 取得に失敗したときは黙らない（DESIGN.md §6-12）。S1 レビュー W1: プレビュー右列を
            撤去したとき error の表示が一緒に消え、失敗しても画面に何も出ない状態になっていた。
            「まだ無い」と見せない（原則9）ため、読み込めなかったことだけを書く。 */}
        {state === 'error' && (
          <p role="status" className="text-small text-ink-2 leading-relaxed">
            AIの判断の記録を読み込めませんでした。記録が消えたわけではありません。時間をおいて、ページを読み込み直してください。
          </p>
        )}

        {/* ── AIの見本（保存済みデータの読み出しのみ・2件・非 buy を含む） ────────── */}
        {samples && (
          <section aria-labelledby="samples-heading" className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-4">
              <h2 id="samples-heading" className="text-small text-muted">AIも、同じ形式で理由を書いています</h2>
              {/* 数字（回数）は見出しにしない（R3）。caption で添えるだけ */}
              <span className="text-caption text-muted tabular-nums">{when}・{session?.tickCount}回目の判断</span>
            </div>
            <ul className="rounded-card border border-border bg-card">
              {samples.map((d, i) => (
                <li key={`${d.symbol}-${i}`} className="mx-4 space-y-1 border-t border-border py-4 first:border-t-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-body font-semibold text-ink">{d.symbol}</span>
                    <span className="truncate text-small text-muted">{d.name}</span>
                    <span className={ACTION_BADGE}>{ACTION_LABEL[d.action]}</span>
                  </div>
                  <p className="line-clamp-2 max-w-[42rem] text-body text-ink-2">{d.reasoning}</p>
                </li>
              ))}
            </ul>
            <Link href="/watch" className={`inline-flex min-h-11 items-center rounded-field text-small text-brand hover:underline ${FOCUS_RING}`}>
              AIの判断を全部読む →
            </Link>
            {/* 注記（法務 C）: 直下・地の上・small・--ink-2 */}
            <p className="max-w-[42rem] text-small text-ink-2">
              これは、このサイトのAIが仮想資金で出した判断の記録です（取得: {when}）。▲▼はAIの判断の分類で、特定の銘柄の売買を推奨するものではありません。
            </p>
          </section>
        )}

        {/* ── 恒久免責（共通部品。ページごとに手書きしない＝§6-11） ────────────── */}
        <section className="border-t border-border pt-4">
          <Disclaimer part="general" />
        </section>
      </div>
    </div>
  )
}
