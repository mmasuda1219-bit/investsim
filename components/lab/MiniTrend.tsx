'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { fyLabel } from '@/lib/lab/9983'
import { lineGeometry, signColor } from '@/lib/lab/display'
import { formatByUnit } from '@/lib/lab/money'
import type { FyKey, Unit } from '@/lib/lab/types'

/**
 * 5期の小さな折れ線（/study 画面2・2026-10-09・S-A）。components/stocks/YearBars.tsx の作法を折れ線に移植。コードは流用しない。
 * **比率（%・倍）用**。金額は components/lab/YearBarsLab.tsx（棒）。
 * 色が無くても正負が分かる形で描く（4重の手がかり・DECISIONS 2026-10-09 (3)）。LAB_SIGN_COLOR が true のときは点の色を signColor で足す（手がかりは外さない）:
 *   位置 … ゼロの基準線（--axis）を引き、マイナスの期は線より下へ。正負で同じ倍率（lib/lab/display.ts の lineGeometry）
 *   形   … プラス＝中空の点（面 --card・輪郭 --ink）／マイナス＝--ink の塗りの点
 *   符号 … 値ラベルは U+2212（lib/lab/money.ts）
 *   語   … aria-label に「（マイナス）」
 *   欠損 … 点を描かず、ゼロ線上に「—」。線はそこで切る
 *
 *  - 期ラベルは最下段に固定。`2026年8月期`。狭くて重なるなら `26年8月期`
 *  - 直接の値ラベルは最新の期だけ。水平のグリッド線はゼロ線だけ
 *  - 高さ 72px・幅 100% の inline SVG。幅は ResizeObserver で測り viewBox を px にそろえる
 *  - `role="img"`＋同じ内容の `aria-label`
 *  - --success／--danger／生の色は使わない（scripts/check-lab-9983.ts (d)(j)）
 */

export interface MiniTrendPoint {
  fy: FyKey
  value: number | null
  /** value が null のときの理由（会社未開示 など） */
  missing?: string
}

export interface MiniTrendProps {
  /** 項目名（aria-label に使う） */
  label: string
  unit: Unit
  points: MiniTrendPoint[]
  /** 幅を測る前に使う px（既定 640）。検査・静的描画で実寸を再現するためのもの */
  initialWidth?: number
}

/** 図全体の高さ */
export const H = 72
/** 最新の期の値ラベルの行 */
const TOP = 14
/** 期ラベルの行（最下段に固定） */
const LABEL_H = 16
/** 線を描く高さ */
export const PLOT_H = H - TOP - LABEL_H
const PADX = 8
const R = 3.5

/** 11px の文字のおおよその幅（全角 11px・半角 6.5px）。期ラベルがぶつかるかの見積もりにだけ使う */
function approxWidth(s: string): number {
  let w = 0
  for (const ch of s) w += ch.charCodeAt(0) > 0x2000 ? 11 : 6.5
  return w
}

/** aria-label の文（検査が同じ文を期待する） */
export function miniTrendAria(label: string, unit: Unit, points: MiniTrendPoint[]): string {
  return (
    `${label}の${points.length}期の折れ線。` +
    points.map(p => {
      if (p.value == null) return `${fyLabel(p.fy)} は${p.missing ?? '取れていません'}`
      return `${fyLabel(p.fy)} ${formatByUnit(p.value, unit)}${p.value < 0 ? '（マイナス）' : ''}`
    }).join('、') +
    '。横の線が 0 で、マイナスの期は線より下に塗りつぶした点で描いています。'
  )
}

export function MiniTrend({ label, unit, points, initialWidth = 640 }: MiniTrendProps) {
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
  const cx = (i: number) => (n === 1 ? PADX + usable / 2 : PADX + (usable * i) / (n - 1))

  const values = points.map(p => p.value)
  const geo = lineGeometry(values, PLOT_H)
  const zeroY = TOP + geo.zeroY
  const ys = geo.ys.map(y => (y == null ? null : TOP + y))
  // 期ラベルがぶつかるかは、描く位置（最初の期は左寄せ・最後の期は右寄せ・間は中央）から各ラベルの左右の端を見積もって決める。
  // 間隔だけで見ると、左寄せの最初のラベルと中央寄せの2つ目が重なるのを見落とす（2026-10-09 撮影で発覚）
  const extents = (shortForm: boolean) =>
    points.map((p, i) => {
      const w = approxWidth(fyLabel(p.fy, shortForm))
      const x = cx(i)
      if (n > 1 && i === 0) return [x, x + w]
      if (n > 1 && i === n - 1) return [x - w, x]
      return [x - w / 2, x + w / 2]
    })
  const collide = (ex: number[][], step: number) => {
    const shown = ex.map((e, i) => [i, e] as const).filter(([i]) => i % step === 0).map(([, e]) => e)
    return shown.some((e, k) => k > 0 && e[0] < shown[k - 1][1] + 6)
  }
  // 長い形 → ぶつかれば短い形（26年8月期）→ それでもぶつかれば 1 つおき（aria-label は全部の期を読む）
  const short = collide(extents(false), 1)
  const labelStep = short && collide(extents(true), 1) ? 2 : 1

  // 連続する点だけを線でつなぐ（欠損で切る）
  const segments: string[] = []
  let current: string[] = []
  ys.forEach((y, i) => {
    if (y == null) { if (current.length > 1) segments.push(current.join(' ')); current = []; return }
    current.push(`${cx(i)},${y}`)
  })
  if (current.length > 1) segments.push(current.join(' '))

  let lastIdx = -1
  for (let i = points.length - 1; i >= 0; i--) if (points[i].value != null) { lastIdx = i; break }
  const latest = lastIdx >= 0 ? points[lastIdx].value : null

  const labelStyle = { fontSize: 11, fontVariantNumeric: 'tabular-nums' as const }

  return (
    <div ref={wrapRef} role="img" aria-label={miniTrendAria(label, unit, points)}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden="true" focusable="false" className="block overflow-visible">
        {/* ゼロの基準線（グリッド線はこれ 1 本だけ） */}
        <line x1={PADX} x2={PADX + usable} y1={zeroY} y2={zeroY} stroke="var(--axis)" strokeWidth={1} />

        {segments.map((pts, i) => (
          <polyline key={i} points={pts} fill="none" stroke="var(--ink)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        ))}

        {points.map((p, i) => {
          const x = cx(i)
          const y = ys[i]
          if (y == null || p.value == null) {
            return (
              <text key={p.fy} x={x} y={zeroY} dominantBaseline="middle" textAnchor="middle" fill="var(--muted)" style={labelStyle}>—</text>
            )
          }
          // 色は足すだけ（LAB_SIGN_COLOR）。形（中空／塗り）はそのまま
          const color = signColor(p.value) ?? 'var(--ink)'
          return p.value < 0 ? (
            <circle key={p.fy} cx={x} cy={y} r={R} fill={color} />
          ) : (
            <circle key={p.fy} cx={x} cy={y} r={R} fill="var(--card)" stroke={color} strokeWidth={1.5} />
          )
        })}

        {/* 直接の値ラベルは最新の期だけ。プラスは点の上、マイナスは点の下 */}
        {latest != null && lastIdx >= 0 && ys[lastIdx] != null && (() => {
          const y = ys[lastIdx] as number
          const ty = latest < 0 ? Math.min(H - LABEL_H - 2, y + 14) : Math.max(10, y - 7)
          const x = cx(lastIdx)
          const anchor = n > 1 && lastIdx === n - 1 ? 'end' : 'middle'
          return (
            <text x={x} y={ty} textAnchor={anchor} fill="var(--ink)" style={labelStyle}>{formatByUnit(latest, unit)}</text>
          )
        })()}

        {/* 期ラベル（最下段に固定）。端の期は内側へ寄せて切れないようにする。狭ければ 1 つおき */}
        {points.map((p, i) => (i % labelStep !== 0 ? null : (
          <text
            key={p.fy}
            x={cx(i)}
            y={H - 3}
            textAnchor={n > 1 && i === 0 ? 'start' : n > 1 && i === n - 1 ? 'end' : 'middle'}
            fill="var(--muted)"
            style={labelStyle}
          >
            {fyLabel(p.fy, short)}
          </text>
        )))}
      </svg>
    </div>
  )
}
