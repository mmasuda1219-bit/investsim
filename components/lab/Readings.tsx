import type { ReactNode } from 'react'

/**
 * 「2通りの読み方」の囲み（/study・2026-10-12・オーナーの読みやすさの指示 (c)・DECISIONS 2026-10-09 の追記）。
 * 画面2 の各項目の解説と、画面3 の図の下で使う。
 *
 *  - --surface の面＋--border 1px＋左に --brand の縦線 2px。本文と同じ流れに埋もれさせない（上下に間を取る）
 *  - 見出しは text-small font-semibold text-ink、各項目は text-body text-ink（--ink-2 に下げない）。番号付き
 *  - 中身は呼び手が渡す（事実の記述＋2通りの読み方の併置。結論を書かない。lib/lab/9983.ts）
 */

export const READINGS_LABEL = '2通りの読み方'

export function Readings({ items }: { items: ReactNode[] }) {
  return (
    <div className="my-3 bg-surface rounded-card border border-border border-l-2 border-l-brand px-4 py-3 space-y-1" data-readings="">
      <p className="text-small font-semibold text-ink">{READINGS_LABEL}</p>
      <ol className="list-decimal pl-5 space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-body text-ink">{it}</li>
        ))}
      </ol>
    </div>
  )
}
