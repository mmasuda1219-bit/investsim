// S5a: quick/investorプリセットをキャッシュ済みユニバース（lib/screen/cache.ts）に
// 適用し、適合度ランキングを作る純関数（I/Oなし・単体テストは
// scripts/check-screen-rank.ts）。
//
// 原則9（架空スコア禁止）: 複数指標を勝手な重みで合成した「スコア」は作らない。
// 第1キーは evaluateFundamentalGate（lib/backtest/fundamental.ts）が返す
// 「AND条件のうち何件を実測で満たしたか」の件数のみ。第2キーは、条件の先頭
// フィルタ（fundamentalFilters[0]）の指標をそのまま使う — その演算子が
// gte/gt（「◯以上が良い」という条件）なら実測値の降順、lte/lt（「◯以下が
// 良い」という条件）なら昇順にする。これは発明した重み付けではなく、条件式
// 自体が既に表している「どちら向きが望ましいか」をそのまま使うだけであり、
// NEEDS_PRESETS・INVESTOR_PRESETS の全プリセットで意図と一致する
// （stable: marketCap gte → 降順 / income: dividendYield gte → 降順 /
//  aggressive: marketCap lte → 昇順 / buffett: roe gte → 降順 /
//  graham: pe lte → 昇順 / lynch: earningsGrowth gte → 降順）。
//
// 欠キャッシュ・鮮度切れ・no_dataは fail-closed で評価対象そのものから除外する
// （ランキングに載せない。架空値で穴埋めしない）。同値は symbol で決定的に
// タイブレークする（辞書式のみ・合成スコアなし）。
import type { CompositeCondition, FundamentalFilter, FundamentalMetric } from '@/lib/backtest/types'
import { evaluateFundamentalGate, METRIC_INFO, formatMetricValue } from '@/lib/backtest/fundamental'
import type { CachedFundamentalRow, RankedCandidate, ScreenRankMeta } from './types'

const MS_PER_DAY = 24 * 60 * 60 * 1000

export interface RankOptions {
  /** この日数を超えて古い fetchedAt は評価対象外（fail-closed）。 */
  staleDays: number
  /** TOP N の上限件数。 */
  limit: number
  /** テスト用に「現在時刻」を注入できるようにする（省略時は実時刻）。 */
  now?: Date
}

export interface RankResult {
  /** limit件に絞ったランキング結果（正直な評価の上澄み）。 */
  candidates: RankedCandidate[]
  /** limit適用前の内訳（正直な件数表示用）。 */
  meta: ScreenRankMeta
}

function directionOf(op: FundamentalFilter['operator']): 'asc' | 'desc' {
  return op === 'gte' || op === 'gt' ? 'desc' : 'asc'
}

function buildReason(
  passedCount: number,
  totalFilters: number,
  primary: FundamentalFilter | undefined,
  rankValue: number | undefined,
  direction: 'asc' | 'desc' | undefined,
): string {
  const gatePart =
    totalFilters > 0 ? `参加条件 ${passedCount}/${totalFilters}件成立` : '参加条件なし（技術トリガーのみ）'
  if (!primary || rankValue == null || !direction) return gatePart
  const label = METRIC_INFO[primary.metric].label
  const valueStr = formatMetricValue(primary.metric, rankValue)
  const dirWord = direction === 'desc' ? '高い順' : '低い順（割安な順）'
  return `${gatePart}・順位根拠: ${label}が${dirWord}（実測 ${valueStr}）`
}

/**
 * キャッシュ行の配列にプリセットの CompositeCondition（の fundamentalFilters のみ。
 * technical/derivedFiltersはscreenでは評価しない — ライブ取得禁止・現在値ゲートのみ）
 * を適用し、適合度ランキングを返す。
 */
export function rankCandidates(
  rows: CachedFundamentalRow[],
  condition: CompositeCondition,
  opts: RankOptions,
): RankResult {
  const filters = condition.fundamentalFilters
  const primary = filters[0]
  const direction: 'asc' | 'desc' | undefined = primary ? directionOf(primary.operator) : undefined

  const now = opts.now ?? new Date()
  const staleThresholdMs = opts.staleDays * MS_PER_DAY

  let excludedStaleCount = 0
  let excludedNoDataCount = 0
  const evaluated: RankedCandidate[] = []

  for (const row of rows) {
    const fetchedAtMs = Date.parse(row.fetchedAt)
    const ageMs = now.getTime() - fetchedAtMs
    // 不正な日時（パース失敗）も安全側で「古い」扱いにする（fail-closed）。
    if (!Number.isFinite(fetchedAtMs) || ageMs > staleThresholdMs) {
      excludedStaleCount++
      continue
    }

    const gate = evaluateFundamentalGate(row.metrics, filters)
    if (gate.evaluations.some((e) => e.result === 'no_data')) {
      // 一部の指標でも実データが無ければ、その銘柄はランキングに載せない
      // （部分的な実測値だけで順位付けすると誤解を招くため・原則9）。
      excludedNoDataCount++
      continue
    }

    const passedCount = gate.evaluations.filter((e) => e.result === 'pass').length
    const totalFilters = filters.length
    const rankMetric: FundamentalMetric | undefined = primary?.metric
    const rankValue: number | undefined = primary ? gate.evaluations[0].actual : undefined

    evaluated.push({
      symbol: row.symbol,
      passedCount,
      totalFilters,
      allPassed: passedCount === totalFilters,
      gate,
      rankMetric,
      rankValue,
      rankDirection: direction,
      reason: buildReason(passedCount, totalFilters, primary, rankValue, direction),
      source: row.source,
      fetchedAt: row.fetchedAt,
    })
  }

  // 辞書式ソート: 第1キー passedCount 降順 → 第2キー rankValue（方向は条件次第）
  // → 第3キー symbol 昇順（決定的タイブレーク）。合成スコア・重み付けはしない。
  evaluated.sort((a, b) => {
    if (b.passedCount !== a.passedCount) return b.passedCount - a.passedCount
    if (direction && a.rankValue != null && b.rankValue != null && a.rankValue !== b.rankValue) {
      return direction === 'desc' ? b.rankValue - a.rankValue : a.rankValue - b.rankValue
    }
    return a.symbol.localeCompare(b.symbol)
  })

  return {
    candidates: evaluated.slice(0, opts.limit),
    meta: {
      totalCached: rows.length,
      evaluatedCount: evaluated.length,
      excludedStaleCount,
      excludedNoDataCount,
    },
  }
}
