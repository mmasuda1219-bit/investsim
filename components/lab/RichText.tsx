import { Fragment } from 'react'
import { CitationMark } from '@/components/lab/CitationMark'
import { Term } from '@/components/lab/Term'
import type { Piece } from '@/lib/lab/rich'

/**
 * 解説文の描画（/lab/9983・2026-10-12）。lib/lab/rich.ts が切った「かけら」を、文を1字も変えずに描く。
 *   text  → そのまま
 *   value → tabular-nums の span。出典があれば直後に [N]（CitationMark）
 *   term  → 用語の囲み（Term）。押すと説明の箱が段落の直下に出るので、呼び手は段落（<p>／<li> の中身）を TermGroup で包む（2026-10-12 スマホ対応）
 */
export function Pieces({ pieces }: { pieces: readonly Piece[] }) {
  return (
    <>
      {pieces.map((p, i) => {
        if (p.kind === 'text') return <Fragment key={i}>{p.text}</Fragment>
        if (p.kind === 'term') return <Term key={i} term={p.term}>{p.text}</Term>
        return (
          <Fragment key={i}>
            <span className="tabular-nums" data-sourced={p.cite != null ? '' : undefined}>{p.text}</span>
            {p.cite != null && <CitationMark n={p.cite} />}
          </Fragment>
        )
      })}
    </>
  )
}
