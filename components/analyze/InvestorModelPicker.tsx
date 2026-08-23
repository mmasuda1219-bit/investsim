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
// ProConditionPicker と同じ `onConditionChange(CompositeCondition)` インター
// フェースで親（AnalyzePage）に条件を渡す。投資家プリセットは自由入力を持たない
// （ラジオ選択のみ）ため、ProConditionPicker と異なりエラー状態は発生しない。

import { useEffect, useState } from 'react'
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

export default function InvestorModelPicker({ onConditionChange }: InvestorModelPickerProps) {
  const [modelId, setModelId] = useState<InvestorModelId>(INVESTOR_PRESET_IDS[0])

  // 選択が変わるたび（初回含む）に、親へ最新の CompositeCondition を通知する。
  // onConditionChange はあえて依存配列に含めない（ProConditionPicker と同じ理由 —
  // 親の再レンダー毎に新しい関数参照になり、含めると無限ループになるため）。
  useEffect(() => {
    onConditionChange(getInvestorPresetCondition(modelId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelId])

  const selected = INVESTOR_PRESETS[modelId]

  return (
    <div className="space-y-4">
      <p className="text-xs text-amber-400/90 bg-amber-950/20 border border-amber-800/40 rounded-lg px-3 py-2 leading-relaxed">
        以下の各モデルは、著名投資家が公に語ってきた投資理論・信念を土台に、実在するテクニカル・ファンダメンタル・
        決算指標へ近似的に写像したスクリーニング条件です。本人の実際の売買判断ではなく、AIレポートの生成時にも
        投資家名は使わず「この条件」として分析します。
      </p>

      {/* モデル選択 */}
      <div>
        <label className="block text-xs text-muted mb-2">投資家モデル（1つ選択）</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {INVESTOR_PRESET_IDS.map(id => {
            const p = INVESTOR_PRESETS[id]
            return (
              <label
                key={id}
                className={`flex items-start gap-2 text-sm rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                  modelId === id
                    ? 'border-blue-500 bg-blue-950/30 text-white'
                    : 'border-border bg-surface text-slate-300 hover:border-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="investor-model"
                  checked={modelId === id}
                  onChange={() => setModelId(id)}
                  className="mt-1 accent-blue-500"
                />
                <span>{p.label}</span>
              </label>
            )
          })}
        </div>
      </div>

      {/* 信念（土台）— 目立つ表示 */}
      <div className="rounded-lg border border-blue-900/50 bg-blue-950/20 p-4">
        <p className="text-xs text-blue-300 font-medium mb-1">投資理論・信念（この条件の土台）</p>
        <p className="text-sm text-white leading-relaxed">{selected.philosophy}</p>
      </div>

      {/* 条件の根拠（信念からなぜこの指標が導かれるか） */}
      <div>
        <p className="text-xs text-muted mb-1.5">この信念から導かれた条件の根拠</p>
        <ul className="text-xs text-slate-300 space-y-1 list-disc list-inside leading-relaxed">
          {selected.rationale.map((r, i) => <li key={i}>{r}</li>)}
        </ul>
      </div>

      {/* 実際の条件（結果表示と同じ形式） */}
      <div>
        <p className="text-xs text-muted mb-1.5">実際に検証する条件</p>
        <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside leading-relaxed">
          {selected.conditionNotes.map((note, i) => <li key={i}>{note}</li>)}
        </ul>
      </div>

      {/* 信念と実装のギャップ（正直な注記・原則9） */}
      <div className="rounded-lg border border-amber-800/40 bg-amber-950/10 p-3">
        <p className="text-xs text-amber-400 font-medium mb-1">近似についての注記（信念と実装のギャップ）</p>
        <ul className="text-xs text-amber-300/90 space-y-1 list-disc list-inside leading-relaxed">
          {selected.approximationNotes.map((note, i) => <li key={i}>{note}</li>)}
        </ul>
      </div>
    </div>
  )
}
