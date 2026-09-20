// 投資家の人物像（重く見る／重く見ない／見る期間）の3行（2026-09-17 S2・2026-09-18 見た目の作り直し）。
//
// 出典はルールブックの portrait（lib/investors/rulebooks/*.ts）。写真・似顔絵・頭文字のアイコンは使わない
// （本人の言葉や姿に見せない: DESIGN.md §6-11・DECISIONS 2026-09-17）。
// 見出し（dt）は small/--muted、本文（dd）は body/--ink（2026-09-18: 14px → 16px に昇格。人物像は読ませる文）。
// 390px では縦積み、sm 以上で見出しと本文を横に並べる（見本 .lens の 5.5rem の列）。

import type { Rulebook } from '@/lib/investors/rulebooks'

const ROWS: { key: keyof Rulebook['portrait']; label: string }[] = [
  { key: 'weighs', label: '重く見る' },
  { key: 'ignores', label: '重く見ない' },
  { key: 'horizon', label: '見る期間' },
]

export function InvestorLens({ book }: { book: Rulebook }) {
  return (
    <dl className="sm:grid sm:grid-cols-[5.5rem_1fr] sm:gap-x-4 sm:gap-y-0.5">
      {ROWS.map(r => (
        <div key={r.key} className="contents">
          <dt className="text-small text-muted mt-1.5 sm:mt-0">{r.label}</dt>
          <dd className="text-body text-ink">{book.portrait[r.key]}</dd>
        </div>
      ))}
    </dl>
  )
}
