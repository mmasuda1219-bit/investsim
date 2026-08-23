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

import InsightNote from './InsightNote'
import { EXECUTION_PLAN_NOTE_LINES } from '@/lib/report/execution'
import type { ExecutionPlan } from '@/lib/report/execution'

export interface ExecutionPlanCardProps {
  plan: ExecutionPlan
}

export default function ExecutionPlanCard({ plan }: ExecutionPlanCardProps) {
  return (
    <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-bold px-2 py-0.5 rounded shrink-0 bg-blue-900/50 text-blue-300">
          過去5年の実測
        </span>
        <h2 className="text-white font-semibold text-sm">あなたが選んだルールの過去5年の成績</h2>
      </div>

      {/* 検証した売買ルール（ユーザーが選んだ条件の言語化）＋出口の明示。
          損切り・利確・保有期限が「無い」ことは正直にそのまま表示する（原則9）。 */}
      <div className="bg-surface/50 border border-blue-900/50 rounded-lg p-3 space-y-1">
        <p className="text-xs text-blue-300 font-medium">検証した売買ルール（あなたが選んだ条件）</p>
        <p className="text-sm text-white font-medium">{plan.ruleDescription}</p>
        {plan.exitLines.map((line, i) => (
          <p key={i} className="text-xs text-slate-400 leading-relaxed">{line}</p>
        ))}
      </div>

      {/* 状態・注意（fail-closed の正直表示 — 無い数字は無いと書く） */}
      {plan.notes.length > 0 && (
        <ul className="space-y-1">
          {plan.notes.map((note, i) => (
            <li key={i} className="flex gap-2 text-xs text-amber-400/90">
              <span className="shrink-0">※</span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 実測ファクト。no_backtest / no_signals では facts が空配列 —
          見出しだけ出して0や「—」を数値として並べることはしない。 */}
      {plan.facts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {plan.facts.map((f, i) => (
            <div key={i} className="bg-surface/50 rounded-lg p-3">
              <p className="text-muted text-xs mb-1">{f.label}</p>
              <p className="font-mono font-bold text-white text-sm">{f.value}</p>
              {f.sub && <p className="text-xs text-muted mt-0.5 leading-relaxed">{f.sub}</p>}
            </div>
          ))}
        </div>
      )}

      {/* 完結往復が3件未満のとき: 統計値（中央値・平均）ではなく生の全件を表示 */}
      {plan.rawRoundTrips.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs text-muted">
            完結した往復の全件表示（件数が少ないため、統計値ではなく1件ずつそのまま表示します）:
          </p>
          <ul className="space-y-1">
            {plan.rawRoundTrips.map((line, i) => (
              <li key={i} className="text-xs text-slate-300 font-mono bg-surface/50 rounded-lg px-3 py-2">
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
