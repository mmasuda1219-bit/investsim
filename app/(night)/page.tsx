'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import Link from 'next/link'
import { hintOf, labelOf } from '@/components/SiteNav'
import { Disclaimer } from '@/components/ui/Disclaimer'
import { AnswerCheckCard } from '@/components/AnswerCheckCard'
import { MIN_ELAPSED_BUSINESS_DAYS } from '@/lib/entry/answer-examples'
import { SHOW_AI_WATCH, SHOW_LAB_9983 } from '@/lib/features'
import { LAB_9983, fyLabel } from '@/lib/lab/9983'
import { formatSignedPercent } from '@/lib/lab/money'
import { signWord } from '@/lib/lab/display'
import { FIXED_COMPANY_NOTE } from '@/lib/lab/fixed-note'
import { DemoPanel } from '@/components/entry/DemoPanel'
import {
  ACTION_LABEL, CompareView, NOTE_AI, RecordView, RereadView,
  givenOf, isTyped, memoToShow, type HomeExample, type Memo,
} from '@/components/entry/fragments'
import s from '@/components/entry/home.module.css'

/**
 * トップページ＝入口画面。Steep の様式で作る investsim 版（2026-10-25・DECISIONS.md 同日）。
 * それまでの正（L2「静かな楽器」quiet-instrument・2026-10-14）から替えた。:root の22トークンには触らず、
 * ホームだけの値は components/entry/home.module.css の .page の局所変数に閉じる。
 *
 * 構成（上から順に。節の間は空白だけで分ける。番号の文字は使わない）:
 *   1. ヒーロー: 2行の見出し（明朝・28/44/52px）→ 支えの1文 → 主ボタン（/trade）＋文字リンク（/review/backfill）。
 *      1200px 以上は左に文・右に実演パネル（components/entry/DemoPanel.tsx）。影はこの実演パネルの1か所だけ（shadow-float クラス）
 *   2〜5. 4段（<ol>）: 学ぶ → くらべる → 書く → 振り返り。見出しは labelOf(href)、主張は hintOf(href)（添字で NAV を読まない）。
 *      1200px 以上は左に文（440px）・右に断片（600px まで）。文は常に左。
 *      学ぶ: 1社固定の断り（FIXED_COMPANY_NOTE・/study と同じ定数）＋題材の1行＋純利益の前期比と翌営業日の前日比
 *            （lib/lab/9983.ts の Sourced から・出典と時点つき）。SHOW_LAB_9983 が false なら節ごと出さない
 *      くらべる: 左右に並べる断片（CompareView・ここで1回だけ）＋「ちがい」＋注記
 *      書く（心臓）: この節だけ淡い青緑の面（--wash）。ヒーローで書いた文が映る欄＋記録された1件＋主ボタン
 *      振り返り: 「N営業日、待ったことにする」で記録された1件が読み返しの形に変わる＋このサイトのAIの実例2件（実データ）
 *   6. 「最初の1件は、短くてかまいません。」＋主ボタン
 *   7. 免責 <Disclaimer part="general" />（共通部品・地の上・畳まない）
 *
 * 守っていること:
 *  - AIの判断は **保存済みデータの読み出しだけ**（GET /api/entry/examples の1本。AI推論は走らせない）。架空の判断で埋めない（原則9）
 *  - 取得の状態は loading / ready / empty / error の4つ（DESIGN §6-12）。**失敗を「無い」と見せない**（error は文で出す）
 *  - ログイン状態・記録の有無・時刻・流入元で並び・中身を変えない（法務 2026-09-25 C3〜C5。localStorage・cookie・useSearchParams を使わない）
 *  - ヒーローに騰落率を置かない（R3）。/stocks/ へリンクしない。学ぶ節の数字は lib/lab/9983.ts からだけ（直書きしない）
 *  - 法務の注記は一字も変えず・畳まず・薄めず・13px 未満にしない（R7・R11。文言は components/entry/fragments.tsx と lib/lab/fixed-note.ts）
 *  - 使わない語（法務 2026-09-29）: 見本／お手本／模範／正解例／自動売買／的中／当たった／外れた／正解率／単独の「答え合わせ」。
 *    「無料」はフッター（app/layout.tsx）の1文だけ。名人・投資家の語も書かない
 *  - 動きは最初の1画面の入場（rise・4つ）だけ。スクロールで後から現れる演出は置かない（DESIGN §5-6）
 * 検査: scripts/check-entry.ts（構成・法務・見た目の値）・check-answer-examples.ts（選び方）・taste-skill の lint.mjs / inspect.mjs
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

/** 入場の順番（--i）。ヒーローの4つ（見出し → 支えの1文 → 動作 → 実演パネル）を 90ms ずつ遅らせる */
const idx = (i: number) => ({ '--i': i } as CSSProperties)

/** 学ぶ節の数字（lib/lab/9983.ts の Sourced から。画面に数字を書かない）。符号は U+2212 と語で示し、色を付けない */
const STUDY_NET_PROFIT_YOY = LAB_9983.netProfit.yoy
const STUDY_PRICE_CHANGE = LAB_9983.price.changePct
function signedWithWord(n: number): string {
  const w = signWord(n)
  return w ? `${formatSignedPercent(n)}（${w}）` : formatSignedPercent(n)
}

export default function Home() {
  const [examples, setExamples] = useState<ExamplesBody['examples']>(null)
  const [state, setState] = useState<HomeState>('loading')
  /** 訪問者がヒーローの実演パネルに書いた文。null＝まだ書いていない（記入例を出す）。保存も送信もしない */
  const [draft, setDraft] = useState<Memo | null>(null)
  /** 振り返り節の1件: 押すと読み返しの形（N営業日後）に変わる */
  const [waited, setWaited] = useState(false)

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
    <div className={s.page}>

      {/* ── 1. ヒーロー ─────────────────────────────────────────────────────── */}
      <section aria-labelledby="hero-heading" data-section="hero" className={s.hero}>
        <div className={s.heroTop}>
          <div className={s.heroCol}>
            {/* 明朝・2行。行の切れ目は作者が決める */}
            <h1 id="hero-heading" className={`${s.h1} ${s.rise}`} style={idx(0)}>
              買う理由を書いて、残す。<br />{MIN_ELAPSED_BUSINESS_DAYS}営業日後に、読み返す。
            </h1>
            {/* 行の切れ目は作者が決める（「1円」を行末で割らない） */}
            <p className={`${s.support} ${s.rise}`} style={idx(1)}>仮想資金の練習です。<br />売買で実際のお金は1円も動きません。</p>
            {/* 主ボタンは1画面に1つ。行き先は /trade 固定 */}
            <div className={`${s.actions} ${s.rise}`} style={idx(2)}>
              <Link href="/trade" className={s.button}>1件目のメモを書く</Link>
              <Link href="/review/backfill" className={s.textLink}>過去に買った株を記録する →</Link>
            </div>
          </div>
        </div>
        {/* 実演パネル。書くと下の節にその文が現れる。影はこの1か所だけ（--shadow-float は @theme inline の生値なのでクラスで付ける） */}
        <div className={s.heroAside}>
          <div className={`${s.heroPanel} ${s.rise} shadow-float`} style={idx(3)}>
            <DemoPanel onDraft={setDraft} />
          </div>
        </div>
      </section>

      {/* ── 2〜5. 4段（学ぶ → くらべる → 書く → 振り返り）。順序は要素で持ち、番号の文字は出さない ── */}
      <ol className={s.stages} aria-label="このサイトの4つの段">

        {SHOW_LAB_9983 && (
          <li className={`${s.section} ${s.stage}`} data-stage="study" aria-labelledby="study-heading">
            <div className={s.stageText}>
              {/* 1社固定の断り（下の p）。/study と同じ定数（文字列で書き直さない）。見出しの直下に無条件で出す */}
              <h2 id="study-heading" className={s.h2}>{labelOf('/study')}</h2>
              <p className={s.fixedNote}>{FIXED_COMPANY_NOTE}</p>
              <p className={s.lead}>{hintOf('/study')}</p>
              <p className={s.body}>純利益が増えたと発表された翌営業日に、株価は下がりました。なぜでしょう。</p>
              <p className={s.more}><Link href="/study" className={s.textLink}>{labelOf('/study')}を開く →</Link></p>
            </div>
            <div className={s.stageBody}>
              <div data-ui className={s.ui}>
                <dl className={s.figures}>
                  {STUDY_NET_PROFIT_YOY && (
                    <div>
                      <dt className={s.dt}>純利益（{fyLabel(LAB_9983.company.latestFy)}）の前期比</dt>
                      <dd className={s.figure}>{signedWithWord(STUDY_NET_PROFIT_YOY.value)}</dd>
                      <dd className={s.meta}>{STUDY_NET_PROFIT_YOY.source.label}・{STUDY_NET_PROFIT_YOY.source.asOf}</dd>
                    </div>
                  )}
                  <div>
                    <dt className={s.dt}>決算発表の翌営業日（{LAB_9983.price.closeDate}）の株価の前日比</dt>
                    <dd className={s.figure}>{signedWithWord(STUDY_PRICE_CHANGE.value)}</dd>
                    <dd className={s.meta}>{STUDY_PRICE_CHANGE.source.label}・{STUDY_PRICE_CHANGE.source.asOf}</dd>
                  </div>
                </dl>
              </div>
            </div>
          </li>
        )}

        <li className={`${s.section} ${s.stage}`} data-stage="compare" aria-labelledby="compare-heading">
          <div className={s.stageText}>
            <h2 id="compare-heading" className={s.h2}>{labelOf('/learn')}</h2>
            <p className={s.lead}>{hintOf('/learn')}</p>
            <p className={s.body}>
              与えるのは、上の文そのままです。同じ形式で書かれたAIの記録を、その右に置きます。どちらが良いかは決めません。何が書けていて、何が書けていないかが、見えるだけです。
            </p>
            <p className={s.more}><Link href="/learn" className={s.textLink}>{labelOf('/learn')}を開く →</Link></p>
          </div>
          <div className={s.stageBody}>
            <div data-ui className={s.ui}>
              <CompareView memo={memo} typed={typed} older={older} aiFallback={aiFallback} />
            </div>
            {/* 「ちがい」は静的な説明文。差を自動判定して採点しない（採点は助言性に近づく） */}
            <p className={s.note}>
              ちがい: 左には「何が起きたらやめるか」の欄があります。右のAIの記録には、その欄がありません。どちらが良いかを、このサイトは判定しません。
            </p>
            <p className={s.note}>{NOTE_AI}</p>
            <p className={`${s.note} ${s.small}`}>いまの「{labelOf('/learn')}」の画面では、{hintOf('/learn')}ことができます。左右に並べて読む画面は準備中です。</p>
            {SHOW_AI_WATCH && (
              <Link href="/watch" className={s.textLink}>AIの判断を全部読む →</Link>
            )}
          </div>
        </li>

        {/* 心臓。この節だけ淡い青緑の面（--wash）。面の上に --brand の文字は置かない */}
        <li className={`${s.section} ${s.stage} ${s.wash}`} data-stage="write" aria-labelledby="write-heading">
          <div className={s.stageText}>
            <h2 id="write-heading" className={s.h2}>{labelOf('/trade')}</h2>
            <p className={s.lead}>{hintOf('/trade')}</p>
            <p className={s.body}>
              3つの問いに答えます。理由と、やめる条件を書かないと記録できません。「なんとなく」では通らないかわりに、あとで読み返せる形が残ります。
            </p>
            {/* ヒーローの欄に書いた文が、そのまま映る */}
            <div className={s.call}>
              {given.map(g => (
                <p key={g.key}><span className={s.soft}>{g.question}：</span>{g.value}</p>
              ))}
              <p className={`${s.small} ${s.soft}`}>
                {typed ? '上の欄に書いた文です。このページの中だけで、保存も送信もしません。' : '記入例です。上の欄に書くと、ここがその文に入れ替わります。'}
              </p>
            </div>
            <div className={s.actions}>
              <Link href="/trade" className={s.button}>1件目のメモを書く</Link>
            </div>
          </div>
          <div className={s.stageBody}>
            <div data-ui className={`${s.ui} ${s.bare}`}>
              <RecordView memo={memo} typed={typed} />
            </div>
          </div>
        </li>

        <li className={`${s.section} ${s.stage}`} data-stage="review" aria-labelledby="review-heading">
          <div className={s.stageText}>
            <h2 id="review-heading" className={s.h2}>{labelOf('/review')}</h2>
            <p className={s.lead}>{hintOf('/review')}</p>
            <p className={s.body}>
              すぐには読み返せません。待つことが、このサイトの決まりです。結果の出ていない判断は、読み返す材料になりません。
            </p>
            {/* 「同じことを5回書くと…」は /review に実物がある（lib/review/patterns.ts・scripts/check-review.ts が対で見る）。無いものを約束しない */}
            <p className={s.body}>{`${MIN_ELAPSED_BUSINESS_DAYS}営業日ほど経つと、書いたメモを、その後の株価と並べて読み返します。書いたときに何を考えていたかが、そのまま残っています。同じことを5回書くと、共通するところを1つだけ出します。`}</p>
            <p className={s.more}><Link href="/review" className={s.textLink}>{labelOf('/review')}を開く →</Link></p>
          </div>
          <div className={s.stageBody}>
            {/* 押す前は記録された1件、押した後は読み返しの形（N営業日後） */}
            <div data-ui className={s.ui}>
              {waited ? (
                <RereadView memo={memo} typed={typed} />
              ) : (
                <>
                  <RecordView memo={memo} typed={typed} />
                  <button type="button" className={s.uiButton} onClick={() => setWaited(true)}>
                    {MIN_ELAPSED_BUSINESS_DAYS}営業日、待ったことにする
                  </button>
                </>
              )}
            </div>
          </div>
          {/* このサイトのAIの実例2件（実データ）。1200px 以上は2列ぶんの幅に広がる */}
          <div className={`${s.stageBody} ${s.span}`}>
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

      {/* ── 6. ふつうの一文と、1つの動作 ───────────────────────────────────── */}
      <section aria-label="はじめる" data-section="closing" className={s.cta}>
        <p className={s.sentence}>最初の1件は、短くてかまいません。</p>
        <div className={s.ctaActions}>
          <Link href="/trade" className={s.button}>1件目のメモを書く</Link>
          <Link href="/review/backfill" className={s.textLink}>過去に買った株を記録する →</Link>
        </div>
      </section>

      {/* ── 7. 恒久免責（共通部品。地の上・畳まない・線で区切らない）────────── */}
      <div className={s.disclaimer} data-section="disclaimer">
        <Disclaimer part="general" />
      </div>
    </div>
  )
}
