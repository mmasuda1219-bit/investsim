'use client'

import { ReasonFields } from '@/components/ReasonFields'
import { DECISION_OPTIONS, MEMO_FIELDS, type Decision, type LabMemo } from '@/lib/lab/memo-fields'

/**
 * 画面4「書く」（/study・2026-10-09・S-A）。
 *
 *  - 6つの問いは lib/lab/memo-fields.ts。入力部品は components/ReasonFields.tsx を**無変更で再利用**（lib/trade/reason.ts も変えない）
 *  - 全欄 required: false。errors は常に空（判定しない）。touched も使わない
 *  - 結論は「買う／買わない／保留」の選択（radio）＋理由の欄。どれかを主ボタンにしない（買いへ誘導しない・DESIGN.md §6-1）
 *  - 「自由記述で書く」に切り替えても6欄の内容は消さない（state は両方持つ）
 *  - 保存しない（ブラウザの中だけ）。主ボタン「添削を読む」は画面5を組むだけ
 *  - 主ボタンはこの画面に1つ（これ）
 */

export const MEMO_TITLE = '書く'
export const MEMO_LEAD = '決算を見て考えたことを、6つの問いに分けて書きます。空欄があってもかまいません。書いた内容は保存されず、このページの中にだけ残ります。'
export const SUBMIT_LABEL = '添削を読む'
export const MODE_FREE_LABEL = '自由記述で書く'
export const MODE_FIELDS_LABEL = '6つの問いで書く'
export const FREE_HELP = '問いに分けずに、自分の言葉でまとめて書きます。6つの問いに戻しても、こちらの文は消えません。'
export const DECISION_LEGEND = '結論'
export const DECISION_HELP = 'どれか1つを選びます。決めないときは「保留」。'

interface Props {
  memo: LabMemo
  onChange: (memo: LabMemo) => void
  onSubmit: () => void
}

export function MemoForm({ memo, onChange, onSubmit }: Props) {
  const setDecision = (d: Decision) => onChange({ ...memo, decision: d })
  const toggleMode = () => onChange({ ...memo, mode: memo.mode === 'fields' ? 'free' : 'fields' })

  return (
    <section className="space-y-3" data-section="lab-memo">
      <h2 className="text-h2 text-ink">{MEMO_TITLE}</h2>
      <p className="text-small text-muted max-w-[42rem]">{MEMO_LEAD}</p>

      <form
        className="bg-card rounded-card border border-border px-4 py-4 space-y-5"
        onSubmit={e => { e.preventDefault(); onSubmit() }}
      >
        <div className="flex justify-end">
          <button
            type="button"
            onClick={toggleMode}
            aria-pressed={memo.mode === 'free'}
            className="h-11 px-4 rounded-field bg-card text-ink border border-border-input hover:bg-surface text-small focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
          >
            {memo.mode === 'fields' ? MODE_FREE_LABEL : MODE_FIELDS_LABEL}
          </button>
        </div>

        {/* 結論の選択（買う／買わない／保留 は同じ重さ） */}
        <fieldset className="space-y-2">
          <legend className="text-base text-ink leading-relaxed">{DECISION_LEGEND} <span className="text-muted">（任意）</span></legend>
          <p className="text-sm text-muted leading-relaxed">{DECISION_HELP}</p>
          <div className="flex flex-wrap gap-x-6 gap-y-2">
            {DECISION_OPTIONS.map(o => (
              <label key={o.value} className="inline-flex items-center gap-2 min-h-11 text-body text-ink cursor-pointer">
                <input
                  type="radio"
                  name="lab-decision"
                  value={o.value}
                  checked={memo.decision === o.value}
                  onChange={() => setDecision(o.value)}
                  className="accent-brand"
                />
                {o.label}
              </label>
            ))}
          </div>
        </fieldset>

        {memo.mode === 'fields' ? (
          <ReasonFields
            fields={MEMO_FIELDS}
            parts={memo.parts}
            onChange={(k, v) => onChange({ ...memo, parts: { ...memo.parts, [k]: v } })}
            errors={{}}
            touched={{}}
            onBlur={() => {}}
            idPrefix="lab-memo"
          />
        ) : (
          <div className="space-y-1">
            <label htmlFor="lab-memo-free" className="block text-base text-ink leading-relaxed">
              自由記述 <span className="text-muted">（任意）</span>
            </label>
            <p className="text-sm text-muted leading-relaxed max-w-[42rem]">{FREE_HELP}</p>
            <textarea
              id="lab-memo-free"
              rows={8}
              value={memo.free}
              onChange={e => onChange({ ...memo, free: e.target.value })}
              placeholder="例: 海外ユニクロの伸びが大きく、純利益も増えている。ただ来期予想の伸びは小さい。次の四半期決算まで保留。"
              className="w-full px-3 py-2 rounded-lg bg-panel border border-border focus:border-brand text-base text-ink leading-relaxed placeholder:text-muted focus:outline-none"
            />
          </div>
        )}

        <button
          type="submit"
          className="w-full h-14 rounded-card text-body font-semibold transition-colors bg-brand text-on-brand hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
        >
          {SUBMIT_LABEL}
        </button>
      </form>
    </section>
  )
}
