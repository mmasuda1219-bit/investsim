'use client'

/**
 * チャートの色を1か所に集約する。
 *
 * ■ なぜこのファイルが要るか
 * lightweight-charts は CSS クラスを受け付けず、色を JS の値として渡すしか無い。
 * そのため各チャートコンポーネントに '#0f1117' のような暗色が直書きされていて、
 * globals.css のトークンを差し替えてもチャートだけ暗いまま取り残されていた。
 *
 * ■ 二重管理を避ける方法
 * 面・文字・枠線・騰落色は `getComputedStyle` で :root のトークンを実行時に読む。
 * したがって globals.css の :root を差し替えればチャートも自動で追随し、
 * ここに色をコピーして持つ必要は無い（FALLBACK は SSR/取得失敗時の保険）。
 *
 * ■ 唯一トークン化できない色（＝ここが定義場所）
 * テクニカル指標線（MA20 / MA50 / BB / RSI / MACD）は「ブランド」でも
 * 「成功/失敗」でもなく、単に系列を見分けるための色なので対応するトークンが無い。
 * SERIES だけはこのファイルが正であり、トークンとは二重管理になっていない。
 */

/** SSR時・CSS変数が読めない時の保険。globals.css の :root と同じ値。 */
const FALLBACK = {
  background: '#FFFFFF',
  text: '#6B6862',
  grid: '#D6D0C3',
  border: '#D6D0C3',
  up: '#177A4F',
  down: '#C03535',
  muted: '#6B6862',
  accent: '#B8491B',
} as const

export type ChartTheme = {
  /** チャートの地。カード面と同じ紙。 */
  background: string
  /** 軸ラベルの文字色。 */
  text: string
  /** 目盛りのグリッド線。 */
  grid: string
  /** 軸の枠線。 */
  border: string
  /** 陽線・上昇・買い。 */
  up: string
  /** 陰線・下落・売り。 */
  down: string
  /** 補助線（基準線・水平ライン）。 */
  muted: string
  /** 資産曲線などブランド寄りの主系列。 */
  accent: string
}

function readVar(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  const v = styles.getPropertyValue(name).trim()
  return v || fallback
}

/**
 * :root のトークンを読んでチャート用の色を返す。
 * クライアントの useEffect 内から呼ぶこと（document を参照するため）。
 */
export function readChartTheme(): ChartTheme {
  if (typeof document === 'undefined') return { ...FALLBACK }
  const s = getComputedStyle(document.documentElement)
  return {
    background: readVar(s, '--card', FALLBACK.background),
    text: readVar(s, '--muted', FALLBACK.text),
    grid: readVar(s, '--border', FALLBACK.grid),
    border: readVar(s, '--border', FALLBACK.border),
    up: readVar(s, '--success', FALLBACK.up),
    down: readVar(s, '--danger', FALLBACK.down),
    muted: readVar(s, '--muted', FALLBACK.muted),
    accent: readVar(s, '--accent-ink', FALLBACK.accent),
  }
}

/**
 * テクニカル指標の系列色。
 *
 * 明るい地の上では、暗色時代に使っていた明るい系列色がほぼ全滅する。
 * グラフィック要素の目安 3:1 に対して実測した結果（地 = --card #FFFFFF）:
 *
 *   旧 MA50  #f59e0b = 2.15  ❌ → #BB4D00 (amber-700) = 5.03  ✅
 *   旧 MA20  #3b82f6 = 3.68  △ → #1447E6 (blue-700)  = 6.83  ✅（余裕を取る）
 *   旧 BB    #8b5cf6 = 4.23  ✅ だが線が細く見えにくいので #6E11B0 = 8.86 へ
 *   旧 資産曲線 #22d3ee = 1.81 ❌ → --accent-ink #B8491B = 5.24 ✅（readChartTheme 側）
 *
 * ローソク足の騰落色も明るい地では基準未達だったため、トークンへ寄せた:
 *   旧 上昇 #26a69a = 3.00（--bg 上では 2.85 ❌） → --success #177A4F = 5.34 ✅
 *   旧 上昇 #22c55e = 2.28 ❌                     → --success #177A4F = 5.34 ✅
 *   旧 下落 #ef5350 = 3.49 / #ef4444 = 3.76      → --danger  #C03535 = 5.52 ✅
 */
export const SERIES = {
  /** 短期移動平均。 */
  ma20: '#1447E6',
  /** 長期移動平均。 */
  ma50: '#BB4D00',
  /** ボリンジャーバンドの上下バンド・RSI 本線。 */
  band: '#6E11B0',
  /** MACD シグナル線。 */
  signal: '#BB4D00',
  /** 決算マーカー。 */
  earnings: '#973C00',
} as const

/** ローソク足の出来高など、面で塗る際の透過サフィックス（8桁hexのα）。 */
export const VOLUME_ALPHA = '55'
