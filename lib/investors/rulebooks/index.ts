// 投資家のルールブックの入口（2026-09-17 S1）。
//
// ルールブックを持つ投資家はここに登録する（当面バフェット1人。S5 で残り4人）。
// 画面に出すのは publishedRules() が返すルールだけ（一次資料で照合済みの出典を1つ以上持つもの）。
// app/ と components/ からは、この index（@/lib/investors/rulebooks）だけを import する（中のファイルの直指定は
// scripts/check-rulebook.ts が禁じる。S2 から画面と /api/signals が使う）。

import type { InvestorId } from '@/types'
import type { DataRule, JudgmentRule, Rule, Rulebook } from './types'
import buffett from './buffett'

export type * from './types'
export { RULE_STATE_LABEL, UNDECIDABLE_REASON_LABEL } from './types'
export { evaluate, evaluateRule, isDataRule, yahooPctToRatio, METRIC_UNIT } from './evaluate'
export type { EvaluateContext } from './evaluate'
export { FORBIDDEN_IN_OUTPUT, NOT_ON_SCREEN, forbiddenWordsIn } from './forbidden'

const RULEBOOKS: Partial<Record<InvestorId, Rulebook>> = {
  buffett,
}

/** ルールブックを持つ投資家のID（並び順もここが正） */
export const RULEBOOK_INVESTOR_IDS: InvestorId[] = Object.keys(RULEBOOKS) as InvestorId[]

/** 無ければ undefined（ルールブックの無い投資家は名人欄に出さない） */
export function getRulebook(id: InvestorId): Rulebook | undefined {
  return RULEBOOKS[id]
}

/** 画面に出してよいルール ＝ 照合済みの出典を1つ以上持つルール。並び順は rules のまま */
export function publishedRules(book: Rulebook): Rule[] {
  return book.rules.filter(r => r.sources.some(s => s.status === '照合済み'))
}

/** 財務データで判定するルールだけ */
export function dataRules(rules: readonly Rule[]): DataRule[] {
  return rules.filter((r): r is DataRule => r.kind === 'data')
}

/** 文章で読むルールだけ（evaluate は返さないので、呼び出し側はこれで取り出す） */
export function judgmentRules(rules: readonly Rule[]): JudgmentRule[] {
  return rules.filter((r): r is JudgmentRule => r.kind === 'judgment')
}
