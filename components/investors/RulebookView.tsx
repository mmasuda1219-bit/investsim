// 投資家1人分の名人欄（2026-09-18 オーナー選択の見た目）。/watch の MasterSignals と銘柄詳細の InvestorPanel が共用。
//
// 上から:
//  1. 人物像の帯（--surface の面）: 名前 h2（20px/600）＋ InvestorLens の3行
//  2. その直下に「ご本人とは無関係です…」（Disclaimer part="investor"）
//  3. 小見出し「数字で確かめること」（small/--muted・右に細線）＋ 表（RuleCheckList・案C）
//     読み込み中・取得失敗・財務データが無いときは表の代わりに帯で伝える（DESIGN §6-12）
//  4. 小見出し「ここから先は、あなたが答えます」＋ レール（QuestionRail・案B）。問いはデータに依らないので常に出す
//  5. 出どころ: 株主への手紙の年の並び（sources の年を重複なく昇順で）
//  6. 共通の免責（Disclaimer part="general"）
//
// 濃紺のベタ帯・大きな主ボタン（案C）は採らない。件数（8つのうち3つ）は出さない。
// 緑・赤・紺青の塗りで状態を表さない（DECISIONS 2026-09-18）。

import { publishedRules, type JudgmentRule, type RuleCheck, type Rulebook, type SourceRef } from '@/lib/investors/rulebooks'
import { INVESTOR_META_BY_ID } from '@/lib/investors/registry'
import { InvestorLens } from '@/components/investors/InvestorLens'
import { RuleCheckList, stampOf } from '@/components/investors/RuleCheckList'
import { QuestionRail } from '@/components/investors/QuestionRail'
import { Disclaimer } from '@/components/ui/Disclaimer'

export interface RulebookViewProps {
  book: Rulebook
  symbol: string
  loading: boolean
  /** 取得に失敗したときの和文（HttpError の message）。null なら成功 */
  error: string | null
  /** 判定の結果。null なら未取得 */
  checks: readonly RuleCheck[] | null
  /** 財務データがまったく取れなかったときの理由の文（API の undecidable） */
  why?: string
  receivedAt: Date | null
}

/** 小見出し: 文字の右に1本の細線（見本 .divider）。右端に添える文があれば線の後ろに置く */
function SubHeading({ text, aside }: { text: string; aside?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-small text-muted whitespace-nowrap">{text}</span>
      <span aria-hidden className="h-px flex-1 bg-rule-line" />
      {aside ? <span className="text-caption text-muted whitespace-nowrap tabular-nums">{aside}</span> : null}
    </div>
  )
}

/** 出典の年（画面に出しているルールと、避けることの出典）。重複なく昇順 */
export function sourceYears(book: Rulebook): { years: number[]; label: string } {
  const sources: SourceRef[] = [
    ...publishedRules(book).flatMap(r => r.sources),
    ...book.avoids.flatMap(a => a.sources),
  ]
  const years = [...new Set(sources.map(s => s.year))].sort((a, b) => a - b)
  const letters = sources.filter(s => s.url?.includes('/letters/')).map(s => s.year)
  const others = [...new Set(sources.filter(s => !s.url?.includes('/letters/')).map(s => s.title))]
  const range = letters.length ? `${Math.min(...letters)}–${Math.max(...letters)}` : ''
  const label = ['株主への手紙', range].filter(Boolean).join(' ') + (others.length ? `・${others.join('・')}` : '')
  return { years, label }
}

function SourceYears({ book }: { book: Rulebook }) {
  const { years, label } = sourceYears(book)
  return (
    <div className="border-t border-rule-line pt-3">
      <p className="text-small text-muted">出どころ: {label}</p>
      {/* 等幅の書体は使わない（DESIGN §5-2）。数字の幅を揃え、字間を少し広げる */}
      <p className="mt-0.5 text-small text-ink-2 tabular-nums tracking-wider">{years.join('　')}</p>
    </div>
  )
}

export function RulebookView({ book, symbol, loading, error, checks, why, receivedAt }: RulebookViewProps) {
  const meta = INVESTOR_META_BY_ID[book.investorId]
  const questions = publishedRules(book).filter((r): r is JudgmentRule => r.kind === 'judgment')
  return (
    <div className="space-y-5">
      {/* 1. 人物像。名前は文字だけ（頭文字の色付き四角・似顔絵は使わない） */}
      <div className="bg-surface rounded-card px-5 py-4 space-y-2">
        <p className="text-h2 text-ink">{meta?.fullName ?? book.investorId}</p>
        <InvestorLens book={book} />
      </div>
      {/* 2. ご本人とは無関係の1文は人物像の直下（文言は Disclaimer の定数。変えない） */}
      <Disclaimer part="investor" className="-mt-2" />

      {/* 3. 数字で確かめること */}
      <section aria-label="数字で確かめること" className="space-y-3">
        <SubHeading text="数字で確かめること" aside={receivedAt ? stampOf(receivedAt) : undefined} />
        {loading && (
          <p className="text-small text-muted">財務データを取得しています…</p>
        )}
        {!loading && error && (
          // 取得できなかったことは --warning-ink で書く（§5-1 色のルール）。HTTP の番号や生の英語は出さない
          <div className="space-y-1">
            <p className="text-body text-warning-ink">判定の材料を取得できませんでした</p>
            <p className="text-body text-ink-2 max-w-[42rem]">{error} 実データが取れないときは、代わりの数字を作らずここで止めます。時間をおいて再読み込みしてください。</p>
          </div>
        )}
        {!loading && !error && why && (
          // 財務データがまったく取れなかったとき。行ごとに同じ文をくり返さず、表の手前に1回だけ
          <div className="space-y-1">
            <p className="text-body text-warning-ink">財務データを取得できませんでした</p>
            <p className="text-body text-ink-2 max-w-[42rem]">{why}</p>
          </div>
        )}
        {/* 財務が全部無い（why）ときは表を出さない。出すと帯と3行の両方に同じ理由が並ぶ（reviewer S4） */}
        {!loading && !error && !why && checks && (
          <RuleCheckList book={book} checks={checks} />
        )}
      </section>

      {/* 4. ここから先は、あなたが答えます（データに依らないので常に出す） */}
      <section aria-label="ここから先は、あなたが答えます" className="space-y-4 pt-2">
        <SubHeading text="ここから先は、あなたが答えます" />
        <QuestionRail rules={questions} symbol={symbol} />
      </section>

      {/* 5. 出どころ */}
      <SourceYears book={book} />

      {/* 6. 共通の免責は末尾 */}
      <Disclaimer part="general" />
    </div>
  )
}
