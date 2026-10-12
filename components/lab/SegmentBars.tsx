'use client'

import { useMemo } from 'react'
import { SERIES } from '@/components/chartTheme'
import { CitationMark } from '@/components/lab/CitationMark'
import { LAB_9983, type LabData } from '@/lib/lab/9983'
import { citationIndex, citeOf } from '@/lib/lab/citations'
import { segmentShare, signStyle } from '@/lib/lab/display'
import { formatMillionYen, formatSignedPercent } from '@/lib/lab/money'

/**
 * セグメント別売上の横棒（/lab/9983 画面2・2026-10-09 オーナー指示「色や棒グラフなども」）。
 * 棒の長さ＝売上収益の合計に対する構成比（会社の概数から計算した目安）。
 *
 *  - 色は components/chartTheme.ts の SERIES の4色（you 青／ai 紫／master 橙／baseline 灰）。色覚の検査（scripts/check-chart-palette.ts）を
 *    通った、互いに見分けられる4色。chartTheme.ts は変更せず使うだけ。生の16進色はここに書かない
 *  - 色だけに頼らない: 各棒の横に名前と構成比（%）を文字で書く。前期比・金額も文字
 *  - 390px では名前・%・棒を縦に積む（潰さない）。md 以上は 1 行
 *  - 前期比の色は lib/lab/display.ts の signStyle 経由だけ
 *  - 出所は金額・前期比の右肩の [N]（CitationMark）。「出所: …」の行は出さない（2026-10-12 オーナーの読みやすさの指示 (a)）
 */

/** セグメント key → 系列（色） */
export const SEGMENT_SERIES: Readonly<Record<string, keyof typeof SERIES>> = {
  domestic: 'you',
  overseas: 'ai',
  gu: 'master',
  globalBrands: 'baseline',
}

export const SEGMENT_BARS_LEAD = '横棒の長さは、売上収益の合計に対する構成比（会社の概数から計算した目安）です。'

export function SegmentBars({ data = LAB_9983 }: { data?: LabData }) {
  const segs = data.segments
  const index = useMemo(() => citationIndex(data), [data])
  if (segs.length === 0) return null
  return (
    <div className="space-y-2 pt-1" data-segment-bars="">
      <p className="text-caption text-muted">{SEGMENT_BARS_LEAD}</p>
      <ul className="space-y-2">
        {segs.map(sg => {
          const share = segmentShare(data, sg.key)
          const color = SERIES[SEGMENT_SERIES[sg.key] ?? 'baseline'].color
          return (
            <li key={sg.key} className="space-y-1" data-segment={sg.key}>
              <div className="flex flex-col gap-y-1 md:flex-row md:items-center md:gap-x-3">
                <span className="text-small font-semibold text-ink md:w-36 md:shrink-0">{sg.label}</span>
                <div className="flex items-center gap-x-2 md:flex-1">
                  <div className="h-5 flex-1 rounded-field bg-surface" aria-hidden="true">
                    <div className="h-5 rounded-field" style={{ width: `${Math.max(1, share ?? 0)}%`, backgroundColor: color }} />
                  </div>
                  <span className="text-small text-ink tabular-nums w-14 shrink-0">{share != null ? `約${share}%` : '—'}</span>
                </div>
              </div>
              <p className="flex flex-wrap items-baseline gap-x-2 text-small tabular-nums md:pl-[9.75rem]">
                <span className="text-ink-2">
                  <span data-sourced="">{formatMillionYen(sg.curr.value)}</span>
                  <CitationMark n={citeOf(index, sg.curr)} />
                </span>
                <span className="text-ink-2">
                  前期比 <span className={signStyle(sg.yoy.value) || undefined} data-sourced="">{formatSignedPercent(sg.yoy.value)}</span>
                  <CitationMark n={citeOf(index, sg.yoy)} />
                </span>
                {sg.yoy.value < 0 && <span className="text-muted">マイナス</span>}
              </p>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
