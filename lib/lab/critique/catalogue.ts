import type { LabData } from '../9983'
import { latestPair, yoyValue, type VarEntry } from '../display'
import type { LabMemo } from '../memo-fields'
import { formatPercent } from '../money'
import type { Series, Sourced } from '../types'

/**
 * §3「計算の確かめと、確認したいこと」の固定カタログ（/study・2026-10-09・S-A）。
 *
 * **計算方法と確認漏れに限る**（DECISIONS 2026-10-09 (9)）。「あなたの投資判断は間違っていた」「買うべきではなかった」は作らない。
 * S-A では `detect`（規則）で選ぶ。S-B の AI もこの id を選ぶだけで、本文は書かない。
 *
 *  - title・body は画面に出る文。禁止語を使わない（scripts/check-lab-9983.ts (a) が読む）
 *  - body の数字は `{var}` で埋める（lib/lab/display.ts の labVars）。直書きしない
 *  - detect に使う語（割安・割高など）は検出のための文字列で、画面には出ない
 */

export type CatalogueKind = 'calc' | 'check'

export interface DetectContext {
  /** メモの本文をすべてつなげた文字列 */
  text: string
  memo: LabMemo
  data: LabData
}

export interface CatalogueEntry {
  id: string
  kind: CatalogueKind
  title: string
  /** 本文（{var} で埋める） */
  body: string
  detect: (ctx: DetectContext) => boolean
  /**
   * 本文の下に並べる行（任意・2026-10-22 fact-mismatch で追加）。メモの該当箇所と、会社の公表値（出典つき）を1行ずつ並べる。
   * 行の文は固定のテンプレート（FACT_TEMPLATES）で、メモの引用は変数 {memoQuote} として入る（テンプレートとしては読まない）
   */
  details?: (ctx: DetectContext) => CatalogueDetail[]
}

export interface CatalogueDetail {
  /** 1行の文（{var} で埋める） */
  template: string
  /** この行だけの変数（メモの引用・前の期の値など）。共通の変数（labVarEntries）に足して使う */
  vars: Record<string, VarEntry>
}

// ── 検出の道具（純関数） ──────────────────────────────────────────────────────

const NUM = /[0-9][0-9,]*(?:\.[0-9]+)?/g

/** 英字の語は前後が英字でないときだけ一致（"approach" の PER・"roe" の ROE を拾わない。レビュー S3） */
export const word = (s: string) => new RegExp(`(?<![A-Za-z])${s}(?![A-Za-z])`, 'i')
const PER = word('PER')
const ROE = word('ROE')
const ROA = word('ROA')

/** 文に分ける（。と改行）。空は落とす */
export function sentences(text: string): string[] {
  return text.split(/[。\n]/).map(s => s.trim()).filter(s => s.length > 0)
}

/**
 * a と b の両方を含む文があり、その文か次の文に c がある（共起だけでは発火させない。レビュー W2）。
 * 「ROEは21.2%でROAは11.6%。差が大きい。」は当たり、「ROE と ROA、自己資本比率…を見た。」は当たらない
 */
export function cooccurWithNext(text: string, a: RegExp, b: RegExp, c: RegExp): boolean {
  const ss = sentences(text)
  return ss.some((s, i) => a.test(s) && b.test(s) && (c.test(s) || (i + 1 < ss.length && c.test(ss[i + 1]))))
}

/** a を含む文の中に b もある */
export function sameSentence(text: string, a: RegExp, b: RegExp): boolean {
  return sentences(text).some(s => a.test(s) && b.test(s))
}

const global = (re: RegExp) => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)

/**
 * a と b の一致が window 文字以内にある（文をまたいでもよい。一方の終わりからもう一方の始まりまでを数える）。
 * 同じメモの離れた場所に両方の語があるだけでは当たらない（フェーズA 2026-10-19・実物のメモでの誤発火の修正）
 */
export function nearby(text: string, a: RegExp, b: RegExp, window = 40): boolean {
  const spans = (re: RegExp) => [...text.matchAll(global(re))].map(m => ({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length }))
  const as = spans(a)
  const bs = spans(b)
  return as.some(x => bs.some(y => (y.start >= x.end ? y.start - x.end : x.start - y.end) <= window))
}

/** word の直後 window 文字の中にある数字（カンマを除いて数値に）。requirePercent なら % が続くものだけ */
export function numbersNear(text: string, word: string | RegExp, window = 14, requirePercent = false): number[] {
  const re = typeof word === 'string' ? new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : new RegExp(word.source, word.flags.includes('g') ? word.flags : `${word.flags}g`)
  const out: number[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const tail = text.slice(m.index + m[0].length, m.index + m[0].length + window)
    const numRe = requirePercent ? /([0-9][0-9,]*(?:\.[0-9]+)?)\s*[%％]/g : NUM
    let n: RegExpExecArray | null
    while ((n = numRe.exec(tail))) {
      const v = Number.parseFloat((n[1] ?? n[0]).replace(/,/g, ''))
      if (Number.isFinite(v)) out.push(v)
    }
  }
  return out
}

/** 0.5% 以内なら同じ数字とみなす */
export function approxEqual(a: number, b: number): boolean {
  if (b === 0) return a === 0
  return Math.abs(a - b) / Math.abs(b) <= 0.005
}

const latest = (data: LabData, key: 'netProfit' | 'operatingProfit' | 'roa') => latestPair(data[key]).curr?.value?.value ?? null

/** 百万円の値を「百万円」「億円」の2通りの書き方で持つ */
const moneyForms = (million: number | null): number[] => (million == null ? [] : [million, million / 100])

// ── 公表値との突き合わせ（fact-mismatch・2026-10-22・review-2026-10-22-W1 ほかで修正） ──
//
// 規則（scratchpad の decision-catalogue-6 に理由）:
//  - 対象は8つ: 売上（売上高・売上収益）・営業利益・純利益・EPS（綴りの ESP も）・ROE・ROA・自己資本比率・PER
//  - 見るのは3通り: 水準（「ROAは11.92%」）・前期比（「売上高は前期比で10%増えていた」）・増減の向き（「ESPが下がっている」）
//  - 水準は指標名の**直後**の数字だけ（「ROE は 2026年8月期で 21.2%」のように間に語が挟まると見ない）。
//    公表された**どの期**の値とも一致なら可（前の期の数字を書いただけで出さない）。EPS（円）は 0.5% 以内
//  - 許す幅は書かれた桁に合わせる（review-2026-10-22-W1）: 整数で書かれていれば |差| < 1（四捨五入・切り捨てのどちらでも可）、小数なら ±0.3
//  - 前期比は「前期比」等の語か符号（+／−）か増減の動詞が付いた % だけ。比べるのは**最新の期**の前期比（会社公表と計算値）だけ
//    （整数の幅 1 で全期と比べると「10%」が 2025年8月期の +9.6% に一致してしまうため）
//  - 増減の向きは、数字の無い句で、完了形・進行形（下がった／下がって／増えた…）だけを読み、最新の期の向きと逆のときだけ。
//    否定・仮定・見通し（ない／か／れば／そう）と、リスク・可能性・懸念・とは言え などの文は見ない
//  - 見ない: 「約」「くらい」付きの概数／来期・予想・計画の文（会社予想と比べてしまう。予想PER は除く）／
//    指標名の前にセグメント名・平均・業種・市場などがある（「海外ユニクロの売上」「小売業の平均PER」）／
//    金額の水準（兆・億の書き方が多く、取り違えは op-net-mix が見る）

type FactKey = 'sales' | 'op' | 'net' | 'eps' | 'roe' | 'roa' | 'eq' | 'per'

/** 1行のテンプレート（数字は全部変数。メモの引用は {memoQuote}）。画面にはこの順で「メモ／公表値」が並ぶ */
const FACT_HEAD = 'メモ「{memoQuote}」／会社の公表値: '
export const FACT_TEMPLATES: Readonly<Record<FactKey, string>> = {
  sales: `${FACT_HEAD}{fy}の売上収益 {sales}・前期比 {salesYoy}。`,
  op: `${FACT_HEAD}{fy}の営業利益 {op}・前期比 {opYoy}。`,
  net: `${FACT_HEAD}{fy}の純利益 {net}・前期比 {netYoy}。`,
  eps: `${FACT_HEAD}{fy}の EPS {eps}・前期比 {epsYoy}。`,
  roe: `${FACT_HEAD}{fy}の ROE {roe}（{fyPrev}は {roePrev}）。`,
  roa: `${FACT_HEAD}ROA は{fy}の値を会社が開示していません。{fyPrev}は {roaPrev}。`,
  eq: `${FACT_HEAD}{fy}の自己資本比率 {eq}（{fyPrev}は {eqPrev}）。`,
  per: `${FACT_HEAD}予想PER {per}・実績PER {perTrailing}（{priceAsOf}の終値で計算）。`,
}
/** 綴りが ESP のときに足す1文 */
export const FACT_ALIAS_NOTE = '「ESP」は EPS として読んでいます。'

interface FactSpec {
  key: FactKey
  re: RegExp
  /** 水準: 単位と、比べる公表値（どの期でも一致なら可） */
  level?: { unit: '%' | '倍' | '円'; values: (d: LabData) => number[] }
  /** 前期比（%）を比べる系列 */
  yoy?: (d: LabData) => Series
  /** 増減の向きを比べる系列（最新の期の前期比の符号） */
  dir?: (d: LabData) => Series
}

const seriesNums = (s: Series): number[] => s.points.map(p => p.value?.value).filter((v): v is number => v != null)

/** 各期の前期比（%・値から計算）と会社公表の前期比 */
function yoyCandidates(s: Series): number[] {
  const out: number[] = []
  for (let i = 1; i < s.points.length; i++) {
    const c = s.points[i].value?.value
    const p = s.points[i - 1].value?.value
    if (c != null && p != null && p > 0) out.push((c / p - 1) * 100)
  }
  if (s.yoy) out.push(s.yoy.value)
  return out
}

/** 最新の期の前期比（値から計算したものと会社公表のもの）。review W1 で全期 → 最新の期に */
function latestYoyCandidates(s: Series): number[] {
  const all = yoyCandidates(s)
  const n = s.points.length
  const c = s.points[n - 1]?.value?.value
  const p = s.points[n - 2]?.value?.value
  const computed = c != null && p != null && p > 0 ? [(c / p - 1) * 100] : []
  return s.yoy ? [...computed, s.yoy.value] : computed.length ? computed : all.slice(-1)
}

const FACT_SPECS: readonly FactSpec[] = [
  { key: 'sales', re: /売上(?:高|収益)?(?!総|原価|高?営業|.?利益率)/g, yoy: d => d.sales, dir: d => d.sales },
  { key: 'op', re: /営業利益(?!率)/g, yoy: d => d.operatingProfit, dir: d => d.operatingProfit },
  { key: 'net', re: /(?:当期)?純利益(?!率)|当期利益(?!率)/g, yoy: d => d.netProfit, dir: d => d.netProfit },
  {
    key: 'eps', re: /(?<![A-Za-z])(?:EPS|ESP)(?![A-Za-z])|[1一]株(?:当たり|あたり)利益/gi,
    level: { unit: '円', values: d => seriesNums(d.eps) }, yoy: d => d.eps, dir: d => d.eps,
  },
  { key: 'roe', re: /(?<![A-Za-z])ROE(?![A-Za-z])|自己資本利益率/gi, level: { unit: '%', values: d => seriesNums(d.roe) }, dir: d => d.roe },
  { key: 'roa', re: /(?<![A-Za-z])ROA(?![A-Za-z])|総資産利益率/gi, level: { unit: '%', values: d => seriesNums(d.roa) }, dir: d => d.roa },
  { key: 'eq', re: /自己資本比率|持分比率/g, level: { unit: '%', values: d => seriesNums(d.equityRatio) }, dir: d => d.equityRatio },
  {
    key: 'per', re: /(?<![A-Za-z])PER(?![A-Za-z])|株価収益率/gi,
    level: { unit: '倍', values: d => [d.price.forwardPer.value, d.price.trailingPer.value] },
  },
]

const N = '[0-9][0-9,]*(?:\\.[0-9]+)?'
const APPROX_PRE = '(約|およそ|ほぼ|大体|だいたい)?'
const APPROX_POST = '(くらい|ぐらい|程度|ほど|前後|台|強|弱|超|近く|以上|以下|未満|を?超え|を?上回|を?下回)?'
const toNum = (s: string) => Number.parseFloat(s.replace(/,/g, ''))
/** 指標名の直後の水準（「ROAは11.92%」「EPS は 1,768.08円」） */
const LEVEL_RE = new RegExp(`^\\s*(?:は|が|も|：|:|=|＝)?\\s*${APPROX_PRE}\\s*(${N})\\s*([%％]|倍|円)${APPROX_POST}`)
/** 前期比の %（3つの書き方）。符号: + − か、後ろの動詞 */
const PRE_G = '(?<pre>約|およそ|ほぼ|大体|だいたい)?'
const POST_G = '(?<post>くらい|ぐらい|程度|ほど|前後|台|強|弱|超|近く|以上|以下|未満|を?超え|を?上回|を?下回)?'
const YOY_RES: readonly RegExp[] = [
  new RegExp(`(?:前期比|前年比|前年同期比|前期より|前年より|前の期より|前期から|前年から)\\s*(?:で|は|が|の)?\\s*${PRE_G}\\s*(?<sign>[+＋\\-−]?)\\s*(?<num>${N})\\s*[%％]${POST_G}\\s*(?:も|の|ほど)?\\s*(?<verb>増|減|伸|アップ|ダウン|上|下|プラス|マイナス)?`),
  new RegExp(`(?<sign>[+＋\\-−])\\s*(?<num>${N})\\s*[%％]`),
  new RegExp(`${PRE_G}(?<num>${N})\\s*[%％]${POST_G}\\s*(?:も|の|ほど)?\\s*(?<verb>増|減|伸び|アップ|ダウン|上が|下が|プラス|マイナス)`),
]
/** 完了形・進行形だけ（「下がるリスク」の「下がる」は読まない。review W3） */
const UP = /^(上がった|上がって|増えた|増えて|伸びた|伸びて|上昇した|上昇して|増加した|増加して)/
const DOWN = /^(下がった|下がって|減った|減って|下落した|下落して|減少した|減少して|低下した|低下して|落ちた|落ちて)/
const DIR_RE = /(上がった|上がって|増えた|増えて|伸びた|伸びて|上昇した|上昇して|増加した|増加して|下がった|下がって|減った|減って|下落した|下落して|減少した|減少して|低下した|低下して|落ちた|落ちて)/
/** 文のどこかにあれば向きとして読まない（仮定・懸念の文。review W3） */
const DIR_HEDGE_SENTENCE = /リスク|可能性|心配|懸念|かも|恐れ|場合|とき|とは言え/
/** 否定・仮定・見通し（向きとして読まない） */
const DIR_HEDGE = /^[^。、]{0,6}?(ない|なかっ|かどうか|か(?![らっ])|なら|たら|れば|ても|そう|ず)/
/** 文の頭から指標名までにあれば、その指標の数字ではない（セグメント・地域・平均・他社。review W4） */
const NOT_OWN_BEFORE = /海外|国内|中国|大陸|韓国|北米|欧州|アジア|ユニクロ|ジーユー|GU|ブランド|セグメント|部門|事業|地域|店舗|既存店|EC|Eコマース|他社|同業|平均|業種|業界|小売|市場/
/** 文の中で指標名より前にあれば、会社予想・過去の話（前期比を今期と比べない） */
const FORECAST_BEFORE = /来期|予想|見通し|計画|ガイダンス/
const PAST_IN_SENTENCE = /前期は|前の期は|過去|以前|昔|年前/

export interface FactMismatch {
  key: FactKey
  /** メモの該当箇所（原文の部分文字列・40字まで） */
  quote: string
  how: 'level' | 'yoy' | 'direction'
  /** 綴りが ESP だった */
  alias: boolean
}

/** メモの数字・増減の向きのうち、公表値と離れているもの（純関数） */
export function factMismatches(text: string, data: LabData): FactMismatch[] {
  const hits: { spec: FactSpec; start: number; end: number; word: string }[] = []
  for (const spec of FACT_SPECS) {
    for (const m of text.matchAll(global(spec.re))) hits.push({ spec, start: m.index ?? 0, end: (m.index ?? 0) + m[0].length, word: m[0] })
  }
  hits.sort((a, b) => a.start - b.start)
  const out: FactMismatch[] = []
  hits.forEach((h, i) => {
    // 句: 指標名の後ろから、句読点・改行か次の指標名まで
    const nextStart = hits.slice(i + 1).find(x => x.start >= h.end)?.start ?? text.length
    const punct = text.slice(h.end).search(/[、。\n,，;；]/)
    const clauseEnd = Math.min(nextStart, punct < 0 ? text.length : h.end + punct)
    const clause = text.slice(h.end, clauseEnd)
    const sentenceStart = Math.max(text.lastIndexOf('。', h.start - 1), text.lastIndexOf('\n', h.start - 1)) + 1
    const before = text.slice(sentenceStart, h.start)
    const sentenceEndRel = text.slice(h.start).search(/[。\n]/)
    const sentence = text.slice(sentenceStart, sentenceEndRel < 0 ? text.length : h.start + sentenceEndRel)
    if (NOT_OWN_BEFORE.test(before)) return
    if (h.spec.key !== 'per' && FORECAST_BEFORE.test(before)) return
    // 引用は「指標名から数字（または向きの語）まで」。句の残り（利用者の評価の語）は §3 に写さない（review S3）
    const push = (how: FactMismatch['how'], endInClause: number) => {
      const quote = text.slice(h.start, Math.min(h.end + endInClause, h.start + 40)).trim()
      if (out.some(o => o.key === h.spec.key && o.quote === quote)) return
      out.push({ key: h.spec.key, quote, how, alias: /^ESP$/i.test(h.word) })
    }
    /** 書かれた桁に合わせた一致（整数なら |差| < 1、小数なら ±0.3。review W1） */
    const near = (written: string, v: number, p: number) => (written.includes('.') ? Math.abs(v - p) <= 0.3 + 1e-9 : Math.abs(v - p) < 1)
    // 水準
    if (h.spec.level) {
      const m = LEVEL_RE.exec(clause)
      if (m && (m[1] || m[4])) return
      if (m) {
        const unit = m[3] === '％' ? '%' : m[3]
        const v = toNum(m[2])
        if (unit === h.spec.level.unit) {
          const pubs = h.spec.level.values(data)
          const ok = unit === '円' ? pubs.some(p => approxEqual(v, p)) : pubs.some(p => near(m[2], v, p))
          if (!ok && pubs.length > 0) { push('level', m[0].length); return }
          if (ok) return
        }
      }
    }
    // 前期比
    if (h.spec.yoy) {
      for (const re of YOY_RES) {
        const m = re.exec(clause)
        if (!m) continue
        const g = m.groups ?? {}
        const sign = g.sign ?? ''
        const verb = g.verb ?? ''
        const num = g.num ?? ''
        if (g.pre || g.post || !num) return
        const negative = /[-−]/.test(sign) || /^(減|ダウン|下|マイナス)/.test(verb)
        const v = (negative ? -1 : 1) * toNum(num)
        if (!latestYoyCandidates(h.spec.yoy(data)).some(p => near(num, v, p))) push('yoy', (m.index ?? 0) + m[0].length)
        return
      }
    }
    // 増減の向き（数字の無い句だけ）
    if (h.spec.dir && !/[0-9０-９]/.test(clause) && !PAST_IN_SENTENCE.test(sentence) && !FORECAST_BEFORE.test(sentence) && !DIR_HEDGE_SENTENCE.test(sentence)) {
      const m = DIR_RE.exec(clause)
      if (!m || (m.index ?? 0) > 10) return
      if (DIR_HEDGE.test(clause.slice((m.index ?? 0) + m[0].length))) return
      const pub = yoyValue(h.spec.dir(data))
      if (pub == null || pub === 0) return
      const word = clause.slice(m.index ?? 0)
      // 引用は向きの語に続く「いる／いた」まで（「ESPが下がっている」）
      const tail = /^(い(?:る|た|ます|ました))?/.exec(clause.slice((m.index ?? 0) + m[0].length))?.[0] ?? ''
      if ((UP.test(word) && pub < 0) || (DOWN.test(word) && pub > 0)) push('direction', (m.index ?? 0) + m[0].length + tail.length)
    }
  })
  return out
}

const prevEntry = (s: Series): VarEntry => {
  const p: Sourced<number> | null = latestPair(s).prev?.value ?? null
  return p ? { text: formatPercent(p.value), source: p.source } : { text: '—', source: null }
}

function factDetails({ text, data }: DetectContext): CatalogueDetail[] {
  return factMismatches(text, data).map(f => ({
    template: f.alias ? `${FACT_TEMPLATES[f.key]}${FACT_ALIAS_NOTE}` : FACT_TEMPLATES[f.key],
    vars: { memoQuote: { text: f.quote, source: null }, roePrev: prevEntry(data.roe), eqPrev: prevEntry(data.equityRatio) },
  }))
}

// ── 考え方の型（momentum・fame・forecast・cf・segment・2026-10-22） ─────────────

/** 値動きそのものを理由にしている: 株価などの主語 → 上がって／下がって → ので／から／ため（同じ句の中）。見通し（そう）・否定・仮定は除く */
const MOMENTUM = /(株価|値動き|チャート|値段|相場)[^。、]{0,12}?(上が|下が|伸び|上昇|下落|値上がり|値下がり|上げ|下げ)([^。、]{0,8}?)(ので|(?<!て)から|ため)/
export function momentumAsReason(text: string): boolean {
  return sentences(text).some(s => {
    const m = MOMENTUM.exec(s)
    if (!m) return false
    if (/そう|ない|なかっ|か$|れば|たら|ても/.test(m[3])) return false
    // 「株価が下がったので PER が下がった」は計算のつながりで、判断の理由ではない
    // 含み益・利回りなど、値動きから出る計算の結果が続くときは判断の理由ではない（review W5）
    return !/PER|PBR|利回り|含み益|含み損|評価額|時価総額/i.test(s.slice((m.index ?? 0) + m[0].length))
  })
}

/** 知名度を安全性の代わりにしている: 知名度・規模の語 → ので／から → 同じ文に「潰れない／安心」など */
const FAME = /(有名|知名度|大手|大企業|大きい会社|大きな会社|規模が大きい|誰もが知|誰でも知|みんな知|名の知れた|ブランド力)[^。]{0,10}?(ので|から|だし)/
const SAFE = /潰れ|つぶれ|倒産|安心|安全|大丈夫|心配ない|問題ない/
export function fameAsSafety(text: string): boolean {
  return sentences(text).some(s => {
    if (!FAME.test(s)) return false
    const rest = s.slice(s.search(FAME))
    const m = SAFE.exec(rest)
    // 「…とは言えない」「…と思い込まない」は、知名度と安全性を分けている文（review W5）
    return !!m && !/とは言え|思い込|わけではない|ではない/.test(rest.slice((m.index ?? 0) + m[0].length))
  })
}

/**
 * 結論の理由が将来の株価の見通し: 結論の部分で「上がりそう／上がり続けそう／下がりそう／伸びそう」＋から／ので／ため。
 * 結論の部分 = 欄で書いたときは結論の欄、自由記述は「結論」の語より後（無ければ買う／買わない／保留の文とその次の文）。
 * 主語が利益・売上・業績など会社の数字で、株価の語が無ければ見ない（会社予想の話）
 */
const FORECAST = /(上がり|下がり|伸び|上昇し|下落し|値上がりし|値下がりし|戻り)(続け)?そう(?:だ|な|です)?(から|ので|ため)(?!と|、?ではなく|ではない)/
export function forecastAsReason(memo: LabMemo, text: string): boolean {
  let region: string[]
  if (memo.mode === 'fields') region = sentences(memo.parts.conclusion ?? '')
  else {
    const i = text.indexOf('結論')
    if (i >= 0) region = sentences(text.slice(i))
    else {
      const ss = sentences(text)
      // 「買うかどうかは…」は結論ではない
      const DECIDE = /(買う|買わない|買い|見送|保留)(?!かどうか|か)/
      region = ss.filter((s, k) => DECIDE.test(s) || (k > 0 && DECIDE.test(ss[k - 1])))
    }
  }
  return region.some(s => FORECAST.test(s) && (/株価|株|値段|チャート/.test(s) || !/利益|売上|EPS|配当|業績|来期/i.test(s)))
}

/** キャッシュフローを利益と並べていない: CF・手元資金の語＋判断の語の文があり、メモのどの文にも CF と利益が一緒に出てこない */
const CF = new RegExp(`営業CF|キャッシュフロー|キャッシュ・フロー|${word('CF').source}|手元資金|現預金|現金同等物|現金(?!配当|還元)`, 'i')
const CF_JUDGE = /増え|増加|多い|潤沢|豊富|十分|確保|安心|強い|余裕|厚い/
export function cfProfitUnchecked(text: string): boolean {
  const ss = sentences(text)
  return ss.some(s => CF.test(s) && CF_JUDGE.test(s)) && !ss.some(s => CF.test(s) && /利益/.test(s))
}

/** 内訳を印象で書いている: 内訳の語＋印象の語の文に、% ・ポイント・割の数字が無い。景気・為替など外の話の文は見ない */
const SEGMENT = new RegExp(`セグメント|内訳|海外|国内|ジーユー|${word('GU').source}|グローバルブランド|地域別|事業別`)
const IMPRESSION = /人気|好調|不調|強い|弱い|高そう|多そう|大きい|小さい|多い|少ない|伸びてい|伸びた|売れて|勢い|調子|良さそう|よさそう/
export function segmentImpression(text: string): boolean {
  return sentences(text).some(s => SEGMENT.test(s) && IMPRESSION.test(s) && !/[0-9０-９]\s*([%％]|ポイント|割)/.test(s) && !/景気|経済|金利|為替|物価|投資家|同業|他社|勢|旅行/.test(s))
}

/**
 * 営業利益だけで業績を判断している: 「営業利益」と業績の判断（業績は問題ない／良い／順調 など）が同じ文にあり、
 * メモのどこにも純利益・当期利益・EPS・1株 が無い（2026-10-22・測定2）
 */
const BIZ_JUDGE = /業績[^。]{0,6}?(問題ない|問題なし|良い|よい|いい|大丈夫|堅調|心配ない)(?!とは言え|とは限ら|か)|順調(?!かどうか|か|とは言え|ではない)/
export function opOnlyJudgement(text: string): boolean {
  if (/純利益|当期利益|(?<![A-Za-z])(?:EPS|ESP)(?![A-Za-z])|[1一１]株/i.test(text)) return false
  return sentences(text).some(s => /営業利益/.test(s) && BIZ_JUDGE.test(s))
}

// ── カタログ ───────────────────────────────────────────────────────────────────

export const CATALOGUE: readonly CatalogueEntry[] = [
  {
    id: 'conclusion-empty',
    kind: 'check',
    title: '結論が空',
    body: '結論（買う／買わない／保留）が選ばれていません。結論が無いと、あとで読み返したときに「何を決めたか」が分かりません。決めないときも「保留」と残しておきます。',
    detect: ({ memo, text }) => memo.decision === null && !/買う|買わない|買い|見送|保留/.test(text),
  },
  {
    id: 'conclusion-reason-empty',
    kind: 'check',
    title: '結論の理由が空',
    body: '結論は選ばれていますが、理由の欄が空です。見た事実と、そこからの解釈を1行でも書いておくと、読み返す材料になります。',
    detect: ({ memo }) => memo.mode === 'fields' && memo.decision !== null && (memo.parts.conclusion ?? '').trim().length === 0,
  },
  {
    // 2026-10-22（測定1の結果を受けて）。どちらが正しいとは書かず、メモの箇所と公表値（出典つき）を並べるだけ
    id: 'fact-mismatch',
    kind: 'calc',
    title: '書かれた数字が、会社の公表値と違う',
    body: 'メモに書かれた数字や増減の向きのうち、会社が公表した数字と離れているものを、下に並べます。他のサイトや記事の数字は、期や計算方法（分母を期末にするか期中平均にするか など）が会社の開示と違うことがあります。どの期の、どの定義の数字かを、出典の資料で確かめます。',
    detect: ({ text, data }) => factMismatches(text, data).length > 0,
    details: factDetails,
  },
  {
    id: 'roe-roa-mix',
    kind: 'check',
    title: 'ROE と ROA を同じ期で比べているか',
    body: 'ROE は純利益 ÷ 期中平均の親会社所有者帰属持分、ROA は純利益 ÷ 期中平均の資産合計です。分母が違うので、同じ純利益でも数字は違います。{fy}の ROE は {roe}。ROA は{fy}の値を会社が開示していないので、{fyPrev}の {roaPrev} までしかありません。2つを同じ期で比べているか、確かめます。',
    // 共起だけでは発火させない。両方を含む文（か次の文）に比較・差の語があるときだけ（レビュー W2）
    detect: ({ text }) => cooccurWithNext(text, ROE, ROA, /差|引|比べ|より|離れ|開き|倍|ポイント|pt/i),
  },
  {
    id: 'roa-unpublished',
    kind: 'check',
    title: 'ROA の数字の出どころ',
    body: '{fy}の ROA は会社が開示していません。会社の開示値は{fyPrev}の {roaPrev} までです。他のサイトの ROA は、計算方法（分母を期末にするか期中平均にするか、利益をどれにするか）が会社と違うことがあります。どの定義の数字かを確かめます。',
    detect: ({ text, data }) => {
      const disclosed = data.roa.points.map(p => p.value?.value).filter((v): v is number => v != null)
      return numbersNear(text, ROA, 14, true).some(n => n > 0 && n < 100 && !disclosed.some(d => approxEqual(n, d)))
    },
  },
  {
    id: 'per-only',
    kind: 'check',
    title: 'PER だけで株価の水準を決めている',
    body: 'PER は株価 ÷ EPS です。同じ PER でも、利益の伸び率が違えば意味が変わります。予想PER {per} は{fyNext}の会社予想の利益で計算した値で、会社の来期予想は純利益 {nextNetYoy} です。PER を使うときは、利益の伸び率と、加重か単純かを明記した平均と合わせて見ます。',
    detect: ({ text }) =>
      PER.test(text)
      && /割安|割高|高すぎ|安すぎ|高い|安い|買われすぎ|売られすぎ/.test(text)
      && !/成長|伸び|増益|減益|来期|利益が増|利益が減/.test(text),
  },
  {
    id: 'per-average-kind',
    kind: 'check',
    title: '平均PER が加重か単純か',
    body: '業種の平均PER には加重平均と単純平均があり、数字が違います。JPX の{jpxAsOf}の値は、プライム市場の小売業で加重 {perRetail}・単純 {perRetailSimple}、市場全体で加重 {perMarket}・単純 {perMarketSimple}。どちらと比べたかを書いておきます。',
    // 近さを要求する（2026-10-19）: 「PERの意味が分からなかった」と「業種別の値上がりランキング」が同じメモの離れた場所にあるだけで当たっていた。
    //  - 比較先の語（平均・業種・業界・小売・市場全体）は PER と**同じ文**にあるとき
    //  - 文をまたぐときは「平均」の語だけ、PER から 40 字以内にあるとき（「PERは39.3倍。小売業の平均より高い。」）
    detect: ({ text }) => (sameSentence(text, PER, /平均|業種|業界|小売|市場全体/) || nearby(text, PER, /平均/, 40)) && !/加重|単純/.test(text),
  },
  {
    id: 'op-net-mix',
    kind: 'calc',
    title: '営業利益と純利益の取り違え',
    body: '書かれた数字が、別の利益の数字と一致しています。{fy}の営業利益は {op}、純利益は {net} です。営業利益は本業の利益、純利益は金利・税金などを引いたあとに株主に残る利益で、別の数字です。',
    detect: ({ text, data }) => {
      const net = moneyForms(latest(data, 'netProfit'))
      const op = moneyForms(latest(data, 'operatingProfit'))
      const nearOp = numbersNear(text, '営業利益')
      const nearNet = numbersNear(text, '純利益')
      return nearOp.some(n => net.some(t => approxEqual(n, t))) || nearNet.some(n => op.some(t => approxEqual(n, t)))
    },
  },
  {
    // 2026-10-22（測定2の結果から）。op-net-mix（数字の取り違え）とは別: 営業利益だけで業績を判断し、純利益・EPS がメモのどこにも無い
    id: 'op-only-judgement',
    kind: 'check',
    title: '営業利益だけで業績を見て、純利益・EPS に触れていない',
    body: '営業利益をもとに業績について書かれていますが、純利益と EPS には触れていません。{fy}の前期比は、営業利益 {opYoy}、純利益 {netYoy}、EPS {epsYoy} で、伸び率が違います。本業の利益（営業利益）・株主に残る利益（純利益）・1株当たりの利益（EPS）の3つを並べて見ておきます。',
    detect: ({ text }) => opOnlyJudgement(text),
  },
  {
    id: 'business-vs-operating',
    kind: 'calc',
    title: '事業利益と営業利益は別の数字',
    body: 'この会社の「事業利益」は会社独自の指標で、IFRS の「営業利益」とは別です。{fy}は事業利益 {biz}（前期比 {bizYoy}）、営業利益 {op}（前期比 {opYoy}）。どちらの数字を使ったかを書いておきます。',
    // 「事業利益」1語では発火しない。「営業利益」と両方が出るときだけ（レビュー W2）
    detect: ({ text }) => /事業利益/.test(text) && /営業利益/.test(text),
  },
  {
    id: 'equity-average',
    kind: 'check',
    title: '自己資本比率の平均値',
    body: '小売業の平均の自己資本比率は、この画面では裏付けの取れる出典が見つからず、出していません。平均と比べる場合は、その数字の出どころ（どの統計・いつ時点・どの範囲の会社か）を確かめます。自社の推移は {fyFirst}の {eqFirst} から{fy}の {eq} です。',
    // 同じ文の中に「自己資本比率」と比較先の語があるときだけ（別の文の「加重平均」で発火しない）
    detect: ({ text }) => sameSentence(text, /自己資本比率/, /平均|業界|業種|他社|小売|一般的/),
  },
  {
    id: 'price-product',
    kind: 'calc',
    title: 'EPS × PER で出した株価',
    body: 'EPS に PER を掛けて株価を出す計算は、掛ける PER を自分で決めた仮定の数字です。この画面は将来の株価を出さず、実際の終値（{price}・{priceAsOf}）だけを出しています。計算した数字は、会社の数字と区別して書いておきます。',
    detect: ({ text }) => /目標株価|理論株価|適正株価|EPS\s*[×x✕*]\s*PER|PER\s*[×x✕*]\s*EPS/i.test(text),
  },
  // ── 2026-10-22: 考え方の型（測定1で AI が 3回中0〜1回しか拾えなかったもの）。文の構造を指摘し、銘柄にも予想の当否にも触れない ──
  // kind は check（画面の札が「計算方法」になるのを避ける。review S1）
  {
    id: 'momentum-as-reason',
    kind: 'check',
    title: '値動きそのものを理由にしている',
    body: '株価の動き（上がっている・下がっている）が、「ので」「から」の前、つまり理由の位置に置かれています。値動きを理由にすると、上がっている理由が「上がっているから」になり、あとで読み返しても確かめようがありません。同じ期間に会社の数字がどう動いたか（{fy}の売上収益の前期比 {salesYoy}・EPS の前期比 {epsYoy}）を、値動きとは分けて書いておきます。',
    detect: ({ text }) => momentumAsReason(text),
  },
  {
    id: 'fame-as-safety',
    kind: 'check',
    title: '知名度を、財務の安全性の代わりにしている',
    body: '会社の知名度や規模が、「潰れない」「安心」の理由として書かれています。知名度と、借りたお金を返す力を示す数字は、別のものです。返す力は、自己資本比率（{fy}は {eq}）・手元資金（{cash}）・有利子負債の額で見ます。',
    detect: ({ text }) => fameAsSafety(text),
  },
  {
    id: 'forecast-as-reason',
    kind: 'check',
    title: '結論の理由が、将来の株価の予想になっている',
    body: '結論の理由が、これからの株価の見通し（「上がりそう」など）になっています。見通しが当たるかどうかには、この添削は触れません。見通しは書いた時点では確かめられず、あとで読み返しても、理由が確かだったのか偶然だったのかを分けられません。このサイトも将来の株価は出しません。理由の欄には、いま確かめられる事実（会社の数字・発表）と、そこからの解釈を書いておきます。',
    detect: ({ memo, text }) => forecastAsReason(memo, text),
  },
  {
    id: 'cf-profit-unchecked',
    kind: 'check',
    title: 'キャッシュフローを、利益と並べて見ていない',
    body: 'キャッシュフローや手元資金について書かれていますが、利益との関係は書かれていません。利益が出ていても、営業CF が減る会社があります（売掛金や在庫が増えたときなど）。{fy}は営業CF {ocf}、純利益 {net}。2つを並べて、差がどこから来ているかを見ておきます。',
    detect: ({ text }) => cfProfitUnchecked(text),
  },
  {
    id: 'segment-impression',
    kind: 'check',
    title: '内訳を、数字でなく印象で書いている',
    body: '内訳（セグメントや地域）について書かれていますが、前期比や構成比の数字がありません。{fy}は、海外ユニクロが前期比 {segOverseasYoy}（構成比 {segOverseasShare}）、国内ユニクロが {segDomesticYoy}（{segDomesticShare}）、ジーユーが {segGuYoy}（{segGuShare}）、グローバルブランドが {segGlobalBrandsYoy}（{segGlobalBrandsShare}）。印象を、どの数字から読んだかを書いておきます。',
    detect: ({ text }) => segmentImpression(text),
  },
]

export function catalogueById(id: string): CatalogueEntry {
  const e = CATALOGUE.find(x => x.id === id)
  if (!e) throw new Error(`catalogue: 未定義の id ${id}`)
  return e
}

/** 規則で当たった項目（カタログの順） */
export function detectAll(ctx: DetectContext): CatalogueEntry[] {
  return CATALOGUE.filter(e => e.detect(ctx))
}

/** §3 に何も無いときの固定文 */
export const NOTHING_FOUND = '見つかりませんでした。'
export const CHECK_SCOPE_NOTE = '規則で見つけられるもの（計算方法と確認漏れ）だけを探しています。見つからなかったことは、判断の正しさを意味しません。'
