/**
 * 「1年ごとの決算」（/stocks/[symbol]・2026-10-07）の表示用の純関数。I/O を持たない。
 * 金額の整形・赤字／黒字の語・前年比の1文・棒の座標。検査: scripts/check-annual-statements.ts。
 *
 * 守っていること（designer 2026-10-07 の設計・DESIGN.md §5-2「数字の書き方」）:
 *  - マイナスは U+2212（−）。ハイフンを使わない。ゼロは ±$0
 *  - 前年比は「％バッジ」にしない。前の年がマイナス・ゼロのときは % を出さない（百分率の意味が反転するため）。↑↓ の矢印も使わない
 *  - 棒は正負で同じ倍率（k = plotH / (maxPos + maxNeg)）。ゼロ線より上が黒字・下が赤字
 *  - 優劣の語を作らない。語は「赤字」「黒字」の2つだけ
 */

/** マイナス記号（U+2212） */
export const MINUS = '−'
/** ゼロの表記（§5-2） */
export const ZERO_MONEY = '±$0'

export type ValueKind = 'money' | 'perShare'

/** 絶対値の整形。|n| ≥ 1e9 → $X.XB／≥ 1e6 → $X.XM／それ未満 → $X,XXX（丸めで 1000.0M になる値は B に繰り上げる） */
export function formatAbsMoney(abs: number): string {
  const a = Math.abs(abs)
  if (a >= 999_950_000) return `$${(a / 1e9).toFixed(1)}B`
  if (a >= 999_950) return `$${(a / 1e6).toFixed(1)}M`
  return `$${Math.round(a).toLocaleString('en-US')}`
}

/** 1株あたりの絶対値。小数2桁 */
export function formatAbsPerShare(abs: number): string {
  return `$${Math.abs(abs).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** 符号付きの値。負は U+2212、ゼロは ±$0 */
export function formatValue(n: number, kind: ValueKind): string {
  if (n === 0) return ZERO_MONEY
  const abs = kind === 'money' ? formatAbsMoney(n) : formatAbsPerShare(n)
  return n < 0 ? `${MINUS}${abs}` : abs
}

/** 赤字／黒字の語。ゼロには語を付けない */
export function signWord(n: number): '赤字' | '黒字' | null {
  if (n < 0) return '赤字'
  if (n > 0) return '黒字'
  return null
}

/** 増減率（比）→ +12.3% / −1.8% / ±0.0%（小数1桁） */
export function formatPct(ratio: number): string {
  const pct = ratio * 100
  const rounded = Math.round(pct * 10) / 10
  if (rounded === 0) return '±0.0%'
  const abs = Math.abs(rounded).toFixed(1)
  return rounded < 0 ? `${MINUS}${abs}%` : `+${abs}%`
}

/**
 * 前年比の1文（％バッジの代わり）。
 *   どちらか欠け       → 前の年の数字が取れていません。
 *   両方マイナス       → 前の年は {prev}。1年で {差} 増えました／減りました。何%かは、前の年が赤字なので出しません。
 *   前がマイナス・今がプラス → 前の年は赤字（{prev}）、{year}年度 は黒字（{curr}）です。
 *   前がプラス・今がマイナス → 前の年は黒字（{prev}）、{year}年度 は赤字（{curr}）です。
 *   前が 0             → 前の年が 0 なので、何%かは出しません。
 *   両方プラス         → 前の年は {prev}。前年比 {+X.X%} です。
 * % を返すのは「両方プラス」のときだけ。
 */
export function yoyLine(prev: number | null | undefined, curr: number | null | undefined, kind: ValueKind, year: number): string {
  if (curr == null) return `${year}年度 の数字が取れていません。`
  if (prev == null) return '前の年の数字が取れていません。'
  const p = formatValue(prev, kind)
  const c = formatValue(curr, kind)
  if (prev === 0) return '前の年が 0 なので、何%かは出しません。'
  if (prev < 0 && curr < 0) {
    const diff = curr - prev
    const d = formatValue(Math.abs(diff), kind)
    if (diff === 0) return `前の年と同じ ${p} でした。何%かは、前の年が赤字なので出しません。`
    return `前の年は ${p}。1年で ${d} ${diff > 0 ? '増えました' : '減りました'}。何%かは、前の年が赤字なので出しません。`
  }
  if (prev < 0 && curr > 0) return `前の年は赤字（${p}）、${year}年度 は黒字（${c}）です。`
  if (prev > 0 && curr < 0) return `前の年は黒字（${p}）、${year}年度 は赤字（${c}）です。`
  if (curr === 0) return `前の年は ${p}。${year}年度 は ${c} です。`
  // ここに来るのは prev > 0 && curr > 0 だけ
  return `前の年は ${p}。前年比 ${formatPct(curr / prev - 1)} です。`
}

/** 期末日（YYYY-MM-DD）→ 年度の数字。鍵は必ず期末日（SEC の fy は提出書類の年なので使わない） */
export function fiscalYearOf(end: string): number {
  return Number.parseInt(end.slice(0, 4), 10)
}

/** 年ラベル。`2025年度`／狭いときは `25年度` */
export function yearLabel(end: string, short = false): string {
  const y = fiscalYearOf(end)
  return short ? `${String(y).slice(2)}年度` : `${y}年度`
}

export interface BarGeometry {
  /** 1単位あたりの px。正負で同じ値 */
  k: number
  /** ゼロ線の y（図の上端からの px） */
  zeroY: number
  /** 各年の棒。null は欠損（棒を描かない） */
  bars: ({ y: number; h: number; negative: boolean } | null)[]
}

/**
 * 棒の座標（純関数）。正負で同じ倍率 k = plotH / (maxPos + maxNeg)。
 * 黒字の棒はゼロ線から上へ（y = zeroY − v·k, h = v·k）、赤字の棒はゼロ線から下へ（y = zeroY, h = |v|·k）。
 * 全部 0 か全部欠損のときは k = 0・ゼロ線は下端。
 */
export function barGeometry(values: (number | null)[], plotH: number): BarGeometry {
  let maxPos = 0
  let maxNeg = 0
  for (const v of values) {
    if (v == null || !Number.isFinite(v)) continue
    if (v > 0 && v > maxPos) maxPos = v
    if (v < 0 && -v > maxNeg) maxNeg = -v
  }
  const span = maxPos + maxNeg
  const k = span > 0 ? plotH / span : 0
  const zeroY = span > 0 ? maxPos * k : plotH
  const bars = values.map(v => {
    if (v == null || !Number.isFinite(v)) return null
    if (v >= 0) return { y: zeroY - v * k, h: v * k, negative: false }
    return { y: zeroY, h: -v * k, negative: true }
  })
  return { k, zeroY, bars }
}
