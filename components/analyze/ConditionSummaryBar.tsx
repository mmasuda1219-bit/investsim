'use client'

// /analyze S-B1 — 結果確定後、設定エリア（モードタブ／対象範囲トグル／
// 銘柄・初期資金入力／各モードパネル／読者プロファイル）を1行のサマリー帯に
// 圧縮するための表示専用コンポーネント。
//
// このコンポーネント自体はロジックを持たない（何を表示するか・どの項目を
// 省略するかは呼び出し側 app/analyze/page.tsx が判断し、フォーマット済みの
// 文字列配列として渡す — 表示できない項目を捏造しないため、値を持たない
// 項目はここに渡さない＝呼び出し側で filter 済みの配列を渡す規約）。
//
// 「条件を編集」は表示の開閉のみを担当し、resetDownstream（fetch競合ガード・
// 結果破棄）は一切トリガーしない — 呼び出し側の onEdit は値を変更しない
// 純粋なUI状態のトグルであること。

export interface ConditionSummaryBarProps {
  /** 既にフォーマット・フィルタ済みの表示断片（モード・対象範囲・銘柄・条件要約・初期資金など）。 */
  items: string[]
  onEdit: () => void
}

export default function ConditionSummaryBar({ items, onEdit }: ConditionSummaryBarProps) {
  return (
    <div className="bg-panel border border-border rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-slate-300 leading-relaxed min-w-0">
        {items.map((item, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted mx-1.5">・</span>}
            {item}
          </span>
        ))}
      </p>
      <button
        type="button"
        onClick={onEdit}
        className="shrink-0 text-xs px-3 py-1.5 rounded-lg border border-border text-slate-300 hover:border-blue-500 hover:text-white transition-colors"
      >
        条件を編集 ▸
      </button>
    </div>
  )
}
