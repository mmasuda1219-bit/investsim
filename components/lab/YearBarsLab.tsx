'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { fyLabel } from '@/lib/lab/9983'
import { barGeometryLab, signColor } from '@/lib/lab/display'
import { formatByUnit } from '@/lib/lab/money'
import type { FyKey, Unit } from '@/lib/lab/types'

/**
 * 5期の棒グラフ（/study 画面2・2026-10-09 オーナー指示「棒グラフなども」）。**金額（百万円・円）はこれ、比率は MiniTrend（折れ線）**。
 * components/stocks/YearBars.tsx の考え方（ゼロ線・正負で同じ倍率・最新の期だけ値ラベル・role="img"＋aria-label）を踏襲し、
 * コードは流用しない（YearBars は `$` 固定で円に使えない。components/stocks/** は変更禁止）。
 *
 * 手がかりは4重（色は足すだけで外さない）:
 *   位置 … ゼロの基準線（--axis）。マイナスの期は線より下へ。正負で同じ倍率（lib/lab/display.ts の barGeometryLab）
 *   形   … プラス＝中空（面 --card・輪郭）／マイナス＝塗り
 *   符号 … 値ラベルは U+2212（lib/lab/money.ts）
 *   語   … aria-label に「（マイナス）」
 *   色   … LAB_SIGN_COLOR が true のとき輪郭・塗りを signColor（--success／--danger）に。false なら --ink
 *
 *  - 欠損は棒を描かず、ゼロ線上に「—」
 *  - 期ラベルは最下段に固定。`2026年8月期`。狭ければ `26年8月期`、それでもぶつかれば 1 つおき（aria-label は全部の期を読む）
 *  - 高さ 88px・幅 100% の inline SVG。幅は ResizeObserver で測り viewBox を px にそろえる
 *  - --success／--danger の文字列はここに書かない（lib/lab/display.ts の signColor 経由だけ。scripts/check-lab-9983.ts (d)）
 */

export interface YearBarsLabPoint {
  fy: FyKey
  value: number | null
  /** value が null のときの理由（会社未開示 など） */
  missing?: string
}

export interface YearBarsLabProps {
  /** 項目名（aria-label に使う） */
  label: string
  unit: Unit
  points: YearBarsLabPoint[]
  /** 幅を測る前に使う px（既定 640）。検査・静的描画で実寸を再現するためのもの */
  initialWidth?: number
}

/** 図全体の高さ */
export const H = 88
/** 最新の期の値ラベルの行 */
const TOP = 14
/** 期ラベルの行（最下段に固定） */
const LABEL_H = 16
/** 棒を描く高さ */
export const PLOT_H = H - TOP - LABEL_H
const PADX = 2
const MAX_BAR_W = 36
const MIN_BAR_W = 8

/** 11px の文字のおおよその幅（全角 11px・半角 6.5px）。期ラベルがぶつかるかの見積もりにだけ使う */
function approxWidth(s: string): number {
  let w = 0
  for (const ch of s) w += ch.charCodeAt(0) > 0x2000 ? 11 : 6.5
  return w
}

/** aria-label の文（検査が同じ文を期待する） */
export function yearBarsLabAria(label: string, unit: Unit, points: YearBarsLabPoint[]): string {
  return (
    `${label}の${points.length}期の棒グラフ。` +
    points.map(p => {
      if (p.value == null) return `${fyLabel(p.fy)} は${p.missing ?? '取れていません'}`
      return `${fyLabel(p.fy)} ${formatByUnit(p.value, unit)}${p.value < 0 ? '（マイナス）' : ''}`
    }).join('、') +
    '。横の線が 0 で、マイナスの期は線より下に塗りつぶしで描いています。'
  )
}

export function YearBarsLab({ label, unit, points, initialWidth = 640 }: YearBarsLabProps) {
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

  const n = Math.max(1, points.length)
  const W = width
  const usable = Math.max(40, W - PADX * 2)
  const colW = usable / n
  const barW = Math.max(MIN_BAR_W, Math.min(MAX_BAR_W, colW * 0.45))
  const cx = (i: number) => PADX + colW * (i + 0.5)

  const values = points.map(p => p.value)
  const geo = barGeometryLab(values, PLOT_H)
  const zeroY = TOP + geo.zeroY
  // 期ラベル: 長い形 → ぶつかれば短い形 → それでもぶつかれば 1 つおき
  const short = points.some(p => approxWidth(fyLabel(p.fy)) + 8 > colW)
  const labelStep = short && points.some(p => approxWidth(fyLabel(p.fy, true)) + 8 > colW) ? 2 : 1

  let lastIdx = -1
  for (let i = points.length - 1; i >= 0; i--) if (points[i].value != null) { lastIdx = i; break }
  const latest = lastIdx >= 0 ? points[lastIdx].value : null

  const labelStyle = { fontSize: 11, fontVariantNumeric: 'tabular-nums' as const }

  return (
    <div ref={wrapRef} role="img" aria-label={yearBarsLabAria(label, unit, points)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden="true" focusable="false" className="block overflow-visible">
        {/* ゼロの基準線（グリッド線はこれ 1 本だけ） */}
        <line x1={PADX} x2={PADX + usable} y1={zeroY} y2={zeroY} stroke="var(--axis)" strokeWidth={1} />

        {geo.bars.map((b, i) => {
          const x = cx(i)
          const p = points[i]
          if (b === null || p.value == null) {
            return (
              <text key={p.fy} x={x} y={zeroY} dominantBaseline="middle" textAnchor="middle" fill="var(--muted)" style={labelStyle}>—</text>
            )
          }
          // 0 に近い値でも「ある」ことが見えるよう 1px は描く（値そのものは上の数字と aria-label が運ぶ）
          const h = b.h > 0 ? Math.max(1, b.h) : 0
          if (h === 0) return null
          const y = b.negative ? zeroY : zeroY - h
          const color = signColor(p.value) ?? 'var(--ink)'
          return b.negative ? (
            <rect key={p.fy} x={x - barW / 2} y={y} width={barW} height={h} fill={color} />
          ) : (
            <rect key={p.fy} x={x - barW / 2} y={y} width={barW} height={h} fill="var(--card)" stroke={color} strokeWidth={1.5} />
          )
        })}

        {/* 直接の値ラベルは最新の期だけ。プラスは棒の上、マイナスはゼロ線の上（棒は下に伸びるので） */}
        {latest != null && lastIdx >= 0 && (() => {
          const b = geo.bars[lastIdx]
          const barTop = b && !b.negative ? zeroY - Math.max(1, b.h) : zeroY
          const y = (b && !b.negative && b.h > 0 ? barTop : zeroY) - 3
          return (
            <text x={cx(lastIdx)} y={Math.max(10, y)} textAnchor="middle" fill="var(--ink)" style={labelStyle}>
              {formatByUnit(latest, unit)}
            </text>
          )
        })()}

        {/* 期ラベル（最下段に固定） */}
        {points.map((p, i) => (i % labelStep !== 0 ? null : (
          <text key={p.fy} x={cx(i)} y={H - 3} textAnchor="middle" fill="var(--muted)" style={labelStyle}>{fyLabel(p.fy, short)}</text>
        )))}
      </svg>
    </div>
  )
}
