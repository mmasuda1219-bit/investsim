// 前日比（前日の終値と比べた変化）の基準と計算。I/O・環境変数を持たない純関数だけ。
//
// なぜ1か所にあるか（2026-09-14）: 取得元ごとに比較の基準がばらばらだった。
//  - Yahoo chart の meta.chartPreviousClose は「取得期間が始まる前の最後の終値」。range=5d なら
//    約5営業日前、7日前から取得すれば約1週間前の終値になり、数日分の変化を1日の変化として出していた
//    （AAPL 9/11 引け後: 本当の前日比 +1.75% に対し、range=5d で +1.24%、7日前からの取得で +3.84%）。
//  - 取れない値を 0・価格で埋めて「変化 0%」にしていた。
// ここでは「最新の取引日より前で、最後の有効な終値」を基準にし、決められなければ null を返す。
//
// 使う所: app/api/markets/route.ts（指数）、lib/market/providers/yahoodirect.ts・yahoo2.ts（個別銘柄）。
// 検査: scripts/check-previous-close.ts・scripts/check-markets.ts

/** 日足1本のうち、基準を決めるのに使う所だけ。time は UNIX 秒。終値が無い足（寄り付き前・場中）は null。 */
export interface CloseBar {
  time: number
  close: number | null
}

const DAY_SEC = 24 * 60 * 60

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v)
}

/**
 * 前日の終値（変化の基準）。日足から「最新の取引日より前で、最後の有効な終値」を返す。
 * - 最新の取引日＝取得元の最終取引時刻（marketTime・UNIX 秒）の日。無ければ最後の足の日。
 *   場中なら当日、場が閉まっていれば直近の取引日になるので、どちらでもその取引日の1日の変化になる。
 * - 日付は取引所の時差（gmtoffset・秒。Yahoo の meta.gmtoffset）で数える。無ければ 0（UTC）。
 *   場中の足が同じ日の別の行で返るときも、寄り付き前に当日の空の足（終値 null）が付くときも、
 *   前日の終値を基準にできる。
 * - 時刻・終値が数値でない足、終値が 0 以下の足は飛ばす。決められなければ null（0 や価格で埋めない）。
 * - bars は古い順（Yahoo の chart の並び）を前提にする。
 */
export function previousCloseFromBars(
  bars: ReadonlyArray<CloseBar>,
  marketTime: number | null,
  gmtoffset: number | null,
): number | null {
  const n = bars.length
  if (n === 0) return null
  const offset = isNum(gmtoffset) ? gmtoffset : 0
  const dayOf = (t: number) => Math.floor((t + offset) / DAY_SEC)
  const lastTs: unknown = bars[n - 1]?.time
  const latest = isNum(marketTime) ? marketTime : isNum(lastTs) ? lastTs : null
  if (latest === null) return null
  const latestDay = dayOf(latest)
  for (let i = n - 1; i >= 0; i--) {
    const t: unknown = bars[i]?.time
    const c: unknown = bars[i]?.close
    if (isNum(t) && dayOf(t) < latestDay && isNum(c) && c > 0) return c
  }
  return null
}

/**
 * Yahoo chart API（生の JSON）の timestamp 配列と indicators.quote[0].close 配列を CloseBar に並べ直す。
 * 中身は信用しない: どちらかが配列でなければ []、長さは短いほうに合わせる、数値でない時刻は NaN
 * （previousCloseFromBars が飛ばす）、数値でない終値は null。
 */
export function barsFromChartArrays(timestamps: unknown, closes: unknown): CloseBar[] {
  if (!Array.isArray(timestamps) || !Array.isArray(closes)) return []
  const n = Math.min(timestamps.length, closes.length)
  const bars: CloseBar[] = []
  for (let i = 0; i < n; i++) {
    const t: unknown = timestamps[i]
    const c: unknown = closes[i]
    bars.push({ time: isNum(t) ? t : Number.NaN, close: isNum(c) ? c : null })
  }
  return bars
}

/**
 * Date・UNIX 秒・日付の文字列を UNIX 秒にする（yahoo-finance2 の chart は時刻を Date で返すため）。
 * 決められなければ null。
 */
export function epochSeconds(v: unknown): number | null {
  if (v instanceof Date) {
    const ms = v.getTime()
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
  }
  if (isNum(v)) return v
  if (typeof v === 'string' && v.trim() !== '') {
    const ms = Date.parse(v)
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null
  }
  return null
}

/**
 * 数値・数値の文字列を有限の数にする。null・undefined・空文字・数値でないものは null
 * （Number(null) や Number('') が 0 になるのを「変化 0」と取り違えないため）。
 */
export function toFiniteNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** parseFloat(v.toFixed(decimals)) と同じ丸め（既存コードの丸め方）。-0 は 0 にする。 */
export function roundTo(v: number, decimals: number): number {
  const r = parseFloat(v.toFixed(decimals))
  return r === 0 ? 0 : r
}

/**
 * 価格と前日の終値から、変化（通貨単位・decimals 桁に丸め）と変化率（%・小数2桁）を出す。
 * 価格か前日の終値が無い・前日の終値が 0 以下なら両方 null（変化 0% で埋めない）。
 * 変化率は丸める前の差から計算する（丸めた差から計算すると、価格の小さい銘柄で 0.01pt を超えてずれるため。
 * 例: 24.555 と 24.30 → 丸める前の差なら +1.05%、差を 0.26 に丸めてからだと +1.07%）。
 */
export function changeFromPrevClose(
  price: number | null | undefined,
  prevClose: number | null | undefined,
  decimals = 2,
): { change: number | null; changePercent: number | null } {
  if (!isNum(price) || !isNum(prevClose) || prevClose <= 0) return { change: null, changePercent: null }
  const diff = price - prevClose
  return {
    change: roundTo(diff, decimals),
    changePercent: roundTo((diff / prevClose) * 100, 2),
  }
}
