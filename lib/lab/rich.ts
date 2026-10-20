import type { VarEntry } from './display'
import { GLOSSARY_EXTRA, type LabTerm } from './glossary-extra'
import type { SourceRef } from './types'

/**
 * 解説文の切り分け（/study・2026-10-12・オーナーの読みやすさの指示 (a)(d)）。純関数。I/O を持たない。
 *
 * 本文のテンプレート（`{var}` 入り）を、画面の部品（components/lab/RichText.tsx）が描ける「かけら」に切る:
 *   text  … 地の文
 *   value … `{var}` を埋めた文字。出典があれば番号 cite を持ち、画面は直後に [N] を置く
 *   term  … 用語（lib/lab/glossary-extra.ts）。画面は小さな囲み（components/lab/Term.tsx）にする
 *
 *  - かけらの文字を全部つなぐと fill(template, vars) と同じ文になる（文を1字も変えない。検査 (l)）
 *  - 用語は **1つの解説の中で初出の1回だけ** 囲む（同じ語を何度も囲んで「札の散らばり」にしない。DESIGN.md §2）
 *  - 英字の用語（ROE・PER …）は前後が英数字でないときだけ（approach の中の PER を拾わない）
 *  - `{var}` の中の文字は用語として拾わない（数字・期の名前・注記の文字なので）
 */

export type Piece =
  | { kind: 'text'; text: string }
  | { kind: 'value'; text: string; cite: number | null }
  | { kind: 'term'; text: string; term: LabTerm }

export interface TermToken {
  token: string
  term: LabTerm
}

/** 用語の一覧から、本文で探す語（名前そのもの・「（」より前・別名）を長い順に。長い語を先に見るので「予想PER」が「PER」より勝つ */
export function termTokens(terms: readonly LabTerm[] = GLOSSARY_EXTRA): TermToken[] {
  const out: TermToken[] = []
  for (const term of terms) {
    const head = term.name.split('（')[0]
    for (const t of [term.name, head, ...(term.aliases ?? [])]) {
      if (t && !out.some(x => x.token === t)) out.push({ token: t, term })
    }
  }
  return out.sort((a, b) => b.token.length - a.token.length)
}

const isLatin = (ch: string | undefined): boolean => !!ch && /[A-Za-z0-9]/.test(ch)

/** 地の文の中の用語を切り出す。各用語は seen に無い最初の1回だけ囲み、seen に足す */
export function splitTerms(text: string, tokens: readonly TermToken[], seen: Set<string>): Piece[] {
  const out: Piece[] = []
  let buf = ''
  let i = 0
  while (i < text.length) {
    let hit: TermToken | null = null
    for (const t of tokens) {
      if (seen.has(t.term.name) || !text.startsWith(t.token, i)) continue
      const before = text[i - 1]
      const after = text[i + t.token.length]
      if (isLatin(t.token[0]) && isLatin(before)) continue
      if (isLatin(t.token[t.token.length - 1]) && isLatin(after)) continue
      hit = t
      break
    }
    if (hit) {
      if (buf) { out.push({ kind: 'text', text: buf }); buf = '' }
      out.push({ kind: 'term', text: hit.token, term: hit.term })
      seen.add(hit.term.name)
      i += hit.token.length
    } else {
      buf += text[i]
      i++
    }
  }
  if (buf) out.push({ kind: 'text', text: buf })
  return out
}

/**
 * 1本のテンプレートをかけらに切る。`{var}` は vars で埋め、出典があれば cite(source) の番号を持たせる。
 * 未定義の変数は投げる（lib/lab/display.ts の fill と同じ）。tokens が null なら用語は囲まない
 */
export function richPieces(
  template: string,
  vars: Record<string, VarEntry>,
  cite: (source: SourceRef | null) => number | null,
  tokens: readonly TermToken[] | null,
  seen: Set<string>,
): Piece[] {
  const out: Piece[] = []
  const re = /\{([A-Za-z][A-Za-z0-9]*)\}/g
  let last = 0
  let m: RegExpExecArray | null
  const pushText = (t: string) => {
    if (!t) return
    if (tokens) out.push(...splitTerms(t, tokens, seen))
    else out.push({ kind: 'text', text: t })
  }
  while ((m = re.exec(template))) {
    pushText(template.slice(last, m.index))
    const v = vars[m[1]]
    if (v === undefined) throw new Error(`lab/rich: 未定義の変数 {${m[1]}}`)
    out.push({ kind: 'value', text: v.text, cite: cite(v.source) })
    last = m.index + m[0].length
  }
  pushText(template.slice(last))
  return out
}

/** 複数のテンプレート（1つの解説の facts＋readings）を、用語の初出を共有して切る。seed は先に出た用語（項目名など） */
export function richParagraphs(
  templates: readonly string[],
  vars: Record<string, VarEntry>,
  cite: (source: SourceRef | null) => number | null,
  tokens: readonly TermToken[] | null,
  seed: Iterable<string> = [],
): Piece[][] {
  const seen = new Set<string>(seed)
  return templates.map(t => richPieces(t, vars, cite, tokens, seen))
}

/** かけらをつないだ文字（検査用。fill と同じ文になる） */
export const piecesText = (pieces: readonly Piece[]): string => pieces.map(p => p.text).join('')
