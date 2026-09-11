// /watch: AIの文を「AIの言葉をそのまま」出す。文中の数値トークンだけを小さな札で包む
// （分割は lib/ai-trader/reading-highlight.ts の純関数）。
//
// - 文は1文字も変えない。セグメントの連結＝原文（scripts/check-reading-highlight.ts で担保）。
//   抜き出して別の表にはしない（文脈が失われる）。
// - 見出しで「AIの言葉をそのまま」と明示する。文中の評価語（割安・秀逸・要監視）はサイトの評価では
//   なく AI の発言。札にもしないし、色も付けない（原則11）。
// - 札は色相なし（地 --surface・枠 --border）。評価の良し悪しを色で運ばない。
//   metric（指標＋数値）は等幅・タブラー、signal（信号語）は通常フォント。

import { highlightReading } from '@/lib/ai-trader/reading-highlight'

export interface ReadingTextProps {
  /** AIの文。そのまま描く（trim もしない）。 */
  text: string
  /** 見出し。例: 「AIの読み（AIの言葉をそのまま）」 */
  label: string
  /** 文が空のときの説明。なぜ無いかを書けるときは上書きする。 */
  emptyNote?: string
}

// 上下 1px・左右 6px、前後 2px。leading-snug で本文（leading-relaxed）の行間を押し広げない。
const CHIP =
  'inline-block align-baseline text-sm leading-snug text-ink bg-surface border border-border rounded px-1.5 py-px mx-0.5'

export default function ReadingText({ text, label, emptyNote = '記録がありません' }: ReadingTextProps) {
  const hasText = text.trim().length > 0
  const segments = highlightReading(text)

  return (
    <div className="max-w-[42rem]">
      <h5 className="text-[13px] font-semibold text-ink mb-1">{label}</h5>
      {hasText ? (
        <p className="text-base text-ink-2 leading-relaxed" data-reading-text="">
          {segments.map((s, i) => {
            if (s.kind === 'plain') return <span key={i}>{s.text}</span>
            const cls = s.kind === 'metric' ? `${CHIP} font-mono tabular-nums` : CHIP
            return <span key={i} className={cls}>{s.text}</span>
          })}
        </p>
      ) : (
        <p className="text-sm text-muted leading-relaxed">{emptyNote}</p>
      )}
    </div>
  )
}
