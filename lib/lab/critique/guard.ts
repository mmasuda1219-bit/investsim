import { FORBIDDEN_EXCEPTIONS, LAB_FORBIDDEN_ALL } from '../forbidden-extra'
import { CRITIQUE_SYSTEM_PROMPT, type CritiqueFinding } from './prompt'

/**
 * AI の添削を通す門（フェーズA・2026-10-18）。**純関数。I/O を持たない**（検査から直接呼ぶ）。
 *
 * 1件ずつ次の3つを見て、1つでも外れた件は落とす:
 *  (1) kind が 'calc'／'missing' のどちらかである
 *  (2) quote が利用者の原文に**文字列としてそのまま**含まれる（要約・言い換え・作った引用は落とす）
 *  (3) title・why・how に禁止語が無い（lib/lab/forbidden-extra.ts の全部＋prompt.ts「絶対に書いてはいけないもの」の 「…」 の語）
 *
 * quote は利用者の文なので禁止語を見ない（利用者が「割安」と書いた文を引用しただけで落とさない）。
 * 落とした件とその理由を全部返す（測定に使う。scripts/eval-judge.ts が C「引用の実在率」をここから数える）。
 * 禁止語の一覧はここで増やさない（増やすなら forbidden-extra.ts か prompt.ts）。
 */

export type DropReason = 'bad-kind' | 'quote-not-in-original' | 'forbidden-word'

/** 1件ごとの判定の内訳（落とした件も残した件も同じ形で記録する） */
export interface FindingFlags {
  kindOk: boolean
  /** quote が原文にそのまま含まれる */
  quoteOk: boolean
  /** そのままでは含まれないが、空白を除くと含まれる（作った引用ではなく、空白の違いだけ。診断用） */
  quoteNearMiss: boolean
  /** title・why・how に含まれていた禁止語（無ければ空） */
  forbidden: string[]
  reasons: DropReason[]
}

export interface DroppedFinding {
  finding: CritiqueFinding
  flags: FindingFlags
  /** 人が読むための1行（何に当たったか） */
  detail: string
}

export interface GuardResult {
  kept: CritiqueFinding[]
  dropped: DroppedFinding[]
  /** 全件の判定（入力と同じ順） */
  flags: FindingFlags[]
  /** 理由ごとの件数。1件が2つの理由に当たれば両方に数える */
  counts: Record<DropReason, number>
}

/** prompt.ts の「絶対に書いてはいけないもの」の節から 「…」 の語を取り出す（「○点」のような見本は除く） */
export function promptForbiddenWords(prompt: string = CRITIQUE_SYSTEM_PROMPT): string[] {
  const start = prompt.indexOf('## 絶対に書いてはいけないもの')
  const end = prompt.indexOf('## 書いてよいもの')
  if (start < 0 || end < 0 || end <= start) return []
  const out: string[] = []
  for (const m of prompt.slice(start, end).matchAll(/「([^」]+)」/g)) {
    const w = m[1]
    if (w.includes('○') || out.includes(w)) continue
    out.push(w)
  }
  return out
}

/**
 * prompt.ts の文に無い形で同じ意味になる語。「あなたの判断は間違っていた」の言い換え（「間違っています」など）を
 * 1語で捕まえるためのもの。門を厳しめにする選択（レビューで緩める余地あり）
 */
const GUARD_EXTRA: readonly string[] = ['間違っ']

const unique = (xs: readonly string[]) => xs.filter((w, i) => w.length > 0 && xs.indexOf(w) === i)

/** 門が見る禁止語の全部（forbidden.ts の2一覧＋LAB_FORBIDDEN＋prompt.ts の 「…」＋GUARD_EXTRA） */
export const GUARD_FORBIDDEN: readonly string[] = unique([...LAB_FORBIDDEN_ALL, ...promptForbiddenWords(), ...GUARD_EXTRA])

/** 例外の文（「将来を予測するものではありません」）を取り除いてから、含まれている禁止語を返す */
export function guardForbiddenWordsIn(text: string): string[] {
  let t = text
  for (const e of FORBIDDEN_EXCEPTIONS) t = t.split(e).join('')
  return GUARD_FORBIDDEN.filter(w => t.includes(w))
}

const stripSpace = (s: string) => s.replace(/\s+/g, '')

/** 1件の判定 */
export function judgeFinding(finding: CritiqueFinding, original: string): FindingFlags {
  const kindOk = finding.kind === 'calc' || finding.kind === 'missing'
  const q = (finding.quote ?? '').trim()
  const quoteOk = q.length > 0 && original.includes(q)
  const quoteNearMiss = !quoteOk && q.length > 0 && stripSpace(original).includes(stripSpace(q))
  const forbidden = unique([
    ...guardForbiddenWordsIn(finding.title ?? ''),
    ...guardForbiddenWordsIn(finding.why ?? ''),
    ...guardForbiddenWordsIn(finding.how ?? ''),
  ])
  const reasons: DropReason[] = []
  if (!kindOk) reasons.push('bad-kind')
  if (!quoteOk) reasons.push('quote-not-in-original')
  if (forbidden.length > 0) reasons.push('forbidden-word')
  return { kindOk, quoteOk, quoteNearMiss, forbidden, reasons }
}

function detailOf(f: CritiqueFinding, flags: FindingFlags): string {
  const parts: string[] = []
  if (!flags.kindOk) parts.push(`kind が ${JSON.stringify(f.kind)}`)
  if (!flags.quoteOk) parts.push((f.quote ?? '').trim().length === 0 ? '引用が空' : flags.quoteNearMiss ? '引用が原文と空白だけ違う' : '引用が原文に無い')
  if (flags.forbidden.length > 0) parts.push(`禁止語: ${flags.forbidden.join('・')}`)
  return parts.join('／')
}

/**
 * AI の出力（形は既に検証済み）を門に通す。original は**利用者のメモの部分だけ**（会社の数字の節は含めない。
 * 数字の節から「引用」しても通らないようにするため）
 */
export function guardFindings(findings: CritiqueFinding[], original: string): GuardResult {
  const flags = findings.map(f => judgeFinding(f, original))
  const kept: CritiqueFinding[] = []
  const dropped: DroppedFinding[] = []
  const counts: Record<DropReason, number> = { 'bad-kind': 0, 'quote-not-in-original': 0, 'forbidden-word': 0 }
  findings.forEach((f, i) => {
    const fl = flags[i]
    for (const r of fl.reasons) counts[r]++
    if (fl.reasons.length === 0) kept.push(f)
    else dropped.push({ finding: f, flags: fl, detail: detailOf(f, fl) })
  })
  return { kept, dropped, flags, counts }
}
