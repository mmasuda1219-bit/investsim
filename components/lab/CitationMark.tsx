/**
 * 出典の参照番号 [N]（/lab/9983・2026-10-12・オーナーの読みやすさの指示 (a)）。数字の直後に上付きで置く。
 * 押すとページ下部の「出典」の節（components/lab/CitationList.tsx の li#cite-N）へ飛ぶ。
 *
 *  - 番号は lib/lab/citations.ts（初出順で固定）。ここでは番号を受け取って描くだけ
 *  - text-caption text-brand。色だけに頼らない（角括弧の番号そのものが印）
 *  - 読み上げは「出典 N」（角括弧を読ませない）
 */
export function CitationMark({ n }: { n: number }) {
  return (
    <sup className="ml-0.5 text-caption leading-none tabular-nums" data-cite={n}>
      <a
        href={`#cite-${n}`}
        aria-label={`出典 ${n}`}
        className="text-brand no-underline hover:underline focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
      >
        [{n}]
      </a>
    </sup>
  )
}
