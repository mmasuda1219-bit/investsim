import type { ReviewRecord, ReviewSell } from '@/lib/review/record'

/**
 * 「書いたことと、したことのまとめ」（/review の一覧・S-H1・2026-10-25）の型。
 *
 * 検出器（catalogue.ts）が受け取るのは、ReviewRecord から**必要な欄だけ**を取り出したこの型だけ。
 * 買値・売値・損益・銘柄名はこの型に入っていないので、検出器は型の上で読めない（不変条件「損益を読まない」）。
 * ReviewRecord はこの型にそのまま代入できる（構造的部分型）。
 *
 * 数は「件数」「日付」だけ。点数・順位・比の欄を持たない（scripts/check-review-habits.ts (2) がこのファイルを
 * 文字列として読み、number の欄の名前が total／hits／count／〜Count／〜At のどれかであることを見る）。
 */

export type HabitSource = 'practice' | 'past'

/** 検出器への入力: 書いた欄・売買の日・帳簿・買いと売りの対応（株数）だけ */
export type HabitRecordInput = Pick<ReviewRecord, 'id' | 'seq' | 'source' | 'entryAt' | 'entryReason' | 'shares'> & {
  sells: readonly Pick<ReviewSell, 'exitAt' | 'exitReason' | 'shares'>[]
}

/** K2 降りる条件の書き方（画面の並びもこの順で固定） */
export const EXIT_RULE_KINDS = ['pricePct', 'priceValue', 'company', 'period', 'combined', 'other', 'none'] as const
export type ExitRuleKind = (typeof EXIT_RULE_KINDS)[number]

/** K4 見立てに使った材料（画面の並びもこの順で固定。1件が複数に当たる） */
export const MATERIAL_KINDS = ['company', 'momentum', 'fame', 'forecast', 'opinion'] as const
export type MaterialKind = (typeof MATERIAL_KINDS)[number]

/** K8 売る理由に出てきたもの */
export const SELL_LINK_KINDS = ['fixedWord', 'sameNumber', 'sameWord'] as const
export type SellLinkKind = (typeof SELL_LINK_KINDS)[number]

/** K9 予定の期間と、実際に売るまでの日数 */
export const HOLD_SIDES = ['before', 'after', 'same'] as const
export type HoldSide = (typeof HOLD_SIDES)[number]

/** 区分ごとの件数 */
export interface HabitCount<K extends string> {
  key: K
  count: number
}

/** 1つの事実（分母 total と、区分ごとの件数） */
export interface HabitFact<K extends string> {
  /** 分母（この事実を数えた記録の件数） */
  total: number
  /** 固定順・0件でも全部 */
  counts: HabitCount<K>[]
}

/** K4: 材料に1つも当たらなかった見立ての件数を添える */
export interface MaterialFact extends HabitFact<MaterialKind> {
  noneCount: number
}

/** K8: 3つのどれかに当たった件数 hits と、【変化】を書いた件数 */
export interface SellLinkFact extends HabitFact<SellLinkKind> {
  hits: number
}

/** K12: くり返し出てくる言い回し1つ */
export interface HabitPhrase {
  /** 最も古い記録の原文から切り出した文字列（書き換えない） */
  text: string
  /** その文字列が出てくる記録（古い順） */
  records: { id: string; seq: number }[]
}

export interface PhraseFact {
  /** 見立てが書かれた記録の件数 */
  total: number
  /** 長い順・最大5つ */
  phrases: HabitPhrase[]
}

/** 練習／過去の記録の、どちらか一方の帳簿のまとめ */
export interface HabitGroup {
  source: HabitSource
  /** この帳簿の売り終えた記録（見出しの有無を問わない） */
  closedCount: number
  /** そのうち見出し付きで書かれた記録（＝数えた件数） */
  total: number
  exitRule: HabitFact<ExitRuleKind>
  material: MaterialFact
  catalyst: HabitFact<'written' | 'blank'>
  sellLink: SellLinkFact
  /** 【変化】を書いた件数（分母は total） */
  change: HabitFact<'written' | 'blank'>
  hold: HabitFact<HoldSide>
  phrase: PhraseFact
}

export interface HabitSummaryData {
  /** 数えた件数（売り終えた・見出し付き。練習と過去の合計） */
  total: number
  /** 売り終えた記録（見出しの有無を問わない） */
  closedCount: number
  /** 保有中（1株でも残っている）の記録 */
  openCount: number
  /** 売り終えたが、見出しの無い（旧形式・理由なし）記録 */
  unstructuredCount: number
  /** 数えた記録の、いちばん古い買いの日（無ければ null） */
  firstAt: number | null
  /** 数えた記録の、いちばん新しい売りの日（無ければ null） */
  lastAt: number | null
  /** 固定順（練習 → 過去の記録）。数えた記録が1件も無い帳簿は入れない */
  groups: HabitGroup[]
}
