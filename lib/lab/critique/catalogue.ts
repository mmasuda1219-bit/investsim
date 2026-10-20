import type { LabData } from '../9983'
import { latestPair } from '../display'
import type { LabMemo } from '../memo-fields'

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
