'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { NAV } from '@/components/SiteNav'
import { Disclaimer } from '@/components/ui/Disclaimer'
import { fieldsFor } from '@/lib/trade/reason'
import { firstSentence, isShowable, pickSamples } from '@/lib/entry/samples'
import type { InvestorId } from '@/types'

/**
 * トップページ＝入口画面（S1c・2026-09-25。承認済みの見た目は scratchpad の Night.dc.html「案B 夜」）。
 *
 * 構成（DESIGN.md §3・§6-6 A アプリ型。390px は1列、lg 以上は左 56% / 右 44%）:
 *   左: 分類ラベル → 52px の見出し → リード → 「できることは3つ」の選択カード3枚 → 主ボタン1つ → 文字リンク
 *   右: 選んだものの実物の見本（プレビュー）。lg では sticky
 *   下: 4段階の一列（/trade だけ大きい）→ AIの見本2件 → 免責（共通部品）
 *
 * 守っていること:
 *  - 選択カードの状態は React の state だけ。保存しない・サーバーにも送らない・ログイン状態で変えない
 *    （legal-compliance 2026-09-25「プレビュー②の中身は誰が選んでも同じ1件」が唯一の生命線）
 *  - AIの判断は **保存済みデータの読み出しだけ**（/api/ai-session/latest）。AI推論は走らせない
 *    （最も人が来る面を最も安い面にする。AI費用は自己負担）。架空の判断で埋めない（原則9）
 *  - 画面に出す AI の理由文は、禁止語（lib/investors/rulebooks/forbidden.ts の FORBIDDEN_IN_OUTPUT）に触れないものだけ。
 *    プレビュー②は冒頭1文だけを表示するので冒頭1文で見る（isShowable）。見本2件は全文を置いて line-clamp で
 *    見た目だけ切るので**全文**で見る（pickSamples → isFullyShowable。reviewer W1・2026-09-25）。
 *    ヒットしたら出さずに次の候補へ。候補が無ければ「まだ無い」と同じ形（法務 F1）。選び方は lib/entry/samples.ts（純関数）
 *  - 見本2件は「買い」以外を1件以上含める（買いだけ並べると成績訴求に見える）。最新3件の中に無ければ節ごと出さない
 *  - 色付きの影は主ボタンと選択中カードの2か所だけ（DESIGN §4-2 R1）。札は光らせない
 *  - 注記（B）（C）は半透明の面の上ではなく地の上に、small・--ink-2 で、畳まない（R7・R11）
 *  - 入場アニメはファーストビューの7要素だけ・65ms 刻み・`prefers-reduced-motion` では動かさない（§5-6）。
 *    4段階より下は静止（`opacity: 1`）。IntersectionObserver は使わない
 *  - 取得の失敗を「記録が無い」と見せない（2026-09-18。状態は loading / ready / empty / error の4つ）
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

// 理由文の冒頭1文（firstSentence）・出してよいか（isShowable＝冒頭1文／isFullyShowable＝全文）・見本2件の選び方（pickSamples）は
// lib/entry/samples.ts（純関数）。scripts/check-entry.ts がそれを実際に呼んで検査する。

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

/** 「できることは3つ」。全員に同じ3つ・同じ並び・既定は①（時刻・流入元・地域・ログイン状態で変えない） */
type Choice = 'write' | 'watch' | 'review'
const CHOICES: readonly { id: Choice; title: string; hint: string; cta: string; href: string; previewTitle: string }[] = [
  { id: 'write',  title: '自分で書く',     hint: 'なぜ買うのか、どうなったらやめるのかを書く',     cta: '理由を書きに行く',     href: '/trade',  previewTitle: '買うときに答える3つ' },
  { id: 'watch',  title: 'AIの判断を読む', hint: 'このサイトのAIが直近にどう考えたかを読む',       cta: 'AIの判断を読みに行く', href: '/watch',  previewTitle: 'AIが書いた理由（直近の1件）' },
  { id: 'review', title: 'あとで読み返す', hint: '書いた理由と、その後の株価を並べて読み返す',     cta: '記録を読み返しに行く', href: '/review', previewTitle: '振り返りの記録' },
]

/**
 * 入場アニメ（DESIGN §5-6）: translateY(18px)→0 ＋ opacity 0→1・.85s・65ms 刻み・最大7要素（合計 390ms ≤ 420ms）。
 * @keyframes rise と animate-rise は app/globals.css。motion-safe: なので「動きを減らす」設定では
 * 動かさず即時 opacity 1（クラスが当たらない＝素の表示）。fill-mode backwards は animate-rise の中。
 * ファーストビューの要素にだけ当てる。4段階より下には当てない。
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
  // 「もう一度読み込む」で +1 して effect を走らせ直す
  const [attempt, setAttempt] = useState(0)
  // 選択カード。保存しない・送らない（React の state だけ）
  const [choice, setChoice] = useState<Choice>('write')

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
  }, [attempt])

  const retry = () => { setSession(null); setState('loading'); setAttempt(n => n + 1) }

  const current = CHOICES.find(c => c.id === choice) ?? CHOICES[0]
  const when = session ? formatWhen(session.lastTickAt ?? '') : ''
  // プレビュー②の1件: 先頭から見て、冒頭1文が禁止語に触れない最初の判断。誰が選んでも同じ1件
  const featured = state === 'ready' && session ? session.decisions.find(isShowable) ?? null : null
  const samples = state === 'ready' && session ? pickSamples(session.decisions) : null

  return (
    // 地の塗りとにじみ・フッターは app/(night)/layout.tsx（S1a・S1c）。
    // 余白は <main> の pt-5 / pb-20 md:pb-5 と合わせる。
    <div className="pt-1 pb-4 md:pb-5">

      {/* ── ファーストビュー: 左 56% / 右 44%・gap 48px（390px は1列） ───────────── */}
      <div className="flex flex-col gap-10 lg:flex-row lg:items-start lg:gap-12">

        <div className="min-w-0 lg:basis-[56%]">
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

          {/* 選択カード3枚。常に3枚とも描画する（「②を選ぶと開く」にしない）。選択は色だけに頼らず「選択中」の文字でも示す */}
          <section aria-labelledby="choose-heading" className={`mt-11 ${RISE[3]}`}>
            <h2 id="choose-heading" className="text-small text-muted">できることは3つです。どれから始めますか</h2>
            <div className="mt-3 flex flex-col gap-3">
              {CHOICES.map(c => {
                const selected = c.id === choice
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setChoice(c.id)}
                    className={`min-h-18 w-full rounded-card border px-6 py-5 text-left transition-colors duration-150 ${FOCUS_RING} ${
                      selected
                        // 選択中: 面 --surface＋枠 rgb(45 212 191 / .55)（地の上 3.79）＋発光の影（R1 で許された2か所のうちの1つ）
                        ? 'border-[rgb(45_212_191_/_.55)] bg-surface shadow-[0_22px_48px_-22px_rgb(45_212_191_/_.55)]'
                        : 'border-border bg-card hover:bg-surface'
                    }`}
                  >
                    <span className="flex items-start justify-between gap-4">
                      <span className="text-h2 text-ink">{c.title}</span>
                      {selected && <span className="shrink-0 pt-1 text-caption font-semibold text-brand">選択中</span>}
                    </span>
                    <span className="mt-1 block text-small text-ink-2">{c.hint}</span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* 主ボタンは1画面に1つ（§6-1・56px）。文言と行き先は選択に追随。発光の影（R1 の2か所のうちの1つ） */}
          <div className={`mt-7 ${RISE[4]}`}>
            <Link
              href={current.href}
              className={`inline-flex h-14 w-full items-center justify-center rounded-card bg-brand px-8 text-body font-semibold text-on-brand shadow-[0_16px_40px_-14px_rgb(45_212_191_/_.70)] transition-colors duration-150 hover:bg-brand-strong sm:w-auto ${FOCUS_RING}`}
            >
              {current.cta}
            </Link>
          </div>
          <p className={`mt-4 ${RISE[5]}`}>
            {/* 押すと②を選択中にするだけ。ページ遷移しない */}
            <button
              type="button"
              onClick={() => setChoice('watch')}
              className={`inline-flex min-h-11 items-center rounded-field text-left text-small text-brand hover:underline ${FOCUS_RING}`}
            >
              気になっている株がまだ無ければ「AIの判断を読む」から
            </button>
          </p>
        </div>

        {/* ── プレビュー（右列。390px では主ボタンの下） ─────────────────────────── */}
        <aside aria-labelledby="preview-heading" className={`min-w-0 lg:sticky lg:top-22 lg:basis-[44%] ${RISE[6]}`}>
          <h2 id="preview-heading" className="text-small text-muted">選ぶと、こういうものが出ます</h2>
          {/* 面の輪郭は --card＋--border の1種類（§6-6）。中にカードを入れない */}
          <div className="mt-3 rounded-card border border-border bg-card p-6">
            <div className="flex items-baseline justify-between gap-4">
              <p className="text-body font-semibold text-ink">{current.previewTitle}</p>
              <p className="shrink-0 text-caption text-muted">実際の画面です</p>
            </div>
            <div className="mt-6">
              {choice === 'write' && <PreviewWrite />}
              {choice === 'watch' && <PreviewWatch state={state} featured={featured} when={when} retry={retry} />}
              {choice === 'review' && <PreviewReview />}
            </div>
          </div>
          {/* 注記（法務 B）: 帯の直下・地の上（R11）・small・--ink-2・畳まない（R7）。にじみは上端だけなのでこの下には無い（R5） */}
          {choice === 'watch' && featured && (
            <p className="mt-3 text-small text-ink-2">
              これは、このサイトのAIが仮想資金で出した判断の記録です。特定の銘柄の売買を推奨するものではありません。（取得: {when}）
            </p>
          )}
        </aside>
      </div>

      {/* ── ここから下は静止（入場アニメを当てない） ─────────────────────────────── */}
      <div className="mt-16 max-w-[760px] space-y-12">

        {/* ── 4段階の一列 ───────────────────────────────────────────── */}
        {/* 同形カード4枚の格子ではなく、番号付きの一列（§2・§3）。03 やる が心臓なので
            一回り大きく（text-h2 対 text-h3、行も高く）描く。--brand-tint の下地は
            §5-1 で「現在地・選択中だけ」なのでここでは使わない。 */}
        <section aria-labelledby="stages-heading" className="space-y-2">
          <h2 id="stages-heading" className="text-small text-muted">このサイトは4つの段階でできています</h2>
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

/** ①「自分で書く」の見本: /trade の買いの問い3つ（lib/trade/reason.ts が正）。入力欄の見た目は作らない・記入例を入れない・押せない */
function PreviewWrite() {
  const fields = fieldsFor('buy')
  return (
    <div>
      <ol className="space-y-6">
        {fields.map(f => (
          // 書き込みの罫は --rule-line（--card の上なので 1.31 で足りる。--surface の上には引かない）
          <li key={f.key} className="border-b border-rule-line pb-3">
            <p className="text-body text-ink">
              {f.question}
              {!f.required && <span className="ml-2 text-caption text-muted">任意</span>}
            </p>
          </li>
        ))}
      </ol>
      <p className="mt-6 text-small text-muted">理由を書かないと記録できません。白紙ではなく、問いに答える形で書きます。</p>
    </div>
  )
}

/**
 * ②「AIの判断を読む」の見本: 本番の最新の判断1件（社名＋銘柄・冒頭1文・取得時点）。▲▼の札は出さない。
 * loading / error は既存の3状態の形（薄い枠／三点＋もう一度）。候補が無ければ empty と同じ形（仮の文で埋めない）。
 * 面はプレビューの帯そのもの（--card）なので、ここで bg-card を重ねない（入れ子禁止・§6-6）。
 */
function PreviewWatch({ state, featured, when, retry }: { state: HomeState; featured: Decision | null; when: string; retry: () => void }) {
  if (state === 'loading') {
    // 読み込み中: 完成時と同じ形の薄い枠（§6-12）。画面全体を覆わない。
    return (
      <div aria-busy="true" aria-label="AIの判断を読み込んでいます" className="space-y-3 motion-safe:animate-pulse">
        <div className="h-4 w-40 rounded-field bg-surface" />
        <div className="h-4 w-full rounded-field bg-surface" />
        <div className="h-4 w-3/4 rounded-field bg-surface" />
        <div className="h-3 w-24 rounded-field bg-surface" />
      </div>
    )
  }
  if (state === 'error') {
    // 失敗: 何が起きたか／データはどうなったか／どうすればいいか（§6-12）。--warning-ink の見出し＋--ink-2 の説明。赤い枠は使わない。
    return (
      <div role="status" className="space-y-1">
        <p className="text-body text-warning-ink">AIの判断記録を読み込めませんでした</p>
        <p className="text-body text-ink-2">記録は消えていません。通信やサーバーの一時的な問題です。</p>
        <p className="text-body text-ink-2">時間をおいて、もう一度読み込んでください。</p>
        <button
          type="button"
          onClick={retry}
          className={`inline-flex min-h-11 items-center rounded-field text-small text-brand hover:underline ${FOCUS_RING}`}
        >
          もう一度読み込む
        </button>
      </div>
    )
  }
  if (!featured) {
    // 空: 何が無いか＋次の一手を1つ（§6-12）。主ボタンは左で使い切っているので文字リンク。
    return (
      <div className="space-y-2">
        <p className="text-body font-semibold text-ink">まだAIの判断記録がありません</p>
        <p className="text-small text-ink-2">AIの運用を始めると、ここに直近の判断とその理由が並びます。</p>
        {/* 押せる範囲は 44px 以上（§8）。他の文字リンクと同じ形 */}
        <Link href="/watch" className={`inline-flex min-h-11 items-center rounded-field text-small text-brand hover:underline ${FOCUS_RING}`}>
          「見る」を開く →
        </Link>
      </div>
    )
  }
  return (
    <div className="space-y-2">
      {/* 社名＋銘柄は見出しにしない（small・--muted の1行） */}
      <p className="text-small text-muted">{featured.name}（{featured.symbol}）</p>
      <p className="text-body text-ink">{firstSentence(featured.reasoning)}</p>
      <p className="text-caption text-muted tabular-nums">取得: {when}</p>
    </div>
  )
}

/** ③「あとで読み返す」の見本: /review の記録カードの形だけ（①書いた理由 → ②その後の値動き → ③損益）。数字は出さない */
function PreviewReview() {
  return (
    <div>
      <ol className="space-y-6">
        {['① 書いた理由', '② その後の値動き', '③ 損益'].map(t => (
          <li key={t} className="border-b border-rule-line pb-3 text-small text-muted">{t}</li>
        ))}
      </ol>
      {/* 記録がある利用者にも偽にならない言い方（「まだ記録がありません」にしない。reviewer S4） */}
      <p className="mt-6 text-small text-muted">あなたの記録はここに並びます</p>
    </div>
  )
}
