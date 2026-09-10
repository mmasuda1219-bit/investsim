// /watch S1: ニュースの根拠。「AIが読んだ見出し（事実）」と「AIの読み（解釈）」を上下に並置する。
//
// 上: AIに渡した順の番号 + 見出し。見出しは外部（Yahoo Finance News）由来の文字列なので
//     必ず React のテキストノード（textContent 相当）として描く。innerHTML 連結は禁止。
// 下: newsInfluence（AIの読み）。地 --panel、左罫 3px --accent（塗り専用トークンの正しい用法）。
//
// 原則9: この判断に保存されているのは見出しの文字だけ（リンク・掲載時刻なし）。無いものは
//        無いと書き、リンクを捏造しない。

export interface NewsEvidenceProps {
  /** AIに渡した順の見出し。engine.ts が "[3h前] 見出し (出版社)" 形式で保存している。 */
  headlines: string[]
  /** AIの読み（newsInfluence）。空なら「触れていない」と出す。 */
  influence: string
}

export default function NewsEvidence({ headlines, influence }: NewsEvidenceProps) {
  const hasHeadlines = headlines.length > 0
  const hasInfluence = influence.trim().length > 0

  if (!hasHeadlines && !hasInfluence) {
    return <p className="text-sm text-muted leading-relaxed">この判断では、ニュースに触れていません。</p>
  }

  return (
    <div className="space-y-4">
      <section>
        <h5 className="text-[13px] font-semibold text-ink mb-1.5">AIが読んだ見出し</h5>
        {hasHeadlines ? (
          <>
            <ol className="space-y-1.5 max-w-[42rem]">
              {headlines.map((headline, i) => (
                <li key={i} className="flex gap-3">
                  <span aria-hidden className="text-muted font-mono tabular-nums text-sm shrink-0 pt-[3px]">
                    {i + 1}
                  </span>
                  <span className="text-base text-ink-2 leading-relaxed break-words">{headline}</span>
                </li>
              ))}
            </ol>
            <p className="mt-2 text-xs text-muted leading-relaxed max-w-[42rem]">
              この判断では、見出しの文字だけが保存されています（リンク・掲載時刻なし）。
            </p>
          </>
        ) : (
          <p className="text-sm text-muted leading-relaxed">この判断には見出しが保存されていません。</p>
        )}
      </section>

      <section>
        <h5 className="text-[13px] font-semibold text-ink mb-1.5">AIの読み</h5>
        {hasInfluence ? (
          <div
            className="bg-panel pl-4 pr-3 py-2 max-w-[42rem]"
            style={{ borderLeft: '3px solid var(--accent)' }}
          >
            <p className="text-base text-ink-2 leading-relaxed">{influence}</p>
          </div>
        ) : (
          <p className="text-sm text-muted leading-relaxed">この判断では、ニュースは判断に使われていません。</p>
        )}
      </section>
    </div>
  )
}
