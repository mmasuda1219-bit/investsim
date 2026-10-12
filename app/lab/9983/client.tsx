'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { CausalMap } from '@/components/lab/CausalMap'
import { CitationList } from '@/components/lab/CitationList'
import { CitationMark } from '@/components/lab/CitationMark'
import { CritiqueView } from '@/components/lab/CritiqueView'
import { MemoForm } from '@/components/lab/MemoForm'
import { MetricRows } from '@/components/lab/MetricRows'
import { Timeline, formatIsoDate } from '@/components/lab/Timeline'
import { Disclaimer } from '@/components/ui/Disclaimer'
import { LAB_9983, fyLabel } from '@/lib/lab/9983'
import { citationIndex, citeOf } from '@/lib/lab/citations'
import { composeCritique, type Critique } from '@/lib/lab/critique/compose'
import { GLOSSARY_EXTRA } from '@/lib/lab/glossary-extra'
import { EMPTY_MEMO, type LabMemo } from '@/lib/lab/memo-fields'
import { formatYen } from '@/lib/lab/money'

/**
 * /lab/9983 の中身（2026-10-09・S-A）。上から 画面1 いつ見るか → 画面2 見る → 画面3 つなげる →（用語）→ 画面4 書く → 画面5 添削（→ 画面6 学ぶ）→ 出典。
 *
 *  - 数字はすべて lib/lab/9983.ts から。画面側に数字を書かない
 *  - メモは state だけ（保存しない・送信しない）。主ボタン「添削を読む」で composeCritique を呼び、画面5 を組む
 *  - 時刻を入力にしない（次回決算日が未定なので「残り日数」の行も出さない）。**例外は画面1 の時系列の「今日」の点だけ**:
 *    useEffect の中で new Date() を読み、描画の初回は空にして水和のずれを避ける（2026-10-12 オーナーの読みやすさの指示 (e)）
 *  - 出所は数字の右肩の [N]（CitationMark）で、ページ下部の「出典」（CitationList）に番号順でまとめる（同 (a)）。
 *    免責（Disclaimer part="general"）は出所ではなく法務の注記なので、画面3 の直下と添削の §7 に残す
 *  - 見出しの階層: 段ラベル＝caption/--muted の <p>、h1＝text-h1 text-ink、節＝h2 text-h2 text-ink（scripts/check-headings.ts の規則）
 */

export const PAGE_KICKER = '添削プロトタイプ（試作・AI は使っていません）'
export const PAGE_LEAD = '決算の数字を見て、つながりをたどり、判断メモを書き、添削を読む。1社の実データで、その流れを1本通します。'
export const WHEN_TITLE = 'いつ見るか'
export const GLOSSARY_TITLE = 'この画面に出てくる用語'
export const NEXT_NOTE = '会社が日付を公表したら、ここに入れます。'

export function Lab9983Client() {
  const data = LAB_9983
  const [memo, setMemo] = useState<LabMemo>(EMPTY_MEMO)
  const [critique, setCritique] = useState<Critique | null>(null)
  const [today, setToday] = useState<string | null>(null)
  const critiqueRef = useRef<HTMLDivElement>(null)
  const index = useMemo(() => citationIndex(data), [data])

  useEffect(() => {
    if (!critique) return
    critiqueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [critique])

  // 時刻を読むのはここだけ（画面1 の「今日」の点）。初回描画は空にして、サーバーとブラウザの日付のずれを避ける
  // （React 公式の「サーバーと違う内容をクライアントだけで出す」型。マウント後に 1 回だけ setState する意図的な再描画なので、
  //   「effect の中で同期的に setState しない」の規則をこの行だけ外す）
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToday(formatIsoDate(new Date()))
  }, [])

  const c = data.company
  const rev = data.dividendRevision
  const revisionDetail = `配当予想を ${formatYen(rev.before.value)}→${formatYen(rev.after.value)} に修正`

  return (
    <div className="max-w-3xl mx-auto space-y-10">
      <header className="space-y-2">
        <p className="text-caption text-muted">{PAGE_KICKER}</p>
        <h1 className="text-h1 text-ink text-balance">{c.name}（{c.code}）の決算を読んで、判断メモを書く</h1>
        <p className="text-h3 font-normal leading-[1.9] text-ink max-w-[42rem]">{PAGE_LEAD}</p>
      </header>

      {/* 画面1 いつ見るか: 横軸の時系列 → 直近の決算 → 次回の決算 → 使い方 */}
      <section className="space-y-3" data-section="lab-when">
        <p className="text-caption text-muted">画面 1</p>
        <h2 className="text-h2 text-ink">{WHEN_TITLE}</h2>
        <div className="bg-card rounded-card border border-border px-4 py-4 space-y-3">
          <Timeline
            prev={{ date: c.latestAnnouncement.value, detail: revisionDetail }}
            today={today}
            next={{ date: c.nextAnnouncement }}
          />
          <div className="border-t border-border pt-3 space-y-1">
            <p className="text-small font-semibold text-ink">直近の決算</p>
            <p className="text-body text-ink tabular-nums">
              <span data-sourced="">{c.latestAnnouncement.value}</span>
              <CitationMark n={citeOf(index, c.latestAnnouncement)} /> 発表・{c.latestFyLabel}
            </p>
            <p className="text-body text-ink-2 tabular-nums">
              同じ日に、{fyLabel(c.latestFy)}の年間配当の予想を{' '}
              <span data-sourced="">{formatYen(rev.before.value)}</span><CitationMark n={citeOf(index, rev.before)} />
              {' '}→{' '}
              <span data-sourced="">{formatYen(rev.after.value)}</span><CitationMark n={citeOf(index, rev.after)} />
              {' '}に修正しました。
            </p>
          </div>
          <div className="border-t border-border pt-3 space-y-1">
            <p className="text-small font-semibold text-ink">次回の決算</p>
            <p className="text-body text-ink">{c.nextAnnouncement}</p>
            <p className="text-caption text-muted">{NEXT_NOTE}</p>
          </div>
          <div className="border-t border-border pt-3">
            <p className="text-body text-ink-2 max-w-[42rem]">{data.howToUse}</p>
          </div>
        </div>
      </section>

      {/* 画面2 見る */}
      <div className="space-y-3">
        <p className="text-caption text-muted">画面 2</p>
        <MetricRows data={data} />
      </div>

      {/* 画面3 つなげる */}
      <div className="space-y-3">
        <p className="text-caption text-muted">画面 3</p>
        <CausalMap data={data} />
        <Disclaimer part="general" />
      </div>

      {/* 用語 */}
      <section className="space-y-3" data-section="lab-glossary">
        <h2 className="text-h2 text-ink">{GLOSSARY_TITLE}</h2>
        <details className="group">
          <summary className="inline-flex items-center gap-1 min-h-11 text-small text-brand cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
            <span aria-hidden="true" className="transition-transform group-open:rotate-90">▸</span>
            用語の説明を開く（{GLOSSARY_EXTRA.length}）
          </summary>
          <dl className="mt-2 space-y-3 border-l-2 border-rule-line pl-3 max-w-[42rem]">
            {GLOSSARY_EXTRA.map(t => (
              <div key={t.name}>
                <dt className="text-small font-semibold text-ink">{t.name}</dt>
                <dd className="text-small text-ink-2 mt-0.5">{t.body}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      {/* 画面4 書く */}
      <div className="space-y-3">
        <p className="text-caption text-muted">画面 4</p>
        <MemoForm memo={memo} onChange={setMemo} onSubmit={() => setCritique(composeCritique(memo, data))} />
      </div>

      {/* 画面5 添削（→ 画面6 学ぶ） */}
      {critique && (
        <div ref={critiqueRef} className="space-y-3 scroll-mt-4">
          <p className="text-caption text-muted">画面 5</p>
          <CritiqueView critique={critique} />
        </div>
      )}

      {/* 出典（常時開いた状態。本文の [N] がここへ飛ぶ） */}
      <CitationList data={data} />
    </div>
  )
}
