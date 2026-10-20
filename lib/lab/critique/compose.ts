import { LAB_9983, type LabData } from '../9983'
import { citationIndex, citeOfRef } from '../citations'
import { fill, labVarEntries, labVars } from '../display'
import { MEMO_FIELDS, decisionLabel, filledFields, memoText, type LabMemo } from '../memo-fields'
import { richParagraphs, richPieces, termTokens, type Piece } from '../rich'
import type { SourceRef } from '../types'
import { CHECK_SCOPE_NOTE, NOTHING_FOUND, detectAll, type CatalogueKind } from './catalogue'
import { pickTheme, type LearnTheme } from './learn-themes'
import { CRITIQUE_SECTIONS, NOTES_TEXT } from './sections'

/**
 * 添削（画面5）を組む純関数（/study・2026-10-09・S-A）。**AI の自由記述はゼロ。**
 *
 *  §1 原文の逐語引用（順に）／§2 事実の列挙／§3 固定カタログから規則で選ぶ／§4 画面2の項目のうち言及の無いもの／
 *  §5 固定の併置文／§6 固定テーマを規則で1つ／§7 固定文。見出しと順番は sections.ts。
 *
 * 守っていること: 原文を書き換えない。評価の語を作らない。買う／買わないを言わない。数字は {var} でデータから埋める。
 * 2026-10-12（オーナーの読みやすさの指示 (a)(d)）: §3 の本文と §5 の併置文は、文字（body・lines）に加えて「かけら」（bodyPieces・pieces。
 * lib/lab/rich.ts）も返す。画面（components/lab/CritiqueView.tsx）はかけらを描き、数字の直後に出典の番号 [N] を、§5 の用語に囲みを付ける。
 * 文字の形は変えない（かけらをつなぐと body・lines と同じ文。検査 (l)）。§3 の固定文の用語は囲まない（札の散らばりを避ける）。
 * 検査: scripts/check-lab-9983.ts (h)(i)(l)(p)。
 */

export interface Quote {
  label: string
  text: string
}

export interface CheckHit {
  id: string
  kind: CatalogueKind
  title: string
  body: string
  /** body と同じ文のかけら（数字に出典の番号。用語は囲まない） */
  bodyPieces: Piece[]
}

const TOKENS = termTokens()

export interface Critique {
  /** §1 */
  flow: { decision: string | null; quotes: Quote[] }
  /**
   * §2。画面は filledLine → namesHeading（小見出し）＋nameLines → decisionLine の順に描く。
   * lines は同じ文を順に並べたもの（検査・禁止語の走査用）
   */
  written: {
    filledLine: string
    namesHeading: string
    nameLines: string[]
    decisionLine: string
    lines: string[]
    filledKeys: string[]
    mentionedNames: string[]
    mentionedSegments: string[]
  }
  /** §3 */
  check: { hits: CheckHit[]; nothingFound: string; scopeNote: string }
  /** §4 */
  missing: { items: { key: string; label: string }[]; noneText: string | null }
  /** §5。lines は文字（検査が固定）、pieces は同じ文のかけら（数字に出典の番号・用語に囲み） */
  connect: { lines: string[]; pieces: Piece[][] }
  /** §6 */
  learn: { theme: LearnTheme }
  /** §7 */
  notes: readonly string[]
  sections: typeof CRITIQUE_SECTIONS
}

/** 英字の語は前後が英字でないときだけ一致（"approach" の PER を拾わない。レビュー S3） */
const W = (s: string) => `(?<![A-Za-z])${s}(?![A-Za-z])`

/**
 * 画面2の項目ごとに「名前で書かれた」とみなす語。画面に出すのは name。
 * segment: true の語（セグメント名）は「指標」ではなく「内訳」として別の行に出し、§4 の判定（itemKeys）にだけ使う（レビュー W3）
 */
export const METRIC_MENTIONS: readonly { itemKey: string; names: readonly { name: string; re: RegExp; segment?: true }[] }[] = [
  { itemKey: 'per', names: [{ name: 'PER', re: new RegExp(`${W('PER')}|株価収益率`, 'i') }] },
  { itemKey: 'eps', names: [{ name: 'EPS', re: new RegExp(`${W('EPS')}|1株当たり利益|一株当たり利益|1株あたり利益|一株あたり利益`, 'i') }] },
  {
    itemKey: 'profit',
    names: [
      { name: '営業利益', re: /営業利益/ },
      { name: '純利益', re: /純利益|当期利益/ },
      { name: '事業利益', re: /事業利益/ },
    ],
  },
  {
    itemKey: 'roeRoa',
    names: [
      { name: 'ROE', re: new RegExp(`${W('ROE')}|自己資本利益率`, 'i') },
      { name: 'ROA', re: new RegExp(`${W('ROA')}|総資産利益率`, 'i') },
    ],
  },
  { itemKey: 'equityRatio', names: [{ name: '自己資本比率', re: /自己資本比率|持分比率/ }] },
  {
    itemKey: 'cash',
    names: [
      { name: '営業CF', re: /営業CF|営業キャッシュ|キャッシュフロー|キャッシュ・フロー/i },
      { name: '手元資金', re: /手元資金|現金/ },
    ],
  },
  { itemKey: 'dividend', names: [{ name: '配当', re: /配当/ }] },
  {
    itemKey: 'segments',
    names: [
      { name: 'セグメント', re: /セグメント|内訳/, segment: true },
      { name: '国内ユニクロ', re: /国内ユニクロ|国内の売上|国内売上/, segment: true },
      { name: '海外ユニクロ', re: /海外ユニクロ|海外の売上|海外売上/, segment: true },
      { name: 'ジーユー', re: /ジーユー|(?<![A-Za-z])GU(?![A-Za-z])/, segment: true },
      { name: 'グローバルブランド', re: /グローバルブランド/, segment: true },
    ],
  },
]

/** 画面2の項目には紐づかないが「名前で書かれた指標」として数える語（「株価」は「株価収益率」「目標株価」にも当たるので数えない。レビュー W3） */
export const EXTRA_NAMES: readonly { name: string; re: RegExp }[] = [
  { name: '売上収益', re: /売上/ },
  { name: 'PBR', re: new RegExp(`${W('PBR')}|株価純資産倍率`, 'i') },
  { name: '配当利回り', re: /配当利回り/ },
  { name: '配当性向', re: /配当性向/ },
]

/** §2 の小見出し */
export const NAMES_HEADING = '名前で書かれた項目'

/** §5 の固定の併置文（{var} で埋める。買う／買わないは言わない） */
export const CONNECT_TEMPLATES: readonly string[] = [
  '売上収益 → 営業利益 → 純利益 → EPS の順に、伸び率がどこで変わるかを見ます。{fy}は {salesYoy} → {opYoy} → {netYoy} → {epsYoy}。売上より利益の伸びが大きいことは「費用の伸びが売上より小さかった」とも「前の期に一時的な費用があった」とも読めます。',
  'PER は利益の伸びと合わせて読みます。予想PER {per}（プライム市場・小売業の加重平均 {perRetail}、市場全体 {perMarket}）に対して、会社の来期予想は純利益 {nextNetYoy}。「将来の伸びを市場が先に織り込んでいる」とも「利益に対して株価が先行している」とも読めます。',
  '決算の数字と株価の動きは、別々に見ます。{fy}は売上・利益・EPS が増え、発表の翌日（{priceDate}）の株価は前日比 {priceChg}。「来期予想の伸びが期待に届かなかった」とも「発表前に株価が先に動いていた」とも読めます。',
  'ROE・ROA・自己資本比率は1組で見ます。ROE {roe}、ROA は{fyPrev}の {roaPrev}（{fy}は会社未開示）、自己資本比率 {eq}。負債の使い方が、ROE と ROA の差になって表れます。',
]

/** 本文に出てきた指標の名前（names）・内訳の名前（segments）・画面2の項目 key（itemKeys。§4 の判定用） */
export function mentionedMetrics(text: string): { names: string[]; segments: string[]; itemKeys: string[] } {
  const names: string[] = []
  const segments: string[] = []
  const itemKeys: string[] = []
  for (const m of METRIC_MENTIONS) {
    let hit = false
    for (const n of m.names) {
      if (n.re.test(text)) { (n.segment ? segments : names).push(n.name); hit = true }
    }
    if (hit) itemKeys.push(m.itemKey)
  }
  for (const n of EXTRA_NAMES) if (n.re.test(text) && !names.includes(n.name)) names.push(n.name)
  return { names, segments, itemKeys }
}

export function composeCritique(memo: LabMemo, data: LabData = LAB_9983): Critique {
  const vars = labVars(data)
  const entries = labVarEntries(data)
  const index = citationIndex(data)
  const cite = (s: SourceRef | null) => citeOfRef(index, s)
  const text = memoText(memo)
  const decision = decisionLabel(memo.decision)

  // §1 原文の逐語引用（順に）
  const quotes: Quote[] = memo.mode === 'free'
    ? (memo.free.trim().length > 0 ? [{ label: '自由記述', text: memo.free }] : [])
    : MEMO_FIELDS.filter(f => (memo.parts[f.key] ?? '').trim().length > 0).map(f => ({ label: f.label, text: memo.parts[f.key] ?? '' }))

  // §2 事実の列挙
  const filled = filledFields(memo)
  const { names, segments, itemKeys } = mentionedMetrics(text)
  let filledLine: string
  if (memo.mode === 'free') {
    const chars = memo.free.trim().length
    filledLine = chars > 0 ? `自由記述で ${chars} 文字が書かれていました。` : '自由記述は空でした。'
  } else {
    filledLine = filled.length > 0
      ? `${MEMO_FIELDS.length}つの欄のうち ${filled.length}つに記入がありました（${filled.map(f => f.label).join('／')}）。`
      : `${MEMO_FIELDS.length}つの欄のどれにも記入がありませんでした。`
  }
  // 指標と内訳は別の行（セグメント名は指標ではない。レビュー W3）
  const nameLines: string[] = [names.length > 0 ? `名前で書かれた指標: ${names.join('、')}。` : '名前で書かれた指標はありませんでした。']
  if (segments.length > 0) nameLines.push(`触れていた内訳: ${segments.join('、')}。`)
  const decisionLine = decision ? `結論: ${decision}。` : '結論は選ばれていません。'
  const lines = [filledLine, ...nameLines, decisionLine]

  // §3 固定カタログから規則で
  const hits: CheckHit[] = detectAll({ text, memo, data }).map(e => ({
    id: e.id, kind: e.kind, title: e.title,
    body: fill(e.body, vars),
    bodyPieces: richPieces(e.body, entries, cite, null, new Set()),
  }))

  // §4 画面2の項目のうち言及の無いもの
  const missingItems = data.metricItems.filter(it => !itemKeys.includes(it.key)).map(it => ({ key: it.key, label: it.label }))
  const noneText = missingItems.length === 0 ? `ありません。画面2の${data.metricItems.length}項目すべてに触れていました。` : null

  // §5 固定の併置文（文字と、同じ文のかけら。用語は §5 の中で初出だけ囲む）
  const connect = CONNECT_TEMPLATES.map(t => fill(t, vars))
  const connectPieces = richParagraphs(CONNECT_TEMPLATES, entries, cite, TOKENS)

  // §6 固定テーマを規則で1つ
  const theme = pickTheme(missingItems.map(m => m.key))

  return {
    flow: { decision, quotes },
    written: { filledLine, namesHeading: NAMES_HEADING, nameLines, decisionLine, lines, filledKeys: filled.map(f => f.key), mentionedNames: names, mentionedSegments: segments },
    check: { hits, nothingFound: NOTHING_FOUND, scopeNote: CHECK_SCOPE_NOTE },
    missing: { items: missingItems, noneText },
    connect: { lines: connect, pieces: connectPieces },
    learn: { theme },
    notes: NOTES_TEXT,
    sections: CRITIQUE_SECTIONS,
  }
}
