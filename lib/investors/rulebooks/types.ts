// 投資家の「ルールブック」の型（2026-09-17 S1）。
//
// ここにあるのは «データだけ» の定義で、AI もネットワークも使わない。
// 名人の判断を「▲買い／◇様子見」の札ではなく、ルールごとの行として出すための土台
// （決定: DECISIONS.md 2026-09-17「投資家の定義を lib/investors/rulebooks/ に一本化」）。
//
// 守ること（同エントリの不変条件）:
//  - ルールID（例 'buffett.B3'）は記録に残るので、変えない・消さない
//  - D/E（Yahoo は%表記）の換算は evaluate.ts だけで行う。他で /100 しない
//  - 点数・合格数・N/M・色の札を作らない。データで測れない概念（堀・内在価値）を数値にしない
//  - 本人の言葉のような引用を作らない。出典は資料名・年・位置・URL だけ
//
// 画面に出る文字列の規則（scripts/check-rulebook.ts が検査する）:
//  title ≤10字／plain ≤30字／portrait 各 ≤40字／question ≤60字で全角「？」終わり／
//  禁止語（forbidden.ts）・「私」・かぎかっこ「」を使わない／英語原文の抜粋を入れない

import type { FundamentalsData, InvestorId } from '@/types'

/** 出典の照合状態。`照合済み` ＝ researcher が一次資料（公式の手紙・Owner's Manual）で確認した。 */
export type SourceStatus = '照合済み' | '照合待ち' | '確証なし'

export interface SourceRef {
  /** 資料名。株主への手紙は «対象年度» で呼ぶ（例: 2014年の手紙 ＝ 2015年2月付） */
  title: string
  /** 対象年度（手紙）または発行年 */
  year: number
  /** 資料の中の位置（印刷ページ・見出し・検索語）。英語の見出しはそのまま書いてよいが、本文の抜粋は書かない */
  locator?: string
  url?: string
  status: SourceStatus
  /** 照合時の注意（原文の主語が違う・引用として書かれている等） */
  note?: string
}

/**
 * 数値の単位。FundamentalsData に入っている値の単位と一致させる（evaluate.ts の METRIC_UNIT が正）。
 *  - ratio    … 割合（0.15 ＝ 15%）。roe・operatingMargin など
 *  - yahooPct … Yahoo 原値の%表記（78.4 ＝ 0.784 倍）。debtToEquity だけ
 *  - x        … 倍率（PER 15 ＝ 15倍）。pe・pb など
 *  - amount   … 銘柄の通貨単位の実額（freeCashflow・marketCap）。通貨記号は StockQuote.currency から決める
 */
export type MetricUnit = 'ratio' | 'yahooPct' | 'x' | 'amount'

export type RuleOp = 'gte' | 'lte' | 'gt'

export interface RuleCheckSpec {
  metric: keyof FundamentalsData
  op: RuleOp
  /** 目安の値。単位は `unit`（＝その metric が FundamentalsData に入っている単位） */
  value: number
  unit: MetricUnit
}

interface RuleBase {
  /** 'buffett.B3' の形。記録に残るので変えない・消さない */
  id: string
  /** 10字以内 */
  title: string
  /** 平易な意味。30字以内 */
  plain: string
  /** 何を信じているからこのルールか（三人称の言い換え。引用ではない） */
  belief: string
  phase: 'entry' | 'exit' | 'both'
  /** 利用者が自分に問う文。60字以内・全角「？」で終わる */
  question: string
  sources: SourceRef[]
}

/** 財務データで判定できるルール。判定は evaluate.ts の純関数だけが行う */
export interface DataRule extends RuleBase {
  kind: 'data'
  /** 画面に出す指標名（ROE／D/E／FCF）。title の横に添える。無いと「148.8%」が何の値か分からない（2026-09-18） */
  metricLabel: string
  checks: RuleCheckSpec[]
  /**
   * 数直線の軸の範囲（単位は checks と同じ）。画面はこの範囲で「目安との位置」を描き、範囲外の値は点を描かず
   * 「軸の外（値）」と書く。無いルール（FCF のプラス／マイナスなど）は数直線を描かない。
   * 1冊で scale を持てるのは2つまで（数直線は1画面に最大2本: DESIGN.md §6-14・2026-09-18）
   */
  scale?: { min: number; max: number }
  /** all ＝ 全部満たして meets／any ＝ 1つ満たせば meets。値が1つでも欠けたら undecidable */
  combine: 'all' | 'any'
  /** source ＝ 数値が出典にある／approximation ＝ 当サイトの目安（出典に数値は無い） */
  thresholdOrigin: 'source' | 'approximation'
  /**
   * この業種では判定しない（例: 金融業は借入が事業の一部）。
   * sector が一覧にあれば undecidable('excluded-sector')、sector が分からなければ undecidable('unknown-sector')。
   * 綴りは lib/market/us-universe.ts（'Financials'）と data/universe.json（'Finance'）の両方を並べる。
   */
  excludeSectors?: string[]
  /** 考え方と数値のずれ（画面で「目安」として添える前提の文） */
  gapNote: string
}

/** 文章で読むルール。財務データでは判定せず、利用者の理由の文を読んで「触れているか」を見る（S3） */
export interface JudgmentRule extends RuleBase {
  kind: 'judgment'
  /** 理由の文に «あれば触れている» と見る観点。AI 向けの内部データで画面に出さない */
  lookFor: string[]
  /** 理由の文が «これだけ» なら、このルールと張り合う。AI 向けの内部データで画面に出さない */
  tension: string[]
}

export type Rule = DataRule | JudgmentRule

export interface Rulebook {
  investorId: InvestorId
  /** 'buffett@2026-09-17'。中身を変えたら日付を進める（記録と突き合わせるため） */
  version: string
  /** 人物像。各40字以内・三人称 */
  portrait: { weighs: string; ignores: string; horizon: string }
  corePhilosophy: string[]
  rules: Rule[]
  /** この投資家が避けること */
  avoids: { text: string; sources: SourceRef[] }[]
  /** 広く知られているが一次資料で見つからず載せない言葉（記録用。画面に出さない） */
  unverifiedSayings: string[]
}

/**
 * ルール1つの状態。
 *  meets / misses … データルールを財務データで判定した結果
 *  read           … 言葉のルール。理由の文を読んだ（S3）
 *  undecidable    … 判定できない（データが無い・業種の対象外・業種が不明）
 */
export type RuleState = 'meets' | 'misses' | 'read' | 'undecidable'

/** 状態の語の対応表はここ1か所。画面・AI 出力はこの語だけを使う（点数・合否の語を作らない） */
export const RULE_STATE_LABEL: Record<RuleState, string> = {
  meets: '目安を満たす',
  misses: '目安を満たさない',
  read: '文章で読んだ',
  undecidable: '判定できない',
}

export type UndecidableReason = 'no-data' | 'excluded-sector' | 'unknown-sector'

/** 判定できない理由の語。画面はこの文をそのまま出す（ここ1か所） */
export const UNDECIDABLE_REASON_LABEL: Record<UndecidableReason, string> = {
  'no-data': 'データが取れないため',
  'excluded-sector': '金融業は借入が事業の一部のため',
  'unknown-sector': '業種が分からないため',
}

export interface RuleCheck {
  ruleId: string
  state: RuleState
  /**
   * 判定に使った実測値（FundamentalsData に入っていた値をそのまま。単位は check の unit）。
   * 複数 checks のルールでは最初の check の値。同じ metric の上限と下限を並べたルール（B4 の D/E 0〜50）では
   * それで足りる。別の metric を組み合わせるルールが増えたら（S5）、ここを配列に広げる
   */
  observed?: { metric: keyof FundamentalsData; value: number; unit: MetricUnit }
  reason?: UndecidableReason
}

/** 投資家1人分の判定の結果（/api/signals/[symbol] が rulebooks[id] として返す形）。version はルールブックの版 */
export interface RulebookResult {
  version: string
  checks: RuleCheck[]
}
