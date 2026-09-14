'use client'

// /analyze S-B2 — Tier1「結論」を担う共通部品。
//
// これまで「無料プレビュー結果」と「AIレポートの実行結果（prepared bundle）」の
// 2箇所にほぼ同一の見た目（5指標グリッド）が重複表示されており、ユーザーには
// 何が違うのか分からなかった。本コンポーネントに統合し、両方の呼び出し側が
// 「見出し」（何の結果か）と「ゲート内訳」を props で渡すことで違いを明示する。
//
// 構成（3c-2・2026-09-14 に囲いを外した。DESIGN.md §2・§5-1・§6-5・§6-6・§6-18）:
//   帯の外（灰の地の上）: 判定の札（参加条件 成立／不成立。ゲート内訳0件のときは
//     中立の「参加条件なし」— 評価していないものを成立と表示しない・原則9）
//     ＋見出し ＋ 任意の補足（children）
//   → 枠線の無い白い帯: 指標の表1つ（左に名前・右に値。値が無い項目は呼び出し側で
//     配列から外す＝捏造しない）＋「条件の内訳を見る」の開閉（デフォルト閉・
//     ゲート評価の生データを畳む）
//   → 「この数字の意味」注記（InsightNote・常時表示）。
// 数字タイルの格子・橙の面・中央揃えはやめた。「不成立」は §6-5 の注意の札で示し、
// 成立は無彩色の札にする（§5-1: 緑/赤は損益と誤りだけ）。
//
// 表示ロジックのみ（I/Oなし・新しいデータ源は増やさない・COMPANY.md 原則9）。

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import InsightNote from './InsightNote'

export interface MetricStripItem {
  label: string
  value: string
  /** 値の文字色クラス（例: 損益の 'text-success' / 'text-danger'）。省略時は --ink。 */
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
  /** 参加条件（ゲート）が成立しているか。札の形・文言に反映される。 */
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
  /** 見出しの直後、指標の表の直前に挿入する補足（例: 不成立理由の説明文）。 */
  children?: ReactNode
}

// 札（§6-5・ピル型）。見出しの札は灰の地（--surface）の上に置くので、無彩色の札は
// --surface ではなく --card の面にする（--surface の面は地に溶けて札に見えない）。
const PILL = 'inline-block rounded-full px-2.5 text-small font-semibold whitespace-nowrap'
const PILL_NEUTRAL = `${PILL} bg-card text-ink`
const PILL_WARNING = `${PILL} bg-warning-tint text-warning-ink`

export default function MetricStrip({
  passed,
  heading,
  metrics,
  gateBreakdown = [],
  insightHeading,
  insightLines = [],
  children,
}: MetricStripProps) {
  const [gateOpen, setGateOpen] = useState(false)
  const gateRegionId = useId()
  const gateTotal = gateBreakdown.length
  const gatePassedCount = gateBreakdown.filter(g => g.result === 'pass').length
  // W1（原則9）: ゲート内訳が0件＝参加条件を1件も評価していない。フィルタ0件の
  // とき FundamentalGateResult.passed は仕様上 true になる（lib/backtest/
  // fundamental.ts）が、それを「成立」の札で見せると「評価して成立した」と
  // 読めてしまうため、中立表示（参加条件なし）に切り替える。
  const hasGateItems = gateTotal > 0
  const hasMetrics = metrics.length > 0

  return (
    <section className="space-y-2">
      <div className="space-y-1">
        <div>
          {hasGateItems ? (
            <span className={passed ? PILL_NEUTRAL : PILL_WARNING}>
              {passed ? '参加条件 成立' : '参加条件 不成立'}
            </span>
          ) : (
            <span className={PILL_NEUTRAL}>参加条件なし</span>
          )}
        </div>
        <h2 className="text-body font-semibold text-ink">{heading}</h2>

        {!hasGateItems && (
          <p className="text-small text-muted max-w-[42rem]">
            ファンダメンタルの絞り込み条件を指定していないため、参加条件の成立/不成立の判定はありません。
          </p>
        )}

        {children}
      </div>

      {(hasMetrics || hasGateItems) && (
        <div className="bg-card rounded-card overflow-hidden">
          {hasMetrics && (
            <div className="overflow-x-auto">
              <table className="w-full text-small">
                <tbody>
                  {metrics.map((m, i) => (
                    <tr key={i} className="border-t border-border first:border-t-0">
                      <th scope="row" className="px-4 py-3 text-left align-top font-normal text-muted">
                        {m.label}
                      </th>
                      <td className="px-4 py-3 text-right align-top tabular-nums">
                        <span className={`block whitespace-nowrap font-mono font-semibold ${m.valueClassName ?? 'text-ink'}`}>
                          {m.value}
                        </span>
                        {m.sub && <span className="block whitespace-nowrap text-caption text-muted">{m.sub}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {hasGateItems && (
            <div className={hasMetrics ? 'border-t border-border' : undefined}>
              <button
                type="button"
                onClick={() => setGateOpen(v => !v)}
                aria-expanded={gateOpen}
                aria-controls={gateRegionId}
                className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2"
              >
                <span className="text-small text-ink">
                  条件の内訳を見る（{gateTotal}件中{gatePassedCount}件成立）
                </span>
                <span className="shrink-0 text-small font-semibold text-brand">{gateOpen ? '閉じる ▾' : '開く ▸'}</span>
              </button>

              {gateOpen && (
                <div id={gateRegionId} className="overflow-x-auto border-t border-border">
                  <table className="w-full text-small">
                    <tbody>
                      {gateBreakdown.map((g, i) => (
                        <tr key={i} className="border-t border-border first:border-t-0">
                          <th scope="row" className="px-4 py-3 text-left align-top font-normal text-ink-2">
                            {g.label}
                          </th>
                          <td className="px-4 py-3 text-right align-top font-mono tabular-nums text-muted">
                            実測: {g.actualText}
                          </td>
                          <td className="py-3 pr-4 text-right align-top">
                            {g.result === 'fail' ? (
                              <span className={PILL_WARNING}>不成立</span>
                            ) : g.result === 'pass' ? (
                              <span className="whitespace-nowrap font-semibold text-ink">成立</span>
                            ) : (
                              <span className="whitespace-nowrap font-semibold text-warning-ink">判定不能</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {insightLines.length > 0 && <InsightNote heading={insightHeading} lines={insightLines} />}
    </section>
  )
}
