'use client'

import { useMemo } from 'react'
import { CitationMark } from '@/components/lab/CitationMark'
import { Readings } from '@/components/lab/Readings'
import { Pieces } from '@/components/lab/RichText'
import { TermGroup } from '@/components/lab/Term'
import { LAB_9983, fyLabel, type LabData } from '@/lib/lab/9983'
import { citationIndex, citeOf, citeOfRef } from '@/lib/lab/citations'
import { labVarEntries, latestPair, signStyle, yoyRatio, yoyText } from '@/lib/lab/display'
import { formatByUnit, formatSignedPercent, formatSignedYen, formatTimes, formatYen } from '@/lib/lab/money'
import { richParagraphs, splitTerms, termTokens } from '@/lib/lab/rich'
import type { SourceRef, Sourced } from '@/lib/lab/types'

/**
 * 画面3「つなげる」（/lab/9983・2026-10-09・S-A → 同日オーナー指示で矢印）: 売上収益 → 営業利益 → 純利益 → EPS → 株価。
 *
 *  - **流れの矢印**（SVG の線＋三角の先端）で箱をつなぐ。広い画面（lg 以上＝1024px〜）は横一列、狭い画面は縦に積んで下向き。
 *    矢印の上（縦のときは横）に「何を引いたか」のラベル。文字の矢印（→・↑・↓・▲・▼）は使わない
 *  - DESIGN.md R2 が禁じるのは「上向き矢印・右肩上がりの飾り」＝成績が良いことを示す矢印。ここは「売上が営業利益に**なる**」という
 *    流れの矢印で別物（MC 2026-10-09。DECISIONS は MC が追記）
 *  - 各箱に当期の値・期・前期比（数字に signStyle の色。LAB_SIGN_COLOR）。箱は --card＋--border の面を横に並べる
 *    （外側の囲いは付けない＝入れ子にしない）
 *  - **出所は数字の右肩の [N]（CitationMark）**（2026-10-12 オーナーの読みやすさの指示 (a)）。figcaption の出所の行は消し、免責の文（CHAIN_NOTE）だけ残す
 *  - **株価の箱は実際の終値（出典つき）だけ。EPS × PER の積を株価として描かない**（DECISIONS 2026-10-09 (7)）。
 *    PER は「株価から計算した数字」として株価の箱の中に出す（注記は「出典」の一覧へ）
 *  - 売上の箱の下にセグメント内訳（前期比）
 *  - 図の下の読み方は、事実の記述＋**「2通りの読み方」の囲み（Readings）**（同 (c)）。lib/lab/9983.ts の EXPLAIN_CHAIN。結論を書かない
 *  - **箱のラベル（売上収益・営業利益・純利益・EPS・株価）と、図の下の事実の文・読み方の用語は囲み（Term）**（同 (d)）。
 *    この節の中で初出だけ（箱のラベルで囲んだ語は下の文でもう囲まない）。矢印の上のラベル（「− 原価…」）は用語ではなく操作の説明なので囲まない。
 *    囲みは <button>（スマホで触っても開く・2026-10-12）。押すと説明の箱が段落の直下に出るので、箱のラベル・事実の各段落・読み方の各項目を TermGroup で包む
 *  - --success／--danger の文字列はここに書かない（lib/lab/display.ts の signStyle 経由だけ）
 * 検査: scripts/check-lab-9983.ts。
 */

const TOKENS = termTokens()

export const CHAIN_TITLE = 'つなげる'
export const CHAIN_LEAD = '売上から株価までの数字がどうつながるかを、1本の流れで見ます。矢印は「次の数字になる」という流れで、矢印の上にあるのは途中で引かれるものです。各箱は当期の値と前期比です。'
export const PRICE_NOTE = 'PER は、株価を EPS で割って出した数字です（株価から計算した数字）。この図は EPS に PER を掛けて株価を作ることはしません。'
export const CHAIN_NOTE = '各箱の数字は会社の開示と日経の実物です（出典は数字の右肩の番号）。矢印は数字の流れを表すもので、良し悪しを表しません。当社の分析や評価は含まれていません。将来を予測するものではありません。'

/** 前期比・前日比の1つの数字と、その出典の番号 */
export interface ChainYoyValue {
  text: string
  cite: number | null
}

export interface ChainNode {
  key: string
  label: string
  valueText: string
  /** 値の出典の番号（出典の一覧の [N]） */
  cite: number | null
  /** 値の期（値のラベル側に置く。レビュー S1） */
  periodText: string
  /** 前期比（前日比）の1文: 「前期比 」＋数字（出典つき）。出せないときは null */
  yoy: { prefix: string; values: ChainYoyValue[] } | null
  /** 前期比の符号（signStyle 用。null なら付けない） */
  yoyValue: number | null
  /** 次の箱へのつなぎ（何を引いたか）。矢印の上に載せる */
  link?: string
}

/** 図の箱（純関数。検査が同じものを読む） */
export function chainNodes(data: LabData = LAB_9983): ChainNode[] {
  const index = citationIndex(data)
  const cite = (s: Sourced<unknown> | null | undefined): number | null => (s ? citeOf(index, s) : null)
  const node = (key: string, series: typeof data.sales, link?: string): ChainNode => {
    const { curr } = latestPair(series)
    const v = curr?.value
    const yoy = yoyText(series)
    return {
      key,
      label: series.label,
      valueText: v ? formatByUnit(v.value, series.unit) : '—',
      cite: cite(v),
      periodText: curr ? fyLabel(curr.fy) : '',
      yoy: yoy ? { prefix: '前期比 ', values: [{ text: yoy, cite: series.yoy ? cite(series.yoy) : null }] } : null,
      yoyValue: series.yoy ? series.yoy.value : yoyRatio(series),
      link,
    }
  }
  const price = data.price
  return [
    node('sales', data.sales, '− 原価・販売費・一般管理費'),
    node('operatingProfit', data.operatingProfit, '− 金利・税金・その他'),
    node('netProfit', data.netProfit, '÷ 発行済み株式数'),
    node('eps', data.eps, '株価 ÷ EPS ＝ PER（PER は株価から計算した数字）'),
    {
      key: 'price',
      label: '株価（終値）',
      valueText: formatYen(price.close.value),
      cite: cite(price.close),
      periodText: price.closeDate,
      yoy: {
        prefix: '前日比 ',
        values: [
          { text: formatSignedYen(price.changeYen.value), cite: cite(price.changeYen) },
          { text: formatSignedPercent(price.changePct.value), cite: cite(price.changePct) },
        ],
      },
      yoyValue: price.changePct.value,
    },
  ]
}

/**
 * 流れの矢印（SVG の線＋三角の先端）。lg 以上は右向き・未満は下向き。aria-hidden（流れの意味は箱の並びとラベルの文が運ぶ）。
 * 色は --ink（成績の色ではない）。
 */
export function FlowArrow({ label }: { label: string }) {
  return (
    <div className="shrink-0 flex items-center gap-x-2 py-1 lg:flex-col lg:items-center lg:justify-center lg:gap-y-1 lg:w-[6.5rem] lg:self-center lg:py-0" data-flow-arrow="">
      {/* 下向き（狭い画面） */}
      <svg className="lg:hidden" width="20" height="40" viewBox="0 0 20 40" aria-hidden="true" focusable="false">
        <line x1="10" y1="0" x2="10" y2="30" stroke="var(--ink)" strokeWidth="1.5" />
        <polygon points="4,29 10,40 16,29" fill="var(--ink)" />
      </svg>
      <span className="text-caption text-muted lg:text-center lg:order-first">{label}</span>
      {/* 右向き（広い画面） */}
      <svg className="hidden lg:block" width="96" height="20" viewBox="0 0 96 20" aria-hidden="true" focusable="false">
        <line x1="0" y1="10" x2="85" y2="10" stroke="var(--ink)" strokeWidth="1.5" />
        <polygon points="84,3 96,10 84,17" fill="var(--ink)" />
      </svg>
    </div>
  )
}

/** 数字＋[N]（出典が無い数字は番号なし） */
function Cited({ text, cite, className }: { text: string; cite: number | null; className?: string }) {
  return (
    <>
      <span className={className} data-sourced={cite != null ? '' : undefined}>{text}</span>
      {cite != null && <CitationMark n={cite} />}
    </>
  )
}

export function CausalMap({ data = LAB_9983, heading = true }: { data?: LabData; heading?: boolean }) {
  const nodes = chainNodes(data)
  const index = useMemo(() => citationIndex(data), [data])
  const vars = useMemo(() => labVarEntries(data), [data])
  const cite = (s: Sourced<unknown>) => citeOf(index, s)
  const citeRef = (s: SourceRef | null) => citeOfRef(index, s)
  const segs = data.segments
  const per = data.price.forwardPer
  const perT = data.price.trailingPer
  // 用語の囲み: 箱のラベル → 事実の文 → 読み方 の順に、この節の中で初出だけ
  const seen = new Set<string>()
  const labelPieces = nodes.map(n => splitTerms(n.label, TOKENS, seen))
  const paras = richParagraphs([...data.explainChain.facts, ...data.explainChain.readings], vars, citeRef, TOKENS, seen)
  const facts = paras.slice(0, data.explainChain.facts.length)
  const readings = paras.slice(data.explainChain.facts.length)
  return (
    <section className="space-y-3" data-section="lab-chain">
      {heading && <h2 className="text-h2 text-ink">{CHAIN_TITLE}</h2>}
      <p className="text-small text-muted max-w-[42rem]">{CHAIN_LEAD}</p>

      {/* lg 以上（1024px〜）は親（max-w-3xl）より広く取り、5つの箱を横一列に（画面幅 − 4rem・上限 72rem・中央寄せ）。
          md（768px）で横一列にすると箱が 141px になり数字が折り返して節が 2,441px まで伸びたので、切り替えを lg に上げた（MC 実測 2026-10-11）。 */}
      <figure className="space-y-3 lg:relative lg:left-1/2 lg:w-[calc(100vw-4rem)] lg:max-w-[72rem] lg:-translate-x-1/2">
        <ol className="flex flex-col lg:flex-row lg:items-start">
          {nodes.map((n, i) => (
            <li key={n.key} className="flex flex-col lg:flex-row lg:flex-1 lg:min-w-0" data-chain-node={n.key}>
              <div className="flex-1 min-w-0 bg-card rounded-card border border-border px-3 py-3 space-y-1">
                <TermGroup id={`lab-chain-${n.key}-label`}>
                  <p className="text-small font-semibold text-ink" data-chain-label=""><Pieces pieces={labelPieces[i]} /></p>
                </TermGroup>
                <p className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-h3 text-ink tabular-nums"><Cited text={n.valueText} cite={n.cite} /></span>
                  {n.periodText && <span className="text-caption text-muted tabular-nums">{n.periodText}</span>}
                </p>
                {n.yoy && (
                  <p className="text-small text-ink-2 tabular-nums">
                    {n.yoy.prefix}
                    {n.yoy.values.map((v, k) => (
                      <span key={k}>
                        {k > 0 && '・'}
                        <Cited text={v.text} cite={v.cite} className={signStyle(n.yoyValue ?? 0) || undefined} />
                      </span>
                    ))}
                  </p>
                )}

                {n.key === 'sales' && segs.length > 0 && (
                  <div className="pt-1 space-y-1">
                    <p className="text-caption text-muted">内訳（セグメント別・前期比）</p>
                    <ul className="space-y-0.5">
                      {segs.map(sg => (
                        <li key={sg.key} className="flex flex-wrap items-baseline gap-x-2 text-small text-ink-2 tabular-nums">
                          <span>{sg.label}</span>
                          <span className="text-ink">
                            <Cited text={formatSignedPercent(sg.yoy.value)} cite={cite(sg.yoy)} className={signStyle(sg.yoy.value) || undefined} />
                          </span>
                          {sg.yoy.value < 0 && <span className="text-muted">マイナス</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {n.key === 'price' && (
                  <div className="pt-1 space-y-1">
                    <p className="text-small text-ink-2 tabular-nums">
                      予想PER <Cited text={formatTimes(per.value)} cite={cite(per)} />・実績PER <Cited text={formatTimes(perT.value)} cite={cite(perT)} />
                    </p>
                    <p className="text-caption text-muted">{PRICE_NOTE}</p>
                  </div>
                )}
              </div>

              {n.link && i < nodes.length - 1 && <FlowArrow label={n.link} />}
            </li>
          ))}
        </ol>
        {/* 免責の文だけ（出所の行は 2026-10-12 に「出典」の節へ） */}
        <figcaption className="text-caption text-muted">{CHAIN_NOTE}</figcaption>
      </figure>

      <div className="max-w-[42rem]">
        <div className="space-y-2">
          {facts.map((p, i) => (
            <TermGroup key={`f${i}`} id={`lab-chain-f${i}`}>
              <p className="text-body text-ink-2"><Pieces pieces={p} /></p>
            </TermGroup>
          ))}
        </div>
        <Readings items={readings.map((p, i) => <TermGroup key={`r${i}`} id={`lab-chain-r${i}`}><Pieces pieces={p} /></TermGroup>)} />
      </div>
    </section>
  )
}
