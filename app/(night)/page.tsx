'use client'

import { useEffect, useRef, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { hintOf, labelOf } from '@/components/SiteNav'
import { Disclaimer } from '@/components/ui/Disclaimer'
import { AnswerCheckCard } from '@/components/AnswerCheckCard'
import { MIN_ELAPSED_BUSINESS_DAYS } from '@/lib/entry/answer-examples'
import { SHOW_AI_WATCH } from '@/lib/features'
import { DemoPanel } from '@/components/entry/DemoPanel'
import {
  ACTION_LABEL, CompareView, NOTE_AI, RecordView, RereadView,
  givenOf, isTyped, memoToShow, type HomeExample, type Memo,
} from '@/components/entry/fragments'
import { useReveal } from '@/components/entry/useReveal'
import s from '@/components/entry/home.module.css'

/**
 * トップページ＝入口画面。L2「静かな楽器」（2026-10-14・DECISIONS.md 同日「ホーム（L2）は design-taste-frontend スキルの規則を優先する」）。
 *
 * 設計図は `design-taste-frontend` の `quiet-instrument`（seed 1243233701）。`draw.mjs --show` で再掲。
 * 考え: **投資サイトが普通は言わない「正解を出しません」という拒否が、この設計図が求める「ほとんど囁く」構えになる。**
 * 訪問者ができる1つのこと: ヒーローの実演パネルに自分の理由を書くと、下の節にその文がそのまま現れる（保存も送信もしない）。
 *
 * 構成（上から順に。節の間は空白だけで分ける。番号は使わず、順序の語で示す）:
 *   1. ヒーロー: 27px・2行の見出し（どの幅でも大きくしない）→ 支えの1文 → 主ボタン（/trade）＋文字リンク（/review/backfill）。
 *      右半分は意図して空ける。下端から実演パネル（components/entry/DemoPanel.tsx・data-ui）が覗く
 *   2. 「与えて、返ってくる」: 3つのやりとり（まず／つぎに／そして）。与えるもの＝書いた文／あなたの文／待つこと。
 *      返ってくるもの＝記録された1件／左右に並んだ断片／760px に広がる、書いた理由と実際の株価（AIの実例2件・実データ）
 *   3. 「同じ1件が、こう変わる」: 同じメモを3つの状態（書いた日／その直後／20営業日後）で真下に重ねる。真ん中の1つは押すと3つ目の状態になる
 *   4. 「最初の1件は、短くてかまいません。」＋小さなボタン
 *   5. 免責 <Disclaimer part="general" />（共通部品・地の上・畳まない）
 *
 * 守っていること:
 *  - AIの判断は **保存済みデータの読み出しだけ**（GET /api/entry/examples の1本。AI推論は走らせない）。架空の判断で埋めない（原則9）
 *  - 取得の状態は loading / ready / empty / error の4つ（DESIGN §6-12）。**失敗を「無い」と見せない**（error は文で出す）
 *  - ログイン状態・記録の有無・時刻・流入元で並び・中身を変えない（法務 2026-09-25 C3〜C5。localStorage・cookie・useSearchParams を使わない）
 *  - ヒーローに騰落率を置かない（R3）。/stocks/ へリンクしない
 *  - 法務の注記は一字も変えず・畳まず・薄めず・13px 未満にしない（R7・R11。文言は components/entry/fragments.tsx）
 *  - 使わない語（法務 2026-09-29）: 見本／お手本／模範／正解例／自動売買／的中／当たった／外れた／正解率／単独の「答え合わせ」。
 *    「無料」はフッター（app/layout.tsx）の1文だけ。名人・投資家の語も書かない
 *  - スキルのハウスルール: 1px の線・枠・グラデーション・休んでいるものへの影・番号・小さな上書きラベルを使わない（data-ui の内側を除く）
 * 検査: scripts/check-entry.ts（構成・法務・ハウスルール）・check-answer-examples.ts（選び方）・design-taste-frontend の lint.mjs / inspect.mjs
 */

/** 応答: 実例あり { examples: { up, down } }／実例なし { examples: null }（正常）。失敗は HTTP 502 */
interface ExamplesBody {
  examples: { up: HomeExample; down: HomeExample } | null
}

function isBar(v: unknown): v is HomeExample['bars'][number] {
  if (v == null || typeof v !== 'object') return false
  const b = v as Record<string, unknown>
  return typeof b.t === 'string' && typeof b.close === 'number'
}
/** 実例1件の形。壊れた要素を ready にしない */
function isExample(v: unknown): v is HomeExample {
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

// 取得の打ち切り。スマホの弱い回線で応答が返らないとき、いつまでも薄い面のままにしない
const FETCH_TIMEOUT_MS = 15_000

/**
 * 状態は4つ（DESIGN §6-12）:
 *  loading … 薄い面／ready … 実例あり／empty … 200 で examples が null のときだけ「まだ無い」／
 *  error   … HTTP が ok でない・JSON で読めない・形が違う・回線の失敗・時間切れ。**失敗を「記録が無い」と見せない**
 */
type HomeState = 'loading' | 'ready' | 'empty' | 'error'

/** 実例2件の選び方（法務 2026-09-29 論点5。一字も変えない。scripts/check-answer-examples.ts が見る） */
const PICK_NOTE = '判断日が古い順に、値上がりした例と値下がりした例を1件ずつ。成績のよい判断を選んでいるのではありません。'
const EMPTY_LINE = `並べて見せられるAIの記録は、まだありません（判断日から${MIN_ELAPSED_BUSINESS_DAYS}営業日以上たったものが要ります）。`
const ERROR_LINE = 'AIの判断の記録を読み込めませんでした。記録が消えたわけではありません。時間をおいて、ページを読み込み直してください。'

/** 読み込み中の薄い面（完成時と同じ大きさ。回り続ける動きは付けない＝R4） */
function Skeleton({ height }: { height: number }) {
  return <div role="status" aria-busy="true" aria-label="読み込み中" className={s.skeleton} style={{ height }} />
}

/** 入場の順番（--i）。見出し → 本文 → 与えるもの → 返ってくるもの の順に 80ms ずつ遅らせる */
const idx = (i: number) => ({ '--i': i } as CSSProperties)

export default function Home() {
  const [examples, setExamples] = useState<ExamplesBody['examples']>(null)
  const [state, setState] = useState<HomeState>('loading')
  /** 訪問者がヒーローの実演パネルに書いた文。null＝まだ書いていない（記入例を出す）。保存も送信もしない */
  const [draft, setDraft] = useState<Memo | null>(null)
  /** 節2 の真ん中の1つ: 押すと3つ目の状態（20営業日後）に変わる */
  const [waited, setWaited] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  useReveal(root)

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

  // くらべる節に使う1件＝2件のうち判断日が古い方（成績で選ばない。同時刻なら銘柄コードの順）
  const older = examples
    ? (examples.up.decidedAt < examples.down.decidedAt || (examples.up.decidedAt === examples.down.decidedAt && examples.up.symbol <= examples.down.symbol)
      ? examples.up : examples.down)
    : null

  const typed = isTyped(draft)
  const memo = memoToShow(draft)
  const given = givenOf(memo)
  /** くらべる断片の右列で、AIの記録がまだ無いときに出すもの（読み込み中／失敗／まだ無い）。失敗を「無い」と見せない */
  const aiFallback = state === 'loading'
    ? <Skeleton height={128} />
    : state === 'error'
      ? <p role="status" className="text-small text-ink-2">{ERROR_LINE}</p>
      : <p className="text-small text-ink-2">{EMPTY_LINE}</p>

  return (
    // 地は <body> の bg-background（globals.css の --bg）。フッターは app/layout.tsx（全ページ共通）。
    <div ref={root} className={s.page}>

      {/* ── 1. ヒーロー（設計図 §6「Column on one line」）────────────────────── */}
      <section aria-labelledby="hero-heading" data-section="hero">
        <div className={s.heroTop}>
          <div className={s.heroCol}>
            {/* 27px・2行・medium・行間 1.25。どの幅でも大きくしない（この設計図だけの例外）。行の切れ目は作者が決める */}
            <h1 id="hero-heading" className={`${s.h1} ${s.rise}`} style={idx(0)}>
              買う理由を書いて、残す。<br />{MIN_ELAPSED_BUSINESS_DAYS}営業日後に、読み返す。
            </h1>
            {/* 行の切れ目は作者が決める（「1円」を行末で割らない） */}
            <p className={`${s.support} ${s.rise}`} style={idx(1)}>仮想資金の練習です。<br />売買で実際のお金は1円も動きません。</p>
            {/* 主ボタンは1画面に1つ。行き先は /trade 固定。アクセントはこの1か所 */}
            <div className={`${s.actions} ${s.rise}`} style={idx(2)}>
              <Link href="/trade" className={s.button}>1件目のメモを書く</Link>
              <Link href="/review/backfill" className={s.textLink}>過去に買った株を記録する →</Link>
            </div>
          </div>
        </div>
        {/* 下端から覗く最初の実演（上 90px が見える・368px 幅）。書くと下の節にその文が現れる */}
        <div className={`${s.heroPanel} ${s.rise}`} style={idx(3)}>
          <DemoPanel onDraft={setDraft} />
        </div>
      </section>

      {/* ── 2. 与えて、返ってくる（設計図 §7-1「Call and response column」）──── */}
      <section aria-labelledby="how-heading" data-section="how" className={`${s.section} ${s.axis}`}>
        <h2 id="how-heading" className={s.h2} data-reveal style={idx(0)}>与えて、返ってくる</h2>
        <ol className={s.exchanges}>

          <li className={s.exchange} data-exchange="write">
            <div className={s.measure}>
              <h3 className={s.h3} data-reveal style={idx(0)}>まず、買う理由を書く。</h3>
              <p className={s.body} data-reveal style={idx(1)}>
                3つの問いに答えます。理由と、やめる条件を書かないと記録できません。「なんとなく」では通らないかわりに、あとで読み返せる形が残ります。
              </p>
              {/* 与えるもの＝上の欄に書いた文、そのまま */}
              <div className={s.call} data-reveal style={idx(2)}>
                {given.map(g => (
                  <p key={g.key}><span className={s.soft}>{g.question}：</span>{g.value}</p>
                ))}
                <p className={`${s.small} ${s.soft}`}>
                  {typed ? '上の欄に書いた文です。このページの中だけで、保存も送信もしません。' : '記入例です。上の欄に書くと、ここがその文に入れ替わります。'}
                </p>
              </div>
            </div>
            {/* 返ってくるもの＝記録された1件 */}
            <div className={s.response} data-reveal style={idx(3)}>
              <div data-ui className={`${s.ui} ${s.bare}`}>
                <RecordView memo={memo} typed={typed} />
              </div>
            </div>
          </li>

          <li className={s.exchange} data-exchange="compare">
            <div className={s.measure}>
              <h3 className={s.h3} data-reveal style={idx(0)}>つぎに、このサイトのAIが書いたものと並べる。</h3>
              {/* 与えるもの＝上の文そのまま（新しく入れるものは無いので、ここには面を置かない） */}
              <p className={s.body} data-reveal style={idx(1)}>
                与えるのは、上の文そのままです。同じ形式で書かれたAIの記録を、その右に置きます。どちらが良いかは決めません。何が書けていて、何が書けていないかが、見えるだけです。
              </p>
            </div>
            {/* 返ってくるもの＝左右に並んだ断片 */}
            <div className={s.response} data-reveal style={idx(2)}>
              <div data-ui className={s.ui}>
                <CompareView memo={memo} typed={typed} older={older} aiFallback={aiFallback} />
              </div>
              {/* 「ちがい」は静的な説明文。差を自動判定して採点しない（採点は助言性に近づく） */}
              <p className={s.note}>
                ちがい: 左には「何が起きたらやめるか」の欄があります。右のAIの記録には、その欄がありません。どちらが良いかを、このサイトは判定しません。
              </p>
              <p className={s.note}>{NOTE_AI}</p>
              {/* 段の呼び名と説明文は路で引く（添字 NAV[1] は並びを変えた日に黙って別の段を指す。2026-10-19 の4段化で実際に起きかけた） */}
              <p className={`${s.note} ${s.small}`}>いまの「{labelOf('/learn')}」の画面では、{hintOf('/learn')}ことができます。左右に並べて読む画面は準備中です。</p>
              {SHOW_AI_WATCH && (
                <Link href="/watch" className={s.textLink}>AIの判断を全部読む →</Link>
              )}
            </div>
          </li>

          <li className={s.exchange} data-exchange="wait">
            <div className={s.measure}>
              <h3 className={s.h3} data-reveal style={idx(0)}>そして、{MIN_ELAPSED_BUSINESS_DAYS}営業日ほど待つ。</h3>
              <p className={s.body} data-reveal style={idx(1)}>
                すぐには読み返せません。待つことが、このサイトの決まりです。結果の出ていない判断は、読み返す材料になりません。
              </p>
              {/* 与えるもの＝待つこと（このサイトの制約そのもの） */}
              <div className={s.call} data-reveal style={idx(2)}>
                {/* 「同じことを5回書くと…」は /review に実物がある（lib/review/patterns.ts・scripts/check-review.ts が対で見る）。無いものを約束しない */}
                <p>{`${MIN_ELAPSED_BUSINESS_DAYS}営業日ほど経つと、書いたメモを、その後の株価と並べて読み返します。書いたときに何を考えていたかが、そのまま残っています。同じことを5回書くと、共通するところを1つだけ出します。`}</p>
              </div>
            </div>
            {/* 返ってくるもの＝書いた理由と実際の株価（760px に広がる）。このサイトのAIの実例2件・実データ */}
            <div className={`${s.response} ${s.wide}`} data-reveal style={idx(3)}>
              <p className="max-w-[42rem] text-small text-ink-2">{PICK_NOTE}</p>
              {/* 候補が無ければカードは出さない（AnswerCheckCard が null を返す）。架空で埋めない */}
              <div data-ui className={`${s.ui} ${s.bare}`} style={{ marginTop: 12 }}>
                {state === 'loading' && (
                  <div className={s.twoUp}>
                    <Skeleton height={248} />
                    <Skeleton height={248} />
                  </div>
                )}
                {state === 'error' && <p role="status" className="text-small text-ink-2">{ERROR_LINE}</p>}
                {state === 'empty' && <p className="text-small text-ink-2">{EMPTY_LINE}</p>}
                {examples && (
                  <div className={s.twoUp}>
                    <AnswerCheckCard example={examples.up} kind="up" />
                    <AnswerCheckCard example={examples.down} kind="down" />
                  </div>
                )}
              </div>
              <p className={s.note}>{NOTE_AI} あなたが書いた理由も、「{labelOf('/review')}」に残ります。</p>
            </div>
          </li>
        </ol>
      </section>

      {/* ── 3. 同じ1件が、こう変わる（設計図 §7-2「One row, three states」）──── */}
      <section aria-labelledby="states-heading" data-section="states" className={s.section}>
        <h2 id="states-heading" className={`${s.h2} ${s.axis}`} data-reveal style={idx(0)}>同じ1件が、こう変わる</h2>
        <ol className={s.showcase}>
          <li className={s.copy} data-state="written" data-reveal style={idx(0)}>
            <p className={s.stateWord}>書いた日</p>
            <div className={`${s.copyBody} ${s.ui} ${s.bare}`} data-ui>
              <RecordView memo={memo} typed={typed} />
            </div>
          </li>
          {/* 真ん中の1つは生きている: 押すと3つ目の状態（20営業日後）に変わる */}
          <li className={s.copy} data-state="after" data-reveal style={idx(1)}>
            <p className={s.stateWord}>{waited ? `${MIN_ELAPSED_BUSINESS_DAYS}営業日後` : 'その直後'}</p>
            <div className={`${s.copyBody} ${s.ui}`} data-ui>
              {waited ? (
                <RereadView memo={memo} typed={typed} />
              ) : (
                <CompareView memo={memo} typed={typed} older={older} aiFallback={aiFallback}>
                  <button type="button" className={s.uiButton} onClick={() => setWaited(true)}>
                    {MIN_ELAPSED_BUSINESS_DAYS}営業日、待ったことにする
                  </button>
                </CompareView>
              )}
            </div>
          </li>
          <li className={s.copy} data-state="later" data-reveal style={idx(2)}>
            <p className={s.stateWord}>{MIN_ELAPSED_BUSINESS_DAYS}営業日後</p>
            <div className={`${s.copyBody} ${s.ui} ${s.bare}`} data-ui>
              <RereadView memo={memo} typed={typed} />
            </div>
          </li>
        </ol>
        <p className={`${s.note} ${s.axis}`}>{NOTE_AI}</p>
      </section>

      {/* ── 4. ふつうの一文と、1つの動作（設計図 §7-3）─────────────────────── */}
      <section aria-label="はじめる" data-section="closing" className={s.cta}>
        <p className={s.sentence} data-reveal style={idx(0)}>最初の1件は、短くてかまいません。</p>
        <div className={s.ctaActions} data-reveal style={idx(1)}>
          <Link href="/trade" className={s.button}>1件目のメモを書く</Link>
          <Link href="/review/backfill" className={s.textLink}>過去に買った株を記録する →</Link>
        </div>
      </section>

      {/* ── 5. 恒久免責（共通部品。地の上・畳まない・線で区切らない）────────── */}
      <div className={s.disclaimer} data-section="disclaimer">
        <Disclaimer part="general" />
      </div>
    </div>
  )
}
