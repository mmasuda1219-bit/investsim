'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { labelOf } from '@/components/SiteNav'
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
import { FIXED_COMPANY_NOTE } from '@/lib/lab/fixed-note'

/**
 * /study「学ぶ」の中身（2026-10-09 S-A に /lab/9983 として作り、2026-10-19 S-L1a で公開）。
 * 上から いつ見るか → 見る → つなげる →（用語）→ 書く → 添削（→ 学ぶ）→ 出典。各節の見出し（h2）は部品が持つ。
 *
 *  - 数字はすべて lib/lab/9983.ts から。画面側に数字を書かない。**数字の時点**（期と発表日）は h1 の近くに data から引いて出す
 *  - 1社固定の断り（FIXED_COMPANY_NOTE）は h1 の直下に**無条件**で出す。リードと同じ大きさ・畳まない・薄くしない（オーナー決定 2026-10-19）
 *  - 添削に AI は使っていない（NO_AI_NOTE。正直な表示なので公開後も本文に残す）
 *  - メモは state だけ（保存しない・送信しない・fetch も localStorage も無い）。主ボタン「添削を読む」で composeCritique を呼び、添削を組む
 *  - 「書く」（/trade）へ銘柄を引き継がない（`/trade?symbol=` を作らない）。`/stocks/` へもつながない（オーナー決定 2026-10-19）
 *  - 時刻を入力にしない（次回決算日が未定なので「残り日数」の行も出さない）。**例外は「いつ見るか」の時系列の「今日」の点だけ**:
 *    useEffect の中で new Date() を読み、描画の初回は空にして水和のずれを避ける（2026-10-12 オーナーの読みやすさの指示 (e)）
 *  - 出所は数字の右肩の [N]（CitationMark）で、ページ下部の「出典」（CitationList）に番号順でまとめる（同 (a)）。
 *    免責（Disclaimer part="general"）は出所ではなく法務の注記なので、「つなげる」の直下と添削の §7 に残す
 *  - 見出しの階層: 段ラベル＝caption/--muted の <p>、h1＝text-h1 text-ink、節＝h2 text-h2 text-ink（scripts/check-headings.ts の規則）
 */

/** 段ラベル（番号なし。並びと呼び名の正は components/SiteNav.tsx の NAV） */
export const PAGE_KICKER = '学ぶ'
export const PAGE_LEAD = '決算の数字を見て、つながりをたどり、判断メモを書き、添削を読む。1社の実データで、その流れを1本通します。'
export { FIXED_COMPANY_NOTE } from '@/lib/lab/fixed-note'
/** 添削に AI を使っていないことの表示（公開後も残す） */
export const NO_AI_NOTE = '添削は決まった規則で組み立てます。AI は使っていません。'
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

  // 時刻を読むのはここだけ（「いつ見るか」の「今日」の点）。初回描画は空にして、サーバーとブラウザの日付のずれを避ける
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
        {/* 1社固定の断り。h1 の直下・無条件・リードと同じ大きさ（畳まない・薄くしない） */}
        <p className="text-h3 font-normal leading-[1.9] text-ink max-w-[42rem]" data-fixed-company="">{FIXED_COMPANY_NOTE}</p>
        <p className="text-h3 font-normal leading-[1.9] text-ink max-w-[42rem]">{PAGE_LEAD}</p>
        {/* 数字の時点（data から引く。手で日付を書かない）＋ AI を使っていないことの表示。
            期は latestFyLabel（「2026年8月期（通期）」）を使う。fyLabel だけだと「2026年8月期」になり、
            通期の実績を四半期の数字と取り違えて読まれうる（下の「直近の決算」の行と同じ語にそろえる） */}
        <p className="text-body text-ink-2 tabular-nums max-w-[42rem]" data-as-of="">
          {c.latestFyLabel}の実績です（<span data-sourced="">{c.latestAnnouncement.value}</span><CitationMark n={citeOf(index, c.latestAnnouncement)} /> 発表）。{NO_AI_NOTE}
        </p>
      </header>

      {/* いつ見るか: 横軸の時系列 → 直近の決算 → 次回の決算 → 使い方 */}
      <section className="space-y-3" data-section="lab-when">
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

      {/* 見る（見出し h2 は MetricRows が持つ） */}
      <div className="space-y-3">
        <MetricRows data={data} />
      </div>

      {/* つなげる（見出し h2 は CausalMap が持つ）。免責はその直下に残す */}
      <div className="space-y-3">
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

      {/* 書く（見出し h2 は MemoForm が持つ） */}
      <div className="space-y-3">
        <MemoForm memo={memo} onChange={setMemo} onSubmit={() => setCritique(composeCritique(memo, data))} />
        {/* 「書く」（/trade）へ進む導線。**素の /trade だけ**で `?symbol=` を付けない＝1社固定の題材を
            引き継がない（引き継ぐとこの1社を勧めた形に見える。オーナー決定 2026-10-19・検査 (t)）。
            `/stocks/` へも繋がない。呼び名は NAV から路で引く（添字で読むと並びを変えた日に嘘になる）。
            文言は2文に分ける（2026-10-20 レビュー W3）: 1文目は**ここで書いたものの行き先**（消える）、
            2文目は**次に何をするか**。つなげて「残しておきたいときは →」にすると「この1社のメモを
            持っていく」と読め、`?symbol=` を付けない決定が文言の側から崩れる。だから
            **「自分で選んだ銘柄で」**と明示し、この会社を持ち出す誘導にしない。 */}
        <p className="text-body text-ink-2 max-w-[42rem]" data-next-step="">
          ここで書いたものは、このページを閉じると消えます（保存も送信もしていません）。
          自分で選んだ銘柄で記録を残したいときは{' '}
          <Link href="/trade" className="text-brand hover:underline">「{labelOf('/trade')}」へ進む →</Link>
        </p>
      </div>

      {/* 添削（→ 学ぶ）。見出し h2 は CritiqueView が持つ */}
      {critique && (
        <div ref={critiqueRef} className="space-y-3 scroll-mt-4">
          <CritiqueView critique={critique} />
        </div>
      )}

      {/* 出典（常時開いた状態。本文の [N] がここへ飛ぶ） */}
      <CitationList data={data} />
    </div>
  )
}
