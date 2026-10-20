/**
 * 「添削プロトタイプ」（/study・2026-10-09・S-A）の型。I/O を持たない。
 *
 * 一番大事な型は `Sourced<T>`。**画面に出す数値は必ず出典（SourceRef）と組にする**。
 * `number` をそのまま置ける場所をデータ（lib/lab/9983.ts）に作らないことで、
 * 「出典の無い数字を1つも画面に出さない」（DECISIONS 2026-10-09 の不変条件）を型で守る。
 * scripts/check-lab-9983.ts (b) がデータを再帰的に歩き、SourceRef の無い number が無いことを見る。
 */

/** 出典。画面にはこの label と asOf を数字の直下に出す（DESIGN.md §4-2 R8） */
export interface SourceRef {
  /** 画面に出す名前（例: 決算短信（2026年8月期・通期）） */
  label: string
  /** 一次情報の URL。www.fastretailing.com / www.jpx.co.jp / www.nikkei.com だけ */
  url: string
  /** いつ時点の数字か（YYYY-MM-DD、または「2026年9月末」のような文字） */
  asOf: string
  /** 注記（概数・計算値など）。画面にそのまま出す */
  note?: string
}

/** 出典つきの値。数値はこの形でしか持たない */
export interface Sourced<T> {
  value: T
  source: SourceRef
}

/** 会計年度の鍵。8月決算なので FY2026 ＝ 2026年8月期（2025-09-01〜2026-08-31） */
export type FyKey = 'FY2022' | 'FY2023' | 'FY2024' | 'FY2025' | 'FY2026'

/** 数値の単位（整形は lib/lab/money.ts） */
export type Unit = 'millionYen' | 'yen' | 'percent' | 'times'

/** 1期分の点。会社が開示していない期は value を null にし、理由を missing に書く */
export interface SeriesPoint {
  fy: FyKey
  value: Sourced<number> | null
  missing?: string
}

/** 5期の系列（折れ線1本） */
export interface Series {
  key: string
  label: string
  unit: Unit
  /** 数字の定義（ROE・ROA のように定義を必ず併記するもの） */
  definition?: string
  points: SeriesPoint[]
  /**
   * 最新の期の前期比（%・会社公表の値）。あれば画面はこれを出す（値から計算すると丸めで 0.1pt ずれることがある。例: 事業利益 +30.4%）。
   * 無い系列は lib/lab/display.ts が値から計算する。検査は両者が 0.1pt 以内で一致することを見る
   */
  yoy?: Sourced<number>
}

/** 平均との比較（出典が取れた PER だけ） */
export interface Comparison {
  label: string
  value: Sourced<number>
  unit: Unit
}

/** 単発の値（時点つき）。株価・予想PER・配当予想など */
export interface Headline {
  label: string
  value: Sourced<number>
  unit: Unit
}

/**
 * 「？」で開く30秒の解説。本文には数字を直接書かず `{var}` で埋める（lib/lab/display.ts の fill）。
 * facts ＝ 事実の記述、readings ＝ 2通りの読み方の併置。結論は書かない
 */
export interface Explanation {
  facts: string[]
  readings: [string, string]
}

/** 画面2の1項目 */
export interface MetricItem {
  key: string
  label: string
  /** (a) 今の数値（系列の最新値とは別に単発で持つもの。PER・配当利回りなど） */
  headlines?: Headline[]
  /** (b) 5期の折れ線。無い項目（PER・セグメント）は空配列にし、trendNote に理由を書く */
  series: Series[]
  trendNote?: string
  /** (c) 平均との比較 */
  comparisons?: Comparison[]
  /** (d) 解説 */
  explain: Explanation
}

/** セグメント別売上の1行 */
export interface Segment {
  key: string
  label: string
  /** 前期（百万円） */
  prev: Sourced<number>
  /** 当期（百万円。会社の億円表示からの概数） */
  curr: Sourced<number>
  /** 前期比（%・会社公表値） */
  yoy: Sourced<number>
}

/** 来期の会社予想の1行 */
export interface Forecast {
  key: string
  label: string
  value: Sourced<number>
  unit: Unit
  /** 前期比（%・会社公表値） */
  yoy: Sourced<number>
}
