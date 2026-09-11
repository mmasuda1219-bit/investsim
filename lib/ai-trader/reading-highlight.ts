// /watch: AIの文（technicals / fundamentals の先頭の文 / newsInfluence）を「そのままの文字列の並び」に
// 分割し、許可リストに完全一致する数値トークンだけに印を付ける純関数。
//
// 目的は表示上の区切りをつくることだけ。AIの文は自由形式（区切りが 、・。で＝ と混在）で表に分解
// できないので、文中の数値トークンをその場で包む。抜き出して別の表にはしない（文脈が失われる）。
//
// 絶対条件: 全セグメントを連結すると入力と完全一致する（1文字も変えない・足さない・削らない）。
//   scripts/check-reading-highlight.ts がこれを担保する。
//
// 許可リスト（これ以外は plain のまま。推測で広げない）:
//   metric … 指標名＋数値＋単位まで。直後の評価語（割安・秀逸 等）は含めない（AIの評価であり
//            サイトが強調してはいけない）。`D/E=2.81x` のような `=` 付きは許可リスト外なので plain。
//   signal … technicals 用のテクニカル信号語。
//   括弧内の `価格<MA20<MA50` のような式は、どのパターンにも当たらないので plain のまま。
//
// 原則11: 評価語（割安・優良・買い時）に印を付けない。印は数値・信号語だけ。

export type ReadingKind = 'plain' | 'metric' | 'signal'

export interface ReadingSegment {
  text: string
  kind: ReadingKind
}

// 指標名。`配当利回り` は `配当` より前に置く（先に当てないと `配当` + `利回り1.5%` に割れる）。
const METRIC_NAME = 'PER|PBR|ROE|ROA|PEG|D\\/E|FCF|EPS|営業利益率|粗利益率|売上成長|配当利回り|配当|時価総額'
// 数値は「数字で始まり数字で終わる」形に限る（`17.4` `1,234` `226`）。末尾の `.` `,` は文の句読点なので
// 取り込まない。桁区切りのカンマは「カンマ＋数字3つ」の形だけ許す（`PER 10, ROE` の `,` を札に
// 取り込まない）。単位は空白を挟んでもよいが、単位が無いときは空白を取り込まない（札の中に空白を残さない）。
const METRIC_NUMBER = '[$¥]?\\d+(?:,\\d{3})*(?:\\.\\d+)?'
const METRIC_UNIT = '(?:\\s?(?:x|倍|%|B|T|億|兆))?'
const METRIC_RE = `(?:${METRIC_NAME})\\s?${METRIC_NUMBER}${METRIC_UNIT}`

// テクニカル信号語。RSI は `RSI47` が基本だが小数（`RSI47.5`）が来ても札を割らない。
const SIGNAL_RE =
  'RSI\\d+(?:\\.\\d+)?|MACD(?:強気|弱気)|(?:上昇|下落)トレンド|横ばい|買われすぎ|売られすぎ|BB(?:内|上限超え|下限割れ)|ゴールデンクロス|デッドクロス'

// 1本の正規表現にまとめ、どちらのグループが当たったかで kind を決める。
// どのパターンも空文字には当たらない（必ず1文字以上のリテラルを含む）ので無限ループしない。
// 先頭の後読み (?<![A-Za-z]) は語境界: `SUPER 8` の `PER 8`、`REPS 3.2` の `EPS 3.2` に当てない。
const TOKEN_RE = new RegExp(`(?<![A-Za-z])(?:(${METRIC_RE})|(${SIGNAL_RE}))`, 'g')

/**
 * AIの文を plain / metric / signal のセグメント列に分割する。
 * 空文字・null・undefined は `[]`（連結すると '' で入力と一致）。
 */
export function highlightReading(text: string | null | undefined): ReadingSegment[] {
  if (!text) return []
  const out: ReadingSegment[] = []
  let cursor = 0
  TOKEN_RE.lastIndex = 0
  for (let m = TOKEN_RE.exec(text); m !== null; m = TOKEN_RE.exec(text)) {
    const start = m.index
    const end = start + m[0].length
    if (start > cursor) out.push({ text: text.slice(cursor, start), kind: 'plain' })
    out.push({ text: m[0], kind: m[1] !== undefined ? 'metric' : 'signal' })
    cursor = end
  }
  if (cursor < text.length) out.push({ text: text.slice(cursor), kind: 'plain' })
  return out
}
