import { LAB_9983, type LabData } from '@/lib/lab/9983'
import { citationList } from '@/lib/lab/citations'

/**
 * 「出典」の節（/lab/9983・2026-10-12・オーナーの読みやすさの指示 (a)・DECISIONS 2026-10-09 の追記）。ページ下部に常時開いた状態で置く。
 *
 *  - 本文の数字の右肩の [N]（CitationMark）がここの li#cite-N へ飛ぶ。番号は lib/lab/citations.ts の初出順
 *  - **<details> にしない・text-small text-ink-2（--muted より薄くしない）・aria-hidden を付けない**。R8「出所の明示が詐欺サイトとの最大の見分け」を
 *    番号で必ず辿れて常に見える形で満たす（scripts/check-lab-9983.ts (m)）
 *  - 1行の形: [N] 資料名・発行元・取得日・注記・URL（リンク）
 *  - 免責（Disclaimer・「当社の分析や評価は含まれていません」など）はここに移さない。出所ではなく法務の注記なので元の場所に残す
 */

export const CITATIONS_TITLE = '出典'
export const CITATIONS_LEAD = '本文の数字の右肩にある [番号] は、この一覧の番号です。番号を押すとここに移ります。'
export const LINK_NOTE = 'リンク先は当社と関係がありません。'

export function CitationList({ data = LAB_9983 }: { data?: LabData }) {
  const list = citationList(data)
  return (
    <section className="space-y-3" data-section="lab-citations" aria-labelledby="lab-citations-heading">
      <h2 id="lab-citations-heading" className="text-h2 text-ink">{CITATIONS_TITLE}</h2>
      <p className="text-small text-ink-2 max-w-[42rem]">{CITATIONS_LEAD}</p>
      <ol className="space-y-2 text-small text-ink-2" data-citations={list.length}>
        {list.map(c => (
          <li key={c.n} id={`cite-${c.n}`} className="flex gap-x-2 scroll-mt-4 target:bg-brand-tint target:rounded-field">
            <span className="shrink-0 tabular-nums text-ink">[{c.n}]</span>
            <span className="min-w-0 break-words">
              <span className="text-ink">{c.label}</span>
              ・{c.publisher}
              ・<span className="tabular-nums">{c.asOf}</span>
              {c.note && <>・{c.note}</>}
              ・<a href={c.url} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-4 break-all">{c.url}</a>
            </span>
          </li>
        ))}
      </ol>
      <p className="text-small text-ink-2">{LINK_NOTE}</p>
    </section>
  )
}
