'use client'

import { useState } from 'react'
import { INVESTOR_META_BY_ID } from '@/lib/investors/registry'
import { RULEBOOKS, useRulebookSignals } from '@/components/MasterSignals'
import { RulebookView } from '@/components/investors/RulebookView'

interface Props {
  symbol: string
}

/**
 * 銘柄詳細の「名人の考え方で見る」（2026-09-17 S2・2026-09-18 見た目の作り直し）。
 *
 * 旧: 5人のタブ・頭文字の丸・格言の斜体・売買の方向の札と3つの点。いまはルールブックがある投資家について
 * 人物像・数字の表と数直線・問いのレール（RulebookView）。判定は /api/signals/[symbol]（AI 不使用）で、
 * 取得の仕組み（useRulebookSignals）は /watch の MasterSignals と共用。
 */

export function InvestorPanel({ symbol }: Props) {
  const [selectedId, setSelectedId] = useState(RULEBOOKS[0]?.investorId)
  const { loading, error, results, undecidable, receivedAt } = useRulebookSignals(symbol)

  const book = RULEBOOKS.find(b => b.investorId === selectedId) ?? RULEBOOKS[0]
  if (!book) return null

  return (
    <section id="investor-panel" aria-labelledby="investor-panel-heading" className="space-y-4">
      {/* 節の見出しは h2（20px/600）。small/--muted では弱すぎて読む気にならない（オーナー指摘 2026-09-18） */}
      <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
        <h2 id="investor-panel-heading" className="text-h2 text-ink">名人の考え方で見る</h2>
        <span className="text-small text-muted">公開された考え方をルールにして、この銘柄の財務データに当てた結果です</span>
      </div>

      {RULEBOOKS.length > 1 && (
        // 投資家が複数になったとき（S5）の切り替え。選択チップ（§6-18）。1人のときは出さない
        <div className="flex flex-wrap items-center gap-2">
          {RULEBOOKS.map(b => (
            <button
              key={b.investorId}
              type="button"
              onClick={() => setSelectedId(b.investorId)}
              aria-pressed={b.investorId === book.investorId}
              className={`min-h-11 rounded-field border px-3 text-small font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 ${b.investorId === book.investorId ? 'border-brand bg-brand-tint text-brand' : 'border-border-input bg-card text-ink hover:bg-surface'}`}
            >
              {INVESTOR_META_BY_ID[b.investorId]?.label ?? b.investorId}
            </button>
          ))}
        </div>
      )}

      <RulebookView
        book={book}
        symbol={symbol}
        loading={loading}
        error={error}
        checks={results?.[book.investorId]?.checks ?? (results ? [] : null)}
        why={undecidable[book.investorId]}
        receivedAt={receivedAt}
      />
    </section>
  )
}
