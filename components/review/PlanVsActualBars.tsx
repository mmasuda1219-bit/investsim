'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { SERIES } from '@/components/chartTheme'
import type { PlannedHold } from '@/lib/review/planned-hold'

/**
 * 「言ったこと vs やったこと」の上段（/review/[recordId] §4・S3a・2026-09-30）。
 * 予定していた期間（点線のバー）と、実際に持っていた期間（実線のバー）を同じ横軸に並べる。
 *
 *  - **予定が読めたときだけ描く**（`parsePlannedHold` が null ならページ側が「予定していた期間は、書かれた文からは読み取れません。」を出す。
 *    この部品は planned を必須に受け、描けない状態を持たない）
 *  - 2系列なので直接ラベル（バーの右端に「予定 3年」「実際 45日」）と凡例の両方を出す
 *  - 色は `SERIES.you` の1色（実際）と `--muted`（予定・点線）。良し悪しの色は無い。長い／短いを評価しない
 *  - 高さ 80px（横軸の両端のラベルが1行に収まらない幅では 92px）・幅 100% の inline SVG。幅は ResizeObserver で測り viewBox を px にそろえる（PriceSincePanel と同じ）
 *  - `role="img"`＋同じ内容の `aria-label`
 *  - 時計を持たない。保有中の右端に使う「今日」はページが渡す
 * 検査: scripts/check-review-record.ts。
 */

export interface PlanVsActualBarsProps {
  planned: PlannedHold
  entryAt: number
  /** 売った時刻（分割して売ったときは最後の売り）。保有中は null */
  exitAt: number | null
  /** 保有中のとき、実際のバーの右端に使う時刻（ms）。ページが渡す */
  today: number
  /** 幅を測る前に使う px（既定 640）。検査・静的描画で実寸を再現するためのもの */
  initialWidth?: number
}

/** 図の高さ。横軸の両端のラベルが1行に収まらないとき（390px 幅）は右端のラベルを2行目に落とし、その分だけ高くする */
const H_BASE = 80
const H_TWO_LINES = 92
const DAY_MS = 86_400_000
const PADX = 2
/** 右側にラベルのために空ける幅 */
const LABEL_W = 132
const BAR_H = 12
const Y_PLAN = 12
const Y_ACTUAL = 34
const Y_AXIS = 60

function ymd(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** 11px の文字のおおよその幅（全角 11px・半角 6.5px）。両端のラベルがぶつかるかの見積もりにだけ使う */
function approxWidth(s: string): number {
  let w = 0
  for (const ch of s) w += ch.charCodeAt(0) > 0x2000 ? 11 : 6.5
  return w
}

export function PlanVsActualBars({ planned, entryAt, exitAt, today, initialWidth = 640 }: PlanVsActualBarsProps) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(initialWidth)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(entries => {
      const w = Math.round(entries[0]?.contentRect.width ?? 0)
      if (w > 0) setWidth(w)
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const open = exitAt === null
  const actualEnd = open ? today : exitAt
  const actualDays = Math.max(0, Math.round((actualEnd - entryAt) / DAY_MS))
  const maxDays = Math.max(planned.days, actualDays, 1)

  const W = width
  const usable = Math.max(40, W - PADX * 2 - LABEL_W)
  const xOf = (days: number) => PADX + (days / maxDays) * usable
  const planW = Math.max(2, xOf(planned.days) - PADX)
  const actualW = Math.max(2, xOf(actualDays) - PADX)

  const planLabel = `予定 ${planned.label}（${planned.days.toLocaleString()}日）`
  const actualLabel = `実際 ${actualDays.toLocaleString()}日${open ? '（保有中）' : ''}`
  const leftTick = `買った日 ${ymd(entryAt)}`
  const rightTick =
    planned.days >= actualDays
      ? `予定の終わり ${ymd(entryAt + planned.days * DAY_MS)}`
      : open
        ? `今日 ${ymd(actualEnd)}`
        : `売った日 ${ymd(actualEnd)}`

  const aria =
    `予定していた期間 ${planned.label}（${planned.days}日）と、実際に持っていた期間 ${actualDays}日${open ? '（保有中）' : ''}を同じ横軸で並べた図。` +
    `横軸は買った日 ${ymd(entryAt)} から ${rightTick} まで。`

  const labelStyle = { fontSize: 11, fontVariantNumeric: 'tabular-nums' as const }
  // 両端のラベルが軸の長さに収まらなければ、右端のラベルを2行目に落とす（重ねて読めなくしない）
  const collide = approxWidth(leftTick) + approxWidth(rightTick) + 8 > usable
  const H = collide ? H_TWO_LINES : H_BASE
  const rightTickY = collide ? Y_AXIS + 26 : Y_AXIS + 14

  return (
    <figure role="img" aria-label={aria} className="space-y-2">
      <div ref={wrapRef}>
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden="true" focusable="false" className="block overflow-visible">
          {/* 予定: 点線の枠だけ（塗らない） */}
          <rect x={PADX} y={Y_PLAN} width={planW} height={BAR_H} rx={2} fill="none" stroke="var(--muted)" strokeWidth={1.5} strokeDasharray="4 3" />
          <text x={PADX + planW + 6} y={Y_PLAN + BAR_H - 2} fill="var(--ink)" style={labelStyle}>{planLabel}</text>

          {/* 実際: 実線の塗り（SERIES.you） */}
          <rect x={PADX} y={Y_ACTUAL} width={actualW} height={BAR_H} rx={2} fill={SERIES.you.color} />
          <text x={PADX + actualW + 6} y={Y_ACTUAL + BAR_H - 2} fill="var(--ink)" style={labelStyle}>{actualLabel}</text>

          {/* 横軸: 左端（買った日）と右端（予定の終わり／売った日／今日）だけ。目盛り線は無い */}
          <line x1={PADX} x2={PADX + usable} y1={Y_AXIS} y2={Y_AXIS} stroke="var(--border)" strokeWidth={1} />
          <line x1={PADX} x2={PADX} y1={Y_AXIS - 3} y2={Y_AXIS + 3} stroke="var(--muted)" strokeWidth={1} />
          <line x1={PADX + usable} x2={PADX + usable} y1={Y_AXIS - 3} y2={Y_AXIS + 3} stroke="var(--muted)" strokeWidth={1} />
          <text x={PADX} y={Y_AXIS + 14} fill="var(--muted)" style={labelStyle}>{leftTick}</text>
          <text x={PADX + usable} y={rightTickY} textAnchor="end" fill="var(--muted)" style={labelStyle}>{rightTick}</text>
        </svg>
      </div>
      {/* 凡例（2系列なので必須）。直接ラベルと両方出す */}
      <figcaption className="flex flex-wrap gap-x-4 gap-y-1 text-caption text-muted">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-5 rounded-[2px] border border-dashed border-muted" />
          予定していた期間（書かれた文から読み取った）
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-2.5 w-5 rounded-[2px]" style={{ background: SERIES.you.color }} />
          実際に持っていた期間
        </span>
      </figcaption>
    </figure>
  )
}
