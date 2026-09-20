// 目安との位置を示す細い数直線（2026-09-18 オーナー選択・案C）。
//
// 規則（DESIGN.md §6-14・DECISIONS 2026-09-18）:
//  - 軸 1px --axis、目安の位置に破線のティックとラベル、実測値に直径 9px の点（チャートの「あなた」の青 SERIES.you）
//  - 緑赤の塗り分けゾーンを作らない（点数・合否に見える）
//  - 軸の両端に実値のラベルを必ず書く（caption 12px。これより小さい文字は作らない: §5-2）
//  - 軸の範囲外の値は点を描かず「軸の外（値）」と文字で書く
//  - 1画面に最大2本（ルールブックの scale の数で決まる。scripts/check-rulebook.ts が数える）
//
// 純粋な描画部品。値の換算・書式は呼び出し側（RuleCheckList）が済ませて渡す。

import { SERIES } from '@/components/chartTheme'

export interface NumberLineProps {
  /** 軸の範囲（呼び出し側の単位のまま） */
  min: number
  max: number
  /** 目安の位置（軸の内側にあるものだけ描く） */
  thresholds: { value: number; label: string }[]
  /** 実測値。undefined なら点を描かない */
  value?: number
  /** ラベルの書式（軸の両端） */
  format: (v: number) => string
  /** 読み上げ用の説明 */
  ariaLabel: string
}

const W = 160
const H = 30
const PAD = 4
const AXIS_Y = 21

function x(v: number, min: number, max: number): number {
  return PAD + ((v - min) / (max - min)) * (W - PAD * 2)
}

export function NumberLine({ min, max, thresholds, value, format, ariaLabel }: NumberLineProps) {
  const inRange = value != null && value >= min && value <= max
  const ticks = thresholds.filter(t => t.value > min && t.value < max)
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="block max-w-full">
      <line x1={PAD} y1={AXIS_Y} x2={W - PAD} y2={AXIS_Y} stroke="var(--axis)" strokeWidth="1" />
      <line x1={PAD} y1={AXIS_Y - 4} x2={PAD} y2={AXIS_Y + 4} stroke="var(--axis)" strokeWidth="1" />
      <line x1={W - PAD} y1={AXIS_Y - 4} x2={W - PAD} y2={AXIS_Y + 4} stroke="var(--axis)" strokeWidth="1" />
      {ticks.map(t => (
        <g key={t.value}>
          <line x1={x(t.value, min, max)} y1={AXIS_Y - 7} x2={x(t.value, min, max)} y2={AXIS_Y + 7} stroke="var(--axis)" strokeWidth="1" strokeDasharray="3 3" />
          <text x={x(t.value, min, max)} y={10} fontSize="12" fill="var(--muted)" textAnchor="middle">{t.label}</text>
        </g>
      ))}
      {/* 両端の実値（目安のラベルと同じ行。目安は軸の内側にあるので重ならない） */}
      <text x={0} y={10} fontSize="12" fill="var(--muted)" textAnchor="start">{format(min)}</text>
      <text x={W} y={10} fontSize="12" fill="var(--muted)" textAnchor="end">{format(max)}</text>
      {inRange && <circle cx={x(value, min, max)} cy={AXIS_Y} r="4.5" fill={SERIES.you} />}
    </svg>
  )
}
