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
 * 系列色（あなた / AI / 著名投資家 / 基準、テクニカル指標線）は「ブランド」でも
 * 「成功/失敗」でもなく、単に系列を見分けるための色なので対応するトークンが無い。
 * SERIES だけはこのファイルが正であり、トークンとは二重管理になっていない。
 * 値の根拠は DESIGN.md §5-1「チャートの系列色」。
 */

/** SSR時・CSS変数が読めない時の保険。globals.css の :root と同じ値。 */
const FALLBACK = {
  background: '#FFFFFF',
  text: '#5B677A',
  grid: '#C3CCD8',
  border: '#C3CCD8',
  up: '#177A4F',
  down: '#C03535',
  muted: '#5B677A',
  accent: '#1A4787',
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
  /** ブランド色（紺青 --brand）。資産曲線など「あなた」に寄せた主系列。 */
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
    accent: readVar(s, '--brand', FALLBACK.accent),
  }
}

/**
 * 系列色（DESIGN.md §5-1「チャートの系列色」が正）。
 *
 * 線・点など図形にだけ使い、文字には使わない。系列は色に加えて線の形でも
 * 区別する（あなた=実線2px / AI=破線2px / 著名投資家=点線2px / 基準=細い実線1px）。
 * 白の上のコントラスト比（図形の目安 3:1。2026-09-11 実測）:
 *   you      #3468C0 = 5.40  紺青 --brand を線用に明るくした青
 *   ai       #8E5BC4 = 4.73  紫
 *   master   #C26A2A = 3.90  橙
 *   baseline #7C889B = 3.59  灰（= --border-input）
 * 3色は dataviz スキルの validate_palette.js（色覚多様性の検査）5項目すべて合格。
 *
 * 損益の緑/赤（--success / --danger）は状態の色なので、系列には使わない
 * （DECISIONS 2026-09-10 の不変条件）。
 *
 * テクニカル指標線は「系列が1本だけの図は主役だけ青、補助線は --muted の
 * 破線・点線＋名前」という規則に寄せ、MA20 を主役の青、MA50 / BB / MACD
 * シグナルを補助の色に割り当てる。
 */
export const SERIES = {
  /** あなた（利用者）の資産曲線・主系列。 */
  you: '#3468C0',
  /** AI の系列。 */
  ai: '#8E5BC4',
  /** 著名投資家の系列。 */
  master: '#C26A2A',
  /** 基準（元本・指数）。 */
  baseline: '#7C889B',

  /** 短期移動平均。主役の線として青。 */
  ma20: '#3468C0',
  /** 長期移動平均。補助の線として橙。 */
  ma50: '#C26A2A',
  /** ボリンジャーバンドの上下バンド・RSI 本線。 */
  band: '#8E5BC4',
  /** MACD シグナル線。 */
  signal: '#C26A2A',
  /** 決算マーカー。 */
  earnings: '#8A5300',
} as const

/** ローソク足の出来高など、面で塗る際の透過サフィックス（8桁hexのα）。 */
export const VOLUME_ALPHA = '55'
