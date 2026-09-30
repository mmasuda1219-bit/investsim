'use client'

import { useLayoutEffect, useRef, useState } from 'react'
import { SERIES, fade } from '@/components/chartTheme'
import type { HistoricalBar } from '@/types'
import type { ExitLevel } from '@/lib/review/exit-rule'

/**
 * 「そのあと、株価はこう動きました」の図＋ずれの1文（S2b「振り返りの作り直し」・2026-09-30・designer 2026-09-29 の設計 B）。
 * /review の判断記録カードの中で、書いた理由の下に置く。1枚のカードに1つ、ページに最大3つ（Yahoo の 429 を避ける）。
 *
 * 図（高さ 96px・幅 100% の inline SVG。lightweight-charts は使わない＝カードに複数載るため）:
 *  - 1系列＝終値だけ。SERIES.you（青・実線 2px）＋薄い面。凡例は出さない（1系列の図に凡例は要らない）
 *  - 期間: 買った日の5営業日前 〜（売った日の5営業日後／最後の足）。営業日は日足の本数で数える（S2 レビュー W1 と同じ）
 *  - 縦線（必ず引く）: 買った日＝1px 実線、上端に「▲ 買 {price}」。往復なら売った日にも「▼ 売 {price}」。保有中は右端に点＋「今 {price}」
 *  - 水平線（exitLevel があるときだけ）: --muted の破線＋「降りる条件 {値}」。無いときは線を引かず、文で伝える
 *  - 軸は右上・右下に期間内の最高値・最安値だけ。横軸は左端・右端の日付だけ。目盛り線は無い
 *  - 出所（R8・必須）: 図の直下に「Yahoo Finance・M/D HH:mm 時点」。quotedAt が無ければ「取得時点が分かりません」（時刻を作らない）
 *
 * 無いときの姿（原則9・§6-12）:
 *  - 'loading' … 同じ高さの薄い枠＋「株価を取得しています」
 *  - null／2本未満／買った日の足が無い … **SVG を1本も出さず**「株価を取得できませんでした。書いた理由は残っています。」（--warning-ink）。ダミー線は描かない
 *
 * ずれの1文（この部品の中。部品を増やさない＝原則8）: 図の直下に常に同じ位置で出す。守れた／守れなかった／正しかった／判断ミス／的中／
 * 当たった／外れた／正解 の語は使わない。触れた／触れていないは **語＋中空の丸＋位置** で区別し、色（--success/--danger）を使わない。
 * 「触れた」は **図と同じ終値の系列** で見る（安値で見ると、図の線が届いていないのに「触れた」と言うことになる）。
 *
 * 検査: scripts/check-review.ts（6・7・8）。
 */

export const PRICE_SOURCE = 'Yahoo Finance'

export interface PriceSincePanelProps {
  symbol: string
  entryAt: number
  entryPrice: number
  exitAt: number | null
  exitPrice: number | null
  /** 【降りる条件】の本文。無ければ null */
  exitRuleText: string | null
  /** parseExitLevel の結果。数値が取れなければ null */
  exitLevel: ExitLevel | null
  bars: HistoricalBar[] | 'loading' | null
  /** 株価を取得した時点（ms）。分からなければ null */
  quotedAt: number | null
  /** 売るときに書いた【変化】の本文。売却済みで書いてあれば引用する */
  changeText?: string | null
  /** 幅を測る前に使う px（既定 640）。実際の幅は ResizeObserver で測って上書きする。検査・静的描画で実寸を再現するためのもの */
  initialWidth?: number
}

const H = 96
const DAY_MS = 86_400_000
/** 買った日の前・売った日の後に足す足の本数 */
const LEAD_BARS = 5
/** 「今」の点の直径 6px、触れた点の輪郭は直径 7px・1.5px */
const NOW_R = 3
const TOUCH_R = 3.5

/** ms → UTC の暦日（YYYY-MM-DD）。判断の記録と日足の日付を同じ基準で比べる（AnswerCheckCard と同じ） */
export function dayKey(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}
const barDay = (b: HistoricalBar) => dayKey(b.time * 1000)
const dayMs = (key: string) => Date.parse(`${key}T00:00:00Z`)

/** 'YYYY-MM-DD' → '9/1' */
function slash(key: string): string {
  const [, m, d] = key.split('-')
  return `${Number(m)}/${Number(d)}`
}

/** 軸の実値。.T は円（整数）、それ以外はドル（小数2桁）。仮想資金でも単位は偽らない（原則10） */
export function fmtPrice(symbol: string, n: number): string {
  return /\.T$/i.test(symbol)
    ? `¥${Math.round(n).toLocaleString('en-US')}`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtClock(ms: number): string {
  const d = new Date(ms)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${hh}:${mm}`
}

export interface PriceSinceLayout {
  /** 図に描く足（期間で切り出したもの） */
  win: HistoricalBar[]
  /** win の中の、買った日の足（買った日以降で最初の足） */
  entryIdx: number
  /** win の中の、売った日の足。保有中は null */
  exitIdx: number | null
  /** 終値が条件に触れた最初の足。条件が無い／触れていない なら null */
  touchIdx: number | null
  /** 期間内の終値の最高値・最安値 */
  max: number
  min: number
  /** 買った日から（売った日／最後の足）までの暦日数 */
  elapsedDays: number
}

/**
 * 足の列から、図に描く期間と、買った日・売った日・触れた日の位置を求める（純関数）。
 * 買った日の足が無い（足の列が買った日より後から始まる／終わる）なら null＝図を描かない。
 */
export function layoutPriceSince(
  bars: HistoricalBar[],
  entryAt: number,
  exitAt: number | null,
  exitLevel: ExitLevel | null,
  entryPrice: number,
): PriceSinceLayout | null {
  if (bars.length < 2) return null
  const sorted = [...bars].sort((a, b) => a.time - b.time)
  const entryDay = dayKey(entryAt)
  const e = sorted.findIndex(b => barDay(b) >= entryDay)
  if (e < 0) return null
  // 買った日より前の足が1本も無い＝この列は買った日を覆っていない（買った日が最初の足より前）
  if (e === 0 && barDay(sorted[0]) > entryDay) return null

  let x: number | null = null
  if (exitAt !== null) {
    const exitDay = dayKey(exitAt)
    const found = sorted.findIndex(b => barDay(b) >= exitDay)
    x = found < 0 ? sorted.length - 1 : found
  }

  const start = Math.max(0, e - LEAD_BARS)
  const end = x === null ? sorted.length - 1 : Math.min(sorted.length - 1, x + LEAD_BARS)
  const win = sorted.slice(start, end + 1)
  if (win.length < 2) return null
  const entryIdx = e - start
  const exitIdx = x === null ? null : x - start

  let touchIdx: number | null = null
  if (exitLevel !== null) {
    const down = exitLevel.price <= entryPrice
    const last = exitIdx ?? win.length - 1
    for (let i = entryIdx; i <= last; i++) {
      const c = win[i].close
      if (down ? c <= exitLevel.price : c >= exitLevel.price) { touchIdx = i; break }
    }
  }

  const closes = win.map(b => b.close)
  const endDay = exitIdx === null ? barDay(win[win.length - 1]) : barDay(win[exitIdx])
  const elapsedDays = Math.max(0, Math.round((dayMs(endDay) - dayMs(entryDay)) / DAY_MS))
  return { win, entryIdx, exitIdx, touchIdx, max: Math.max(...closes), min: Math.min(...closes), elapsedDays }
}

/**
 * ずれの1文（純関数）。型は designer 2026-09-29 の設計 B:
 *  - 条件の数値が取れて触れた … 「書いた条件（値）に、M/D の終値で触れています。そのあと売ったのは M/D です。／その後も持ち続けています。」
 *  - 取れて触れていない     … 「書いた条件（値）には、まだ触れていません。N日が過ぎました。」（売却済みなら「売るまでのN日のあいだ触れていません。」）
 *  - 数値が取れない         … 「この条件は数字ではないので、こちらでは判定していません。N日が過ぎました。」
 *  - 条件が空               … 「降りる条件は決めていませんでした。N日が過ぎました。」
 *  - 売却済みで【変化】あり … 「売るときには『冒頭40字』と書いています。」を足す（引用だけ。評価しない）
 */
export function gapSentence(input: {
  exitRuleText: string | null
  exitLevel: ExitLevel | null
  layout: PriceSinceLayout
  changeText?: string | null
}): string {
  const { exitRuleText, exitLevel, layout, changeText } = input
  const closed = layout.exitIdx !== null
  const n = layout.elapsedDays
  const rule = (exitRuleText ?? '').trim()
  let s: string
  if (!rule) {
    s = closed ? `降りる条件は決めていませんでした。買ってから${n}日で売っています。` : `降りる条件は決めていませんでした。${n}日が過ぎました。`
  } else if (exitLevel === null) {
    // 条件が数字でないときは、この1文だけで「線が引けない」と「判定していない」の両方を言う。
    // 図の下にもう1文を足すと同じことを2回読ませることになる（2026-09-30・オーナー要望「もっとわかりやすい文章」）。
    // 「数字ではない」だと、読み手に数字（15% など）が見えていて矛盾する（S2b レビュー W5）。
    // 言いたいのは「株価の値として読めない」こと。
    const why = `書いた条件『${rule}』は株価の値ではないので、この図には線を引かず、触れたかどうかも見ていません。`
    s = closed ? `${why}買ってから${n}日で売っています。` : `${why}${n}日が過ぎました。`
  } else if (layout.touchIdx !== null) {
    const touched = slash(barDay(layout.win[layout.touchIdx]))
    const tail = closed ? `そのあと売ったのは ${slash(barDay(layout.win[layout.exitIdx as number]))} です。` : 'その後も持ち続けています。'
    s = `書いた条件（${exitLevel.label}）に、${touched} の終値で触れています。${tail}`
  } else {
    // 「終値では」を必ず付ける（S2b レビュー W1）。その日の安値が条件を割っていても、この図は終値の線なので
    // 見ていない。「触れていません」と言い切ると、実際には割っていた日を無かったことにする。
    s = closed
      ? `書いた条件（${exitLevel.label}）には、売るまでの${n}日のあいだ、終値では触れていません。`
      : `書いた条件（${exitLevel.label}）には、終値ではまだ触れていません。${n}日が過ぎました。`
  }
  const change = (changeText ?? '').trim()
  if (closed && change) {
    const head = Array.from(change).slice(0, 40).join('')
    s += `売るときには『${head}${Array.from(change).length > 40 ? '…' : ''}』と書いています。`
  }
  return s
}

/** 読み込み中・取得失敗のときの、図と同じ高さの枠（枠だけ。線は描かない） */
function Frame({ children, busy }: { children: React.ReactNode; busy?: boolean }) {
  return (
    <div
      role={busy ? 'status' : undefined}
      aria-busy={busy || undefined}
      className="flex items-center justify-center rounded-card border border-border px-4"
      style={{ height: H }}
    >
      {children}
    </div>
  )
}

export function PriceSincePanel(props: PriceSincePanelProps) {
  const { symbol, entryAt, entryPrice, exitAt, exitPrice, exitRuleText, exitLevel, bars, quotedAt, changeText, initialWidth = 640 } = props
  const wrapRef = useRef<HTMLDivElement>(null)
  // 実際の幅を測って viewBox を px にそろえる（文字と丸が伸び縮みで歪まないように）。測る前は initialWidth（既定 640）で描く
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
    // 読み込み中 → 図 で包みの要素が入れ替わるので、bars が変わるたびに測り直す
  }, [bars])

  const heading = <p className="text-small text-muted">そのあと、株価はこう動きました</p>

  if (bars === 'loading') {
    return (
      <div className="space-y-2">
        {heading}
        <div ref={wrapRef}>
          <Frame busy>
            <span className="text-small text-muted">株価を取得しています</span>
          </Frame>
        </div>
      </div>
    )
  }

  const layout = bars === null ? null : layoutPriceSince(bars, entryAt, exitAt, exitLevel, entryPrice)
  if (layout === null) {
    // 通信の失敗と「足が買った日を覆えない」を分ける（S2b レビュー W3）。
    // 買った当日に読み返すのは1件目の人が最初にやる操作で、そこで「取得できませんでした」と出ると
    // 取れているのに壊れて見える。5年より前の買いも同じで、どちらも不具合ではない。
    let why = '株価を取得できませんでした。書いた理由は残っています。'
    if (bars !== null && bars.length > 0) {
      const firstDay = dayMs(barDay(bars[0]))
      const lastDay = dayMs(barDay(bars[bars.length - 1]))
      const entryDay = dayMs(dayKey(entryAt))
      why = entryDay > lastDay
        ? '買った日の株価は、まだ日足に載っていません。翌営業日以降に出ます。'
        : entryDay < firstDay
          ? '5年より前の買いは、この図にできません（取れる日足が5年分までのため）。'
          : '株価を取得できませんでした。書いた理由は残っています。'
    }
    return (
      <div className="space-y-2">
        {heading}
        <div ref={wrapRef}>
          <p className="text-small text-warning-ink">{why}</p>
        </div>
      </div>
    )
  }

  const { win, entryIdx, exitIdx, touchIdx, max, min } = layout
  const closed = exitIdx !== null
  const sentence = gapSentence({ exitRuleText, exitLevel, layout, changeText })
  const rule = (exitRuleText ?? '').trim()

  // ── 座標 ──────────────────────────────────────────────
  const W = width
  const buyLabel = `▲ 買 ${fmtPrice(symbol, entryPrice)}`
  const sellLabel = closed && exitPrice !== null ? `▼ 売 ${fmtPrice(symbol, exitPrice)}` : null
  const PADX = 2
  const xAt = (i: number) => PADX + (i / (win.length - 1)) * (W - PADX * 2)
  // 買と売のラベルが重なるときは、売のラベルを2段目に置く（上端の帯を 14px → 28px に）
  const collide = sellLabel !== null && Math.abs(xAt(exitIdx as number) - xAt(entryIdx)) < 150
  const TOP = collide ? 28 : 14
  const lo = Math.min(min, exitLevel?.price ?? min)
  const hi = Math.max(max, exitLevel?.price ?? max)
  const span = hi - lo || 1
  const yTop = TOP + 5
  const yBot = H - 5
  const yAt = (v: number) => yBot - ((v - lo) / span) * (yBot - yTop)

  const closes = win.map(b => b.close)
  const linePath = closes.map((v, i) => `${i === 0 ? 'M' : 'L'}${xAt(i).toFixed(1)} ${yAt(v).toFixed(1)}`).join(' ')
  const areaPath = `${linePath} L${xAt(win.length - 1).toFixed(1)} ${H} L${xAt(0).toFixed(1)} ${H} Z`

  const xBuy = xAt(entryIdx)
  const buyAnchor: 'start' | 'end' = xBuy > W - 110 ? 'end' : 'start'
  const xSell = closed ? xAt(exitIdx as number) : null
  const sellAnchor: 'start' | 'end' = xSell !== null && xSell < 110 ? 'start' : 'end'
  const lastI = win.length - 1
  const yLast = yAt(closes[lastI])
  const nowLabelY = yLast - 8 < TOP + 10 ? yLast + 14 : yLast - 7
  const yLevel = exitLevel ? yAt(exitLevel.price) : null
  const levelLabelY = yLevel !== null ? (yLevel - 4 < TOP + 10 ? yLevel + 12 : yLevel - 4) : null

  const leftDay = barDay(win[0])
  const rightDay = barDay(win[lastI])
  const buyDay = slash(barDay(win[entryIdx]))
  const sellDay = closed ? slash(barDay(win[exitIdx as number])) : null
  const asOf = quotedAt !== null && Number.isFinite(quotedAt) ? `${PRICE_SOURCE}・${fmtClock(quotedAt)} 時点` : `${PRICE_SOURCE}・取得時点が分かりません`
  const aria =
    `${symbol} の終値の折れ線（${slash(leftDay)}〜${slash(rightDay)}）。縦の線は買った日 ${buyDay}${sellDay ? ` と売った日 ${sellDay}` : ''}。` +
    (exitLevel ? `横の破線は降りる条件 ${exitLevel.label}。` : '') +
    `期間の最高値 ${fmtPrice(symbol, max)}、最安値 ${fmtPrice(symbol, min)}。${sentence}`

  const labelStyle = { fontSize: 11, fontVariantNumeric: 'tabular-nums' as const }
  const clampTop = (y: number) => Math.max(0, Math.min(H - 16, y - 8))

  return (
    <div className="space-y-2">
      {heading}
      <figure role="img" aria-label={aria} className="space-y-1">
        <div className="flex items-stretch gap-2">
          <div ref={wrapRef} className="min-w-0 flex-1">
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} aria-hidden="true" focusable="false" className="block overflow-visible">
              {/* 薄い面＋終値の線（1系列・SERIES.you） */}
              <path d={areaPath} fill={fade(SERIES.you.color, 0.12)} stroke="none" />
              <path d={linePath} fill="none" stroke={SERIES.you.color} strokeWidth={SERIES.you.width} strokeLinejoin="round" strokeLinecap="round" />

              {/* 降りる条件の水平線（数値が取れたときだけ）。--muted の破線 */}
              {yLevel !== null && exitLevel && (
                <>
                  <line x1={0} x2={W} y1={yLevel} y2={yLevel} stroke="var(--muted)" strokeWidth={1} strokeDasharray="4 4" />
                  <text x={4} y={levelLabelY ?? 0} fill="var(--muted)" style={labelStyle}>降りる条件 {exitLevel.label}</text>
                </>
              )}

              {/* 買った日の縦線（必ず引く）＋上端のラベル */}
              <line x1={xBuy} x2={xBuy} y1={TOP} y2={H} stroke="var(--muted)" strokeWidth={1} />
              <text x={xBuy + (buyAnchor === 'start' ? 3 : -3)} y={10} textAnchor={buyAnchor} fill="var(--ink)" style={labelStyle}>{buyLabel}</text>

              {/* 売った日の縦線（往復のときだけ） */}
              {xSell !== null && sellLabel && (
                <>
                  <line x1={xSell} x2={xSell} y1={TOP} y2={H} stroke="var(--muted)" strokeWidth={1} />
                  <text x={xSell + (sellAnchor === 'start' ? 3 : -3)} y={collide ? 24 : 10} textAnchor={sellAnchor} fill="var(--ink)" style={labelStyle}>{sellLabel}</text>
                </>
              )}

              {/* 保有中: 右端の点＋「今」 */}
              {!closed && (
                <>
                  <circle cx={xAt(lastI)} cy={yLast} r={NOW_R} fill={SERIES.you.color} />
                  <text x={xAt(lastI) - 6} y={nowLabelY} textAnchor="end" fill="var(--ink)" style={labelStyle}>今 {fmtPrice(symbol, closes[lastI])}</text>
                </>
              )}

              {/* 触れた時点: 中空の丸（塗らない・色で区別しない） */}
              {touchIdx !== null && (
                <circle cx={xAt(touchIdx)} cy={yAt(closes[touchIdx])} r={TOUCH_R} fill="none" stroke="var(--muted)" strokeWidth={1.5} />
              )}
            </svg>
          </div>
          {/* 軸: 期間内の最高値・最安値だけ（右の列・HTML。伸縮で歪ませない） */}
          <div className="relative w-16 shrink-0 text-caption text-muted tabular-nums" style={{ height: H }} aria-hidden="true">
            <span className="absolute left-0 leading-4" style={{ top: clampTop(yAt(max)) }}>{fmtPrice(symbol, max)}</span>
            <span className="absolute left-0 leading-4" style={{ top: clampTop(yAt(min)) }}>{fmtPrice(symbol, min)}</span>
          </div>
        </div>
        {/* 横軸: 左端・右端の日付だけ */}
        <div className="flex justify-between pr-18 text-caption text-muted tabular-nums" aria-hidden="true">
          <span>{slash(leftDay)}</span>
          <span>{slash(rightDay)}</span>
        </div>
        {/* 出所と時点（R8・必須） */}
        <figcaption className="text-caption text-muted tabular-nums">{asOf}</figcaption>
      </figure>

      {/* ずれの1文。常に図の直下・同じ位置（触れた／触れていないで位置を動かさない・色を付けない） */}
      {/* 条件が数字でないときの説明は gapSentence の中に入れた（同じことを2回読ませない・2026-09-30） */}
      <p className="text-small text-ink-2 max-w-[42rem]">{sentence}</p>
    </div>
  )
}
