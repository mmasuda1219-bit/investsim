'use client'

// /analyze S-C — 「あなたが選んだルールの過去5年の成績」カード（Tier2・表示のみ）。
//
// ファイル名は旧称（執行計画カード）の名残だが、法務判定により “AIが執行計画
// （いつ買う・いくら賭ける・どこで損切る）を提示する” 形は実装しない。主語を
// ユーザーへ移し、「ユーザーが選んだ売買ルールが過去5年の実データでどう動いたか」
// の実測値だけを表示する。数値の出所は (a) ユーザーが選んだ条件 (b) 過去の実データ
// からの計算 のみで、当社やAIが決めた数値は1つも含まれない。
//
// 計算・表示文言はすべて lib/report/execution.ts（純関数）に集約し、この
// コンポーネントはレイアウトのみ担当する（MetricStrip / InsightNote と同じ流儀・
// I/Oなし・新しいデータ源は増やさない・COMPANY.md 原則9）。
// 下部の注記（InsightNote）は常時表示 — 折りたたみ禁止（法務由来の必須文言）。
//
// 3c-3（2026-09-14）: 囲いを外し、MetricStrip（3c-2）と同じ形にした（DESIGN.md §2・§5-1・§6-5・§6-6）。
//   帯の外（灰の地の上）: 無彩色の札「過去5年の実測」＋見出し
//   → 検証した売買ルール: 小見出しは帯の外、ルールの文は枠線の無い白い帯
//   → 状態・注意の行: 枠なしで --warning-ink、先頭の「※」だけ semibold（3c-1 の開示の注記と同じ）
//   → 実測ファクト: 2列のタイルをやめて表1つ（左に項目・右に値・tabular-nums）
//   → 往復の全件表示: 1件ずつの小箱をやめ、1つの帯の中の行
//   → 注記（InsightNote）: 常時表示のまま
// 文言・表示する値・並び順は変えていない。

import { Fragment } from 'react'
import InsightNote from './InsightNote'
import { EXECUTION_PLAN_NOTE_LINES } from '@/lib/report/execution'
import type { ExecutionPlan } from '@/lib/report/execution'

// 札（§6-5・ピル型）。灰の地の上に置くので、無彩色の札は --card の面にする（MetricStrip と同じ）。
// 「実測である」ことの表示で、選択中・現在地の意味ではないので紺青にはしない。
const PILL_NEUTRAL = 'inline-block rounded-full px-2.5 text-small font-semibold whitespace-nowrap bg-card text-ink'

export interface ExecutionPlanCardProps {
  plan: ExecutionPlan
}

export default function ExecutionPlanCard({ plan }: ExecutionPlanCardProps) {
  return (
    <div className="space-y-2">
      <div className="space-y-1">
        <div>
          <span className={PILL_NEUTRAL}>過去5年の実測</span>
        </div>
        <h2 className="text-body font-semibold text-ink">あなたが選んだルールの過去5年の成績</h2>
      </div>

      {/* 検証した売買ルール（ユーザーが選んだ条件の言語化）＋出口の明示。
          損切り・利確・保有期限が「無い」ことは正直にそのまま表示する（原則9）。
          3c-3: 青い枠の箱をやめ、小見出しは帯の外、文は枠線の無い白い帯に載せる。 */}
      <div className="space-y-1">
        <h3 className="text-small text-muted">検証した売買ルール（あなたが選んだ条件）</h3>
        <div className="bg-card rounded-card px-4 py-3 space-y-1">
          <p className="text-body font-medium text-ink max-w-[42rem]">{plan.ruleDescription}</p>
          {plan.exitLines.map((line, i) => (
            <p key={i} className="text-small text-ink-2 max-w-[42rem]">{line}</p>
          ))}
        </div>
      </div>

      {/* 状態・注意（fail-closed の正直表示 — 無い数字は無いと書く）。
          3c-3: 琥珀の文字をやめ、枠なしの --warning-ink。先頭の「※」だけ semibold（3c-1 の開示の注記と同じ） */}
      {plan.notes.length > 0 && (
        <ul className="space-y-1 max-w-[42rem]">
          {plan.notes.map((note, i) => (
            <li key={i} className="flex gap-2 text-small text-warning-ink">
              <span className="shrink-0 font-semibold">※</span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 実測ファクト。no_backtest / no_signals では facts が空配列 —
          見出しだけ出して0や「—」を数値として並べることはしない。
          3c-3: 2列のタイルをやめて表1つ（左に項目・右に値。線・余白は MetricStrip の表と同じ）。
          値の補足（母集団 n・出所）は長い文なので、値の下ではなく次の行に全幅で置く（右揃えの長文にしない）。
          値にも「最後の約定は…」のような長い文があるので折り返しを許し、1行に収まるときだけ右に寄る形にする
          （whitespace-nowrap にするとスマホ幅で表がはみ出す）。 */}
      {plan.facts.length > 0 && (
        <div className="bg-card rounded-card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-small">
              <tbody>
                {plan.facts.map((f, i) => (
                  <Fragment key={i}>
                    <tr className={i > 0 ? 'border-t border-border' : undefined}>
                      <th scope="row" className={`px-4 text-left align-top font-normal text-muted ${f.sub ? 'pt-3' : 'py-3'}`}>
                        {f.label}
                      </th>
                      <td className={`px-4 text-right align-top tabular-nums ${f.sub ? 'pt-3' : 'py-3'}`}>
                        {/* 折り返すときは行の長さを揃える（最後の1〜2文字だけが次の行に落ちないように） */}
                        <span className="inline-block text-left text-balance font-mono font-semibold text-ink">{f.value}</span>
                      </td>
                    </tr>
                    {f.sub && (
                      <tr>
                        <td colSpan={2} className="px-4 pb-3 pt-0.5">
                          {/* 全幅の補足が列の幅の配分を引っぱらないよう、幅の計算から外す（列幅は項目名と値だけで決まる） */}
                          <p className="[contain:inline-size] text-caption text-muted tabular-nums">{f.sub}</p>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 完結往復が3件未満のとき: 統計値（中央値・平均）ではなく生の全件を表示。
          3c-3: 1件ずつの小箱をやめ、説明は帯の外、1件＝1行を1つの帯に並べる（区切り線は文字の左端から） */}
      {plan.rawRoundTrips.length > 0 && (
        <div className="space-y-1">
          <p className="text-small text-muted max-w-[42rem]">
            完結した往復の全件表示（件数が少ないため、統計値ではなく1件ずつそのまま表示します）:
          </p>
          <ul className="bg-card rounded-card">
            {plan.rawRoundTrips.map((line, i) => (
              <li key={i} className="mx-4 border-t border-border py-3 text-small text-ink-2 font-mono tabular-nums first:border-t-0">
                {line}
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* 法務注記 — 常時表示（InsightNote 自体が折りたたみを持たない部品）。
          文言は lib/report/execution.ts の定数が単一真実源。 */}
      <InsightNote heading="この成績の読み方" lines={EXECUTION_PLAN_NOTE_LINES} />
    </div>
  )
}
