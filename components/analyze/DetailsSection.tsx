'use client'

// /analyze S-B2 — Tier3（詳細情報）用の汎用アコーディオン殻。
//
// 「見出し＋開閉」だけを担当し、中身のロジック・データ取得は一切持たない
// （何を包むかは呼び出し側 app/analyze/page.tsx が決める）。デフォルト閉。
//
// 注意: AIレポート本文（ストリーミングMarkdown）は絶対にこれで包まない —
// 生成直後は常に展開表示のままにする必要がある（builder作業指示・S-B2）。

import { useId, useState } from 'react'
import type { ReactNode } from 'react'

export interface DetailsSectionProps {
  title: string
  children: ReactNode
  /** デフォルトは false（閉）。AIレポート本文はこのコンポーネントで包まないこと。 */
  defaultOpen?: boolean
}

export default function DetailsSection({ title, children, defaultOpen = false }: DetailsSectionProps) {
  const [open, setOpen] = useState(defaultOpen)
  const contentId = useId()

  return (
    <div className="bg-panel border border-border rounded-xl overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="w-full flex items-center justify-between gap-3 px-5 py-3.5 text-left hover:bg-surface/40 transition-colors"
      >
        <span className="text-white font-semibold text-sm">{title}</span>
        <span className="text-xs text-muted shrink-0">{open ? '閉じる ▾' : '詳細を見る ▸'}</span>
      </button>

      {open && <div id={contentId} className="px-5 pb-5 pt-1 border-t border-border space-y-3">{children}</div>}
    </div>
  )
}
