// S5c-1: ユニバース・ファンダメンタルのキャッシュ行の型。
// S5a: screen API（/api/analyze/screen）の入出力型・ランキング結果型を追加。
import type { FundamentalsData } from '@/types'
import type { FundamentalGateResult } from '@/lib/backtest/fundamental'
import type { FundamentalMetric, InvestorModelId, NeedsPresetId } from '@/lib/backtest/types'

/** universe_fundamentals（Supabase）/ data/universe-fundamentals.json（ローカル）の1行。 */
export interface CachedFundamentalRow {
  symbol: string
  /** lib/market/index.ts の getFundamentals() が返した実値のみ。空({})は保存しない（原則9）。 */
  metrics: FundamentalsData
  /** 取得経路（例: 'seed', 'cron'）。architectのS5計画に合わせて追記されていく。 */
  source: string
  /** ISO文字列。取得時刻。 */
  fetchedAt: string
}

// ── S5a: /api/analyze/screen ─────────────────────────────────────────────
// 銘柄指定なし・quick(ニーズ軸)/investor(投資家モデル)のみ対応。pro(カスタム条件)
// は対象外（rank.tsの第2キー導出が「先頭fundamentalFilterの向き」という単純な
// 規約に依存しており、任意カスタム条件では規約と利用者の意図がズレうるため）。

/** screenが受け付けるモード（proは非対応）。 */
export type ScreenMode = 'quick' | 'investor'

/** POST /api/analyze/screen の入力。 */
export interface ScreenRequest {
  mode: ScreenMode
  presetId: NeedsPresetId | InvestorModelId
  /** 鮮度閾値（日数）。省略時はroute側の既定値を使う。 */
  staleDays?: number
}

/** lib/screen/rank.ts の出力1件（キャッシュ済み実測値のみで構成・架空スコアなし）。 */
export interface RankedCandidate {
  symbol: string
  /** AND条件のうち何件を実測で満たしたか（fail-closed除外後の評価）。 */
  passedCount: number
  totalFilters: number
  /** 全フィルタ成立（＝従来のgate.passedと同義）。 */
  allPassed: boolean
  /** 条件の完全な評価内訳（実測値つき）。 */
  gate: FundamentalGateResult
  /** 第2キーに使った実在指標（先頭フィルタの指標）。フィルタが0件ならundefined。 */
  rankMetric?: FundamentalMetric
  rankValue?: number
  rankDirection?: 'asc' | 'desc'
  /** 実測値を引用した順位理由（人間可読）。 */
  reason: string
  source: string
  fetchedAt: string
}

/** lib/screen/rank.ts が返す評価メタ（正直な内訳・原則9）。 */
export interface ScreenRankMeta {
  /** rank()に渡されたキャッシュ行の総数。 */
  totalCached: number
  /** 鮮度OK・no_data無しで実際にランキング評価された件数。 */
  evaluatedCount: number
  /** 鮮度切れ(閾値超・不正日時含む)で除外された件数。 */
  excludedStaleCount: number
  /** いずれかのフィルタでno_data（fail-closed）のため除外された件数。 */
  excludedNoDataCount: number
}

/** POST /api/analyze/screen の応答。 */
export interface ScreenResponse {
  mode: ScreenMode
  presetId: NeedsPresetId | InvestorModelId
  presetLabel: string
  conditionNotes: string[]
  staleDaysThreshold: number
  /** US_UNIVERSE.length（キャッシュ対象ユニバース全体のサイズ）。 */
  universeSize: number
  /** universeSize - meta.totalCached（キャッシュに一度も無いシンボル数）。 */
  excludedMissingCount: number
  meta: ScreenRankMeta
  /** TOP N（rank.ts の出力を上限で切ったもの）。 */
  candidates: RankedCandidate[]
}
