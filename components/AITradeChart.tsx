'use client'

import { useEffect, useRef } from 'react'
import {
  createChart,
  AreaSeries,
  LineSeries,
  LineStyle,
  createSeriesMarkers,
  ColorType,
  CrosshairMode,
  type IChartApi,
  type Time,
} from 'lightweight-charts'
import { calcMA } from '@/lib/technicals'
import type { HistoricalBar } from '@/types'

export interface TradeMarker {
  time:      number
  action:    'buy' | 'sell'
  price:     number
  shares:    number
  total:     number
  reason:    string
  timestamp: string
}

interface Props {
  data:    HistoricalBar[]
  trades:  TradeMarker[]
  /** x軸の帯を含めた総高さ(px)。コンテナにも同じ高さを与えるので、カード内に縦スクロールは出ない */
  height?: number
  symbol:  string
}

// ── 色 ────────────────────────────────────────────────────────────────────
// lightweight-charts は canvas 描画で CSS 変数を読めないため hex 直書きだが、
// すべて app/globals.css のトークンと同値（TradingChart と同じ方式）。
// トークン側を変えたらここも合わせること。
const C = {
  ink:     '#1A1A18', // --ink     終値の線・売買マーカー
  ink2:    '#44413B', // --ink-2   MA50（長い期間ほど濃い＝順序尺度）
  muted:   '#6B6862', // --muted   MA20・軸文字
  border:  '#D6D0C3', // --border  grid（1px 実線）
  card:    '#FFFFFF', // --card    背景
  inkFill: 'rgba(26, 26, 24, 0.08)', // --ink の 8%。終値の下の面
} as const

// 売買の方向は「色で運ばない」。
// 同じページに「利益＝緑 / 損失＝赤」（TradeLog の往復の結果）が並ぶので、ここで
// 「買い＝緑 / 売り＝赤」を使うと、読者は「AIが買った＝良いこと」と誤読する
// （COMPANY.md 原則11: 読者の判断力向上が目的。判断と結果を混同させない）。
// 方向は 形（▲/▼）＋位置（bar下/bar上）＋文字（「買 178.20」「売 191.40」）で示す。
// 金融UIの慣習（買い緑・売り赤）に逆らう判断なので、後で反転したくなったら
// この2つの値だけを --success / --danger に変えれば戻る（他の箇所は触らずに済む）。
const MARKER_COLOR = { buy: C.ink, sell: C.ink } as const

// マーカーの価格表記。`.T` は円（整数）、それ以外は小数2桁。
function fmtMarkerPrice(symbol: string, p: number) {
  return symbol.endsWith('.T') ? `¥${Math.round(p).toLocaleString('en-US')}` : p.toFixed(2)
}

export function AITradeChart({ data, trades, height = 380, symbol }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef     = useRef<IChartApi | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el || data.length === 0) return

    chartRef.current?.remove()
    chartRef.current = null

    // OS の「視差効果を減らす」設定を尊重。lightweight-charts で動きが出るのは
    // 慣性スクロール（kineticScroll）なので、それを切る。fitContent 自体は即時。
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

    // canvas には font-variant-numeric: tabular-nums を指定できないので、
    // せめてページと同じフォント族を使って軸の数字の見た目を揃える。
    const fontFamily = getComputedStyle(el).fontFamily || undefined

    const chart = createChart(el, {
      // コンテナの実寸に追従（ResizeObserver）。height はコンテナの style で決める。
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: C.card },
        textColor:  C.muted,
        fontSize:   11,
        fontFamily,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: C.border, style: LineStyle.Solid },
        horzLines: { color: C.border, style: LineStyle.Solid },
      },
      rightPriceScale: { borderColor: C.border },
      timeScale: {
        borderColor:    C.border,
        // 日足なので時刻は出さない（出すと「00:00」が並ぶだけ）
        timeVisible:    false,
        secondsVisible: false,
      },
      crosshair: { mode: CrosshairMode.Normal },
      kineticScroll: reduceMotion ? { mouse: false, touch: false } : { mouse: false, touch: true },
    })

    // 終値: 2px の線＋その下に同色 8% の面（AreaSeries は線と面を1系列で描く）。
    // ローソク足（緑/赤）をやめた理由: 白地で 1.9:1 しか出ない上に、
    // 「上がった日＝緑」が売買マーカーの意味と衝突する。
    const closeSeries = chart.addSeries(AreaSeries, {
      lineColor:        C.ink,
      lineWidth:        2,
      topColor:         C.inkFill,
      bottomColor:      'rgba(26, 26, 24, 0)',
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
    })
    closeSeries.setData(
      data.map(d => ({ time: d.time as unknown as Time, value: d.close }))
    )

    // 移動平均は「期間が長いほど濃い」順序尺度。色相は増やさない。
    // 線幅は LineWidth 型が 1|2|3|4 の整数なので 1px（1.5px は指定できない）。
    const ma20series = chart.addSeries(LineSeries, {
      color: C.muted, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    ma20series.setData(calcMA(data, 20).map(p => ({ time: p.time as unknown as Time, value: p.value })))

    const ma50series = chart.addSeries(LineSeries, {
      color: C.ink2, lineWidth: 1, priceLineVisible: false, lastValueVisible: false,
      crosshairMarkerVisible: false,
    })
    ma50series.setData(calcMA(data, 50).map(p => ({ time: p.time as unknown as Time, value: p.value })))

    if (trades.length > 0) {
      const markers = [...trades]
        .sort((a, b) => a.time - b.time)
        .map(t => ({
          time:     t.time as unknown as Time,
          position: t.action === 'buy' ? ('belowBar' as const) : ('aboveBar' as const),
          color:    MARKER_COLOR[t.action],
          shape:    t.action === 'buy' ? ('arrowUp' as const) : ('arrowDown' as const),
          text:     `${t.action === 'buy' ? '買' : '売'} ${fmtMarkerPrice(symbol, t.price)}`,
        }))
      createSeriesMarkers(closeSeries, markers)
    }

    chart.timeScale().fitContent()
    chartRef.current = chart

    return () => {
      chartRef.current?.remove()
      chartRef.current = null
    }
  }, [data, trades, height, symbol])

  // 凡例はチャートの上に独立した1行として置く（以前は absolute でチャートに重なっていた）。
  // 線キーは 12×2px の短い横線。文字は --ink-2 / --muted。
  const legend = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted mb-2">
      <span className="font-mono font-semibold text-ink-2">{symbol}</span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-0.5 bg-[var(--ink)]" aria-hidden="true" />終値
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-0.5 bg-[var(--muted)]" aria-hidden="true" />MA20
      </span>
      <span className="flex items-center gap-1.5">
        <span className="inline-block w-3 h-0.5 bg-[var(--ink-2)]" aria-hidden="true" />MA50
      </span>
      {/* 方向は形と位置で示す（色ではない）。凡例もその通りに書く */}
      <span className="text-ink-2">▲ 買（足の下）</span>
      <span className="text-ink-2">▼ 売（足の上）</span>
    </div>
  )

  if (data.length === 0) {
    return (
      <div className="w-full">
        {legend}
        <div
          className="flex items-center justify-center text-sm text-muted border border-border rounded-lg"
          style={{ height }}
        >
          この銘柄の価格データがまだありません
        </div>
      </div>
    )
  }

  return (
    <div className="w-full">
      {legend}
      {/* height は x軸の帯込み。コンテナに同じ高さを与えるので、内側でスクロールしない */}
      <div ref={containerRef} className="w-full overflow-hidden rounded-lg" style={{ height }} />
    </div>
  )
}
