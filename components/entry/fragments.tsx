'use client'

import { fmtSlashDate, type AnswerExample } from '@/components/AnswerCheckCard'
import { SERIES, svgDash, type SeriesStyle } from '@/components/chartTheme'
import { composeFrom, fieldsFor, parseReason, type ReasonFieldSpec } from '@/lib/trade/reason'
import { MIN_ELAPSED_BUSINESS_DAYS } from '@/lib/entry/answer-examples'
import { labelOf } from '@/components/SiteNav'
import s from './home.module.css'

/**
 * ホーム（app/(night)/page.tsx）に置く「製品の実物の断片」。L2（2026-10-14・DECISIONS.md 同日）。
 *
 * 設計図 `quiet-instrument` §5: 「この主題はソフトウェアなので、写真は自分の画面そのもの」。写真の代わりに
 * 製品の断片を HTML で実物大に作り、根に `data-ui` を付ける（inspect.mjs が写真として数える・内側は製品の作法）。
 *
 * 1件のメモ（Memo）は lib/trade/reason.ts の fieldsFor('buy') の鍵（thesis / catalyst / exit）→ 文字列。
 *  - 既定は記入例（EXAMPLE_MEMO ＝ reason.ts の placeholder。「例: 」で始まるので記入例と分かる）
 *  - 訪問者がヒーローの実演パネルに書くと、その文がそのまま（保存も送信もせず）ここに入る＝「書いた文がそのまま返ってくる」
 *  - 文の組み立て（composeFrom）と見出しごとの分解（parseReason）は製品の実物の関数。ここで書き直さない
 *
 * 守っていること:
 *  - 良し悪しを判定しない（点数・採点・合否の語と仕組みを持たない）
 *  - AIの記録は保存済みの実データだけ（older＝/api/entry/examples の2件のうち判断日が古い方）。架空で埋めない（原則9）
 *  - 株価の線は実際の株価から引き、無いときは出さない。訪問者のメモには銘柄が無いので線は引かず、入る場所を文で示す
 *  - 注記は 13px 未満にしない・畳まない・薄くしない（R7）。面は不透明（R11）
 */

export type Memo = Record<string, string>
export type ExampleAction = 'buy' | 'sell' | 'hold' | 'watch'
export interface HomeExample extends AnswerExample {
  action: ExampleAction
  elapsedBusinessDays: number
}

/** 「書く」の3つの問い。lib/trade/reason.ts が唯一の正（ここで問いを書き直さない） */
export const BUY_FIELDS: ReasonFieldSpec[] = fieldsFor('buy')
/** 記入例＝reason.ts の placeholder。「例: 」で始まる */
export const EXAMPLE_MEMO: Memo = Object.fromEntries(BUY_FIELDS.map(f => [f.key, f.placeholder]))

/** 方向の札は無彩色＋記号（DESIGN.md §6-5）。買い＝緑・売り＝赤で運ばない */
export const ACTION_LABEL: Record<ExampleAction, string> = {
  buy: '▲ 買い', sell: '▼ 売り', hold: '＝ 保有継続', watch: '◇ 様子見',
}

/** 注記（法務 C）。AIの判断を見せる節の直下に置く。一字も変えない */
export const NOTE_AI =
  'これは、このサイトのAIが仮想資金で出した判断の記録です。▲▼はAIの判断の分類で、特定の銘柄の売買を推奨するものではありません。'
/** 記入例であることの明示（法務。一字も変えない）。「01」の番号は落とし、段の名は NAV から取る（DECISIONS 2026-10-14 決定(2)①）。
 *  **添字ではなく路（/trade）で引く**: この文が指しているのは「書く」の画面そのものなので、並びが変わっても
 *  嘘にならないよう labelOf('/trade') で引く（2026-10-19 に3段→4段で NAV[0] が「学ぶ」になり、実際に嘘になりかけた）。 */
export const SAMPLE_NOTE = `記入例が入った状態です。この画面では押せません。実際に書くのは「${labelOf('/trade')}」（上のボタン）。`
export const PAIR_NOTE_SAMPLE = '左は記入例、右はこのサイトのAIが実際に書いた記録です。'
export const PAIR_NOTE_TYPED = '左は、あなたが上の欄に書いた文です（このページの中だけで、保存も送信もしていません）。右はこのサイトのAIが実際に書いた記録です。'
export const LINE_NOTE = '画面の例です。線は実際の株価から引き、無いときは出しません。'

/** 訪問者が書いた文があるか（記入例のままなら false。空欄だけでも false） */
export function isTyped(draft: Memo | null): boolean {
  if (!draft) return false
  const filled = BUY_FIELDS.some(f => (draft[f.key] ?? '').trim().length > 0)
  const same = BUY_FIELDS.every(f => (draft[f.key] ?? '') === EXAMPLE_MEMO[f.key])
  return filled && !same
}
/** 画面に出すメモ。訪問者の文があればそれ、無ければ記入例 */
export function memoToShow(draft: Memo | null): Memo {
  return isTyped(draft) ? (draft as Memo) : EXAMPLE_MEMO
}
/** 与えるもの＝問いと、それに書いた答え（空の欄は落とす） */
export function givenOf(memo: Memo): { key: string; question: string; value: string }[] {
  const out: { key: string; question: string; value: string }[] = []
  for (const f of BUY_FIELDS) {
    const value = (memo[f.key] ?? '').trim()
    if (value.length > 0) out.push({ key: f.key, question: f.question, value })
  }
  return out
}
/** 保存されるときと同じ形（【見立て】…）に組み立ててから見出しごとに分ける。空の任意項目は落ちる */
export function sectionsOf(memo: Memo) {
  return parseReason(composeFrom(BUY_FIELDS, memo))
}

/** 系列の見分け（色＋線の形。文字には色を使わない＝DESIGN.md §5-1） */
export function Swatch({ style }: { style: SeriesStyle }) {
  return (
    <svg aria-hidden="true" focusable="false" width={22} height={8} viewBox="0 0 22 8">
      <line x1={1} x2={21} y1={4} y2={4} stroke={style.color} strokeWidth={style.width} strokeDasharray={svgDash(style)} strokeLinecap="round" />
    </svg>
  )
}

/** 書くときの3つの問い（製品の実物の形。components/ReasonFields.tsx と同じ並び） */
export function WriteForm({
  values, onChange, onFocus, idPrefix, pointer = false, note = true, inert = false,
}: {
  values: Memo
  onChange?: (key: string, value: string) => void
  onFocus?: () => void
  idPrefix: string
  /** 最初の欄を「選択中」の見え方にする（設計図 §5「1つは選択中」） */
  pointer?: boolean
  note?: boolean
  inert?: boolean
}) {
  return (
    <div>
      {BUY_FIELDS.map((f, i) => {
        const id = `${idPrefix}-${f.key}`
        return (
          <div key={f.key} className={s.field}>
            <label htmlFor={id} className={s.label}>
              {f.question}{' '}
              {f.required ? <span className={s.required}>（必須）</span> : <span className={s.optional}>（任意）</span>}
            </label>
            <p className={s.help}>{f.help}</p>
            <textarea
              id={id}
              rows={Math.max(2, f.rows - 1)}
              value={values[f.key] ?? ''}
              placeholder={f.placeholder}
              readOnly={!onChange}
              tabIndex={inert ? -1 : undefined}
              onChange={onChange ? e => onChange(f.key, e.target.value) : undefined}
              onFocus={onFocus}
              className={s.textarea}
              data-pointer={pointer && i === 0 ? '' : undefined}
            />
          </div>
        )
      })}
      {/* 押せない（aria-disabled）。disabled にしない＝読み上げで読めてよい。tabIndex=-1 で焦点の順路からは外す */}
      <button type="button" aria-disabled="true" tabIndex={-1} className={s.submit}>この内容で記録する</button>
      {note && <p className={s.uiNote}>{SAMPLE_NOTE}</p>}
    </div>
  )
}

/** 記録された1件（/review の WrittenCard の見た目）。見出しごとの区画は製品の parseReason から */
export function RecordView({ memo, typed, stateWord, dense = false }: {
  memo: Memo
  typed: boolean
  stateWord?: string
  /** ヒーローの覗き（上 90px）に【見立て】の文の行まで入れるための詰めた形。上の hint を出さない代わりに、呼ぶ側が stateWord に同じ旨を書く */
  dense?: boolean
}) {
  const sections = sectionsOf(memo)
  return (
    <div className={s.card} data-dense={dense ? '' : undefined}>
      <p className={s.cardHead}>買ったときに書いたこと</p>
      {!dense && <p className={s.cardHint}>{typed ? 'あなたが上の欄に書いた文（このページの中だけ。保存も送信もしていません）' : '記入例が入った状態です'}</p>}
      <dl className={s.dl} data-dense={dense ? '' : undefined}>
        {sections.map((sec, i) => (
          <div key={`${sec.label ?? 'free'}-${i}`}>
            <dt className={s.dt}>{sec.label ? `【${sec.label}】` : '（見出しなし）'}</dt>
            <dd className={s.dd} data-exit={sec.label === '降りる条件' ? '' : undefined}>{sec.value}</dd>
          </div>
        ))}
      </dl>
      {stateWord && <p className={s.meta}>{stateWord}</p>}
    </div>
  )
}

/** 左右に並べる（くらべる）。左はメモ、右はこのサイトのAIが実際に書いた記録。混ぜない・採点しない */
export function CompareView({
  memo, typed, older, aiFallback, children,
}: {
  memo: Memo
  typed: boolean
  older: HomeExample | null
  /** older が無いとき（読み込み中／失敗／まだ無い）に右列へ出すもの。文言と状態機械は page.tsx が持つ */
  aiFallback: React.ReactNode
  children?: React.ReactNode
}) {
  const sections = sectionsOf(memo)
  return (
    <div>
      <div className={s.pair}>
        <div>
          <p className={s.pairHead}><Swatch style={SERIES.you} />{typed ? 'あなたが書いたこと' : 'あなたが書いたこと（記入例）'}</p>
          <dl className={s.dl}>
            {sections.map((sec, i) => (
              <div key={`${sec.label ?? 'free'}-${i}`}>
                <dt className={s.dt}>{sec.label ? `【${sec.label}】` : '（見出しなし）'}</dt>
                <dd className={s.dd}>{sec.value}</dd>
              </div>
            ))}
          </dl>
        </div>
        <div>
          <p className={s.pairHead}><Swatch style={SERIES.ai} />このサイトのAIが書いたこと</p>
          {older ? (
            <>
              <p className={s.meta}>{older.symbol}・{ACTION_LABEL[older.action]}・判断日 {fmtSlashDate(older.decidedAt)}</p>
              <p className={s.pairText}>{older.reasoning}</p>
            </>
          ) : aiFallback}
        </div>
      </div>
      <p className={`${s.uiNote} ${s.uiNoteInk}`}>{typed ? PAIR_NOTE_TYPED : PAIR_NOTE_SAMPLE}</p>
      {children}
    </div>
  )
}

/** 20営業日後（読み返す）。書いた理由はそのまま、株価の線が入る場所を文で示す（訪問者のメモには銘柄が無いので線は引かない） */
export function RereadView({ memo, typed }: { memo: Memo; typed: boolean }) {
  return (
    <div className={s.card}>
      <p className={s.cardHead}>書いた理由と、その後の株価</p>
      <p className={s.cardHint}>{typed ? 'あなたが上の欄に書いた文のまま' : '記入例のまま'}</p>
      <dl className={s.dl}>
        {sectionsOf(memo).map((sec, i) => (
          <div key={`${sec.label ?? 'free'}-${i}`}>
            <dt className={s.dt}>{sec.label ? `【${sec.label}】` : '（見出しなし）'}</dt>
            <dd className={s.dd}>{sec.value}</dd>
          </div>
        ))}
      </dl>
      <div className={s.lineSlot}>
        <p>
          買った株の、{MIN_ELAPSED_BUSINESS_DAYS}営業日ほどの実際の株価の線が、ここに入ります。{LINE_NOTE}
        </p>
      </div>
      <p className={s.meta}>書いたときに何を考えていたかが、そのまま残っています。</p>
    </div>
  )
}
