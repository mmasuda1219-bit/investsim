// /analyze S4 — 透明性カード（純関数・I/Oなし）。
//
// 「なぜこの銘柄/戦略が選ばれたか」を、既に手元にある PreparedBundle の
// 3要素だけから可視化する。新しいデータ源・新しいAPI・新規データ取得は
// 一切増やさない（COMPANY.md 原則9）。
//
// データ源はこの3つに限定する:
//   (a) bundle.fundamentalGate.evaluations — 現在値ファンダの実測 pass/fail/no_data
//   (b) bundle.request.condition.technical — 既存の describeCondition() で文章化
//   (c) bundle.backtest?.metrics           — 5年実データバックテストの要約指標
//
// fail-closed: 取得・判定できた事実のみ reasons/tags に載せる。no_data・欠損・
// 未実行は値を創作せず「データなし」「未実行」と正直に caveats へ回す。
// 過去の各時点のファンダには遡及しない（現在値の静的判定）ことを caveats に必ず
// 明記する。

import type { PreparedBundle } from './types'
import { describeCondition } from './prompt'
import { describeFundamentalFilter, formatMetricValue } from '@/lib/backtest/fundamental'

export interface TransparencyCard {
  /** なぜこの銘柄/戦略が選ばれたかの要点（実測できた事実のみ）。 */
  reasons: string[]
  /** 条件を短いタグで要約したもの（UIのチップ表示用）。 */
  tags: string[]
  /** 注意・不成立・データなし・恒久ディスクレーマ（fail-closed）。 */
  caveats: string[]
}

export function buildTransparencyCard(bundle: PreparedBundle): TransparencyCard {
  const reasons: string[] = []
  const tags: string[] = []
  const caveats: string[] = []

  // (b) テクニカル・トリガー — 戦略の定義そのもの（判定結果ではない）。
  const technicalDesc = describeCondition(bundle.request.condition.technical)
  reasons.push(`売買トリガー: ${technicalDesc}`)
  tags.push(technicalDesc)

  // (a) ファンダメンタル・ゲート（現在値・静的・fail-closed）。
  for (const ev of bundle.fundamentalGate.evaluations) {
    const cond = describeFundamentalFilter(ev.filter)
    if (ev.result === 'no_data') {
      caveats.push(`${cond} → データなし（実データ取得不可のため判定不能・不成立扱い）`)
      continue
    }
    const actual = ev.actual != null ? formatMetricValue(ev.filter.metric, ev.actual) : 'データなし'
    if (ev.result === 'pass') {
      reasons.push(`参加条件成立: ${cond}（実測 ${actual}）`)
      tags.push(`${cond}: 実測${actual}`)
    } else {
      caveats.push(`参加条件不成立: ${cond}（実測 ${actual}）`)
    }
  }

  // (c) バックテスト要約（5年実データ・仮想資金）。
  if (bundle.backtest) {
    const m = bundle.backtest.metrics
    const diff = m.totalReturnPct - bundle.backtest.buyHoldReturnPct
    reasons.push(
      `5年実データバックテスト: 総リターン ${m.totalReturnPct >= 0 ? '+' : ''}${m.totalReturnPct.toFixed(2)}%・` +
      `勝率${m.winRate.toFixed(0)}%・バイ&ホールド差 ${diff >= 0 ? '+' : ''}${diff.toFixed(2)}%`,
    )
    tags.push(`総合${m.totalReturnPct >= 0 ? '+' : ''}${m.totalReturnPct.toFixed(2)}%`)
  } else {
    caveats.push(
      `バックテスト未実行（参加条件が現在値で不成立のため実行していません。過去の成績は不明です）`,
    )
  }

  // 恒久注記（COMPANY.md 原則9）: 現在値の静的判定であり過去には遡及しない。
  caveats.push('ファンダメンタル条件は現在値の静的判定であり、過去のバックテスト期間には遡及しません。')

  return { reasons, tags, caveats }
}
