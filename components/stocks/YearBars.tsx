'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { barGeometry, formatValue, signWord, yearLabel, type ValueKind } from '@/lib/statements/display'

/**
 * 「1年ごとの決算」の 1 項目の棒グラフ（/stocks/[symbol]・2026-10-07・designer の設計）。
 * 5 期の値を、色を使わずに正負が分かる形で描く:
 *   位置 … ゼロの基準線（--axis）を引き、マイナスの年は線より下へ。正負で同じ倍率（lib/statements/display.ts の barGeometry）
 *   形   … 黒字＝中空（面 --card・輪郭 --ink 1px）／赤字＝--ink の塗り。既存のローソク足（上げ＝中空・下げ＝塗り）と同じ向き
 *   欠損 … 棒を描かず、ゼロ線上に「—」
 *
 *  - 年ラベルは図の最下段に固定（棒が下向きでも動かさない）。`2025年度`。狭くて重なるなら `25年度`
 *  - 直接の値ラベルは最新年だけ。水平のグリッド線は引かない
 *  - 高さ 88px・幅 100% の inline SVG。幅は ResizeObserver で測り viewBox を px にそろえる（PlanVsActualBars と同じ）
 *  - `role="img"`＋同じ内容の `aria-label`
 *  - --success／--danger／生の色は使わない。語は「赤字」「黒字」だけ
 * 検査: scripts/check-annual-statements.ts。
 */

export interface YearBarsProps {
  /** 項目名（aria-label に使う） */
  label: string
  /** 期末日（YYYY-MM-DD）の昇順 */
  ends: string[]
  /** ends と同じ長さ。欠損は null */
  values: (number | null)[]
  kind: ValueKind
  /** 幅を測る前に使う px（既定 640）。検査・静的描画で実寸を再現するためのもの */
  initialWidth?: number
}

/** 図全体の高さ */
export const H = 88
/** 最新年の値ラベルの行 */
const TOP = 14
/** 年ラベルの行（最下段に固定） */
const LABEL_H = 16
/** 棒を描く高さ */
export const PLOT_H = H - TOP - LABEL_H
const PADX = 2
const MAX_BAR_W = 36
const MIN_BAR_W = 8

/** 11px の文字のおおよその幅（全角 11px・半角 6.5px）。年ラベルがぶつかるかの見積もりにだけ使う */
function approxWidth(s: string): number {
  let w = 0
  for (const ch of s) w += ch.charCodeAt(0) > 0x2000 ? 11 : 6.5
  return w
}

export function YearBars({ label, ends, values, kind, initialWidth = 640 }: YearBarsProps) {
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

  const n = Math.max(1, ends.length)
  const W = width
  const usable = Math.max(40, W - PADX * 2)
  const colW = usable / n
  const barW = Math.max(MIN_BAR_W, Math.min(MAX_BAR_W, colW * 0.45))
  const cx = (i: number) => PADX + colW * (i + 0.5)

  const geo = barGeometry(values, PLOT_H)
  const zeroY = TOP + geo.zeroY
  // 年ラベルが隣とぶつかるなら短い形（25年度）に落とす
  const short = ends.some(e => approxWidth(yearLabel(e)) + 8 > colW)
  const last = ends.length - 1
  const latest = last >= 0 ? values[last] : null

  const aria =
    `${label}の${ends.length}期の棒グラフ。` +
    ends.map((e, i) => {
      const v = values[i]
      if (v == null) return `${yearLabel(e)} は取れていません`
      const w = signWord(v)
      return `${yearLabel(e)} ${formatValue(v, kind)}${w ? `（${w}）` : ''}`
    }).join('、') +
    '。横の線が 0 で、マイナスの年は線より下に塗りつぶしで描いています。'

  const labelStyle = { fontSize: 11, fontVariantNumeric: 'tabular-nums' as const }

  return (
    <div ref={wrapRef} role="img" aria-label={aria}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden="true" focusable="false" className="block overflow-visible">
        {/* ゼロの基準線（グリッド線はこれ 1 本だけ） */}
        <line x1={PADX} x2={PADX + usable} y1={zeroY} y2={zeroY} stroke="var(--axis)" strokeWidth={1} />

        {geo.bars.map((b, i) => {
          const x = cx(i)
          if (b === null) {
            return (
              <text key={ends[i]} x={x} y={zeroY} dominantBaseline="middle" textAnchor="middle" fill="var(--muted)" style={labelStyle}>—</text>
            )
          }
          // 0 に近い値でも「ある」ことが見えるよう 1px は描く（値そのものは上の数字と aria-label が運ぶ）
          const h = b.h > 0 ? Math.max(1, b.h) : 0
          if (h === 0) return null
          const y = b.negative ? zeroY : zeroY - h
          return b.negative ? (
            <rect key={ends[i]} x={x - barW / 2} y={y} width={barW} height={h} fill="var(--ink)" />
          ) : (
            <rect key={ends[i]} x={x - barW / 2} y={y} width={barW} height={h} fill="var(--card)" stroke="var(--ink)" strokeWidth={1} />
          )
        })}

        {/* 直接の値ラベルは最新年だけ。黒字は棒の上、赤字はゼロ線の上（棒は下に伸びるので） */}
        {latest != null && last >= 0 && (() => {
          const b = geo.bars[last]
          const barTop = b && !b.negative ? zeroY - Math.max(1, b.h) : zeroY
          const y = (b && !b.negative && b.h > 0 ? barTop : zeroY) - 3
          return (
            <text x={cx(last)} y={Math.max(10, y)} textAnchor="middle" fill="var(--ink)" style={labelStyle}>
              {formatValue(latest, kind)}
            </text>
          )
        })()}

        {/* 年ラベル（最下段に固定） */}
        {ends.map((e, i) => (
          <text key={e} x={cx(i)} y={H - 3} textAnchor="middle" fill="var(--muted)" style={labelStyle}>{yearLabel(e, short)}</text>
        ))}
      </svg>
    </div>
  )
}
