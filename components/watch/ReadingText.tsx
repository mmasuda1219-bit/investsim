// /watch: AIの文を「AIの言葉をそのまま」出す。文中の数値・信号の語だけを札にし、
// 札には初心者向けの意味を添える（lib/ai-trader/glossary.ts）。分割は lib/ai-trader/reading-highlight.ts。
//
// - 文は1文字も変えない。セグメントの連結＝原文（scripts/check-reading-highlight.ts で担保）。
//   抜き出して別の表にはしない（文脈が失われる）。
// - 見出しで「AIの言葉をそのまま」と明示する。文中の評価語（割安・秀逸・要監視）はサイトの評価ではなく
//   AI の発言。札にもしないし、色も付けない（原則11）。
// - 用語の意味は2か所に出す。PC はホバー（title）、スマホ・キーボードでも読めるように文の下の
//   折りたたみ「この文に出てきた用語」。ホバーだけにするとスマホの利用者に届かない。

import { highlightReading } from '@/lib/ai-trader/reading-highlight'
import { GLOSSARY, termKeyOf, termsInReading } from '@/lib/ai-trader/glossary'

export interface ReadingTextProps {
  /** AIの文。そのまま描く（trim もしない）。 */
  text: string
  /** 見出し。例: 「AIの読み（AIの言葉をそのまま）」 */
  label: string
  /** 文が空のときの説明。なぜ無いかを書けるときは上書きする。 */
  emptyNote?: string
}

// 日本語は単語の間に空白を入れないので、枠線＋左右の余白を持つ「箱」を文中に置くと、
// そこで文が途切れて見える（実例: `RSI54 中立・ BB内 で 横ばい 。`）。
// 枠線と左右マージンを外し、余白を 6px→3px に詰めたうえで、数値は「文字を濃く・太く」して
// 目立たせる（地の薄い色は補助）。これで走り読みできる性質を保ったまま文の流れが切れない。
// 下の点線は「この語には意味の説明がある」の web の慣用表現（`<abbr>` と同じ）。
const CHIP =
  'text-ink font-semibold bg-surface rounded-sm px-[3px] decoration-dotted underline decoration-border underline-offset-4'

export default function ReadingText({ text, label, emptyNote = '記録がありません' }: ReadingTextProps) {
  const hasText = text.trim().length > 0
  const segments = highlightReading(text)

  // この文に出てきた用語（出てきた順・重複なし）。札の語に加えて、札にならない地の文の語
  // （「PER計算不能」の PER、「高レバレッジ」、「反発」など）も拾う
  const terms = termsInReading(segments)

  return (
    <div className="max-w-[42rem]">
      <h5 className="text-[13px] font-semibold text-ink mb-1">{label}</h5>
      {hasText ? (
        <>
          <p className="text-base text-ink-2 leading-relaxed" data-reading-text="">
            {segments.map((s, i) => {
              if (s.kind === 'plain') return <span key={i}>{s.text}</span>
              const k = termKeyOf(s.text)
              const cls = `${CHIP}${s.kind === 'metric' ? ' font-mono tabular-nums' : ''}${k ? ' cursor-help' : ''}`
              return k ? (
                <abbr key={i} className={cls} title={`${GLOSSARY[k].name}：${GLOSSARY[k].short}`}>{s.text}</abbr>
              ) : (
                <span key={i} className={cls}>{s.text}</span>
              )
            })}
          </p>
          {terms.length > 0 && (
            <details className="group mt-2">
              <summary className="inline-flex items-center gap-1 text-sm text-accent-ink cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                <span aria-hidden className="transition-transform group-open:rotate-90">▸</span>
                この文に出てきた用語（{terms.length}）
              </summary>
              <dl className="mt-2 space-y-3 border-l-2 border-border pl-3">
                {terms.map((k) => (
                  <div key={k}>
                    <dt className="text-sm font-semibold text-ink">{GLOSSARY[k].name}</dt>
                    <dd className="text-sm text-ink-2 leading-relaxed mt-0.5">{GLOSSARY[k].body}</dd>
                  </div>
                ))}
              </dl>
            </details>
          )}
        </>
      ) : (
        <p className="text-sm text-muted leading-relaxed">{emptyNote}</p>
      )}
    </div>
  )
}
