'use client'

// /analyze S-B2 — 「この数字の意味」共通部品。
//
// 金融数値（バックテスト指標など）の隣に置く、平易な注記の共通表示。
// **常時表示**（クリックで開く形にしない）— 金融数値の注記を隠す設計は
// 法務上避ける（builder作業指示・S-B2）。文面は呼び出し側から渡す（このコンポーネント
// 自体は文言を持たない）。将来 S-C/S-D/S-E で計5箇所に増える前提の作り。

export interface InsightNoteProps {
  /** 見出し（【】内の文字列）。省略時は「この数字の意味」。 */
  heading?: string
  /** 本文（複数行）。行ごとに1つの <p> として表示する。 */
  lines: string[]
}

export default function InsightNote({ heading = 'この数字の意味', lines }: InsightNoteProps) {
  if (lines.length === 0) return null
  return (
    <div className="text-xs text-slate-400 bg-surface/40 border border-border/60 rounded-lg px-3 py-2.5 leading-relaxed space-y-0.5">
      <p className="text-slate-300 font-semibold">【{heading}】</p>
      {lines.map((line, i) => (
        <p key={i}>{line}</p>
      ))}
    </div>
  )
}
