'use client'

// /analyze S-B1 — 読者プロファイル（任意・4問）をアコーディオンに畳んで
// 設定エリアの縦の高さを圧縮する。
//
// 3c-1（2026-09-14）: 外枠をやめ、灰の地に載る白い帯（DESIGN.md §6-6 A アプリ型）に
// した。開閉の行が帯の1行目、開いた中身は文字の左端から始まる1本の線の下。
// 選択肢の格子（同形の箱×N・§2 の禁止形）は §6-18 の選択チップにした。
// ラジオ（name / checked / onChange）はそのまま残し、見た目だけ隠す（sr-only）ので、
// キーボードの矢印キーで選べる挙動も変わらない。
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

// §6-18 選択チップ（角丸6px・選択中は --brand-tint の下地＋--brand の枠）。
// 中の radio は sr-only なので、キーボード操作時の枠はチップ側に出す。
const chipClass = (selected: boolean) =>
  `relative inline-flex min-h-11 items-center rounded-field border px-3 py-2 text-small font-semibold cursor-pointer transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus has-[:focus-visible]:outline-offset-2 ${
    selected ? 'border-brand bg-brand-tint text-brand' : 'border-border-input bg-card text-ink hover:bg-surface'
  }`

function ProfileRadioGroup<T extends string>({
  name, labelId, options, value, onChange,
}: {
  name: string
  labelId: string
  options: { id: T; label: string }[]
  value: T | ''
  onChange: (v: T | '') => void
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelId} className="flex flex-wrap gap-2">
      <label className={chipClass(value === '')}>
        <input
          type="radio" name={name} checked={value === ''}
          onChange={() => onChange('')} className="sr-only"
        />
        指定なし
      </label>
      {options.map(opt => (
        <label key={opt.id} className={chipClass(value === opt.id)}>
          <input
            type="radio" name={name} checked={value === opt.id}
            onChange={() => onChange(opt.id)} className="sr-only"
          />
          {opt.label}
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
    <div className="bg-card rounded-card overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        aria-controls={contentId}
        className="w-full min-h-14 flex items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2"
      >
        <span className="text-body font-semibold text-ink">
          読者プロファイル（任意・{answeredCount}/3問回答済み）
        </span>
        <span className="text-small text-muted shrink-0">{open ? '閉じる ▾' : '開く ▸'}</span>
      </button>

      {open && (
        <div id={contentId} className="mx-4 border-t border-border pt-3 pb-5 space-y-4">
          <p className="text-small text-muted max-w-[42rem]">
            回答するとAIレポートの強調順序・語り口・意味づけがあなた向けに調整されます。
            数値・ゲート判定・バックテストの中身は一切変わりません。未回答でも通常どおりレポートは生成されます。
          </p>

          <div>
            <p id={`${contentId}-horizon`} className="text-small text-ink-2 mb-2">投資期間</p>
            <ProfileRadioGroup name="profile-horizon" labelId={`${contentId}-horizon`} options={HORIZON_OPTIONS} value={horizon} onChange={onHorizonChange} />
          </div>
          <div>
            <p id={`${contentId}-tolerance`} className="text-small text-ink-2 mb-2">リスク許容度</p>
            <ProfileRadioGroup name="profile-tolerance" labelId={`${contentId}-tolerance`} options={TOLERANCE_OPTIONS} value={tolerance} onChange={onToleranceChange} />
          </div>
          <div>
            <p id={`${contentId}-style`} className="text-small text-ink-2 mb-2">スタイル志向</p>
            <ProfileRadioGroup name="profile-style" labelId={`${contentId}-style`} options={STYLE_OPTIONS} value={style} onChange={onStyleChange} />
          </div>
          <div>
            <p id={`${contentId}-capacity`} className="text-small text-ink-2 mb-2">資金の性格（任意・4問目）</p>
            <ProfileRadioGroup name="profile-capacity" labelId={`${contentId}-capacity`} options={CAPACITY_OPTIONS} value={capacity} onChange={onCapacityChange} />
          </div>
        </div>
      )}
    </div>
  )
}
