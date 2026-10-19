'use client'

/**
 * チャートの色を1か所に集約する。
 *
 * ■ なぜこのファイルが要るか
 * lightweight-charts は CSS クラスを受け付けず、色を JS の値として渡すしか無い。
 * そのため各チャートコンポーネントに '#FFFFFF' や '#3b82f6' のような色が直書きされていて、
 * globals.css のトークンを差し替えてもチャートだけ取り残されていた（2026-09-24 の暗転で顕在化）。
 *
 * ■ 二重管理を避ける方法
 * 面・文字・枠線・ローソク足の線は `readChartTheme()` が `getComputedStyle` で :root のトークンを
 * 実行時に読む。したがって globals.css の :root を差し替えればチャートも自動で追随し、
 * ここに色をコピーして持つ必要は無い（FALLBACK は SSR/取得失敗時の保険にすぎない）。
 *
 * ■ 唯一トークン化できない色（＝ここが定義場所）
 * 系列色（あなた / AI / 著名投資家 / 基準、テクニカル指標線）は「ブランド」でも
 * 「成功/失敗」でもなく、単に系列を見分けるための色なので対応するトークンが無い。
 * SERIES だけはこのファイルが正であり、トークンとは二重管理になっていない。
 * 値の根拠は DESIGN.md §5-1「チャートの系列色」、検査は scripts/check-chart-palette.ts。
 *
 * ■ 損益・売買の方向に色を使わない（DECISIONS 2026-09-24「損益から色を外す」）
 * ローソク足の上げ下げ・MACD の正負・売買の印は --success / --danger で塗らず、
 * --ink 系（--ink / --muted）の明るさの差と形（中空／塗り、▲／▼）で表す。
 */

export type ChartTheme = {
  /** チャートの地。カード面（--card）と同じ。 */
  background: string
  /** 軸ラベルの文字色（--muted）。 */
  text: string
  /** 目盛りのグリッド線。--border をそのまま使う（薄めない: DESIGN.md §6-14）。 */
  grid: string
  /** 軸の枠線（--border）。 */
  border: string
  /** 本文の色（--ink）。ローソク足の輪郭と芯・終値の線・売買の印・MACD の正のバー。 */
  ink: string
  /** 説明文の色（--ink-2）。ローソク足の陰線の塗り（--ink だと下げ相場で黒い壁になる・L1 2026-10-12）と、
   *  「期間が長いほど濃い」順序尺度の中間段（AITradeChart の MA50）。 */
  ink2: string
  /** 補助線（RSI の 70/30・ゼロ基準線）と MACD の負のバー。--muted ＝ --ink の 55% なので「--ink 系の明度差」になる。 */
  muted: string
  /** ブランド色（--brand 青緑）。チャートの線には使わない（DESIGN.md §5-1）。読み出し用に置くだけ。 */
  accent: string
}

/**
 * SSR 時・CSS 変数が読めない時の保険。globals.css の :root（明るい地・L1 2026-10-12）のトークンを
 * チャートの面 --card（白 #FFFFFF）に合成した実効色（scripts/check-theme.ts と同じ手順・Math.round。
 * 同じ検査が「この値が :root と一致するか」を毎回見るので、:root を変えたらここも追随させる）。
 * 実行時は readChartTheme() がトークンを読むので、ここが画面に出るのは取得に失敗したときだけ。
 */
const FALLBACK: ChartTheme = {
  background: '#FFFFFF', // --card
  text:       '#64686F', // --muted
  grid:       '#D1D1D1', // --border rgb(0 0 0 / .18) on #FFFFFF
  border:     '#D1D1D1', // --border
  ink:        '#111111', // --ink
  ink2:       '#4A4D55', // --ink-2
  muted:      '#64686F', // --muted
  accent:     '#0F766E', // --brand
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = styles.getPropertyValue(name).trim()
  return v || fallback
}

/**
 * :root のトークンを読んでチャート用の色を返す。
 * クライアントの useEffect 内から呼ぶこと（document を参照するため）。
 *
 * 半透明のトークン（--border など）は文字列のまま canvas に渡す。
 * lightweight-charts 5 は `rgb(r g b / a)` の書き方も DOM 経由で解釈できる。
 * チャートの面 --card は明るい地では不透明な白なので、面の上の比はそのまま #FFFFFF の上の値になる
 * （scripts/check-chart-palette.ts の「参考: チャートの面」の行）。
 */
export function readChartTheme(): ChartTheme {
  if (typeof document === 'undefined') return { ...FALLBACK }
  const s = getComputedStyle(document.documentElement)
  return {
    background: readVar(s, '--card', FALLBACK.background),
    text: readVar(s, '--muted', FALLBACK.text),
    grid: readVar(s, '--border', FALLBACK.grid),
    border: readVar(s, '--border', FALLBACK.border),
    ink: readVar(s, '--ink', FALLBACK.ink),
    ink2: readVar(s, '--ink-2', FALLBACK.ink2),
    muted: readVar(s, '--muted', FALLBACK.muted),
    accent: readVar(s, '--brand', FALLBACK.accent),
  }
}

/**
 * 色に透明度を掛ける（AreaSeries の面など、線と同じ色の薄い塗りを作るとき）。
 * `#RRGGBB` と `rgb(r g b / a)` / `rgba(r, g, b, a)` を受け付け、`rgb(r g b / alpha)` で返す。
 * 読めない形はそのまま返す（描けなくなるより安全側）。
 */
export function fade(color: string, alpha: number): string {
  const c = color.trim()
  const hex6 = /^#([0-9a-f]{6})$/i.exec(c)
  if (hex6) {
    const n = parseInt(hex6[1], 16)
    return `rgb(${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255} / ${alpha})`
  }
  const fn = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/.exec(c)
  if (fn) return `rgb(${fn[1]} ${fn[2]} ${fn[3]} / ${alpha})`
  return c
}

/**
 * 系列の見た目。色に加えて線の形でも区別する（DESIGN.md §5-1・§6-14「色だけに頼らない」）。
 * dash は SVG の stroke-dasharray と同じ並び（空＝実線）。width は px。
 */
export type SeriesStyle = { color: string; dash: readonly number[]; width: 1 | 2 }

/**
 * 系列色（DESIGN.md §5-1「チャートの系列色」が正）。線・点など図形にだけ使い、文字には使わない。
 *
 * 検査は scripts/check-chart-palette.ts（2026-09-25・旧道具 validate_palette.js は失われたため作り直し）。
 * 明るい地 #F6F8FB（既定＝:root の --bg）と面 #FFFFFF（--bg "#FFFFFF"）の両方で 5 項目（地との比 3:1・
 * 系列同士 ΔE ≥ 8・色覚3型の変換後も ΔE ≥ 8・明度の帯・線種の冗長性）に合格した値（L1・2026-10-12 に
 * 明るい地で再実行。4色は 2026-09-28 の暗い地の検証から変えていない＝両方の地で 3:1 以上）。
 *
 *   you      #5681DC = 3.54 on #F6F8FB  青（旧 #3468C0 は ai の紫と1型色覚で ΔE 1.9＝見分けられず、
 *                                         同じ色相で L* を +10 した。2026-09-28）
 *   ai       #8E5BC4 = 4.44             紫
 *   master   #C26A2A = 3.66             橙
 *   baseline #7C889B = 3.37             灰
 *
 * 損益の緑/赤（--success / --danger）は状態の色なので、系列には使わない
 * （DECISIONS 2026-09-10・2026-09-24 の不変条件）。青緑 --brand も線に使わない（§5-1）。
 *
 * テクニカル指標線は「系列が1本だけの図は主役だけ系列色、補助線は名前を添える」規則に寄せ、
 * MA20・MACD 本線を主役の青、MA50・MACD シグナルを橙、BB・RSI 本線を紫、MA200 を灰の破線に割り当てる。
 * 決算マーカーは #A8761F（明るい地の上 3.74）。暗い地のときの #C08A2E は明るい地で 2.85 と 3:1 未達だったので
 * L1 で差し替え、--warning-ink（文字・#8A5300）との同値は解いた（マーカーは図形で、文字の閾値とは別）。
 */
export const SERIES = {
  /** あなた（利用者）の資産曲線・主系列。実線 2px。 */
  you:      { color: '#5681DC', dash: [],     width: 2 },
  /** AI の系列。破線 2px。 */
  ai:       { color: '#8E5BC4', dash: [6, 4], width: 2 },
  /** 著名投資家の系列。点線 2px。 */
  master:   { color: '#C26A2A', dash: [2, 3], width: 2 },
  /** 基準（元本・指数）。細い実線 1px。 */
  baseline: { color: '#7C889B', dash: [],     width: 1 },

  /** 短期移動平均。主役の線として青。 */
  ma20:     { color: '#5681DC', dash: [],     width: 1 },
  /** 中期移動平均。補助の線として橙。 */
  ma50:     { color: '#C26A2A', dash: [],     width: 1 },
  /** 長期移動平均。基準に近い役割なので灰の破線。 */
  ma200:    { color: '#7C889B', dash: [6, 4], width: 1 },
  /** ボリンジャーバンドの上下バンド（破線）。 */
  band:     { color: '#8E5BC4', dash: [6, 4], width: 1 },
  /** RSI 本線（別の図なので band と同じ紫の実線）。 */
  rsi:      { color: '#8E5BC4', dash: [],     width: 1 },
  /** MACD 本線。 */
  macd:     { color: '#5681DC', dash: [],     width: 1 },
  /** MACD シグナル線。 */
  signal:   { color: '#C26A2A', dash: [],     width: 1 },
  /** 決算マーカー。 */
  earnings: { color: '#A8761F', dash: [],     width: 1 },
} as const satisfies Record<string, SeriesStyle>

/** SVG の stroke-dasharray に渡す値。実線なら undefined（属性を出さない）。 */
export function svgDash(s: SeriesStyle): string | undefined {
  return s.dash.length ? s.dash.join(' ') : undefined
}

// lightweight-charts 5.2 の LineStyle（enum を import しないのは、scripts/check-*.ts が Node でこの
// ファイルを読むため。lightweight-charts を巻き込まない）。使う側で `as LineStyle` を付ける。
// 注記: 凡例の SVG dash（`svgDash()` が返す "6 4" / "2 3"）と canvas の実描画（Dashed は [2w, 2w]・
// Dotted は [w, w] を lightweight-charts 内部で使う）は、線の種類（破線/点線）は一致するが間隔の数値は同一ではない。
const LW_LINE_STYLE = { solid: 0, dotted: 1, dashed: 2 } as const

/**
 * lightweight-charts の LineStyle に対応する数（Solid=0 / Dotted=1 / Dashed=2）。
 */
export function lineStyleOf(s: SeriesStyle): 0 | 1 | 2 {
  if (s.dash.length === 0) return LW_LINE_STYLE.solid
  return s.dash[0] <= 2 ? LW_LINE_STYLE.dotted : LW_LINE_STYLE.dashed
}

/**
 * 出来高など、面で塗る際の透過サフィックス（8桁 hex のα）。#RRGGBB の後ろに付ける。
 * 2026-09-28 時点で使う側は無い（出来高の図が無い）。'55'（33%）は明るい地でも面として読める濃さなので据え置き。
 * トークン由来の rgb(…) には付けられないので、その場合は fade() を使うこと。
 */
export const VOLUME_ALPHA = '55'
