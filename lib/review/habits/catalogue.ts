import { isNoRule } from '@/lib/review/exit-rule'
import { parsePlannedHold } from '@/lib/review/planned-hold'
import { parseReason } from '@/lib/trade/reason'
import { fameAsSafety, forecastAsReason, momentumAsReason, word } from './patterns'
import {
  EXIT_RULE_KINDS,
  HOLD_SIDES,
  MATERIAL_KINDS,
  SELL_LINK_KINDS,
  type ExitRuleKind,
  type HabitFact,
  type HabitGroup,
  type HabitPhrase,
  type HabitRecordInput,
  type HabitSource,
  type HabitSummaryData,
  type HoldSide,
  type MaterialFact,
  type MaterialKind,
  type PhraseFact,
  type SellLinkFact,
  type SellLinkKind,
} from './types'

/**
 * 「書いたことと、したことのまとめ」の検出器（S-H1・2026-10-25）。**純関数だけ**。I/O・時計・乱数・利用者 ID を持たない。
 *
 * 材料は本人が書いた欄（【見立て】【注目】【降りる条件】【売る理由】【変化】）と、売買の日と、買いと売りの対応（株数）だけ。
 * 買値・売値・損益・株価は入力の型（HabitRecordInput）に入っていない＝読めない。
 *
 * 守っていること（MC ゲート① 2026-10-24・legal 2026-10-24 §1・§4・§8 (h)）:
 *  - 数えるのは **売り終えた記録（1株も残っていない）** で、**見出し付きで書かれた** ものだけ。保有中は件数だけ別に返す
 *  - 練習（practice）と過去の記録（past）は別の帳簿として数える（過去の記録の入力欄には【注目】が無い＝混ぜると入口の違いを映す）
 *  - 入力の並び順に依らない（entryAt → id で並べ替えてから見る）
 *  - 区分は0件でも全部・固定順で返す。点数・比・順位を作らない
 *
 * 出典: strategist 2026-10-24 の K2・K4・K8・K9・K12。閾値（8字・3件・語彙）は「言い過ぎないための線」で、統計の根拠は無い。
 * このファイルの語の一覧は**検出のための文字列**で、画面には出ない（画面の文は text.ts）。
 * 検査: scripts/check-review-habits.ts。
 */

const DAY_MS = 86_400_000

// ── 小道具 ─────────────────────────────────────────────────────────────────────

/** 表記をならす: NFKC（全角の数字・記号を半角に）・英字は小文字・空白を除く */
function norm(s: string): string {
  return s.normalize('NFKC').toLowerCase().replace(/\s+/g, '')
}

/** 見出し付きの文を 見出し → 本文 に。見出しが無ければ null */
function structured(text: string | null): Map<string, string> | null {
  if (!text) return null
  const sections = parseReason(text)
  if (!sections.some(s => s.label !== null)) return null
  const m = new Map<string, string>()
  for (const s of sections) if (s.label !== null) m.set(s.label, s.value.trim())
  return m
}

const sharesSold = (r: HabitRecordInput) => r.sells.reduce((s, x) => s + x.shares, 0)
/** 売り終えた（1株も残っていない） */
const isClosed = (r: HabitRecordInput) => r.sells.length > 0 && sharesSold(r) >= r.shares
/** 売り終えた日（いちばん新しい売り） */
const closedAt = (r: HabitRecordInput) => r.sells.reduce((m, x) => Math.max(m, x.exitAt), 0)

function countsOf<K extends string>(keys: readonly K[], tally: Map<K, number>): { key: K; count: number }[] {
  return keys.map(key => ({ key, count: tally.get(key) ?? 0 }))
}
function bump<K>(m: Map<K, number>, k: K) {
  m.set(k, (m.get(k) ?? 0) + 1)
}

// ── K2 降りる条件の書き方 ─────────────────────────────────────────────────────

/** 会社の数字の語（lib/review/exit-rule.ts の NON_PRICE_WORDS のうち、会社の数字にあたるもの＋決算・業績） */
const COMPANY_WORDS_JA = [
  '決算', '業績', '売上', '売り上げ', '利益', '成長率', '成長', '増収', '増益', '減収', '減益', '前年比', '前年同期比', '伸び率',
  'マージン', '粗利', '営業', '純利', '経常', 'シェア', '配当', '利回り', '会員', 'ユーザー', '契約', '販売台数', '出荷', '在庫',
  '負債', '自己資本', '時価総額', 'ガイダンス', '会社予想', '赤字', '黒字',
]
const COMPANY_WORDS_EN = ['eps', 'per', 'pbr', 'psr', 'roe', 'roa', 'roic', 'ebitda']
/** 会社の数字ではなく、株価そのものでもない語（金利・指数・テクニカル指標）。この語がある句は「その他」 */
const OTHER_METRIC_WORDS_JA = [
  '金利', '為替', '失業率', 'インフレ', '移動平均', '乖離', '騰落レシオ', '指数', 'ナスダック', '日経', '出来高',
  // 口座の中の持ち分の話（「保有比率が20%を超えたら」）。「保有」だけでは「保有株が-20%」も拾うので、比率・割合・額に限る
  '比率', '保有割合', '保有額',
]
const OTHER_METRIC_WORDS_EN = ['cpi', 'gdp', 'rsi', 'macd', 'vix', 's&p']

const hasAnyWord = (t: string, ja: readonly string[], en: readonly string[]) =>
  ja.some(w => t.includes(w)) || en.some(w => word(w.replace(/[.*+?^${}()|[\]\\&]/g, '\\$&')).test(t))
const hasCompanyWord = (t: string) => hasAnyWord(t, COMPANY_WORDS_JA, COMPANY_WORDS_EN)

const PRICE_WORDS = ['株価', '買値', '買った値段', '買った価格', '取得単価', '取得価格', '購入価格', '購入単価', '平均取得', '約定', '値段', '価格', '単価', '含み損', '含み益']
const MOVE_WORDS = /下が|下げ|下落|割っ|割れ|割り|下回|落ち|安く|マイナス|上が|上げ|上昇|超え|上回|到達|達し|高く|プラス/
const NOT_PRICE_UNIT = /^\s*(?:倍|割|分|日|週|か月|ヶ月|カ月|箇月|月|年|回|株|本|時|営業|件|%)/

function clauseKind(raw: string): ExitRuleKind | null {
  const t = raw.normalize('NFKC').toLowerCase()
  if (!t.trim()) return null
  if (parsePlannedHold(t)) return 'period'
  if (hasCompanyWord(t)) return 'company'
  if (hasAnyWord(t, OTHER_METRIC_WORDS_JA, OTHER_METRIC_WORDS_EN)) return 'other'
  const hasPriceWord = PRICE_WORDS.some(w => t.includes(w))
  if (/\d[\d,]*(?:\.\d+)?\s*%/.test(t)) {
    const signed = /[-−▲+]\s*\d[\d,]*(?:\.\d+)?\s*%/.test(t)
    if (signed || hasPriceWord || MOVE_WORDS.test(t)) return 'pricePct'
    return 'other'
  }
  if (/\$\s*\d/.test(t) || /\d[\d,]*(?:\.\d+)?\s*(?:ドル|円|usd|jpy)/.test(t)) return 'priceValue'
  if (hasPriceWord) {
    const re = /\d[\d,]*(?:\.\d+)?/g
    let m: RegExpExecArray | null
    while ((m = re.exec(t)) !== null) {
      if (!NOT_PRICE_UNIT.test(t.slice(m.index + m[0].length))) return 'priceValue'
    }
  }
  return 'other'
}

/** 【降りる条件】の書き方を1つに決める（2つ以上の種類に当たれば「組み合わせ」） */
export function exitRuleKind(text: string | null | undefined): ExitRuleKind {
  if (isNoRule(text)) return 'none'
  const kinds = new Set<ExitRuleKind>()
  const whole = (text ?? '').trim()
  if (parsePlannedHold(whole)) kinds.add('period')
  for (const c of whole.split(/[\/／。\n、;；]|または|もしくは|あるいは/)) {
    const k = clauseKind(c)
    if (k && k !== 'other') kinds.add(k)
  }
  if (kinds.size === 0) return 'other'
  if (kinds.size >= 2) return 'combined'
  return [...kinds][0]
}

// ── K4 見立てに使った材料 ─────────────────────────────────────────────────────

/** 文に分ける（。！？と改行。区切りの記号は文の側に残す＝問いの文を見分けるため） */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[。！!？?\n])/).map(s => s.trim()).filter(s => s.length > 0)
}

/**
 * 言い切りでない文（問い・仮の話・打ち消し）。材料の判定に入れない。
 * 「上がっているからといって買わない」「もし決算が良ければ」「上がっているのか？」は当たらない（検査 (9)）。
 * 保守的に倒す（数え漏れは「当てはまらなかった」に入るだけだが、誤って数えると本人が書いていない理由を数えることになる）
 */
const NOT_ASSERTIVE = /[?？]$|か[。!！]?$|かな[。!！]?$|だろうか(?!ら)|でしょうか|もし|れば|たら|としたら|なら(?!ず)|からといって|わけではな|とは限ら|とは言え|とはいえ|とは思わ|理由ではな|理由にしな|理由は使わ|理由には使わ|ではなく|ではない|関係な|気にしな|見ていな|見ない|(?:ない|ません|なかった)[。!！]?$/

/** 「」『』の中身（人の言ったことの引用）は本人の理由ではないので、判定の前に取り除く */
const stripQuoted = (s: string) => s.replace(/「[^「」]*」|『[^『』]*』/g, '')

function assertiveText(text: string): string {
  return splitSentences(text)
    .map(stripQuoted)
    .filter(s => !NOT_ASSERTIVE.test(s.trim()))
    .map(s => s.replace(/[。！!？?\n]+$/, ''))
    .filter(s => s.trim().length > 0)
    .join('。')
}

const CAUSE = '(?:ので|(?<!て)から|ため)'
/** 会社の数字の語 → 変化・良し悪しの語 → ので／から／ため（同じ句の中） */
const COMPANY_REASON = new RegExp(
  `(?:${COMPANY_WORDS_JA.join('|')}|(?<![a-z])(?:${COMPANY_WORDS_EN.join('|')})(?![a-z]))[^。、]{0,16}?` +
    `(?:伸び|増え|増加|減っ|減少|上が|下が|上昇|下落|良|よい|よかっ|よく|強|弱|高|低|拡大|縮小|続い|最高|黒字|赤字|超え|上回|下回)` +
    `[^。、]{0,10}?${CAUSE}`,
)
/**
 * 買う・持つという判断の語（「買うのは」「買うこと」のように話題にしているだけのものは除く）。
 * 人の意見の語は「ニュースで見たので調べ始めた」のように判断でない因果にも出るので、因果の語の後に判断の語を求める（reviewer 2026-10-25 W2）
 */
const DECISION = '(?:買う|買った|買い[、増足ま]|買って|購入し|購入す|持つ|持った|持って|持ち続け|保有し|保有す|選ぶ|選んだ|選んで|入れる|入れた|組み入れ|手を出)(?!の[はが]|こと)'
/** 人の意見・ニュースの語 → ので／から／ため（同じ句の中）→ 判断の語（同じ文の中・近く） */
const OPINION_REASON = new RegExp(
  `(?:sns|ニュース|記事|アナリスト|評判|話題|口コミ|youtube|ユーチューブ|ツイッター|twitter|雑誌|新聞|友人|友達|知人|専門家|インフルエンサー|おすすめ|勧め|推して|と聞い|と言われ|が言って|と書かれ)[^。、]{0,16}?${CAUSE}[^。]{0,12}?${DECISION}`,
)

/**
 * 見立てに当たった材料。値動き・知名度・株価の見通しの判定（./patterns.ts。添削の判定の写し）を、言い切りの文だけに当てる。
 * 会社の数字と人の意見はこのファイルで同じ形（語 → ので／から／ため）に書いた。
 */
export function materialsOf(thesis: string): MaterialKind[] {
  const t = assertiveText(thesis.normalize('NFKC'))
  if (!t) return []
  const lower = t.toLowerCase()
  const out: MaterialKind[] = []
  if (COMPANY_REASON.test(lower)) out.push('company')
  if (momentumAsReason(t)) out.push('momentum')
  if (fameAsSafety(t)) out.push('fame')
  // 見立ての欄は「なぜ買うのか」＝結論の理由そのもの。結論の欄として当てる
  if (forecastAsReason(t)) out.push('forecast')
  if (OPINION_REASON.test(lower)) out.push('opinion')
  return MATERIAL_KINDS.filter(k => out.includes(k))
}

// ── K8 売る理由と、買ったときの降りる条件 ─────────────────────────────────────

const FIXED_SELL_WORDS = /条件|決めた|決めていた|予定どおり|予定通り|ルール/g
/** 固定語の直後（同じ句の中）に打ち消しが続く（「条件に当てはまらないが売った」）ものは数えない */
const FIXED_NEGATED = /^[^。、]{0,12}?(?:ない|なかっ|ません|ず(?:に|[、。]|$))/

function hasFixedWord(sellReason: string): boolean {
  for (const m of sellReason.matchAll(FIXED_SELL_WORDS)) {
    if (!FIXED_NEGATED.test(sellReason.slice((m.index ?? 0) + m[0].length))) return true
  }
  return false
}

/** 同じ語の固定語彙 */
const SHARED_VOCAB_JA = ['決算', '売上', '利益', '成長率', '配当', '金利', '為替', '新製品']
const SHARED_VOCAB_EN = ['eps', 'per']

/** 単位のならし（か月の書き方の揺れ・$ と ドル） */
const UNIT_OF: Record<string, string> = { '%': '%', '円': '円', 'ドル': 'ドル', '$': 'ドル', '日': '日', '週': '週', '年': '年', 'か月': 'か月', 'ヶ月': 'か月', 'カ月': 'か月', '箇月': 'か月' }

/** 数字を単位つきで（「-20%」と「20日」は別の数字。符号は見ない＝「-20%」と「20%下がった」は同じ） */
function numbersIn(text: string): Set<string> {
  const t = text.normalize('NFKC').replace(/(\d),(?=\d{3})/g, '$1')
  const out = new Set<string>()
  for (const m of t.matchAll(/(\$)?\s*(\d+(?:\.\d+)?)\s*(%|円|ドル|日|週|年|か月|ヶ月|カ月|箇月)?/g)) {
    const unit = m[3] ?? m[1] ?? ''
    out.add(`${Number(m[2])}${UNIT_OF[unit] ?? ''}`)
  }
  return out
}
function vocabIn(text: string): Set<string> {
  const t = text.normalize('NFKC').toLowerCase()
  const out = new Set<string>()
  for (const w of SHARED_VOCAB_JA) if (t.includes(w)) out.add(w)
  for (const w of SHARED_VOCAB_EN) if (word(w).test(t)) out.add(w)
  return out
}

export function sellLinks(exitRule: string, sellReason: string): SellLinkKind[] {
  const out: SellLinkKind[] = []
  if (hasFixedWord(sellReason)) out.push('fixedWord')
  const a = numbersIn(exitRule)
  if ([...numbersIn(sellReason)].some(n => a.has(n))) out.push('sameNumber')
  const v = vocabIn(exitRule)
  if ([...vocabIn(sellReason)].some(w => v.has(w))) out.push('sameWord')
  return SELL_LINK_KINDS.filter(k => out.includes(k))
}

// ── K12 くり返し出てくる言い回し ──────────────────────────────────────────────

export const PHRASE_MIN_CHARS = 8
export const PHRASE_MIN_RECORDS = 3
export const PHRASE_MAX = 5

/** ならした文字列と、ならした1字ごとの原文の位置 */
function normWithMap(s: string): { n: string; map: number[] } {
  let n = ''
  const map: number[] = []
  let i = 0
  while (i < s.length) {
    const cp = s.codePointAt(i) as number
    const ch = String.fromCodePoint(cp)
    const t = norm(ch)
    for (let k = 0; k < t.length; k++) {
      n += t[k]
      map.push(i)
    }
    i += ch.length
  }
  return { n, map }
}

interface PhraseSource { id: string; seq: number; raw: string; n: string; map: number[] }

/**
 * 8字以上の同じ文字列が3件以上の別の記録に出てくるもの（最大5つ・長い順）。
 *
 * 速さのため（reviewer 2026-10-25 C1。前の作りは件数²×字数²で、200件で数分かかった）:
 *  (1) ならした後の見立てが同じ記録は先に1つにまとめ、件数（members）だけ持つ
 *  (2) 伸ばす判定は 8字グラムの出現位置（どの見立ての何字目か）を1字ずつ絞り込んで行う。全文の includes をしない
 *      （出現位置で見るので「その文字列を含む見立て」と一致する＝前の作りと同じ答え）
 *  (3) 1つの見立ての中で、見つけた文字列の内側から始まる位置は、その終わりを越えて伸びられないと分かれば飛ばす
 *      （越えるには終わりの次の1字を含む 8字グラムが3件以上に必要。それが無ければ内側の文字列はみな見つけた文字列の一部＝最後に落とすもの）
 * 出力（text・records の順・最大5・長い順）は前の作りと同じ。
 */
export function repeatedPhrases(items: readonly { id: string; seq: number; thesis: string }[]): HabitPhrase[] {
  const src: PhraseSource[] = items.map(it => ({ id: it.id, seq: it.seq, raw: it.thesis, ...normWithMap(it.thesis) }))
  const L = PHRASE_MIN_CHARS
  const MIN = PHRASE_MIN_RECORDS

  // (1) 同じ見立てをまとめる（members は入力の順）
  const uniq: { n: string; members: number[] }[] = []
  const byText = new Map<string, number>()
  src.forEach((s, idx) => {
    let u = byText.get(s.n)
    if (u === undefined) {
      u = uniq.length
      byText.set(s.n, u)
      uniq.push({ n: s.n, members: [] })
    }
    uniq[u].members.push(idx)
  })

  /** 出現位置の並び [見立て, 位置, 見立て, 位置, …] から、別の記録の件数 */
  const weightOf = (pairs: readonly number[]) => {
    const seen = new Set<number>()
    let w = 0
    for (let k = 0; k < pairs.length; k += 2) {
      const u = pairs[k]
      if (seen.has(u)) continue
      seen.add(u)
      w += uniq[u].members.length
    }
    return w
  }
  const distinctOf = (pairs: readonly number[]) => {
    const out: number[] = []
    for (let k = 0; k < pairs.length; k += 2) if (!out.includes(pairs[k])) out.push(pairs[k])
    return out
  }

  // 8字グラム → 出現位置
  const occ = new Map<string, number[]>()
  uniq.forEach((t, u) => {
    for (let i = 0; i + L <= t.n.length; i++) {
      const g = t.n.slice(i, i + L)
      let a = occ.get(g)
      if (!a) occ.set(g, (a = []))
      a.push(u, i)
    }
  })
  const gramWeight = new Map<string, number>()
  const weightOfGram = (g: string) => {
    let w = gramWeight.get(g)
    if (w === undefined) gramWeight.set(g, (w = weightOf(occ.get(g) ?? [])))
    return w
  }

  const found = new Map<string, number[]>()
  for (const t of uniq) {
    const n = t.n
    let skipUntil = -1
    for (let i = 0; i + L <= n.length; i++) {
      if (i <= skipUntil) continue
      const g = n.slice(i, i + L)
      if (weightOfGram(g) < MIN) continue
      // (2) 出現位置を1字ずつ絞り込んで伸ばす
      let cur = occ.get(g) as number[]
      let len = L
      while (i + len < n.length) {
        const ch = n[i + len]
        const next: number[] = []
        for (let k = 0; k < cur.length; k += 2) {
          const u = cur[k]
          const p = cur[k + 1]
          if (uniq[u].n[p + len] === ch) next.push(u, p)
        }
        if (weightOf(next) < MIN) break
        cur = next
        len++
      }
      const str = n.slice(i, i + len)
      if (!found.has(str)) found.set(str, distinctOf(cur))
      // (3) 内側の開始位置を飛ばせるか
      const end = i + len
      if (end >= n.length) skipUntil = n.length
      else if (weightOfGram(n.slice(end - L + 1, end + 1)) < MIN) skipUntil = Math.max(skipUntil, end - L + 1)
    }
  }

  // 長い言い回しに含まれる短い言い回しは落とす
  const strs = [...found.keys()].sort((a, b) => b.length - a.length)
  const maximal: string[] = []
  for (const a of strs) if (!maximal.some(b => b.length > a.length && b.includes(a))) maximal.push(a)
  const whoOf = (str: string) => (found.get(str) as number[]).flatMap(u => uniq[u].members).sort((a, b) => a - b)
  const who = new Map(maximal.map(s => [s, whoOf(s)]))
  maximal.sort((a, b) => b.length - a.length || (who.get(b)!.length - who.get(a)!.length) || (a < b ? -1 : a > b ? 1 : 0))

  return maximal.slice(0, PHRASE_MAX).map(str => {
    const ids = who.get(str)!
    const first = src[ids[0]]
    const at = first.n.indexOf(str)
    const start = first.map[at]
    const endIdx = at + str.length
    const end = endIdx < first.map.length ? first.map[endIdx] : first.raw.length
    return { text: first.raw.slice(start, end), records: ids.map(k => ({ id: src[k].id, seq: src[k].seq })) }
  })
}

// ── まとめ ─────────────────────────────────────────────────────────────────────

interface Counted {
  r: HabitRecordInput
  buy: Map<string, string>
  /** 売りの欄（分けて売ったときは、見出し付きの売りの欄を古い順につなぐ） */
  sellReason: string | null
  change: boolean
}

function prepare(r: HabitRecordInput): Counted | null {
  const buy = structured(r.entryReason)
  if (!buy) return null
  const sells = [...r.sells].sort((a, b) => a.exitAt - b.exitAt)
  const reasons: string[] = []
  let change = false
  for (const s of sells) {
    const m = structured(s.exitReason)
    if (!m) continue
    const v = m.get('売る理由')
    if (v) reasons.push(v)
    if (m.get('変化')) change = true
  }
  return { r, buy, sellReason: reasons.length > 0 ? reasons.join('\n') : null, change }
}

function groupOf(source: HabitSource, closedCount: number, items: Counted[]): HabitGroup {
  const total = items.length

  const exitTally = new Map<ExitRuleKind, number>()
  for (const c of items) bump(exitTally, exitRuleKind(c.buy.get('降りる条件')))
  const exitRule: HabitFact<ExitRuleKind> = { total, counts: countsOf(EXIT_RULE_KINDS, exitTally) }

  const matTally = new Map<MaterialKind, number>()
  let matTotal = 0
  let noneCount = 0
  for (const c of items) {
    const thesis = c.buy.get('見立て') ?? ''
    if (!thesis) continue
    matTotal++
    const ms = materialsOf(thesis)
    if (ms.length === 0) noneCount++
    for (const m of ms) bump(matTally, m)
  }
  const material: MaterialFact = { total: matTotal, counts: countsOf(MATERIAL_KINDS, matTally), noneCount }

  const catWritten = items.filter(c => !!c.buy.get('注目')).length
  const catalyst: HabitFact<'written' | 'blank'> = {
    total,
    counts: [{ key: 'written', count: catWritten }, { key: 'blank', count: total - catWritten }],
  }

  const linkTally = new Map<SellLinkKind, number>()
  let linkTotal = 0
  let linkHits = 0
  for (const c of items) {
    const rule = c.buy.get('降りる条件')
    if (isNoRule(rule) || !c.sellReason) continue
    linkTotal++
    const ls = sellLinks(rule as string, c.sellReason)
    if (ls.length > 0) linkHits++
    for (const l of ls) bump(linkTally, l)
  }
  const sellLink: SellLinkFact = { total: linkTotal, hits: linkHits, counts: countsOf(SELL_LINK_KINDS, linkTally) }

  const changeWritten = items.filter(c => c.change).length
  const change: HabitFact<'written' | 'blank'> = {
    total,
    counts: [{ key: 'written', count: changeWritten }, { key: 'blank', count: total - changeWritten }],
  }

  const holdTally = new Map<HoldSide, number>()
  let holdTotal = 0
  for (const c of items) {
    const rule = c.buy.get('降りる条件')
    const plan = parsePlannedHold(isNoRule(rule) ? null : rule) ?? parsePlannedHold(c.buy.get('見立て'))
    if (!plan) continue
    holdTotal++
    const held = Math.floor((closedAt(c.r) - c.r.entryAt) / DAY_MS)
    bump(holdTally, held < plan.days ? 'before' : held > plan.days ? 'after' : 'same')
  }
  const hold: HabitFact<HoldSide> = { total: holdTotal, counts: countsOf(HOLD_SIDES, holdTally) }

  const theses = items
    .map(c => ({ id: c.r.id, seq: c.r.seq, thesis: c.buy.get('見立て') ?? '' }))
    .filter(x => x.thesis.length > 0)
  const phrase: PhraseFact = { total: theses.length, phrases: repeatedPhrases(theses) }

  return { source, closedCount, total, exitRule, material, catalyst, sellLink, change, hold, phrase }
}

/** 一覧の記録から、まとめを作る。同じ入力（並び順を問わない）には常に同じ答え */
export function summarizeHabits(records: readonly HabitRecordInput[]): HabitSummaryData {
  const sorted = [...records].sort((a, b) => a.entryAt - b.entryAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const closed = sorted.filter(isClosed)
  const openCount = sorted.length - closed.length

  const groups: HabitGroup[] = []
  let total = 0
  let unstructuredCount = 0
  let firstAt: number | null = null
  let lastAt: number | null = null
  for (const source of ['practice', 'past'] as const) {
    const mine = closed.filter(r => r.source === source)
    const items = mine.map(prepare).filter((c): c is Counted => c !== null)
    unstructuredCount += mine.length - items.length
    if (items.length === 0) continue
    total += items.length
    for (const c of items) {
      firstAt = firstAt === null ? c.r.entryAt : Math.min(firstAt, c.r.entryAt)
      lastAt = lastAt === null ? closedAt(c.r) : Math.max(lastAt, closedAt(c.r))
    }
    groups.push(groupOf(source, mine.length, items))
  }

  return { total, closedCount: closed.length, openCount, unstructuredCount, firstAt, lastAt, groups }
}

/** 検出器の一覧（id・出典）。画面の文は text.ts にあり、ここには置かない */
export const HABIT_CATALOGUE: readonly { id: string; source: string }[] = [
  { id: 'K2', source: 'strategist 2026-10-24 K2 降りる条件の書き方の種類' },
  { id: 'K4', source: 'strategist 2026-10-24 K4 見立てに使った材料（判断の語＋因果の語）' },
  { id: 'catalyst', source: 'lib/review/patterns.ts 軸3（【注目】を書いたか）の件数だけ' },
  { id: 'K8', source: 'strategist 2026-10-24 K8 売る理由と買ったときの条件' },
  { id: 'K9', source: 'strategist 2026-10-24 K9 予定期間と実際（売り終えた記録だけ）' },
  { id: 'K12', source: 'strategist 2026-10-24 K12 同じ言い回しのくり返し' },
]
