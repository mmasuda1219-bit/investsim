'use client'

// /watch のAI判断1件。「結論 → 理由 → 根拠」の3層で読ませる。
//
//   第1層（常時・最も目立つ）… 会社名／ティッカー・株価・当日変化率／判断／確信度
//   第2層（常時）            … AI自身の言葉（reasoning）。カードの主文
//   第3層（折りたたみ）      … テクニカル／ファンダメンタル／ニュース／参照した原則／出所
//
// 原則9: 欠けているデータは埋めない。「記録がありません」と正直に出す。
// 原則11: AIは助言者ではなく教材。「おすすめ」「買い時」の語は出さない。判断はAIが
//         何をしたかの記録であって、読者への推奨ではない。

import type { AIDecision } from '@/lib/ai-trader/engine'
import DetailsSection from '@/components/analyze/DetailsSection'

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

const ACTION: Record<AIDecision['action'], { label: string; cls: string }> = {
  buy:   { label: '買い',     cls: 'border-success text-success' },
  sell:  { label: '売り',     cls: 'border-danger text-danger' },
  hold:  { label: '保有継続', cls: 'border-border text-ink-2' },
  watch: { label: '様子見',   cls: 'border-border text-muted' },
}

const CONFIDENCE: Record<AIDecision['confidence'], string> = {
  high:   '高い',
  medium: '中くらい',
  low:    '低い',
}

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
      <h4 className="text-sm font-semibold text-ink mb-1">{title}</h4>
      {isEmpty ? (
        <p className="text-sm text-muted">{empty}</p>
      ) : (
        <div className="text-base text-ink-2 leading-relaxed max-w-[42rem]">{children}</div>
      )}
    </div>
  )
}

export default function DecisionCard({ decision, held }: DecisionCardProps) {
  const action = ACTION[decision.action] ?? ACTION.watch
  const news = decision.news ?? []
  const sources = decision.sources ?? []
  const refs = decision.knowledgeRefs ?? []

  return (
    <article className="bg-panel border border-border rounded-2xl">
      <div className="px-5 pt-4 pb-3">
        {/* ── 第1層: 結論 ───────────────────────────────────────────── */}
        <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h3 className="text-xl font-semibold text-ink leading-snug break-words">
              {decision.name || decision.symbol}
            </h3>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono tabular-nums text-sm">
              <span className="text-muted">{decision.symbol}</span>
              <span className="text-ink font-semibold">{fmtPrice(decision.symbol, decision.price)}</span>
              <span className={changeCls(decision.change)}>{fmtPct(decision.change)}</span>
              <span className="font-sans text-muted text-xs">当日</span>
              {held && (
                <span className="font-sans text-xs text-muted border border-border rounded px-1.5 py-px">
                  保有中
                </span>
              )}
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2 shrink-0">
            <span className={`text-base font-semibold border rounded-lg px-3 py-1 ${action.cls}`}>
              {action.label}
            </span>
            <span className="text-sm text-muted whitespace-nowrap">
              確信度 <span className="text-ink-2 font-semibold">{CONFIDENCE[decision.confidence] ?? '不明'}</span>
            </span>
          </div>
        </div>

        {/* ── 第2層: 理由（AI自身の言葉） ────────────────────────────── */}
        {decision.reasoning ? (
          <p className="mt-3 text-base text-ink-2 leading-relaxed max-w-[42rem]">{decision.reasoning}</p>
        ) : (
          <p className="mt-3 text-base text-muted">判断の理由が記録されていません。</p>
        )}
      </div>

      {/* ── 第3層: 根拠（折りたたみ） ──────────────────────────────── */}
      <div className="px-5 pb-4">
        <DetailsSection title="この判断の根拠">
          <div className="space-y-4 pt-2">
            <Field title="テクニカル（値動きの形）">{decision.technicals}</Field>
            <Field title="ファンダメンタル（会社の中身）">{decision.fundamentals}</Field>
            <Field title="ニュースの影響" empty="この銘柄のニュースは判断に使われていません">
              {decision.newsInfluence}
            </Field>

            {news.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-ink mb-1">読んだ見出し</h4>
                <ul className="space-y-1 max-w-[42rem]">
                  {news.map((headline, i) => (
                    <li key={i} className="text-base text-ink-2 leading-relaxed flex gap-2">
                      <span aria-hidden className="text-muted font-mono tabular-nums shrink-0">{i + 1}</span>
                      <span>{headline}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <Field title="参照した投資の原則" empty="この判断では原則の引用がありませんでした">
              {refs.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {refs.map(ref => (
                    <li
                      key={ref.id}
                      className="text-sm text-ink-2 border border-border bg-surface rounded-full px-2.5 py-0.5"
                    >
                      {ref.title}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Field>

            <Field title="データの出所" empty="出所が記録されていません">
              {sources.length > 0 ? (
                <ul className="flex flex-wrap gap-1.5">
                  {sources.map((src, i) => (
                    <li
                      key={i}
                      className="text-sm text-muted border border-border rounded-full px-2.5 py-0.5 font-mono"
                    >
                      {src}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Field>
          </div>
        </DetailsSection>
      </div>
    </article>
  )
}
