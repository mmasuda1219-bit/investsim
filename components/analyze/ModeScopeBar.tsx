'use client'

// /analyze S-B2 — モードタブ（クイック/プロ/投資家モデル）と対象範囲トグル
// （銘柄指定あり/なし）を1行にまとめる表示部品。
//
// デスクトップでは左＝モード・右＝範囲の1行、モバイルでは折り返し（縦積み）。
// 3モードの構成・ラベル、対象範囲の構成・ラベルは一切変更しない — 選択肢の配列
// （id/label/disabled）は呼び出し側 app/analyze/page.tsx の ANALYZE_MODE_TABS /
// ANALYZE_SCOPE_OPTIONS をそのまま渡す設計（新しい選択肢はここで発明しない）。
// resetDownstream（fetch競合ガード）のトリガーはonModeChange/onScopeChange経由で
// 呼び出し側に委ねる（このコンポーネント自体はロジックを持たない）。

export interface ModeScopeOption<T extends string> {
  id: T
  label: string
  disabled?: boolean
}

function TabGroup<T extends string>({
  options,
  value,
  onChange,
}: {
  options: ModeScopeOption<T>[]
  value: T
  onChange: (id: T) => void
}) {
  return (
    <div role="tablist" className="inline-flex rounded-lg border border-border overflow-hidden">
      {options.map(opt => (
        <button
          key={opt.id}
          type="button"
          role="tab"
          aria-selected={value === opt.id}
          onClick={() => {
            if (opt.disabled || opt.id === value) return
            onChange(opt.id)
          }}
          disabled={opt.disabled}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            value === opt.id
              ? 'bg-blue-600 text-white'
              : opt.disabled
                ? 'bg-surface text-slate-600 cursor-not-allowed'
                : 'bg-surface text-slate-400 hover:text-slate-200'
          }`}
        >
          {opt.label}
          {opt.disabled && (
            <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 align-middle">
              近日対応
            </span>
          )}
        </button>
      ))}
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
  return (
    <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
      <div>
        <p className="text-xs text-muted mb-2">モード</p>
        <TabGroup options={modeTabs} value={mode} onChange={onModeChange} />
      </div>
      <div>
        <p className="text-xs text-muted mb-2">対象範囲</p>
        <TabGroup options={scopeOptions} value={scope} onChange={onScopeChange} />
      </div>
    </div>
  )
}
