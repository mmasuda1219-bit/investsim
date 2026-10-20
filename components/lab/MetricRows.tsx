'use client'

import { useMemo, useState } from 'react'
import { CitationMark } from '@/components/lab/CitationMark'
import { MiniTrend } from '@/components/lab/MiniTrend'
import { Readings } from '@/components/lab/Readings'
import { Pieces } from '@/components/lab/RichText'
import { SegmentBars } from '@/components/lab/SegmentBars'
import { TermGroup } from '@/components/lab/Term'
import { YearBarsLab } from '@/components/lab/YearBarsLab'
import { LAB_9983, fyLabel, type LabData } from '@/lib/lab/9983'
import { citationIndex, citeOf, citeOfRef } from '@/lib/lab/citations'
import { labVarEntries, latestPair, signStyle, yoySentenceParts, yoyValue } from '@/lib/lab/display'
import { formatByUnit } from '@/lib/lab/money'
import { richParagraphs, splitTerms, termTokens } from '@/lib/lab/rich'
import type { Series, SourceRef, Sourced, Unit } from '@/lib/lab/types'

/**
 * 画面2「見る」（/study・2026-10-09・S-A）。項目ごとに (a) 今の数値 (b) 5期のグラフ (c) 平均との比較 (d) 「？」で30秒解説。
 *
 *  - カードを8枚並べない（DESIGN.md §2 の禁止形）。components/stocks/AnnualStatements.tsx と同じく bg-card の帯1本＋mx-4 border-t の区切り
 *  - 項目はデータ（lib/lab/9983.ts の METRIC_ITEMS）だけから描く。固定の項目を画面側に書かない（データに無い項目は行ごと出ない）
 *  - **グラフの使い分け（2026-10-09 オーナー指示）: 金額（百万円・円）は棒（YearBarsLab）、比率（%・倍）は折れ線（MiniTrend）。
 *    セグメント別売上は構成比の横棒（SegmentBars・SERIES の4色）**
 *  - **出所は数字の右肩の [N]（CitationMark）で、ページ下部の「出典」（CitationList）に番号順でまとめる**（2026-10-12 オーナーの読みやすさの指示 (a)・
 *    DECISIONS 2026-10-09 の追記）。「出所: …」の行と、値の横の括弧書き（注記）はこの画面に出さない。
 *    figcaption の注記（SOURCE_NOTE）は法務の注記なので残す（無条件に描く・畳まない・薄くしない）
 *  - **見出しの数字の下に値をもう一度書かない・算式の行を出さない**（同 (b)）。算式は用語の囲み（Term）の説明（lib/lab/glossary-extra.ts）に移した。
 *    残すのは 見出しの数字・期・グラフ・前期比の1文・「？」の解説。見出しの数字に出ていない系列（2本目以降・headlines のある項目の系列）だけ名前と値を1行
 *  - **「2通りの読み方」は独立した囲み（Readings）**（同 (c)）
 *  - **項目名と解説文の用語は小さな囲み（Term）**（同 (d)）。囲むのは用語だけ（評価・状態の札を作らない）。同じ解説の中では初出の1回だけ。
 *    囲みは <button>（スマホで触っても開く・2026-10-12）。押すと説明の箱が段落の直下に出るので、項目名・事実の各段落・読み方の各項目を TermGroup で包む
 *  - (c) は出典が取れた PER だけ（データが comparisons を持つ行だけ出る）
 *  - (d) は事実の記述＋2通りの読み方の併置。結論を書かない。本文の数字はデータから埋める（lib/lab/rich.ts）
 *  - 前期比は％バッジにせず1文（lib/lab/display.ts の yoySentence）。数字の部分だけ signStyle で色（LAB_SIGN_COLOR）。
 *    --success／--danger の文字列はここに書かない（lib/lab/display.ts 経由だけ）
 * 検査: scripts/check-lab-9983.ts。
 */

export const METRICS_TITLE = '見る'
export const METRICS_LEAD = '項目ごとに、今の数値・5期の推移（金額は棒、比率は折れ線）・平均との比較（出典のあるものだけ）・30秒の解説を並べます。数字はすべて会社の開示・JPX・日経の実物です。数字の右肩の [番号] が出典で、ページ下部の「出典」にまとめています。'
export const SOURCE_NOTE = 'この一覧は、会社が公表した数値と JPX・日経の数値をそのまま並べたものです。当社の分析や評価は含まれていません。将来を予測するものではありません。'
export const EXPLAIN_BUTTON = '？ 30秒で読む'
export const EXPLAIN_CLOSE = '閉じる'

const BAND = 'bg-card rounded-card border border-border'
const ROW = 'mx-4 border-t border-border first:border-t-0 py-4 space-y-2'
const TOKENS = termTokens()

interface Props {
  data?: LabData
  /** 出す項目の key（省略なら全部）。画面6の再掲で使う */
  keys?: readonly string[]
  /** 解説を最初から開く（検査・再掲用） */
  defaultOpen?: boolean
  heading?: boolean
}

type Cite = (s: Sourced<unknown>) => number

/** 金額（百万円・円）は棒、比率（%・倍）は折れ線 */
export const chartKindOf = (s: Series): 'bars' | 'line' => (s.unit === 'percent' || s.unit === 'times' ? 'line' : 'bars')

/** 出典つきの値＋[N]。big は見出しの数字（text-h1） */
function Value({ sourced, unit, cite, big = false }: { sourced: Sourced<number>; unit: Unit; cite: Cite; big?: boolean }) {
  return (
    <span className={big ? 'text-h1 tabular-nums text-ink' : 'tabular-nums text-ink'}>
      <span data-sourced="">{formatByUnit(sourced.value, unit)}</span>
      <CitationMark n={cite(sourced)} />
    </span>
  )
}

/** 前期比の1文。前の期の値と会社公表の前期比には [N]。数字の部分だけに符号の色（LAB_SIGN_COLOR が false なら無色） */
function YoyLine({ series, cite }: { series: Series; cite: Cite }) {
  const { prefix, yoy, suffix } = yoySentenceParts(series)
  const v = yoyValue(series)
  const { prev } = latestPair(series)
  const prevText = prev?.value ? formatByUnit(prev.value.value, series.unit) : null
  const at = prevText ? prefix.indexOf(prevText) : -1
  const [pre, post] = at >= 0 && prevText ? [prefix.slice(0, at), prefix.slice(at + prevText.length)] : [prefix, '']
  const yoyCite = yoy && series.unit !== 'percent' && series.yoy ? cite(series.yoy) : null
  return (
    <p className="text-small text-ink-2 max-w-[42rem] tabular-nums">
      {pre}
      {at >= 0 && prev?.value && (
        <>
          <span data-sourced="">{prevText}</span>
          <CitationMark n={cite(prev.value)} />
        </>
      )}
      {post}
      {yoy && (
        <>
          <span className={signStyle(v ?? 0) || undefined} data-sourced={yoyCite != null ? '' : undefined}>{yoy}</span>
          {yoyCite != null && <CitationMark n={yoyCite} />}
        </>
      )}
      {suffix}
    </p>
  )
}

export function MetricRows({ data = LAB_9983, keys, defaultOpen = false, heading = true }: Props) {
  const items = keys ? data.metricItems.filter(it => keys.includes(it.key)) : data.metricItems
  const vars = useMemo(() => labVarEntries(data), [data])
  const index = useMemo(() => citationIndex(data), [data])
  const cite: Cite = s => citeOf(index, s)
  const citeRef = (s: SourceRef | null) => citeOfRef(index, s)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const isOpen = (k: string) => open[k] ?? defaultOpen
  const latestFy = fyLabel(data.company.latestFy)
  const salesLatest = latestPair(data.sales).curr

  return (
    <section className="space-y-3" data-section="lab-metrics">
      {heading && <h2 className="text-h2 text-ink">{METRICS_TITLE}</h2>}
      {heading && <p className="text-small text-muted max-w-[42rem]">{METRICS_LEAD}</p>}

      <figure className={BAND}>
        {items.map(it => {
          const main = it.headlines?.[0]
          const firstSeries = it.series[0]
          const mainLatest = firstSeries ? latestPair(firstSeries).curr : null
          const panelId = `lab-explain-${it.key}`
          // 項目名の用語を囲む。解説の中では、項目名で囲んだ語はもう囲まない（初出だけ）
          const labelSeen = new Set<string>()
          const labelPieces = splitTerms(it.label, TOKENS, labelSeen)
          const paras = richParagraphs([...it.explain.facts, ...it.explain.readings], vars, citeRef, TOKENS, labelSeen)
          const facts = paras.slice(0, it.explain.facts.length)
          const readings = paras.slice(it.explain.facts.length)
          return (
            <div key={it.key} className={ROW} data-metric={it.key}>
              <TermGroup id={`lab-term-${it.key}-label`}>
                <p className="text-small font-semibold text-ink" data-metric-label=""><Pieces pieces={labelPieces} /></p>
              </TermGroup>

              {/* (a) 今の数値（出典は右肩の [N]。括弧書きは出さない） */}
              {main ? (
                <>
                  <p className="flex flex-wrap items-baseline gap-x-2">
                    <Value sourced={main.value} unit={main.unit} cite={cite} big />
                    <span className="text-small text-muted">{main.label}</span>
                  </p>
                  {(it.headlines ?? []).slice(1).map(h => (
                    <p key={h.label} className="text-small text-ink-2 tabular-nums">
                      {h.label} <Value sourced={h.value} unit={h.unit} cite={cite} />
                    </p>
                  ))}
                </>
              ) : mainLatest && firstSeries ? (
                <p className="flex flex-wrap items-baseline gap-x-2">
                  {mainLatest.value
                    ? <Value sourced={mainLatest.value} unit={firstSeries.unit} cite={cite} big />
                    : <span className="text-h1 tabular-nums text-muted">—</span>}
                  <span className="text-small text-muted">{firstSeries.label}・{fyLabel(mainLatest.fy)}</span>
                  {mainLatest.value && mainLatest.value.value < 0 && <span className="text-small text-muted">マイナス</span>}
                </p>
              ) : it.key === 'segments' && salesLatest?.value ? (
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <Value sourced={salesLatest.value} unit="millionYen" cite={cite} big />
                  <span className="text-small text-muted">売上収益の合計・{latestFy}</span>
                </p>
              ) : null}

              {/* (b) 5期のグラフ（系列ごと。金額は棒・比率は折れ線） */}
              {it.series.map((s, si) => {
                const { curr } = latestPair(s)
                const points = s.points.map(p => ({ fy: p.fy, value: p.value?.value ?? null, missing: p.missing }))
                // 見出しの数字に出ている系列（headlines の無い項目の1本目）は、名前と値をもう一度書かない（2026-10-12 (b)）
                const showHeading = !!main || si > 0
                return (
                  <div key={s.key} className="space-y-1 pt-1" data-series={s.key} data-chart={chartKindOf(s)}>
                    {showHeading && (
                      <p className="text-small text-ink tabular-nums" data-series-heading="">
                        <span className="font-semibold">{s.label}</span>{' '}
                        {curr?.value ? <Value sourced={curr.value} unit={s.unit} cite={cite} /> : `—（${curr?.missing ?? '取れていません'}）`}
                        {curr?.value && <span className="text-caption text-muted">・{fyLabel(curr.fy)}</span>}
                      </p>
                    )}
                    {chartKindOf(s) === 'bars'
                      ? <YearBarsLab label={s.label} unit={s.unit} points={points} />
                      : <MiniTrend label={s.label} unit={s.unit} points={points} />}
                    <YoyLine series={s} cite={cite} />
                  </div>
                )
              })}
              {it.series.length === 0 && it.trendNote && <p className="text-caption text-muted max-w-[42rem]">{it.trendNote}</p>}

              {/* セグメント別の内訳（データが segments を持つときだけ）: 構成比の横棒 */}
              {it.key === 'segments' && <SegmentBars data={data} />}

              {/* (c) 平均との比較 */}
              {it.comparisons && it.comparisons.length > 0 && (
                <ul className="space-y-0.5 pt-1">
                  {it.comparisons.map(c => (
                    <li key={c.label} className="text-small text-ink-2 tabular-nums">
                      {c.label}: <Value sourced={c.value} unit={c.unit} cite={cite} />
                    </li>
                  ))}
                </ul>
              )}

              {/* (d) 30秒解説: 事実の記述 → 「2通りの読み方」の囲み */}
              <div className="pt-1">
                <button
                  type="button"
                  aria-expanded={isOpen(it.key)}
                  aria-controls={panelId}
                  onClick={() => setOpen(o => ({ ...o, [it.key]: !isOpen(it.key) }))}
                  className="h-11 px-4 rounded-field bg-card text-ink border border-border-input hover:bg-surface text-small focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
                >
                  {isOpen(it.key) ? EXPLAIN_CLOSE : EXPLAIN_BUTTON}
                </button>
                {isOpen(it.key) && (
                  <div id={panelId} className="mt-3 max-w-[42rem]">
                    <div className="space-y-2">
                      {facts.map((p, i) => (
                        <TermGroup key={`f${i}`} id={`lab-term-${it.key}-f${i}`}>
                          <p className="text-body text-ink-2"><Pieces pieces={p} /></p>
                        </TermGroup>
                      ))}
                    </div>
                    <Readings items={readings.map((p, i) => <TermGroup key={`r${i}`} id={`lab-term-${it.key}-r${i}`}><Pieces pieces={p} /></TermGroup>)} />
                  </div>
                )}
              </div>
            </div>
          )
        })}

        {/* 注記（法務が要求する注記＝弱めない・畳まない。text-caption text-muted が底）。出所の一覧はページ下部の「出典」（CitationList） */}
        <figcaption className="mx-4 border-t border-border py-3 text-caption text-muted">
          <p>{SOURCE_NOTE}</p>
        </figcaption>
      </figure>
    </section>
  )
}
