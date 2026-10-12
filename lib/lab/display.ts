import { LAB_SIGN_COLOR } from '@/lib/features'
import { formatByUnit, formatMillionYen, formatPercent, formatRatioPercent, formatSignedPercent, formatSignedPoint, formatSignedYen, formatTimes, formatYen, MINUS } from './money'
import { fyLabel, type LabData } from './9983'
import type { FyKey, Series, SeriesPoint, SourceRef, Sourced } from './types'

/**
 * 表示用の純関数（/lab/9983・2026-10-09）。I/O を持たない。
 *
 *  - 折れ線の座標（lineGeometry）: 正負で同じ倍率 k = plotH / (maxPos + maxNeg)。ゼロ線より上がプラス・下がマイナス
 *  - 前期比の1文（yoySentence）: ％バッジにしない。前の期がマイナス・ゼロのときは % を出さない
 *  - 解説文の変数（labVars／labVarEntries）と穴埋め（fill）: 本文に数字を直書きしないための仕組み。未定義の変数は投げる。
 *    labVarEntries は文字と一緒に出典（SourceRef）も返し、画面は値の直後に出典の番号 [N] を置く（lib/lab/rich.ts・citations.ts）
 *  - 符号の見た目（signStyle）: **色を戻す口はここ1か所**。LAB_SIGN_COLOR（既定 false）が true のときだけ class を返す
 *  - 評価の語を作らない。語は「増えた」「減った」「マイナス」だけ
 */

export { MINUS }

/** 系列の値だけを並べる（null は欠損） */
export const seriesValues = (series: Series): (number | null)[] => series.points.map(p => p.value?.value ?? null)

/** 系列の最新の点と、その1つ前の点 */
export function latestPair(series: Series): { curr: SeriesPoint | null; prev: SeriesPoint | null } {
  const pts = series.points
  const n = pts.length
  return { curr: n >= 1 ? pts[n - 1] : null, prev: n >= 2 ? pts[n - 2] : null }
}

/** 前期比（比）。どちらか欠け・前期が 0 以下なら null（百分率の意味が反転するため） */
export function yoyRatio(series: Series): number | null {
  const { curr, prev } = latestPair(series)
  const c = curr?.value?.value
  const p = prev?.value?.value
  if (c == null || p == null || p <= 0) return null
  return c / p - 1
}

/** 割合どうしの差（ポイント）。どちらか欠けなら null。比率の系列（unit === 'percent'）はこれを前期比にする（レビュー W1） */
export function yoyPointDelta(series: Series): number | null {
  const { curr, prev } = latestPair(series)
  const c = curr?.value?.value
  const p = prev?.value?.value
  if (c == null || p == null) return null
  return Math.round((c - p) * 10) / 10
}

/**
 * 前期比の文字。金額・円・倍率は比（+16.6%。会社公表の値 series.yoy があればそれ、無ければ値から計算）、
 * 比率（%）は差（+1.0ポイント）。出せないときは null
 */
export function yoyText(series: Series): string | null {
  if (series.unit === 'percent') {
    const d = yoyPointDelta(series)
    return d == null ? null : formatSignedPoint(d)
  }
  if (series.yoy) return formatSignedPercent(series.yoy.value)
  const r = yoyRatio(series)
  return r == null ? null : formatRatioPercent(r)
}

/** 値から計算した前期比（検査用。会社公表の値との整合を見る） */
export function yoyComputedText(series: Series): string | null {
  const r = yoyRatio(series)
  return r == null ? null : formatRatioPercent(r)
}

/**
 * 前期比の1文（％バッジの代わり）。
 *   最新が欠損 → {fy}は会社が開示していません。
 *   前期が欠損 → 前の期の数字が取れていません。
 *   比率（%）の系列 → 前の期は {prev}。{+X.Xポイント}です。（比ではなく差。レビュー W1）
 *   前期が 0 以下 → 前の期は {prev}。何%かは、前の期がマイナスか 0 なので出しません。
 *   それ以外 → 前の期は {prev}。前期比 {+X.X%} です。
 */
export function yoySentence(series: Series): string {
  const { curr, prev } = latestPair(series)
  if (!curr) return '数字がありません。'
  if (curr.value == null) return `${fyLabel(curr.fy)}は会社が開示していません${curr.missing ? `（${curr.missing}）` : ''}。`
  if (!prev || prev.value == null) return '前の期の数字が取れていません。'
  const p = formatByUnit(prev.value.value, series.unit)
  if (series.unit === 'percent') return `前の期は ${p}。${yoyText(series) ?? '—'}です。`
  if (prev.value.value <= 0) return `前の期は ${p}。何%かは、前の期がマイナスか 0 なので出しません。`
  return `前の期は ${p}。前期比 ${yoyText(series) ?? '—'} です${series.yoy ? '（会社公表の値）' : ''}。`
}

/** マイナスの語（色の代わり）。プラスには語を付けない */
export function signWord(n: number): 'マイナス' | null {
  return n < 0 ? 'マイナス' : null
}

/**
 * 符号の見た目の class。**色を出す口はここ（class）と signColor（SVG）の2か所だけ**（DECISIONS 2026-10-09 (3)・オーナー 2026-10-09 の2度目の要望で既定 true）。
 * LAB_SIGN_COLOR = false なら空文字＝色を付けない。色は足すだけで、位置・形・U+2212・語の手がかりは外さない。
 */
export function signStyle(n: number): string {
  if (!LAB_SIGN_COLOR) return ''
  if (n < 0) return 'text-danger'
  if (n > 0) return 'text-success'
  return ''
}

/** SVG の塗り・線の色（棒・点）。LAB_SIGN_COLOR = true のときだけ var(--success)／var(--danger)。false と 0 は null（呼び手は --ink を使う） */
export function signColor(n: number): string | null {
  if (!LAB_SIGN_COLOR) return null
  if (n < 0) return 'var(--danger)'
  if (n > 0) return 'var(--success)'
  return null
}

/** 前期比の数値（符号の判定用）。比率はポイント差、それ以外は %（会社公表の値か計算値） */
export function yoyValue(series: Series): number | null {
  if (series.unit === 'percent') return yoyPointDelta(series)
  if (series.yoy) return series.yoy.value
  const r = yoyRatio(series)
  return r == null ? null : r * 100
}

/**
 * yoySentence を「前」「符号付きの数字」「後」に分ける（数字だけに色を付けるため）。
 * prefix + (yoy ?? '') + suffix は常に yoySentence と同じ文（検査が見る）
 */
export function yoySentenceParts(series: Series): { prefix: string; yoy: string | null; suffix: string } {
  const full = yoySentence(series)
  const y = yoyText(series)
  const i = y ? full.indexOf(y) : -1
  if (!y || i < 0) return { prefix: full, yoy: null, suffix: '' }
  return { prefix: full.slice(0, i), yoy: y, suffix: full.slice(i + y.length) }
}

// ── 棒の座標 ──────────────────────────────────────────────────────────────────

export interface BarGeometryLab {
  /** 1単位あたりの px。正負で同じ値 */
  k: number
  /** ゼロ線の y（図の上端からの px） */
  zeroY: number
  /** 各期の棒。null は欠損（棒を描かない） */
  bars: ({ y: number; h: number; negative: boolean } | null)[]
}

/**
 * 棒の座標（純関数・components/lab/YearBarsLab.tsx 用）。正負で同じ倍率 k = plotH / (maxPos + maxNeg)。
 * プラスの棒はゼロ線から上へ、マイナスの棒はゼロ線から下へ。全部 0 か全部欠損のときは k = 0・ゼロ線は下端。
 */
export function barGeometryLab(values: (number | null)[], plotH: number): BarGeometryLab {
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

// ── 折れ線の座標 ──────────────────────────────────────────────────────────────

export interface LineGeometry {
  /** 1単位あたりの px。正負で同じ値 */
  k: number
  /** ゼロ線の y（図の上端からの px） */
  zeroY: number
  /** 各点の y。null は欠損（描かない） */
  ys: (number | null)[]
}

/**
 * 折れ線の y 座標（純関数）。正負で同じ倍率 k = plotH / (maxPos + maxNeg)。
 * プラスはゼロ線から上へ（y = zeroY − v·k）、マイナスは下へ（y = zeroY + |v|·k）。
 * 全部 0 か全部欠損のときは k = 0・ゼロ線は下端。
 */
export function lineGeometry(values: (number | null)[], plotH: number): LineGeometry {
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
  const ys = values.map(v => (v == null || !Number.isFinite(v) ? null : zeroY - v * k))
  return { k, zeroY, ys }
}

// ── 解説文の変数と穴埋め ──────────────────────────────────────────────────────

/** セグメントの構成比（%・会社の概数から計算した目安）。整数に丸める */
export function segmentShare(data: LabData, key: string): number | null {
  const seg = data.segments.find(x => x.key === key)
  const total = latestPair(data.sales).curr?.value?.value
  if (!seg || total == null || total <= 0) return null
  return Math.round((seg.curr.value / total) * 100)
}

/** 解説文の変数1つ: 画面に出す文字と、その出典（出典の無い文字＝期の名前・会社名などは null） */
export interface VarEntry {
  text: string
  source: SourceRef | null
}

const latestS = (series: Series): Sourced<number> | null => latestPair(series).curr?.value ?? null
const previousS = (series: Series): Sourced<number> | null => latestPair(series).prev?.value ?? null
const firstS = (series: Series): Sourced<number> | null => series.points[0]?.value ?? null
/** 出典つきの値 → 変数。無ければ「—」（出典なし） */
const sv = <T,>(s: Sourced<T> | null | undefined, f: (x: T) => string, fallback = '—'): VarEntry =>
  s ? { text: f(s.value), source: s.source } : { text: fallback, source: null }
const plain = (text: string): VarEntry => ({ text, source: null })
/** 前期比の変数。会社公表の値（series.yoy）を出すときはその出典、値から計算したとき（比率のポイント差を含む）は出典なし */
const yoyEntry = (series: Series): VarEntry => {
  const t = yoyText(series)
  if (!t) return plain('—')
  return { text: t, source: series.unit !== 'percent' && series.yoy ? series.yoy.source : null }
}

/**
 * 解説文に埋める変数（文字＋出典）。全部データ（lib/lab/9983.ts）から作る。ここに無い名前を本文で使うと fill が投げる。
 * 数字を文に入れる口はここだけなので、本文（explain）に数字を直書きしないことを検査できる（check-lab-9983.ts (c)）。
 * 出典のある変数は、画面で文字の直後に出典の番号 [N] が付く（lib/lab/rich.ts・components/lab/RichText.tsx）。
 */
export function labVarEntries(data: LabData): Record<string, VarEntry> {
  const fy = data.company.latestFy
  const prevFy = data.operatingProfit.points[data.operatingProfit.points.length - 2]?.fy ?? fy
  const firstFy = data.equityRatio.points[0]?.fy ?? fy
  const nextNet = data.forecasts.find(f => f.key === 'netProfit')
  const seg = (key: string) => data.segments.find(x => x.key === key)
  const share = (key: string): VarEntry => { const n = segmentShare(data, key); return plain(n == null ? '—' : `約${n}%`) }
  const segYoy = (key: string): VarEntry => sv(seg(key)?.yoy, formatSignedPercent)
  const str = (x: string) => x
  return {
    company: plain(data.company.name),
    fy: plain(fyLabel(fy)),
    fyPrev: plain(fyLabel(prevFy)),
    fyFirst: plain(fyLabel(firstFy)),
    fyNext: plain(data.company.nextFyLabel),
    announced: sv(data.company.latestAnnouncement, str),
    nextAnnouncement: plain(data.company.nextAnnouncement),
    splitNote: sv(data.company.splitNote, str),
    // 損益
    sales: sv(latestS(data.sales), formatMillionYen),
    salesYoy: yoyEntry(data.sales),
    op: sv(latestS(data.operatingProfit), formatMillionYen),
    opYoy: yoyEntry(data.operatingProfit),
    biz: sv(latestS(data.businessProfit), formatMillionYen),
    bizYoy: yoyEntry(data.businessProfit),
    pretax: sv(latestS(data.pretaxProfit), formatMillionYen),
    pretaxYoy: yoyEntry(data.pretaxProfit),
    net: sv(latestS(data.netProfit), formatMillionYen),
    netYoy: yoyEntry(data.netProfit),
    eps: sv(latestS(data.eps), formatYen),
    epsYoy: yoyEntry(data.eps),
    // 収益性・財政状態
    roe: sv(latestS(data.roe), formatPercent),
    roaPrev: sv(previousS(data.roa), formatPercent),
    eq: sv(latestS(data.equityRatio), formatPercent),
    eqFirst: sv(firstS(data.equityRatio), formatPercent),
    // キャッシュ
    ocf: sv(latestS(data.operatingCf), formatMillionYen),
    cash: sv(latestS(data.cash), formatMillionYen),
    cashPrev: sv(previousS(data.cash), formatMillionYen),
    // 配当
    div: sv(latestS(data.dividend), formatYen),
    divPrev: sv(previousS(data.dividend), formatYen),
    divNext: sv(data.dividendForecast.value, formatYen),
    divBefore: sv(data.dividendRevision.before, formatYen),
    revisionDate: sv(data.dividendRevision.date, str),
    payoutPrev: sv(data.payoutRatio.prev, formatPercent),
    payout: sv(data.payoutRatio.curr, formatPercent),
    yield: sv(data.price.dividendYield, formatPercent),
    // 株価・PER
    price: sv(data.price.close, formatYen),
    priceDate: plain(data.price.closeDate),
    priceAsOf: plain(data.price.close.source.asOf),
    priceSource: plain(data.price.close.source.label),
    priceChg: sv(data.price.changePct, formatSignedPercent),
    priceChgYen: sv(data.price.changeYen, formatSignedYen),
    per: sv(data.price.forwardPer, formatTimes),
    perTrailing: sv(data.price.trailingPer, formatTimes),
    pbr: sv(data.price.pbr, formatTimes),
    perRetail: sv(data.perAverages.retailWeighted, formatTimes),
    perRetailSimple: sv(data.perAverages.retailSimple, formatTimes),
    perMarket: sv(data.perAverages.marketWeighted, formatTimes),
    perMarketSimple: sv(data.perAverages.marketSimple, formatTimes),
    jpxAsOf: plain(data.perAverages.retailWeighted.source.asOf),
    // 来期予想
    nextNetYoy: sv(nextNet?.yoy, formatSignedPercent),
    // セグメント
    segDomesticShare: share('domestic'),
    segOverseasShare: share('overseas'),
    segGuShare: share('gu'),
    segGlobalBrandsShare: share('globalBrands'),
    segDomesticYoy: segYoy('domestic'),
    segOverseasYoy: segYoy('overseas'),
    segGuYoy: segYoy('gu'),
    segGlobalBrandsYoy: segYoy('globalBrands'),
  }
}

/** 解説文に埋める変数（文字だけ）。labVarEntries の text。fill と lib/lab/critique/compose.ts が使う */
export function labVars(data: LabData): Record<string, string> {
  return Object.fromEntries(Object.entries(labVarEntries(data)).map(([k, e]) => [k, e.text]))
}

/** `{name}` を vars で埋める。未定義の名前があれば投げる（画面に `{…}` を残さない） */
export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (_, name: string) => {
    const v = vars[name]
    if (v === undefined) throw new Error(`lab/display: 未定義の変数 {${name}}`)
    return v
  })
}

/** 期のラベル（折れ線の x 軸用に短い形も） */
export const fyShort = (fy: FyKey) => fyLabel(fy, true)
