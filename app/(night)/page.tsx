'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { NAV } from '@/components/SiteNav'
import { Disclaimer } from '@/components/ui/Disclaimer'
import { AnswerCheckCard, MiniLine, fmtSlashDate, type AnswerExample } from '@/components/AnswerCheckCard'
import { SERIES, svgDash, type SeriesStyle } from '@/components/chartTheme'
import { fieldsFor } from '@/lib/trade/reason'
import { firstSentence } from '@/lib/entry/samples'
import { MIN_ELAPSED_BUSINESS_DAYS } from '@/lib/entry/answer-examples'

/**
 * トップページ＝入口画面。S2「プレゼン型ホーム」（2026-09-29・DECISIONS.md 同日の2エントリ。オーナーが人間ゲート①で承認）。
 *
 * 説明文の羅列ではなく「このサイトが何をする場所かを、実際の3画面の断片を1本のレールで順に見せる」。
 * 構成（上から順に。正は DESIGN.md §3「トップページの構成」）:
 *   1. ヒーロー: h1 → リード → 主ボタン1つ（/trade「1件目のメモを書く」・56px・色付きの影はここだけ）→ 「保存するときだけログインが要ります」
 *      → 文字リンク2本（/review/backfill・/watch）。パソコンでは右に「残るもの（例）」カード1枚（スマホでは下に回る）。
 *      **ヒーローに騰落率を置かない**（R3・2026-09-29 オーナー判断。数字は 03 の節で初めて出す）
 *   2. 「このサイトは、3つの画面でできています／書く → くらべる → 読み返す」
 *   3. 左に1本のレール（2px・上が --brand で下に向かって消える）に沿って3段。各段＝左に説明／右にその画面の実物の断片。
 *      段の間に時間のラベル「書いたその日に」「20営業日ほど経つと」
 *        01 書く   … /trade の3つの問い（lib/trade/reason.ts の fieldsFor('buy') が正）に記入例が入った状態＋「この内容で記録する」
 *        02 くらべる … 左「あなたが書いたこと」（記入例＝reason.ts の placeholder。**記入例であることを明示**）／右「このサイトのAIが書いたこと」（実データ）。
 *                    「ちがい」の1文は**静的な説明文**（差を自動判定して採点しない＝助言性を避ける）
 *        03 読み返す … AIの判断の実例2件（AnswerCheckCard: 理由1行 → 折れ線 → 「AIはこう書いた／株価はこう動いた」の1文）。
 *                    判断日が古い順に値上がり・値下がりを1件ずつ（選び方を画面に明記）。**「やめる条件」の水平線は描かない**
 *   4. 締めのボタン再掲（/trade・色付きの影なし）＋「過去に買った株を記録する」への文字リンク
 *   5. 免責 <Disclaimer part="general" />（共通部品・地の上）
 *
 * 守っていること:
 *  - AIの判断は **保存済みデータの読み出しだけ**（GET /api/entry/examples の1本。AI推論は走らせない・AI費用は自己負担）。
 *    架空の判断で埋めない（原則9）。候補が無ければ実例の節は出さない（AnswerCheckCard は null を返す）
 *  - 選び方は純関数 lib/entry/answer-examples.ts（時刻・ユーザー・ログイン状態・地域・乱数・入力順を入力にしない）。
 *    禁止語（lib/investors/rulebooks/forbidden.ts の FORBIDDEN_IN_OUTPUT）の検査は理由の**全文**（lib/entry/samples.ts の isTextShowable）
 *  - 取得の状態は loading / ready / empty / error の4つ（DESIGN §6-12）。**失敗を「無い」と見せない**（error は文で出す）
 *  - ログイン状態・記録の有無・時刻・流入元で並び・中身を変えない（法務 2026-09-25 C3〜C5。localStorage・cookie・useSearchParams を使わない）
 *  - 色付きの影は主ボタンの1か所だけ（R1）。にじみは app/(night)/layout.tsx（R5）。入場アニメはヒーローの5要素だけ・65ms 刻み（§5-6）
 *  - 免責・出所は半透明の面の上に置かない（R11）。畳まない・薄くしない（R7）
 *  - 使わない語（法務 2026-09-29）: 見本／お手本／模範／正解例／自動売買／的中／当たった／外れた／正解率／単独の「答え合わせ」。
 *    「無料」はフッター（app/layout.tsx）の1文だけ。名人・投資家の語も書かない（名人を隠している間）
 * 検査: scripts/check-entry.ts（構成・法務・R1〜R8）・check-answer-examples.ts（選び方）・check-signals-undecidable.ts（状態機械）・check-night-theme.ts（R4・目印）
 */

type ExampleAction = 'buy' | 'sell' | 'hold' | 'watch'
/** GET /api/entry/examples の1件（app/api/entry/examples/route.ts の Example と同じ形。社名は無い） */
interface Example extends AnswerExample {
  action: ExampleAction
  elapsedBusinessDays: number
}
/** 応答: 実例あり { examples: { up, down } }／実例なし { examples: null }（正常）。失敗は HTTP 502 */
interface ExamplesBody {
  examples: { up: Example; down: Example } | null
}

// 方向の札は無彩色＋記号（DESIGN.md §6-5）。買い＝緑・売り＝赤で運ばない（DECISIONS 2026-09-10）
const ACTION_LABEL: Record<ExampleAction, string> = {
  buy: '▲ 買い', sell: '▼ 売り', hold: '＝ 保有継続', watch: '◇ 様子見',
}

function isBar(v: unknown): v is Example['bars'][number] {
  if (v == null || typeof v !== 'object') return false
  const b = v as Record<string, unknown>
  return typeof b.t === 'string' && typeof b.close === 'number'
}
/** 実例1件の形。壊れた要素を ready にしない */
function isExample(v: unknown): v is Example {
  if (v == null || typeof v !== 'object') return false
  const e = v as Record<string, unknown>
  return typeof e.symbol === 'string' && typeof e.decidedAt === 'string' && typeof e.reasoning === 'string'
    && typeof e.changePct === 'number' && typeof e.elapsedBusinessDays === 'number'
    && typeof e.baseAsOf === 'string' && typeof e.priceAsOf === 'string' && typeof e.source === 'string'
    && typeof e.action === 'string' && e.action in ACTION_LABEL
    && Array.isArray(e.bars) && e.bars.every(isBar)
}
/** 応答の形を確かめる。形が違えば失敗（error）として扱い、「まだ無い」にも ready にも倒さない */
function isExamplesBody(v: unknown): v is ExamplesBody {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  if (o.examples === null) return true
  if (o.examples == null || typeof o.examples !== 'object') return false
  const ex = o.examples as Record<string, unknown>
  return isExample(ex.up) && isExample(ex.down)
}

// 取得の打ち切り。スマホの弱い回線で応答が返らないとき、いつまでも薄い枠のままにしない（2026-09-18）
const FETCH_TIMEOUT_MS = 15_000

/**
 * 状態は4つ（DESIGN §6-12）:
 *  loading … 薄い枠／ready … 実例あり／empty … 200 で examples が null のときだけ「まだ無い」／
 *  error   … HTTP が ok でない・JSON で読めない・形が違う・回線の失敗・時間切れ。**失敗を「記録が無い」と見せない**
 */
type HomeState = 'loading' | 'ready' | 'empty' | 'error'

/**
 * 入場アニメ（DESIGN §5-6）: translateY(18px)→0 ＋ opacity 0→1・.85s・65ms 刻み・最大7要素（合計 390ms ≤ 420ms）。
 * @keyframes rise と animate-rise は app/globals.css。motion-safe: なので「動きを減らす」設定では動かさない。
 * ヒーローの要素にだけ当てる（S2 では5つ）。3つの画面の節より下には当てない。
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
const TEXT_LINK = `inline-flex min-h-11 items-center rounded-field text-small text-brand hover:underline ${FOCUS_RING}`

/** 01 書く の3つの問い。lib/trade/reason.ts が唯一の正（ここで問いを書き直さない） */
const BUY_FIELDS = fieldsFor('buy')

/** 3段の説明。並びと段ラベルは NAV（components/SiteNav.tsx）が唯一の出所。ここは各段の見出しと本文だけ持つ */
const STAGE_COPY: Record<(typeof NAV)[number]['href'], { title: string; body: string }> = {
  '/trade': {
    title: 'なぜ買うのか・どうなったらやめるのかを書く',
    body: '3つの問いに答えるだけです。理由と、やめる条件を書かないと記録できません。「なんとなく」で通せない代わりに、あとで読み返せる形が残ります。',
  },
  '/learn': {
    title: '自分が書いたことを、AIが書いたことと並べて読む',
    body: '同じ形式で書いたAIの記録と、自分のメモを左右に置きます。どちらが良いかは決めません。何が書けていて、何が書けていないかが見えるだけです。',
  },
  '/review': {
    title: '書いた理由と、その後の株価を並べる',
    // 「同じことを5回書くと、共通するところを1つだけ出します」は S2b（2026-09-30）で /review に実物ができた
    // （lib/review/patterns.ts の findPattern＝5件以上・4/5 以上のときだけ1つ）ので、予告ではなく機能の記述として戻した。
    // check-entry.ts の対の検査も同じコミットで「予告がある」に裏返してある（原則9: 無いものを約束しない／あるものは書く）。
    body: `${MIN_ELAPSED_BUSINESS_DAYS}営業日ほど経つと、書いたメモを、その後の株価と並べて読み返します。書いたときに何を考えていたかが、そのまま残っています。同じことを5回書くと、共通するところを1つだけ出します。`,
  },
}
/** 段の間の時間のラベル（その段に入る前に出す）。01 の前には無い */
const TIME_LABEL: Partial<Record<(typeof NAV)[number]['href'], string>> = {
  '/learn': '書いたその日に',
  '/review': `${MIN_ELAPSED_BUSINESS_DAYS}営業日ほど経つと`,
}

/** 注記（法務 C）。AIの判断を見せる節・/watch へ送る節の直下に、地の上・small・--ink-2 で置く（畳まない＝R7・R11） */
const NOTE_AI =
  'これは、このサイトのAIが仮想資金で出した判断の記録です。▲▼はAIの判断の分類で、特定の銘柄の売買を推奨するものではありません。'
/** 実例2件の選び方（法務 2026-09-29 論点5。一字も変えない。scripts/check-answer-examples.ts が見る） */
const PICK_NOTE = '判断日が古い順に、値上がりした例と値下がりした例を1件ずつ。成績のよい判断を選んでいるのではありません。'
const EMPTY_LINE = `並べて見せられるAIの記録は、まだありません（判断日から${MIN_ELAPSED_BUSINESS_DAYS}営業日以上たったものが要ります）。`
const ERROR_LINE = 'AIの判断の記録を読み込めませんでした。記録が消えたわけではありません。時間をおいて、ページを読み込み直してください。'

/** 系列の見分け（色＋線の形。文字には色を使わない＝§5-1） */
function Swatch({ style }: { style: SeriesStyle }) {
  return (
    <svg aria-hidden="true" focusable="false" width={22} height={8} viewBox="0 0 22 8" className="shrink-0">
      <line x1={1} x2={21} y1={4} y2={4} stroke={style.color} strokeWidth={style.width} strokeDasharray={svgDash(style)} strokeLinecap="round" />
    </svg>
  )
}

/** 読み込み中の薄い枠（完成時と同じ大きさ。回り続ける動きは付けない＝R4） */
function Skeleton({ className = '' }: { className?: string }) {
  return <div role="status" aria-busy="true" aria-label="読み込み中" className={`rounded-card border border-border ${className}`.trim()} />
}

/**
 * ヒーロー右の「残るもの（例）」。AIの実例のうち判断日が古い方を使う。**騰落率を出さない**（R3）。
 * 「やめる条件」の線は描かず、書けば文で出る旨の1行に置き換える（2026-09-29 オーナー判断。AI の判断には対応する項目が無い）。
 */
function HeroCard({ example }: { example: Example }) {
  return (
    <aside aria-labelledby="hero-card-heading" className="space-y-3 rounded-card border border-border p-4">
      <p id="hero-card-heading" className="text-small text-muted">残るもの（例）— このサイトのAIの記録から</p>
      <p className="text-body text-ink">{firstSentence(example.reasoning)}</p>
      <MiniLine
        bars={example.bars}
        decidedAt={example.decidedAt}
        symbol={example.symbol}
        label={`${example.symbol} の終値の折れ線。縦の破線は判断日 ${fmtSlashDate(example.decidedAt)}。`}
      />
      <p className="text-caption text-muted tabular-nums">
        {example.symbol}・{example.source}・{fmtSlashDate(example.priceAsOf)} の終値まで。縦の破線は判断日 {fmtSlashDate(example.decidedAt)}。
      </p>
      <p className="text-caption text-muted">画面の例です。線は実際の株価から引き、無いときは出しません。</p>
    </aside>
  )
}

export default function Home() {
  const [examples, setExamples] = useState<ExamplesBody['examples']>(null)
  const [state, setState] = useState<HomeState>('loading')

  useEffect(() => {
    let alive = true
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
    // 読み口は1本だけ（保存済みの判断と日足の読み出し。AI推論は走らせない）
    fetch('/api/entry/examples', { signal: ctrl.signal })
      .then(async r => {
        if (!r.ok) throw new Error(String(r.status))
        // 本文が JSON でない（途中で切れた応答・HTML のエラーページ）も失敗として扱う
        return r.json() as Promise<unknown>
      })
      .then((body: unknown) => {
        if (!alive) return
        // 形が違う（examples が壊れている等）は失敗として扱う。200 で examples が null のときだけ「まだ無い」
        if (!isExamplesBody(body)) throw new Error('unexpected shape')
        if (body.examples) {
          setExamples(body.examples); setState('ready')
        } else {
          setState('empty')
        }
      })
      .catch(() => { if (alive) setState('error') })
      .finally(() => clearTimeout(timer))
    return () => { alive = false; clearTimeout(timer); ctrl.abort() }
  }, [])

  // ヒーローと 02 に使う1件＝2件のうち判断日が古い方（成績で選ばない。同時刻なら銘柄コードの順）
  const older = examples
    ? (examples.up.decidedAt < examples.down.decidedAt || (examples.up.decidedAt === examples.down.decidedAt && examples.up.symbol <= examples.down.symbol)
      ? examples.up : examples.down)
    : null

  return (
    // 地の塗りとにじみは app/(night)/layout.tsx。フッターは app/layout.tsx（全ページ共通）。
    <div className="pt-1 pb-4 md:pb-5">

      {/* ── 1. ヒーロー（入場アニメはここだけ） ─────────────────────────────── */}
      <section aria-labelledby="hero-heading" data-section="hero" className="grid gap-8 lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] lg:items-start">
        <div className="max-w-[760px]">
          {/* display＝52px / 1.26 / 900 / 字間 −0.035em（DESIGN §5-2。1画面に1つ）。640px 未満は font-size だけ 40px */}
          <h1 id="hero-heading" className={`text-display text-ink text-balance ${RISE[0]} max-sm:text-[40px]`}>
            株を売り買いする前に、その理由を書いて残す場所です。
          </h1>
          {/* リードは h3 の大きさを太さ 400・行間 1.9 で（§5-2。新しい段階を足さない） */}
          <p className={`mt-7 max-w-[540px] text-h3 font-normal leading-[1.9] text-ink-2 ${RISE[1]}`}>
            数週間後、書いた理由と実際の株価を並べて読み返せます。売買で実際のお金は1円も動きません。
          </p>

          {/* 主ボタンは1画面に1つ（§6-1・56px）。行き先は /trade 固定（着地点は1つ）。発光の影（R1 で許された唯一の場所） */}
          <div className={`mt-9 ${RISE[2]}`}>
            <Link
              href="/trade"
              className={`inline-flex h-14 w-full items-center justify-center rounded-card bg-brand px-8 text-body font-semibold text-on-brand shadow-[0_16px_40px_-14px_rgb(45_212_191_/_.70)] transition-colors duration-150 hover:bg-brand-strong sm:w-auto ${FOCUS_RING}`}
            >
              1件目のメモを書く
            </Link>
            <p className="mt-2 text-small text-muted">保存するときだけログインが要ります</p>
          </div>

          <ul className={`mt-5 flex flex-wrap gap-x-6 gap-y-1 ${RISE[3]}`}>
            <li><Link href="/review/backfill" className={TEXT_LINK}>過去に買った株を、いま記録する</Link></li>
            <li><Link href="/watch" className={TEXT_LINK}>AIの判断を読む（ログイン不要）</Link></li>
          </ul>
        </div>

        {/* 右列（lg 以上。スマホでは下に回る）。読み込み中は薄い枠、実例が無ければ何も出さない（架空で埋めない） */}
        <div className={`${RISE[4]} lg:pt-2`}>
          {state === 'loading' && <Skeleton className="h-[248px]" />}
          {older && <HeroCard example={older} />}
        </div>
      </section>

      {/* ── 2〜3. 3つの画面とレール（ここから下は静止。入場アニメを当てない） ─────── */}
      <section aria-labelledby="stages-heading" className="mt-16 md:mt-20">
        <h2 id="stages-heading" className="text-h2 text-ink">このサイトは、3つの画面でできています</h2>
        <p className="mt-1 text-body text-ink-2">
          {NAV.map(n => n.label).join(' → ')}。上から順に降りてくるだけです。途中でやめても、書いたものは残ります。
        </p>

        {/* レール: 左端に 2px の縦線。上が --brand で下に向かって消える。段の印は各 li の丸 */}
        <ol className="relative mt-8 pl-6 before:absolute before:top-0 before:left-0 before:h-full before:w-0.5 before:bg-linear-to-b before:from-brand before:to-transparent before:content-[''] md:pl-10">
          {NAV.map(({ href, label }, i) => {
            const copy = STAGE_COPY[href]
            const time = TIME_LABEL[href]
            return (
              <li key={href} data-stage={href} className="relative">
                {time && (
                  <div className="flex items-center gap-3 py-8">
                    <span className="text-small text-muted">{time}</span>
                    <span aria-hidden="true" className="h-px flex-1 bg-border" />
                  </div>
                )}
                <div className="relative grid gap-5 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] md:gap-10">
                  <span aria-hidden="true" className="absolute top-1.5 -left-[31px] h-3 w-3 rounded-full border-2 border-brand bg-background md:-left-[47px]" />
                  {/* 左: 説明 */}
                  <div>
                    <p className="text-small text-muted tabular-nums">{String(i + 1).padStart(2, '0')} {label}</p>
                    <h3 className="mt-1 text-h3 text-ink text-balance">{copy.title}</h3>
                    <p className="mt-2 max-w-[42rem] text-body text-ink-2">{copy.body}</p>
                  </div>
                  {/* 右: その画面の実物の断片 */}
                  <div className="min-w-0">
                    {href === '/trade' && <WriteFragment />}
                    {href === '/learn' && <CompareFragment older={older} state={state} />}
                    {href === '/review' && <RereadFragment examples={examples} state={state} />}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      </section>

      {/* ── 4. 締め（主ボタンの再掲。色付きの影は付けない＝主ボタンは上の1つ） ──────── */}
      <section aria-labelledby="closing-heading" data-section="closing" className="mt-16 max-w-[760px]">
        <h2 id="closing-heading" className="text-h2 text-ink">最初の1件は、短くてかまいません</h2>
        <Link
          href="/trade"
          className={`mt-4 inline-flex h-12 w-full items-center justify-center rounded-card bg-brand px-8 text-body font-semibold text-on-brand transition-colors duration-150 hover:bg-brand-strong sm:w-auto ${FOCUS_RING}`}
        >
          1件目のメモを書く
        </Link>
        <p className="mt-3 text-small text-ink-2">
          思いつかなければ、<Link href="/review/backfill" className="text-brand hover:underline">過去に買った株を記録する</Link>ところからでも始められます。
        </p>
      </section>

      {/* ── 5. 恒久免責（共通部品。地の上・畳まない） ──────────────────────────── */}
      <section className="mt-12 max-w-[760px] border-t border-border pt-4">
        <Disclaimer part="general" />
      </section>
    </div>
  )
}

/** 01 書く の断片: /trade の3つの問い（readOnly）に記入例が入った状態。押せないので装飾に留める（aria-disabled）。読み上げでは読めてよい */
function WriteFragment() {
  return (
    <div className="space-y-4 rounded-card border border-border bg-card p-4">
      {BUY_FIELDS.map(f => {
        const id = `home-write-${f.key}`
        return (
          <div key={f.key} className="space-y-1">
            <label htmlFor={id} className="block text-small text-ink">
              {f.question}{' '}
              {f.required ? <span className="text-brand">（必須）</span> : <span className="text-muted">（任意）</span>}
            </label>
            <textarea
              id={id}
              readOnly
              rows={Math.max(2, f.rows - 1)}
              value={f.placeholder}
              className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-small leading-relaxed text-ink"
            />
          </div>
        )
      })}
      <button
        type="button"
        aria-disabled="true"
        className="h-12 w-full cursor-default rounded-card bg-brand text-body font-semibold text-on-brand"
      >
        この内容で記録する
      </button>
      <p className="text-caption text-muted">記入例が入った状態です。この画面では押せません。実際に書くのは「01 書く」（上のボタン）。</p>
    </div>
  )
}

/** 02 くらべる の断片: 左は記入例（reason.ts）、右はこのサイトのAIが実際に書いた記録。混ぜない・採点しない */
function CompareFragment({ older, state }: { older: Example | null; state: HomeState }) {
  return (
    <div className="space-y-3">
      <div className="rounded-card border border-border bg-card p-4">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <p className="flex items-center gap-2 text-small text-muted"><Swatch style={SERIES.you} />あなたが書いたこと（記入例）</p>
            <dl className="mt-2 space-y-2">
              {BUY_FIELDS.map(f => (
                <div key={f.key}>
                  <dt className="text-caption text-muted">【{f.label}】</dt>
                  <dd className="text-small text-ink">{f.placeholder}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div>
            <p className="flex items-center gap-2 text-small text-muted"><Swatch style={SERIES.ai} />このサイトのAIが書いたこと</p>
            {older ? (
              <>
                <p className="mt-2 text-caption text-muted tabular-nums">
                  {older.symbol}・{ACTION_LABEL[older.action]}・判断日 {fmtSlashDate(older.decidedAt)}
                </p>
                <p className="mt-1 text-small text-ink">{older.reasoning}</p>
              </>
            ) : state === 'loading' ? (
              <Skeleton className="mt-2 h-32" />
            ) : state === 'error' ? (
              <p role="status" className="mt-2 text-small text-ink-2">{ERROR_LINE}</p>
            ) : (
              <p className="mt-2 text-small text-ink-2">{EMPTY_LINE}</p>
            )}
          </div>
        </div>
        <p className="mt-4 text-caption text-muted">左は記入例、右はこのサイトのAIが実際に書いた記録です。右は、下の 03 に出る2件のうち判断日が古い方です。</p>
      </div>
      {/* 「ちがい」は静的な説明文。差を自動判定して採点しない（採点は助言性に近づく） */}
      <p className="max-w-[42rem] text-body text-ink-2">
        <span className="font-semibold text-ink">ちがい: </span>
        左には「何が起きたらやめるか」の欄があります。右のAIの記録には、その欄がありません。どちらが良いかを、このサイトは判定しません。
      </p>
      <p className="max-w-[42rem] text-small text-ink-2">{NOTE_AI}</p>
      <p className="text-caption text-muted">いまの「02 くらべる」の画面では、{NAV[1].hint}ことができます。左右に並べて読む画面は準備中です。</p>
      <Link href="/watch" className={TEXT_LINK}>AIの判断を全部読む →</Link>
    </div>
  )
}

/** 03 読み返す の断片: AIの実例2件（値上がり・値下がり）。候補が無ければカードは出さない（AnswerCheckCard が null を返す） */
function RereadFragment({ examples, state }: { examples: ExamplesBody['examples']; state: HomeState }) {
  return (
    <div className="space-y-3">
      <p className="max-w-[42rem] text-small text-ink-2">{PICK_NOTE}</p>
      {state === 'loading' && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-[248px]" />
          <Skeleton className="h-[248px]" />
        </div>
      )}
      {state === 'error' && <p role="status" className="text-small text-ink-2">{ERROR_LINE}</p>}
      {state === 'empty' && <p className="text-small text-ink-2">{EMPTY_LINE}</p>}
      {examples && (
        <div className="grid gap-4 lg:grid-cols-2">
          <AnswerCheckCard example={examples.up} kind="up" />
          <AnswerCheckCard example={examples.down} kind="down" />
        </div>
      )}
      <p className="max-w-[42rem] text-small text-ink-2">
        {NOTE_AI} あなたが書いた理由も、「03 読み返す」に残ります。
      </p>
    </div>
  )
}
