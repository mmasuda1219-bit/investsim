'use client'

// /analyze S-B2 — Tier3（詳細情報）用の汎用アコーディオン殻。
//
// 「見出し＋開閉」だけを担当し、中身のロジック・データ取得は一切持たない
// （何を包むかは呼び出し側 app/learn/page.tsx が決める）。デフォルト閉。
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
    // 3c-2（2026-09-14）: 枠線の箱をやめ、枠線の無い白い帯にする（DESIGN.md §6-6 A アプリ型）。
    // 開閉の行（行全体が押せる・aria-expanded）と右端の文字ボタン（§6-1 の文字ボタン＝紺青の文字）は残す。
    // 開いた中身の上の区切り線は文字の左端から始める（§6-6）。
    <div className="bg-card rounded-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2"
      >
        <span className="text-body font-semibold text-ink">{title}</span>
        <span className="shrink-0 text-small font-semibold text-brand">{open ? '閉じる ▾' : '詳細を見る ▸'}</span>
      </button>

      {open && <div id={contentId} className="mx-4 space-y-3 border-t border-border pb-5 pt-4">{children}</div>}
    </div>
  )
}
