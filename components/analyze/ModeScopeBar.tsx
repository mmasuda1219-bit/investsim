'use client'

// /analyze S-B2 — モードタブ（クイック/プロ/投資家モデル）と対象範囲トグル
// （銘柄指定あり/なし）をまとめる表示部品。
//
// 3c-1（2026-09-14）: 枠付きの切り替えボタン群をやめた。モードは DESIGN.md §6-8 の
// タブ（現在のタブは太字＋紺青の下線）、対象範囲は §6-18 の選択チップ。760px の
// 1列に収めるため、モード→対象範囲の縦積みに統一した。
//
// 3モードの構成・ラベル、対象範囲の構成・ラベルは一切変更しない — 選択肢の配列
// （id/label/disabled）は呼び出し側 app/learn/page.tsx の ANALYZE_MODE_TABS /
// ANALYZE_SCOPE_OPTIONS をそのまま渡す設計（新しい選択肢はここで発明しない）。
// resetDownstream（fetch競合ガード）のトリガーはonModeChange/onScopeChange経由で
// 呼び出し側に委ねる（このコンポーネント自体はロジックを持たない）。

import { useId } from 'react'

export interface ModeScopeOption<T extends string> {
  id: T
  label: string
  disabled?: boolean
}

interface GroupProps<T extends string> {
  options: ModeScopeOption<T>[]
  value: T
  onChange: (id: T) => void
  labelledBy: string
}

// 選べない・選択中の項目を押しても何もしない（同値ガード）。従来の TabGroup と同じ。
function pick<T extends string>(opt: ModeScopeOption<T>, value: T, onChange: (id: T) => void) {
  if (opt.disabled || opt.id === value) return
  onChange(opt.id)
}

function TabGroup<T extends string>({ options, value, onChange, labelledBy }: GroupProps<T>) {
  return (
    <div role="tablist" aria-labelledby={labelledBy} className="flex overflow-x-auto border-b border-border">
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          role="tab"
          aria-selected={value === opt.id}
          onClick={() => pick(opt, value, onChange)}
          disabled={opt.disabled}
          className={`min-h-11 px-4 border-b-2 text-body whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2 ${
            value === opt.id
              ? 'border-brand text-ink font-semibold'
              : opt.disabled
                ? 'border-transparent text-muted cursor-not-allowed'
                : 'border-transparent text-muted hover:text-ink'
          }`}
        >
          {opt.label}
          {opt.disabled && <span className="ml-1.5 text-caption text-muted">近日対応</span>}
        </button>
      ))}
    </div>
  )
}

function ChipGroup<T extends string>({ options, value, onChange, labelledBy }: GroupProps<T>) {
  return (
    <div role="group" aria-labelledby={labelledBy} className="flex flex-wrap gap-2">
      {options.map(opt => {
        const selected = value === opt.id
        return (
          <button
            key={opt.id}
            type="button"
            aria-pressed={selected}
            onClick={() => pick(opt, value, onChange)}
            disabled={opt.disabled}
            className={`min-h-11 rounded-field border px-3 py-2 text-small font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 ${
              selected
                ? 'border-brand bg-brand-tint text-brand'
                : opt.disabled
                  ? 'border-border bg-surface text-muted cursor-not-allowed'
                  : 'border-border-input bg-card text-ink hover:bg-surface'
            }`}
          >
            {opt.label}
            {opt.disabled && <span className="ml-1.5 text-caption font-normal text-muted">近日対応</span>}
          </button>
        )
      })}
    </div>
  )
}

export interface ModeScopeBarProps<M extends string, S extends string> {
  modeTabs: ModeScopeOption<M>[]
  mode: M
  onModeChange: (id: M) => void
  scopeOptions: ModeScopeOption<S>[]
  scope: S
  onScopeChange: (id: S) => void
}

export default function ModeScopeBar<M extends string, S extends string>({
  modeTabs,
  mode,
  onModeChange,
  scopeOptions,
  scope,
  onScopeChange,
}: ModeScopeBarProps<M, S>) {
  const modeLabelId = useId()
  const scopeLabelId = useId()
  return (
    <div className="space-y-4">
      <div>
        <p id={modeLabelId} className="text-small text-muted">モード</p>
        <TabGroup options={modeTabs} value={mode} onChange={onModeChange} labelledBy={modeLabelId} />
      </div>
      <div>
        <p id={scopeLabelId} className="text-small text-muted mb-2">対象範囲</p>
        <ChipGroup options={scopeOptions} value={scope} onChange={onScopeChange} labelledBy={scopeLabelId} />
      </div>
    </div>
  )
}
