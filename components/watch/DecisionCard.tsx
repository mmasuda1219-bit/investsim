'use client'

// /watch のAI判断1件。「結論 → 理由 → 根拠」の3層で読ませる。
//
//   第1層（常時・最も目立つ）… 会社名／ティッカー・株価・当日変化率／判断／確信度
//   第2層（常時）            … AI自身の言葉（reasoning）。カードの主文
//   第3層（折りたたみ）      … テクニカル／ファンダメンタル／ニュース／参照した原則／出所
//
// 見た目（2026-09-12 切り分け3b-1・DESIGN.md §6-6 A アプリ型）:
//   判断1件＝白い帯の中の1まとまり。帯（bg-card rounded-card）は呼び出し側
//   （app/watch/client.tsx）が持ち、このカードは「文字の左端から始まる 1px の区切り線」で
//   区切られた1行として並ぶ（mx-4 border-t first:border-t-0）。角丸の枠線で囲わない。
//   根拠の開閉は共用の DetailsSection（components/analyze/*＝切り分け3c の範囲）を使わず、
//   カードの中の文字ボタン「根拠を開く／根拠を閉じる」で行う（aria-expanded 付き）。
//   これで「判断カード → 折りたたみ箱 → タイル4枚」の3段の入れ子が解けた（§10 P1.5）。
//   札は方向の札（§6-5）だけ。原則・出所のピル型の札は文字にした。
//
// 原則9: 欠けているデータは埋めない。「記録がありません」と正直に出す。
// 原則11: AIは助言者ではなく教材。「おすすめ」「買い時」の語は出さない。判断はAIが
//         何をしたかの記録であって、読者への推奨ではない。

import { useId, useState } from 'react'
import type { AIDecision } from '@/lib/ai-trader/engine'
import EvidenceMap from '@/components/watch/EvidenceMap'

export interface DecisionCardProps {
  decision: AIDecision
  /** 保有中の銘柄なら true。値動きで選ばれただけの銘柄と区別する。 */
  held?: boolean
}

const changeCls = (v: number) => (v > 0 ? 'text-success' : v < 0 ? 'text-danger' : 'text-ink-2')
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

// 通貨は実単位で出す（仮想資金だが単位は偽らない）。Yahoo Financeの `.T` は円建て。
const fmtPrice = (symbol: string, n: number) =>
  /\.T$/i.test(symbol)
    ? `¥${n.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// 方向の札は無彩色（--surface の面・--ink の文字・ピル型。DESIGN.md §6-5）で、方向は記号の形で運ぶ。
// 買い＝緑／売り＝赤にすると、同じページの「利益＝緑」と混ざって「AIが買った＝良いこと」と
// 誤読させる（原則11。AITradeChart / TradeLog と同じ規則）。
// EvidenceMap の結論行は `border rounded-lg px-2.5 py-0.5 ${cls}` を自分で足すので、
// cls 側は面・文字と「見えない枠（border-surface＝面と同色）」だけを持つ。ここを変えれば追従する。
const ACTION: Record<AIDecision['action'], { label: string; cls: string }> = {
  buy:   { label: '▲ 買い',     cls: 'bg-surface border-surface text-ink' },
  sell:  { label: '▼ 売り',     cls: 'bg-surface border-surface text-ink' },
  hold:  { label: '＝ 保有継続', cls: 'bg-surface border-surface text-ink' },
  watch: { label: '◇ 様子見',   cls: 'bg-surface border-surface text-ink' },
}

const CONFIDENCE: Record<AIDecision['confidence'], string> = {
  high:   '高い',
  medium: '中くらい',
  low:    '低い',
}

// 文字ボタン（§6-1）: 枠なし・--brand の文字・ホバーで下線。押せる範囲は 44px 以上（§8）。
const TEXT_BUTTON =
  'inline-flex min-h-11 items-center rounded-field text-small text-brand hover:underline focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2'

/** 第3層の1項目。見出しと本文を分け、欠損は正直に書く。 */
function Field({ title, children, empty = '記録がありません' }: {
  title: string
  children?: React.ReactNode
  empty?: string
}) {
  const isEmpty =
    children == null ||
    children === '' ||
    (Array.isArray(children) && children.length === 0)
  return (
    <div>
      <h4 className="text-small font-semibold text-ink mb-1">{title}</h4>
      {isEmpty ? (
        <p className="text-small text-muted">{empty}</p>
      ) : (
        <div className="text-body text-ink-2 max-w-[42rem]">{children}</div>
      )}
    </div>
  )
}

export default function DecisionCard({ decision, held }: DecisionCardProps) {
  const action = ACTION[decision.action] ?? ACTION.watch
  const sources = decision.sources ?? []
  const refs = decision.knowledgeRefs ?? []
  const [open, setOpen] = useState(false)
  const evidenceId = useId()

  return (
    // 帯の中の1まとまり。区切り線は文字の左端から（mx-4）。枠線・角丸・影は持たない。
    <article className="mx-4 border-t border-border first:border-t-0 py-4">
      {/* ── 第1層: 結論 ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-h3 text-ink break-words">
            {decision.name || decision.symbol}
          </h3>
          {/* ティッカーは等幅ではなく通常書体の太字（§5-2）。数字は tabular-nums で桁を揃える。 */}
          <p className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-small tabular-nums">
            <span className="font-semibold text-ink">{decision.symbol}</span>
            <span className="text-ink">{fmtPrice(decision.symbol, decision.price)}</span>
            <span className={changeCls(decision.change)}>{fmtPct(decision.change)}</span>
            <span className="text-caption text-muted">当日</span>
            {held && <span className="text-caption text-muted">保有中</span>}
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <span className="rounded-full bg-surface px-2.5 text-small font-semibold text-ink whitespace-nowrap">
            {action.label}
          </span>
          <span className="text-small text-muted whitespace-nowrap">
            確信度 <span className="text-ink-2 font-semibold">{CONFIDENCE[decision.confidence] ?? '不明'}</span>
          </span>
        </div>
      </div>

      {/* ── 第2層: 理由（AI自身の言葉） ────────────────────────────── */}
      {decision.reasoning ? (
        <p className="mt-3 text-body text-ink-2 max-w-[42rem]">{decision.reasoning}</p>
      ) : (
        <p className="mt-3 text-body text-muted">判断の理由が記録されていません。</p>
      )}

      {/* ── 第3層: 根拠（文字ボタンで開閉） ────────────────────────── */}
      {/* S1: 「文章→文章→文章」ではなく、テクニカル／ファンダ／ニュースが1つの結論に
          収束する根拠マップ（EvidenceMap）を最初に出す。参照原則・出所はその下に残す。 */}
      <div className="mt-2">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          aria-expanded={open}
          aria-controls={evidenceId}
          className={TEXT_BUTTON}
        >
          {open ? '根拠を閉じる' : '根拠を開く'}
        </button>

        {open && (
          <div id={evidenceId} className="space-y-5 pb-1">
            <EvidenceMap
              decision={decision}
              action={action}
              confidenceLabel={CONFIDENCE[decision.confidence] ?? '不明'}
            />

            <Field title="参照した投資の原則" empty="この判断では原則の引用がありませんでした">
              {refs.length > 0 ? (
                <ul className="space-y-1">
                  {refs.map(ref => (
                    <li key={ref.id} className="text-small text-ink-2">{ref.title}</li>
                  ))}
                </ul>
              ) : null}
            </Field>

            <Field title="データの出所" empty="出所が記録されていません">
              {sources.length > 0 ? (
                <p className="text-small text-muted">{sources.join('・')}</p>
              ) : null}
            </Field>
          </div>
        )}
      </div>
    </article>
  )
}
