'use client'

// 分析の過程の再生（DESIGN.md §6-19）の株価の図。AI が判断時に見ていた3か月の終値（replay-model の AiView）と
// 20日・50日平均線、売買の印を SVG で描く。
//
//  - 幅は ResizeObserver で実寸を測り viewBox を実寸にする（文字が拡大縮小されず、実寸 12px を保つ）
//  - 線の伸長は props.draw.price（0〜1）で決まる比率。時計（useReplayClock）が刻み、ここは描くだけ
//  - 系列色は DESIGN.md §5-1「系列が1本だけの図」: 主役の終値だけ #3468C0（chartTheme.SERIES.you）、
//    平均線は --muted の破線・点線＋線の端に名前。売買の印は ▲/▼＋文字で色は --ink（§6-14）
//  - 右余白は端の名前ぶん（スマホ 56・PC 104）。名前が重なる場合は縦 14px 以上に押し広げる
//  - 原則9: 値は AiView にある足だけ。無い区間（MA50 の先頭 49 本など）は描かない

import { useEffect, useId, useRef, useState } from 'react'
import type { AiView } from '@/lib/ai-trader/replay-model'
import { SERIES } from '@/components/chartTheme'

export interface ReplayMarker {
  /** epoch ms */
  time: number
  action: 'buy' | 'sell'
  price: number
}

export interface ReplayChartProps {
  view: AiView | null
  symbol: string
  markers: ReplayMarker[]
  draw: { price: number; ma20: boolean; ma50: boolean }
}

const isJP = (symbol: string) => /\.T$/i.test(symbol)

/** 通貨は実単位（.T は円・整数、それ以外はドル・小数2桁）。仮想資金だが単位は偽らない（原則10）。 */
export function fmtPrice(symbol: string, n: number): string {
  return isJP(symbol)
    ? `¥${Math.round(n).toLocaleString('en-US')}`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

/** 軸の目盛り用（記号なし）。 */
function fmtAxis(symbol: string, n: number): string {
  return isJP(symbol)
    ? Math.round(n).toLocaleString('en-US')
    : n.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** 見やすい目盛り間隔（1・2・5×10^k）。 */
function niceStep(range: number, target = 4): number {
  if (range <= 0) return 1
  const raw = range / target
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const r = raw / mag
  const f = r < 1.5 ? 1 : r < 3.5 ? 2 : r < 7.5 ? 5 : 10
  return f * mag
}

function mdOf(date: string): string {
  const [, m, d] = date.split('-')
  return `${Number(m)}/${Number(d)}`
}

const LABEL_GAP = 14
const FONT = 12

export default function ReplayChart({ view, symbol, markers, draw }: ReplayChartProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  // useId の値は「:」「«」など url(#…) で壊れる文字を含みうるので英数字だけにする
  const clipId = 'replay-clip-' + useId().replace(/[^a-zA-Z0-9_-]/g, '')

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const bars = view?.bars ?? []
  const n = bars.length
  const narrow = width < 480
  const H = narrow ? 180 : 200
  const L = 48
  const R = narrow ? 56 : 104
  const T = 14
  const B = 24

  if (n < 2 || width <= L + R + 40) {
    return <div ref={ref} className="w-full" style={{ minHeight: H }} />
  }

  const W = width
  const v = view!
  const plotW = W - L - R
  const plotH = H - T - B

  // 縦軸の範囲: 終値・平均線・印の価格をすべて含め、上下に 4% の余白
  const values: number[] = [...v.closes]
  for (const m of v.ma20) if (m != null) values.push(m)
  for (const m of v.ma50) if (m != null) values.push(m)
  const t0 = bars[0].time
  const t1 = bars[n - 1].time
  const inRange = markers.filter(m => m.time >= t0 - 86_400_000 && m.time <= t1 + 86_400_000)
  for (const m of inRange) values.push(m.price)
  let lo = Math.min(...values)
  let hi = Math.max(...values)
  if (!(hi > lo)) { lo -= 1; hi += 1 }
  const pad = (hi - lo) * 0.04
  lo -= pad; hi += pad

  const x = (i: number) => L + (plotW * i) / (n - 1)
  const y = (val: number) => T + (plotH * (hi - val)) / (hi - lo)

  const path = (series: (number | null)[]): string => {
    let d = ''
    let pen = false
    for (let i = 0; i < n; i++) {
      const s = series[i]
      if (s == null) { pen = false; continue }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(s).toFixed(1)} `
      pen = true
    }
    return d.trim()
  }

  // 目盛り（縦）
  const step = niceStep(hi - lo)
  const ticks: number[] = []
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(parseFloat(t.toFixed(6)))
  // 目盛り（横）: 4 か所
  const xIdx = Array.from(new Set([0, Math.round((n - 1) / 3), Math.round(((n - 1) * 2) / 3), n - 1]))

  // 端の名前（右）。重なるなら 14px 以上に押し広げる。狭い幅（右余白 56px）では値を付けず名前だけ
  // （値そのものは段3の表に出る）
  const last = v.last
  const withValue = (name: string, val: number) => (narrow ? name : `${name} ${fmtAxis(symbol, val)}`)
  type EndLabel = { text: string; y: number; bold: boolean; show: boolean }
  const labels: EndLabel[] = [
    { text: withValue('判断時', last.price), y: y(v.closes[n - 1]), bold: true, show: draw.price >= 1 },
  ]
  if (last.ma20 != null) labels.push({ text: withValue('MA20', last.ma20), y: y(last.ma20), bold: false, show: draw.ma20 })
  if (last.ma50 != null) labels.push({ text: withValue('MA50', last.ma50), y: y(last.ma50), bold: false, show: draw.ma50 })
  const sorted = [...labels].sort((a, b) => a.y - b.y)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].y - sorted[i - 1].y < LABEL_GAP) sorted[i].y = sorted[i - 1].y + LABEL_GAP
  }
  const maxY = H - B - 2
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].y > maxY) sorted[i].y = maxY
    if (i > 0 && sorted[i].y - sorted[i - 1].y < LABEL_GAP) sorted[i - 1].y = sorted[i].y - LABEL_GAP
  }
  for (const l of sorted) if (l.y < T + 6) l.y = T + 6

  // 売買の印: 印の時刻に最も近い足の位置
  const markerPts = inRange.map(m => {
    let best = 0
    let diff = Infinity
    for (let i = 0; i < n; i++) {
      const d = Math.abs(bars[i].time - m.time)
      if (d < diff) { diff = d; best = i }
    }
    return { ...m, i: best }
  })
  const drawnBars = draw.price >= 1 ? n - 1 : draw.price * (n - 1)

  const clipW = Math.max(0, Math.min(plotW + 6, plotW * draw.price + (draw.price >= 1 ? 6 : 0)))
  const lastX = x(n - 1)
  const lastY = y(v.closes[n - 1])

  return (
    <div ref={ref} className="w-full">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`${symbol} の判断日までの3か月の終値と、20日・50日平均線`}
        style={{ display: 'block', fontSize: FONT, fontVariantNumeric: 'tabular-nums' }}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={L - 3} y={0} width={clipW} height={H} />
          </clipPath>
        </defs>
        {/* 補助線と縦の目盛り */}
        {ticks.map(t => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} style={{ stroke: 'var(--border)' }} strokeOpacity={0.5} />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" style={{ fill: 'var(--muted)' }}>{fmtAxis(symbol, t)}</text>
          </g>
        ))}
        {/* 横の目盛り */}
        {xIdx.map(i => (
          <text key={i} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} style={{ fill: 'var(--muted)' }}>
            {mdOf(bars[i].date)}
          </text>
        ))}
        {/* 平均線（補助: --muted の破線・点線） */}
        <path d={path(v.ma20)} fill="none" strokeWidth={1.5} strokeDasharray="6 4"
          style={{ stroke: 'var(--muted)', opacity: draw.ma20 ? 1 : 0, transition: 'opacity 150ms ease-out' }} />
        <path d={path(v.ma50)} fill="none" strokeWidth={1.5} strokeDasharray="2 4" strokeLinecap="round"
          style={{ stroke: 'var(--muted)', opacity: draw.ma50 ? 1 : 0, transition: 'opacity 150ms ease-out' }} />
        {/* 終値（主役）。伸長は clipPath の幅で決める */}
        <g clipPath={`url(#${clipId})`}>
          <path d={path(v.closes)} fill="none" stroke={SERIES.you} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        </g>
        {/* 判断時の点（線が端まで届いたら） */}
        {draw.price >= 1 && (
          <circle cx={lastX} cy={lastY} r={4} fill={SERIES.you} style={{ stroke: 'var(--card)' }} strokeWidth={2} />
        )}
        {/* 売買の印（▲/▼＋文字・--ink）。線がその位置まで届いたら出す */}
        {markerPts.map((m, k) => {
          if (m.i > drawnBars + 1e-9) return null
          const px = x(m.i)
          const py = y(m.price)
          const buy = m.action === 'buy'
          const ty = buy ? py + 22 : py - 12
          const tri = buy
            ? `M${px} ${py + 4} l-5 8 h10 z`
            : `M${px} ${py - 4} l-5 -8 h10 z`
          const anchor = px > W - R - 40 ? 'end' : px < L + 40 ? 'start' : 'middle'
          return (
            <g key={k}>
              <path d={tri} style={{ fill: 'var(--ink)' }} />
              <text x={px} y={ty} textAnchor={anchor} style={{ fill: 'var(--ink)', fontWeight: 600, paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 3, strokeLinejoin: 'round' }}>
                {buy ? '買' : '売'} {fmtAxis(symbol, m.price)}
              </text>
            </g>
          )
        })}
        {/* 端の名前 */}
        {sorted.map(l => l.show && (
          <text key={l.text} x={W - R + 6} y={l.y + 4} style={{ fill: l.bold ? 'var(--ink)' : 'var(--muted)', fontWeight: l.bold ? 600 : 400, paintOrder: 'stroke', stroke: 'var(--card)', strokeWidth: 3, strokeLinejoin: 'round' }}>
            {l.text}
          </text>
        ))}
      </svg>
    </div>
  )
}
