import type { Unit } from './types'

/**
 * 円の整形（/lab/9983・2026-10-09）。純関数。lib/statements/display.ts は `$` 固定なので流用せず、円の規則をここに置く。
 *
 *  - 百万円の値 → 「3兆9,634億円」「7,431億円」（億に丸める。1兆以上は兆＋億）
 *  - 1株当たりの円 → 会社の開示どおりの桁（1,768.08円・891.8円・850円）
 *  - 割合 → 小数1〜2桁（62.6%・1.25%）／倍率 → 39.3倍・7.73倍
 *  - 割合どうしの前期比は「ポイント」（差）: +1.0ポイント／−3.7ポイント（レビュー W1・2026-10-09）
 *  - マイナスは U+2212（−）。ハイフンを使わない（DESIGN.md §5-2）
 *  - 色は付けない。符号は文字で運ぶ
 * 単位の型（Unit）は lib/lab/types.ts の1か所だけ（レビュー S5）。
 * 検査: scripts/check-lab-9983.ts (k)
 */

/** マイナス記号（U+2212） */
export const MINUS = '−'

const group = (n: number, min = 0, max = 2) =>
  n.toLocaleString('en-US', { minimumFractionDigits: min, maximumFractionDigits: max })

const signed = (n: number, body: string) => (n < 0 ? `${MINUS}${body}` : body)

/** 百万円 → 億円／兆円（億に丸める）。0 は「0円」 */
export function formatMillionYen(million: number): string {
  const oku = Math.round(Math.abs(million) / 100)
  if (oku === 0) return '0円'
  if (oku >= 10_000) {
    const cho = Math.floor(oku / 10_000)
    const rest = oku - cho * 10_000
    return signed(million, rest > 0 ? `${cho}兆${group(rest)}億円` : `${cho}兆円`)
  }
  return signed(million, `${group(oku)}億円`)
}

/** 円（1株当たり・株価）。小数は会社の開示どおり最大2桁 */
export function formatYen(yen: number): string {
  return signed(yen, `${group(Math.abs(yen))}円`)
}

/** 割合（%）。小数1〜2桁 */
export function formatPercent(pct: number): string {
  return signed(pct, `${group(Math.abs(pct), 1, 2)}%`)
}

/** 倍率。小数1〜2桁 */
export function formatTimes(x: number): string {
  return signed(x, `${group(Math.abs(x), 1, 2)}倍`)
}

/**
 * 符号付きの割合。会社・日経が公表した % の数字をそのまま受け取り、公表どおりの桁で出す（最大2桁・最小1桁）:
 * +16.6% / −4.04% / −2.3% / ±0.0%
 */
export function formatSignedPercent(pct: number, maxDigits = 2): string {
  const rounded = Math.round(pct * 100) / 100
  if (rounded === 0) return '±0.0%'
  const abs = group(Math.abs(rounded), 1, maxDigits)
  return rounded < 0 ? `${MINUS}${abs}%` : `+${abs}%`
}

/** 比（curr / prev − 1）→ 符号付きの割合。値から計算したものは小数1桁に丸める（DESIGN.md §5-2） */
export function formatRatioPercent(ratio: number): string {
  return formatSignedPercent(Math.round(ratio * 1000) / 10, 1)
}

/**
 * 割合どうしの差（ポイント）。比率（ROE・自己資本比率など）の前期比は % の比ではなく差で出す:
 * +1.0ポイント / −3.7ポイント / ±0.0ポイント（小数1桁・U+2212）
 */
export function formatSignedPoint(deltaPct: number): string {
  const rounded = Math.round(deltaPct * 10) / 10
  if (rounded === 0) return '±0.0ポイント'
  const abs = Math.abs(rounded).toFixed(1)
  return rounded < 0 ? `${MINUS}${abs}ポイント` : `+${abs}ポイント`
}

/** 符号付きの円（前日比など） */
export function formatSignedYen(yen: number): string {
  if (yen === 0) return '±0円'
  return yen < 0 ? `${MINUS}${group(Math.abs(yen))}円` : `+${group(yen)}円`
}

/** 単位ごとの整形 */
export function formatByUnit(n: number, unit: Unit): string {
  switch (unit) {
    case 'millionYen': return formatMillionYen(n)
    case 'yen': return formatYen(n)
    case 'percent': return formatPercent(n)
    case 'times': return formatTimes(n)
  }
}
