// ルールブックの «データルール» を財務データで判定する純関数（2026-09-17 S1）。
//
// ネットワーク・AI・DB を使わない。入力は Rulebook と FundamentalsData（実データ）と業種だけ。
// 返すのは DataRule の分だけ。JudgmentRule（言葉のルール）は財務データでは判定できないので、
// ここでは返さない。呼び出し側は index.ts の judgmentRules() で取り出して別に扱う（S2 は問いを出すだけ、
// S3 は理由の文を読んで 'read' にする）。
//
// 判定できないときは黙って misses にせず undecidable にする（原則9: 無いデータで判断を作らない）:
//  - 値が undefined / null / NaN / 無限大 → 'no-data'
//  - excludeSectors を持つルールで、業種が対象外 → 'excluded-sector'
//  - excludeSectors を持つルールで、業種が分からない → 'unknown-sector'（安全側）
//
// 単位: D/E は Yahoo 原値の%表記（types/index.ts:40-43）。根拠は取得元がそのまま写していること＝
// lib/market/providers/yahoo2.ts:235-257（`debtToEquity: num(fd.debtToEquity)`）と
// lib/market/providers/yahoodirect.ts:173-192（`fd.debtToEquity?.raw`）。Yahoo の financialData.debtToEquity は
// AAPL で 78.4 のような%の値。ルールの目安も同じ単位（yahooPct）で書くので、比較は同じ単位どうしで行い、
// 換算はしない。倍率が要るとき（画面表示など）は yahooPctToRatio() を使う。
// D/E の /100 はこのファイル以外に書かない（DECISIONS.md 2026-09-17 不変条件）。

import type { FundamentalsData } from '@/types'
import type { DataRule, MetricUnit, Rule, RuleCheck, RuleCheckSpec, Rulebook, RuleState } from './types'

/**
 * FundamentalsData の各項目が入っている単位（types/index.ts のコメントが根拠）。
 * 全項目を必須にしてあるので、FundamentalsData に項目を足すとここも足すまで型エラーになる（実行時の突き合わせは
 * scripts/check-rulebook.ts にも残す）。ルールの check.unit はこれと一致していなければならない。
 */
export const METRIC_UNIT: Record<keyof FundamentalsData, MetricUnit> = {
  pe: 'x',
  pb: 'x',
  pegRatio: 'x',
  evToEbitda: 'x',
  roe: 'ratio',
  roa: 'ratio',
  operatingMargin: 'ratio',
  grossMargin: 'ratio',
  profitMargin: 'ratio',
  eps: 'amount',
  freeCashflow: 'amount',
  debtToEquity: 'yahooPct',
  currentRatio: 'x',
  revenueGrowth: 'ratio',
  earningsGrowth: 'ratio',
  marketCap: 'amount',
  dividendYield: 'ratio',
  week52High: 'amount',
  week52Low: 'amount',
}

/** Yahoo の%表記（78.4）を倍率（0.784）に。D/E を倍で見せたいときはここを通す */
export function yahooPctToRatio(value: number): number {
  return value / 100
}

export interface EvaluateContext {
  /** 業種。lib/market/us-universe.ts の sector や data/universe.json の sector。分からなければ undefined */
  sector?: string
}

function isUsable(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

function compare(observed: number, spec: RuleCheckSpec): boolean {
  switch (spec.op) {
    case 'gte': return observed >= spec.value
    case 'lte': return observed <= spec.value
    case 'gt': return observed > spec.value
  }
}

function normalizeSector(s: string): string {
  return s.trim().toLowerCase()
}

function isExcludedSector(rule: DataRule, sector: string): boolean {
  const target = normalizeSector(sector)
  return (rule.excludeSectors ?? []).some(x => normalizeSector(x) === target)
}

/** データルール1つを判定する */
export function evaluateRule(rule: DataRule, fundamentals: FundamentalsData, ctx: EvaluateContext = {}): RuleCheck {
  // 業種の対象外かどうかを先に見る（対象外なら、値があっても判定しない）
  if (rule.excludeSectors && rule.excludeSectors.length > 0) {
    const sector = ctx.sector?.trim()
    if (!sector) return { ruleId: rule.id, state: 'undecidable', reason: 'unknown-sector' }
    if (isExcludedSector(rule, sector)) return { ruleId: rule.id, state: 'undecidable', reason: 'excluded-sector' }
  }

  const results: boolean[] = []
  let observed: RuleCheck['observed']
  for (const spec of rule.checks) {
    const raw = fundamentals[spec.metric]
    if (!isUsable(raw)) return { ruleId: rule.id, state: 'undecidable', reason: 'no-data' }
    if (!observed) observed = { metric: spec.metric, value: raw, unit: spec.unit }
    results.push(compare(raw, spec))
  }
  if (results.length === 0) return { ruleId: rule.id, state: 'undecidable', reason: 'no-data' }

  const ok = rule.combine === 'all' ? results.every(Boolean) : results.some(Boolean)
  const state: RuleState = ok ? 'meets' : 'misses'
  return { ruleId: rule.id, state, observed }
}

/**
 * ルールブックのデータルールをすべて判定して、ルールの並び順で返す。
 * 言葉のルール（kind: 'judgment'）は含まない。
 */
export function evaluate(book: Rulebook, fundamentals: FundamentalsData, ctx: EvaluateContext = {}): RuleCheck[] {
  return book.rules
    .filter((r): r is DataRule => r.kind === 'data')
    .map(r => evaluateRule(r, fundamentals, ctx))
}

/** 型の絞り込み用。index.ts と検査スクリプトが使う */
export function isDataRule(rule: Rule): rule is DataRule {
  return rule.kind === 'data'
}
