'use client'

// /analyze S-B2 — Tier1「結論」を担う共通部品。
//
// これまで「無料プレビュー結果」と「AIレポートの実行結果（prepared bundle）」の
// 2箇所にほぼ同一の見た目（5指標グリッド）が重複表示されており、ユーザーには
// 何が違うのか分からなかった。本コンポーネントに統合し、両方の呼び出し側が
// 「見出し」（何の結果か）と「ゲート内訳」を props で渡すことで違いを明示する。
//
// 構成: 判定バッジ（参加条件 成立／不成立。ゲート内訳0件のときは中立の
//   「参加条件なし」— 評価していないものを成立と表示しない・原則9）＋見出し
//   ＋ 任意の補足（children）
//   → 5指標グリッド（値が無い項目は呼び出し側で配列から外す＝捏造しない）
//   → 「条件の内訳を見る」の折りたたみ（デフォルト閉・ゲート評価の生データを畳む）
//   → 「この数字の意味」注記（InsightNote・常時表示）。
//
// 表示ロジックのみ（I/Oなし・新しいデータ源は増やさない・COMPANY.md 原則9）。

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import InsightNote from './InsightNote'

export interface MetricStripItem {
  label: string
  value: string
  /** 値のTailwindカラークラス（例: 'text-green-400'）。省略時は白。 */
  valueClassName?: string
  /** 値の下に添える小さな補足（例: 金額換算）。 */
  sub?: string
}

export interface MetricStripGateItem {
  label: string
  result: 'pass' | 'fail' | 'no_data'
  /** 実測値の表示テキスト（データなしの場合もその旨の文字列を渡す — 空欄で誤魔化さない）。 */
  actualText: string
}

export interface MetricStripProps {
  /** 参加条件（ゲート）が成立しているか。バッジの色・文言に反映される。 */
  passed: boolean
  /** 何の結果かを示す見出し（例:「無料プレビュー（現在値判定）」「AIレポートの実行結果（実データ・過去5年日足）」）。 */
  heading: string
  /** 5指標（またはそれ以下）。値が無い指標は呼び出し側で配列から除外する（捏造しない）。 */
  metrics: MetricStripItem[]
  /** ゲート評価の内訳（折りたたみの中身）。空/未指定なら折りたたみ自体を表示しない。 */
  gateBreakdown?: MetricStripGateItem[]
  /** 「この数字の意味」の見出し（InsightNoteへそのまま渡す）。 */
  insightHeading?: string
  /** 「この数字の意味」の本文行。空/未指定ならInsightNote自体を表示しない。 */
  insightLines?: string[]
  /** true時、不成立ならカード全体をamber基調にする（無料プレビューのような「まだ数字が出ていない」文脈向け）。 */
  emphasizeFailure?: boolean
  /** バッジ・見出しの直後、5指標グリッドの直前に挿入する補足（例: 不成立理由の説明文）。 */
  children?: ReactNode
}

export default function MetricStrip({
  passed,
  heading,
  metrics,
  gateBreakdown = [],
  insightHeading,
  insightLines = [],
  emphasizeFailure = false,
  children,
}: MetricStripProps) {
  const [gateOpen, setGateOpen] = useState(false)
  const gateRegionId = useId()
  const gateTotal = gateBreakdown.length
  const gatePassedCount = gateBreakdown.filter(g => g.result === 'pass').length
  // W1（原則9）: ゲート内訳が0件＝参加条件を1件も評価していない。フィルタ0件の
  // とき FundamentalGateResult.passed は仕様上 true になる（lib/backtest/
  // fundamental.ts）が、それを緑バッジ「成立」で見せると「評価して成立した」と
  // 読めてしまうため、中立表示（参加条件なし）に切り替える。
  const hasGateItems = gateTotal > 0

  const containerTone =
    emphasizeFailure && !passed ? 'bg-amber-950/30 border-amber-700' : 'bg-panel border-border'

  return (
    <div className={`border rounded-xl p-5 space-y-3 ${containerTone}`}>
      <div className="flex items-center gap-2 flex-wrap">
        {hasGateItems ? (
          <span
            className={`text-xs font-bold px-2 py-0.5 rounded shrink-0 ${
              passed ? 'bg-green-900/50 text-green-400' : 'bg-amber-900/50 text-amber-400'
            }`}
          >
            {passed ? '参加条件 成立' : '参加条件 不成立'}
          </span>
        ) : (
          <span className="text-xs font-bold px-2 py-0.5 rounded shrink-0 bg-slate-700 text-slate-300">
            参加条件なし
          </span>
        )}
        <h2 className="text-white font-semibold text-sm">{heading}</h2>
      </div>

      {!hasGateItems && (
        <p className="text-xs text-muted leading-relaxed">
          ファンダメンタルの絞り込み条件を指定していないため、参加条件の成立/不成立の判定はありません。
        </p>
      )}

      {children}

      {metrics.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
          {metrics.map((m, i) => (
            <div key={i} className="bg-surface/50 rounded-lg p-3">
              <p className="text-muted text-xs mb-1">{m.label}</p>
              <p className={`font-mono font-bold ${m.valueClassName ?? 'text-white'}`}>{m.value}</p>
              {m.sub && <p className="text-xs text-muted mt-0.5">{m.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {hasGateItems && (
        <div className="border-t border-border/60 pt-2">
          <button
            type="button"
            onClick={() => setGateOpen(v => !v)}
            aria-expanded={gateOpen}
            aria-controls={gateRegionId}
            className="w-full flex items-center justify-between gap-3 text-xs text-slate-300 hover:text-white transition-colors"
          >
            <span>
              条件の内訳を見る（{gateTotal}件中{gatePassedCount}件成立）
            </span>
            <span className="text-muted shrink-0">{gateOpen ? '閉じる ▾' : '開く ▸'}</span>
          </button>

          {gateOpen && (
            <div id={gateRegionId} className="mt-2 space-y-1.5">
              {gateBreakdown.map((g, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2 bg-surface/50 rounded-lg text-xs">
                  <span
                    className={`shrink-0 font-bold px-2 py-0.5 rounded ${
                      g.result === 'pass'
                        ? 'bg-green-900/50 text-green-400'
                        : g.result === 'fail'
                          ? 'bg-red-900/50 text-red-400'
                          : 'bg-slate-700 text-slate-300'
                    }`}
                  >
                    {g.result === 'pass' ? '成立' : g.result === 'fail' ? '不成立' : '判定不能'}
                  </span>
                  <span className="text-slate-300">{g.label}</span>
                  <span className="text-muted font-mono ml-auto">実測: {g.actualText}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {insightLines.length > 0 && <InsightNote heading={insightHeading} lines={insightLines} />}
    </div>
  )
}
