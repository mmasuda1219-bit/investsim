'use client'

// /analyze S3 — 投資家モデルの選択ピッカー。
//
// 【オーナー要望・最重要】各投資家モデルは「言語化された投資理論・信念
// （philosophy）」を土台として表示し、そこから導かれた条件（conditionNotes/
// rationale）と、信念と実装のギャップの正直な注記（approximationNotes）を
// 併せて見せる。投資家名は表示のみに使い、AIレポート生成プロンプトへは
// 注入しない（app/learn/page.tsx 側で investorModelId を generate に渡さない
// ことで、「本人が買う」という断定をAIができない構造を維持する）。
//
// 3c-1（2026-09-14）: 注意・信念・注記の小箱（色付きの枠）をやめ、DESIGN.md §6-6 の
// A アプリ型にした＝見出しは帯の外（small/muted）、中身は枠線の無い白い帯、
// 箇条は文字の左端から始まる1本の線で区切る行。モデル選択の3列の箱は、名前だけの
// 選択肢なので §6-18 の選択チップにした（radio の name / onChange は不変・sr-only）。
// 信念は「目立つ表示」の意図を保つため、他の帯より一段大きい body/--ink で書く。
//
// ProConditionPicker と同じ `onConditionChange(CompositeCondition)` インター
// フェースで親（AnalyzePage）に条件を渡す。投資家プリセットは自由入力を持たない
// （ラジオ選択のみ）ため、ProConditionPicker と異なりエラー状態は発生しない。

import { useEffect, useId, useState } from 'react'
import type { CompositeCondition } from '@/lib/backtest/types'
import {
  INVESTOR_PRESETS,
  INVESTOR_PRESET_IDS,
  getInvestorPresetCondition,
} from '@/lib/backtest/investor-presets'
import type { InvestorModelId } from '@/lib/backtest/types'

export interface InvestorModelPickerProps {
  onConditionChange: (condition: CompositeCondition) => void
}

// §6-18 選択チップ。中の radio は sr-only なので、キーボード操作時の枠はチップ側に出す。
const chipClass = (selected: boolean) =>
  `relative inline-flex min-h-11 items-center rounded-field border px-3 py-2 text-small font-semibold cursor-pointer transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus has-[:focus-visible]:outline-offset-2 ${
    selected ? 'border-brand bg-brand-tint text-brand' : 'border-border-input bg-card text-ink hover:bg-surface'
  }`

// 帯の中の箇条（1項目＝1行・区切り線は文字の左端から）。
// tone="warning" は原則9の正直な開示（信念と実装のギャップ）用: 枠や面は付けず、文字色だけ
// --warning-ink にして、根拠・条件の並びと見分けられるようにする（3c-1 レビュー後の修正）。
function NoteRows({ items, tone = 'default' }: { items: string[]; tone?: 'default' | 'warning' }) {
  return (
    <ul className="bg-card rounded-card">
      {items.map((text, i) => (
        <li
          key={i}
          className={`mx-4 border-t border-border py-3 text-small first:border-t-0 ${
            tone === 'warning' ? 'text-warning-ink' : 'text-ink-2'
          }`}
        >
          {text}
        </li>
      ))}
    </ul>
  )
}

export default function InvestorModelPicker({ onConditionChange }: InvestorModelPickerProps) {
  const [modelId, setModelId] = useState<InvestorModelId>(INVESTOR_PRESET_IDS[0])
  const pickerLabelId = useId()

  // 選択が変わるたび（初回含む）に、親へ最新の CompositeCondition を通知する。
  // onConditionChange はあえて依存配列に含めない（ProConditionPicker と同じ理由 —
  // 親の再レンダー毎に新しい関数参照になり、含めると無限ループになるため）。
  useEffect(() => {
    onConditionChange(getInvestorPresetCondition(modelId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId])

  const selected = INVESTOR_PRESETS[modelId]

  return (
    <div className="space-y-6">
      <p className="text-small text-ink-2 max-w-[42rem]">
        以下の各モデルは、著名投資家が公に語ってきた投資理論・信念を土台に、実在するテクニカル・ファンダメンタル・
        決算指標へ近似的に写像したスクリーニング条件です。本人の実際の売買判断ではなく、AIレポートの生成時にも
        投資家名は使わず「この条件」として分析します。
      </p>

      {/* モデル選択 */}
      <section className="space-y-2">
        <h2 id={pickerLabelId} className="text-small text-muted">投資家モデル（1つ選択）</h2>
        <div role="radiogroup" aria-labelledby={pickerLabelId} className="flex flex-wrap gap-2">
          {INVESTOR_PRESET_IDS.map(id => {
            const p = INVESTOR_PRESETS[id]
            return (
              <label key={id} className={chipClass(modelId === id)}>
                <input
                  type="radio"
                  name="investor-model"
                  checked={modelId === id}
                  onChange={() => setModelId(id)}
                  className="sr-only"
                />
                {p.label}
              </label>
            )
          })}
        </div>
      </section>

      {/* 信念（土台）— 目立つ表示 */}
      <section className="space-y-2">
        <h2 className="text-small text-muted">投資理論・信念（この条件の土台）</h2>
        <p className="bg-card rounded-card px-4 py-4 text-body text-ink">{selected.philosophy}</p>
      </section>

      {/* 条件の根拠（信念からなぜこの指標が導かれるか） */}
      <section className="space-y-2">
        <h2 className="text-small text-muted">この信念から導かれた条件の根拠</h2>
        <NoteRows items={selected.rationale} />
      </section>

      {/* 実際の条件（結果表示と同じ形式） */}
      <section className="space-y-2">
        <h2 className="text-small text-muted">実際に検証する条件</h2>
        <NoteRows items={selected.conditionNotes} />
      </section>

      {/* 信念と実装のギャップ（正直な注記・原則9）— 見出し語は semibold、文字色は --warning-ink。
          枠・面は付けない（3c-1 レビュー後の修正。根拠・条件の並びと見分けるため） */}
      <section className="space-y-2">
        <h2 className="text-small font-semibold text-warning-ink">近似についての注記（信念と実装のギャップ）</h2>
        <NoteRows items={selected.approximationNotes} tone="warning" />
      </section>
    </div>
  )
}
