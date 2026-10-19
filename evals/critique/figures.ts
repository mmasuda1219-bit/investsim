import { LAB_9983, type LabData } from '../../lib/lab/9983'
import { buildCritiqueInput } from '../../lib/lab/critique/prompt'
import { latestPair, segmentShare } from '../../lib/lab/display'
import { formatMillionYen, formatPercent, formatSignedPercent, formatSignedPoint, formatSignedYen, formatTimes, formatYen } from '../../lib/lab/money'
import type { Series } from '../../lib/lab/types'

/**
 * フェーズA（2026-10-18）: 添削の AI に渡す「会社が公表した数字」と、F「与えられていない数字を使っていないか」の機械判定。**純関数。I/O なし。**
 *
 *  - 数字は全部 lib/lab/9983.ts から組む（ここに数字を直書きしない）。事業利益（会社独自の指標）は渡さない（clean のメモが触れる項目を画面2の8項目に揃えるため）
 *  - buildEvalInput: 利用者の原文を**1欄（自由記述）としてそのまま**渡す。門（guard.ts）に渡す原文（original）はメモの節だけ（数字の節から「引用」しても通らない）
 *  - knownNumbers / classifyNumbers: AI の文に出た数値を「データにある／利用者が書いた／データから引き算・割り算で出る／年・小さい整数／不明」に分ける。
 *    「不明」が F の違反。判定 AI には数えさせない（AI に自分の採点をさせない）
 */

export interface EvalFigure { label: string; value: string; period: string }
export interface EvalPeer { label: string; value: string }

const curr = (s: Series) => latestPair(s).curr?.value?.value ?? null
const prev = (s: Series) => latestPair(s).prev?.value?.value ?? null
const yoy = (s: Series) => (s.yoy ? formatSignedPercent(s.yoy.value) : null)

/** 渡す数字（固定の順）。各行は「値（期）」の形で buildCritiqueInput に入る */
export function evalFigures(data: LabData = LAB_9983): { figures: EvalFigure[]; peers: EvalPeer[] } {
  const c = data.company
  const fy = c.latestFyLabel
  const money = (s: Series) => `${formatMillionYen(curr(s) ?? 0)}（前の期 ${formatMillionYen(prev(s) ?? 0)}${yoy(s) ? `・前期比 ${yoy(s)}` : ''}）`
  const pct = (s: Series) => {
    const cv = curr(s)
    const pv = prev(s)
    if (cv == null) return `${fy}は会社が開示していません（${s.points[s.points.length - 2]?.fy.slice(2)}年8月期は ${formatPercent(pv ?? 0)}）`
    return `${formatPercent(cv)}（前の期 ${formatPercent(pv ?? 0)}・${formatSignedPoint(Math.round((cv - (pv ?? 0)) * 10) / 10)}）`
  }
  const seg = (key: string) => data.segments.find(x => x.key === key)!
  const segLine = (key: string) => `${seg(key).label} ${formatSignedPercent(seg(key).yoy.value)}（構成比 約${segmentShare(data, key)}%・会社の概数から計算した目安）`
  const nextNet = data.forecasts.find(f => f.key === 'netProfit')!
  const nextSales = data.forecasts.find(f => f.key === 'sales')!
  const figures: EvalFigure[] = [
    { label: '直近の決算発表日', value: `${c.latestAnnouncement.value}（通期）`, period: fy },
    { label: '次回の決算発表', value: c.nextAnnouncement, period: c.nextFyLabel },
    { label: data.sales.label, value: money(data.sales), period: fy },
    { label: data.operatingProfit.label, value: money(data.operatingProfit), period: fy },
    { label: data.netProfit.label, value: money(data.netProfit), period: fy },
    { label: data.eps.label, value: `${formatYen(curr(data.eps) ?? 0)}（前の期 ${formatYen(prev(data.eps) ?? 0)}・前期比 ${yoy(data.eps)}）`, period: fy },
    { label: `${data.roe.label}（${data.roe.definition}）`, value: pct(data.roe), period: fy },
    { label: `${data.roa.label}（${data.roa.definition}）`, value: pct(data.roa), period: fy },
    { label: `${data.equityRatio.label}（${data.equityRatio.definition}）`, value: pct(data.equityRatio), period: fy },
    { label: data.operatingCf.label, value: money(data.operatingCf), period: fy },
    { label: data.cash.label, value: money(data.cash), period: fy },
    { label: data.dividend.label, value: `${formatYen(curr(data.dividend) ?? 0)}（前の期 ${formatYen(prev(data.dividend) ?? 0)}）`, period: fy },
    { label: '配当予想の修正', value: `年間 ${formatYen(data.dividendRevision.before.value)} → ${formatYen(data.dividendRevision.after.value)}`, period: data.dividendRevision.date.value },
    { label: data.dividendForecast.label, value: formatYen(data.dividendForecast.value.value), period: c.nextFyLabel },
    { label: '配当性向', value: `${formatPercent(data.payoutRatio.curr.value)}（前の期 ${formatPercent(data.payoutRatio.prev.value)}）`, period: fy },
    { label: '配当利回り（会社予想の年間配当で計算）', value: formatPercent(data.price.dividendYield.value), period: data.price.close.source.asOf },
    { label: '株価（終値）', value: `${formatYen(data.price.close.value)}・前日比 ${formatSignedYen(data.price.changeYen.value)}（${formatSignedPercent(data.price.changePct.value)}）`, period: data.price.closeDate },
    { label: '予想PER（2027年8月期の会社予想利益で計算）', value: formatTimes(data.price.forwardPer.value), period: data.price.closeDate },
    { label: '実績PER（終値 ÷ 2026年8月期の基本的EPS）', value: formatTimes(data.price.trailingPer.value), period: data.price.closeDate },
    { label: 'PBR', value: formatTimes(data.price.pbr.value), period: data.price.closeDate },
    { label: 'セグメント別売上収益の前期比', value: ['domestic', 'overseas', 'gu', 'globalBrands'].map(segLine).join('、'), period: fy },
    { label: '来期の会社予想', value: `${nextSales.label} ${formatMillionYen(nextSales.value.value)}（${formatSignedPercent(nextSales.yoy.value)}）、${nextNet.label} ${formatMillionYen(nextNet.value.value)}（${formatSignedPercent(nextNet.yoy.value)}）`, period: c.nextFyLabel },
  ]
  const pa = data.perAverages
  const asOf = pa.retailWeighted.source.asOf
  const peers: EvalPeer[] = [
    { label: `プライム市場・小売業の加重平均PER（JPX・${asOf}）`, value: formatTimes(pa.retailWeighted.value) },
    { label: `プライム市場・小売業の単純平均PER（JPX・${asOf}）`, value: formatTimes(pa.retailSimple.value) },
    { label: `プライム市場全体の加重平均PER（JPX・${asOf}）`, value: formatTimes(pa.marketWeighted.value) },
    { label: `プライム市場全体の単純平均PER（JPX・${asOf}）`, value: formatTimes(pa.marketSimple.value) },
  ]
  return { figures, peers }
}

export const MEMO_FIELD_KEY = 'memo'
export const MEMO_FIELD_LABEL = '判断メモ（自由記述・原文のまま）'
const FIGURES_HEADING = '## 会社が公表した数字'

/** AI に渡す入力の全文と、門に渡す原文（メモの節だけ） */
export function buildEvalInput(memoText: string, data: LabData = LAB_9983): { input: string; original: string } {
  const { figures, peers } = evalFigures(data)
  const input = buildCritiqueInput({ memo: { [MEMO_FIELD_KEY]: memoText }, memoLabels: { [MEMO_FIELD_KEY]: MEMO_FIELD_LABEL }, figures, peers })
  const at = input.indexOf(FIGURES_HEADING)
  if (at < 0) throw new Error('evals/figures: 数字の節の見出しが見つからない')
  return { input, original: input.slice(0, at) }
}

// ── F: 与えられていない数字 ──────────────────────────────────────────────────

export type NumberClass = 'memo' | 'direct' | 'derived' | 'year' | 'small' | 'unknown'

export interface NumberToken { token: string; value: number; cls: NumberClass }

export interface KnownNumbers {
  /** データにある値（そのまま・億円・兆円・丸めの各形） */
  direct: number[]
  /** データから引き算・割り算で出る値（比率の差＝ポイント、前期比、構成比） */
  derived: number[]
}

const r = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d

function collectNumbers(v: unknown, out: number[]): void {
  if (typeof v === 'number') { if (Number.isFinite(v)) out.push(v) }
  else if (Array.isArray(v)) v.forEach(x => collectNumbers(x, out))
  else if (typeof v === 'object' && v !== null) Object.values(v).forEach(x => collectNumbers(x, out))
}

/** 百万円の値の書かれ方（百万円・億円・兆円・兆の端数）を全部並べる */
function moneyForms(million: number): number[] {
  const oku = million / 100
  const out = [million, oku, r(oku, 0), r(oku, 1), r(oku, 2)]
  if (Math.abs(oku) >= 10_000) {
    const cho = Math.floor(Math.abs(oku) / 10_000)
    out.push(cho, r(Math.abs(oku) - cho * 10_000, 0), r(million / 1e6, 1), r(million / 1e6, 2))
  }
  return out
}

/** データにある数値と、そこから出る値 */
export function knownNumbers(data: LabData = LAB_9983): KnownNumbers {
  const raw: number[] = []
  collectNumbers(data, raw)
  const direct = new Set<number>()
  for (const n0 of raw) {
    // 負の値（前日比 −3,020円・−4.04%）は文の中では「3,020」「4.04」の形で出るので絶対値も足す
    for (const n of n0 < 0 ? [n0, -n0] : [n0]) {
      direct.add(n); direct.add(r(n, 0)); direct.add(r(n, 1)); direct.add(r(n, 2))
      if (Math.abs(n) >= 1000) moneyForms(n).forEach(x => direct.add(x))
    }
  }
  const derived = new Set<number>()
  const series: Series[] = [data.sales, data.operatingProfit, data.netProfit, data.eps, data.roe, data.roa, data.equityRatio, data.operatingCf, data.cash, data.dividend, data.bps, data.totalAssets, data.equity]
  for (const s of series) {
    const vals = s.points.map(p => p.value?.value ?? null)
    for (let i = 1; i < vals.length; i++) {
      const a = vals[i - 1]; const b = vals[i]
      if (a == null || b == null) continue
      derived.add(r(b - a, 1)); derived.add(r(b - a, 2))
      if (a !== 0) { derived.add(r((b / a - 1) * 100, 1)); derived.add(r((b / a - 1) * 100, 2)) }
    }
  }
  // 比率どうしの差（ROE − ROA など）。%・倍率の小さい値の全組
  const small = raw.filter(n => Math.abs(n) < 200)
  for (const a of small) for (const b of small) { derived.add(r(Math.abs(a - b), 1)); derived.add(r(Math.abs(a - b), 2)) }
  for (const seg of data.segments) {
    const share = segmentShare(data, seg.key)
    if (share != null) derived.add(share)
    const total = latestPair(data.sales).curr?.value?.value
    if (total) { derived.add(r((seg.curr.value / total) * 100, 1)); derived.add(r((seg.prev.value / (prev(data.sales) ?? 1)) * 100, 0)) }
  }
  return { direct: [...direct], derived: [...derived] }
}

const NUM_RE = /[0-9][0-9,]*(?:\.[0-9]+)?/g

/** 文の中の数値トークン */
export function numberTokens(text: string): { token: string; value: number }[] {
  const out: { token: string; value: number }[] = []
  for (const m of text.matchAll(NUM_RE)) {
    const v = Number.parseFloat(m[0].replace(/,/g, ''))
    if (Number.isFinite(v)) out.push({ token: m[0], value: v })
  }
  return out
}

const same = (a: number, b: number) => Math.abs(a - b) < 0.0051

/**
 * AI の文（title・why・how をつなげたもの）の数値を分類する。
 * memoText の数値は「利用者が書いた数字」として通す（AI が利用者の数字を引いて説明するのは正当）。
 * 利用者の数字とデータの数字の差（21% − 11.6% など）も derived に数える
 */
export function classifyNumbers(text: string, known: KnownNumbers, memoText: string): NumberToken[] {
  const memoNums = numberTokens(memoText).map(t => t.value)
  const derived = [...known.derived]
  const smallKnown = known.direct.filter(n => Math.abs(n) < 200)
  for (const m of memoNums) for (const d of smallKnown) { derived.push(r(Math.abs(m - d), 1)); derived.push(r(Math.abs(m - d), 2)) }
  for (const a of memoNums) for (const b of memoNums) derived.push(r(Math.abs(a - b), 1), r(Math.abs(a - b), 2))
  return numberTokens(text).map(({ token, value }) => {
    let cls: NumberClass
    if (memoNums.some(n => same(n, value))) cls = 'memo'
    else if (known.direct.some(n => same(n, value))) cls = 'direct'
    else if (derived.some(n => same(n, value))) cls = 'derived'
    else if (Number.isInteger(value) && value >= 1990 && value <= 2100) cls = 'year'
    else if (Number.isInteger(value) && value >= 0 && value <= 31) cls = 'small'
    else cls = 'unknown'
    return { token, value, cls }
  })
}
