'use client'

// /analyze S-B1 — 読者プロファイル（任意・4問）をアコーディオンに畳んで
// 設定エリアの縦の高さを圧縮する。
//
// 回答値そのもの（horizon/tolerance/style/capacity）は親（AnalyzePage）の
// state のまま — このコンポーネントは開閉のUI状態（open）だけを内部に持つ
// 「見た目のコンテナ」であり、回答値を保持しない。そのため開閉によって
// 回答内容が失われることはない（開閉＝アンマウントではなく、この
// コンポーネント自体は親から常にマウントされ続け、内部で条件付きレンダリング
// するのは中身のフォーム部分のみ）。
//
// 中身のロジック（ProfileRadioGroup・選択肢・onChange配線）は
// app/learn/page.tsx から無改修で移設したもの。回答内容・レポートへの
// 渡され方（未回答なら profile を一切送らない等）は一切変えていない。

import { useId, useState } from 'react'
import type { ReaderProfile } from '@/lib/report/types'
import { HORIZON_OPTIONS, TOLERANCE_OPTIONS, STYLE_OPTIONS, CAPACITY_OPTIONS } from '@/lib/report/profile'

function ProfileRadioGroup<T extends string>({
  name, options, value, onChange,
}: {
  name: string
  options: { id: T; label: string }[]
  value: T | ''
  onChange: (v: T | '') => void
}) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
      <label
        className={`block rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${
          value === '' ? 'border-blue-500 bg-blue-950/30' : 'border-border bg-surface/50 hover:border-blue-600'
        }`}
      >
        <span className="flex items-center gap-2">
          <input
            type="radio" name={name} checked={value === ''}
            onChange={() => onChange('')} className="accent-blue-500"
          />
          <span className="text-xs text-slate-300">指定なし</span>
        </span>
      </label>
      {options.map(opt => (
        <label
          key={opt.id}
          className={`block rounded-lg border px-2.5 py-2 cursor-pointer transition-colors ${
            value === opt.id ? 'border-blue-500 bg-blue-950/30' : 'border-border bg-surface/50 hover:border-blue-600'
          }`}
        >
          <span className="flex items-center gap-2">
            <input
              type="radio" name={name} checked={value === opt.id}
              onChange={() => onChange(opt.id)} className="accent-blue-500"
            />
            <span className="text-xs text-slate-300">{opt.label}</span>
          </span>
        </label>
      ))}
    </div>
  )
}

export interface ReaderProfilePanelProps {
  horizon: ReaderProfile['horizon'] | ''
  tolerance: ReaderProfile['tolerance'] | ''
  style: ReaderProfile['style'] | ''
  capacity: NonNullable<ReaderProfile['capacity']> | ''
  onHorizonChange: (v: ReaderProfile['horizon'] | '') => void
  onToleranceChange: (v: ReaderProfile['tolerance'] | '') => void
  onStyleChange: (v: ReaderProfile['style'] | '') => void
  onCapacityChange: (v: NonNullable<ReaderProfile['capacity']> | '') => void
}

export default function ReaderProfilePanel({
  horizon, tolerance, style, capacity,
  onHorizonChange, onToleranceChange, onStyleChange, onCapacityChange,
}: ReaderProfilePanelProps) {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  // バッジは必須3問（horizon/tolerance/style）の回答済み数を表示する表示用
  // カウント。任意の4問目（capacity=資金の性格）は分母にも分子にも含めない
  // — readerProfile が有効になる条件（親側ロジック・3問必須）と一致させ、
  // 「あと1問答えないと機能しない」という誤解を避けるため（reviewer指摘）。
  const answeredCount = [horizon, tolerance, style].filter(Boolean).length

  return (
    <div className="border border-border rounded-lg overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface/40 transition-colors"
      >
        <span className="text-sm text-white font-medium">
          読者プロファイル（任意・{answeredCount}/3問回答済み）
        </span>
        <span className="text-xs text-muted shrink-0">{open ? '閉じる ▾' : '開く ▸'}</span>
      </button>

      {open && (
        <div id={contentId} className="px-4 pb-4 pt-1 space-y-3 border-t border-border">
          <p className="text-xs text-muted leading-relaxed">
            回答するとAIレポートの強調順序・語り口・意味づけがあなた向けに調整されます。
            数値・ゲート判定・バックテストの中身は一切変わりません。未回答でも通常どおりレポートは生成されます。
          </p>

          <div>
            <p className="text-xs text-muted mb-1.5">投資期間</p>
            <ProfileRadioGroup name="profile-horizon" options={HORIZON_OPTIONS} value={horizon} onChange={onHorizonChange} />
          </div>
          <div>
            <p className="text-xs text-muted mb-1.5">リスク許容度</p>
            <ProfileRadioGroup name="profile-tolerance" options={TOLERANCE_OPTIONS} value={tolerance} onChange={onToleranceChange} />
          </div>
          <div>
            <p className="text-xs text-muted mb-1.5">スタイル志向</p>
            <ProfileRadioGroup name="profile-style" options={STYLE_OPTIONS} value={style} onChange={onStyleChange} />
          </div>
          <div>
            <p className="text-xs text-muted mb-1.5">資金の性格（任意・4問目）</p>
            <ProfileRadioGroup name="profile-capacity" options={CAPACITY_OPTIONS} value={capacity} onChange={onCapacityChange} />
          </div>
        </div>
      )}
    </div>
  )
}
