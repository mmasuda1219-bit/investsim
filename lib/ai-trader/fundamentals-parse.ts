// /watch S1: 旧 `AIDecision.fundamentals` 文字列 → `Partial<FundamentalsData>` の純関数。
//
// `AIDecision.fundamentals` は「AIの1文 | PER=28.4x | ROE=31.2% | …」という形で、後半は
// engine.ts の `fmtFundamentals()` が生成した固定書式。自分たちのコードが書いた書式を
// 厳密に読み戻すだけなので捏造にはならない（原則9）。AIの文や書式に合わないトークンは
// 黙って捨てる。`N/A` は undefined のまま（0にしない）。
//
// `fmtFundamentals()` の書式は2世代ある。末尾の `fmt=2` トークンの有無で機械的に判定する。
//
// v1（2026-09-11 より前・`fmt=2` 無し）:
//   PER=28.4x | PBR=5.1x | ROE=31.2% | ROA=N/A | 営業利益率=N/A | 粗利益率=N/A
//   | 売上成長=7.0% | D/E=0.67x | FCF=$1.2B | 時価総額=$226B | 配当利回り=1.5%
//   | 52週高値=123 | 安値=98
//   ・`x` `%` は先頭8項目。欠損時は `N/A`
//   ・`$…B` は10億単位（FCF は負値あり: `$-1.2B`）。欠損時はトークン自体が無い。
//     `.T` 銘柄にも `$` が付いていた（通貨の誤り）ので、記号は無視して数値だけ採る
//   ・52週高値/安値は単位なしの整数。欠損時はトークン自体が無い
//   ・D/E の `x` は**単位が記録から判別できない**。Yahoo 由来の記録は%スケール
//     （`49.00x` ＝ 0.49倍）、mock フォールバック由来の記録は本当の倍率（`0.67x`）で、
//     書式が同じため区別できない。数値は保存値のまま返し（/100 も ×100 もしない）、
//     `legacy.debtToEquityUnitUnknown` で表示側に注記を促す（推測で換算しない＝原則9）
//   ・ファンダが丸ごと無いと全体が `-`
//
// v2（2026-09-11 以降・末尾に `fmt=2`）:
//   PER=36.1x | PBR=44.4x | ROE=148.8% | … | D/E=78.4% | FCF=$107.7B | 時価総額=$4766B
//   | 配当利回り=0.3% | 52週高値=$345 | 安値=$227 | fmt=2
//   ・D/E は `%`（FundamentalsData の正準単位＝Yahoo 原値の%表記）。`%` を剥がして 78.4 のまま返す
//   ・FCF／時価総額／52週高値・安値には銘柄の通貨記号（`$` `¥`、その他は `EUR ` のようにISOコード＋空白）。
//     記号は剥がして数値だけ返す（表示の通貨は銘柄から決める）

import type { FundamentalsData } from '@/types'

type Unit = 'x' | 'pct' | 'de' | 'moneyB' | 'raw'
type Format = 1 | 2

/** v2 書式の目印。engine.ts の `fmtFundamentals()` が末尾に付ける。 */
export const FORMAT_TOKEN = 'fmt=2'

/** v1（旧書式）の記録についての注記。表示側が「当時の値の単位は判別できない」と出すために使う。 */
export interface FundamentalsLegacy {
  /** v1 の `D/E=<数値>x` は%スケールと倍率が混在していて区別できない。値は保存値のまま。 */
  debtToEquityUnitUnknown: true
}

export interface ParsedFundamentals {
  data: Partial<FundamentalsData>
  format: Format
  legacy?: FundamentalsLegacy
}

/** ホワイトリスト（13項目）。この KEY 以外は無視する。 */
const SPEC: ReadonlyArray<{ key: string; field: keyof FundamentalsData; unit: Unit }> = [
  { key: 'PER',       field: 'pe',              unit: 'x' },
  { key: 'PBR',       field: 'pb',              unit: 'x' },
  { key: 'ROE',       field: 'roe',             unit: 'pct' },
  { key: 'ROA',       field: 'roa',             unit: 'pct' },
  { key: '営業利益率', field: 'operatingMargin', unit: 'pct' },
  { key: '粗利益率',   field: 'grossMargin',     unit: 'pct' },
  { key: '売上成長',   field: 'revenueGrowth',   unit: 'pct' },
  { key: 'D/E',       field: 'debtToEquity',    unit: 'de' },
  { key: 'FCF',       field: 'freeCashflow',    unit: 'moneyB' },
  { key: '時価総額',   field: 'marketCap',       unit: 'moneyB' },
  { key: '配当利回り', field: 'dividendYield',   unit: 'pct' },
  { key: '52週高値',   field: 'week52High',      unit: 'raw' },
  { key: '安値',       field: 'week52Low',       unit: 'raw' },
]

/** 旧書式に保存されうる `FundamentalsData` のフィールド（13項目）。 */
export const PARSEABLE_FIELDS: ReadonlyArray<keyof FundamentalsData> = SPEC.map(s => s.field)

// 正規表現リテラルで書く（文字列から組み立てるとエスケープ事故が起きやすい）。
// 書式ごとに厳密に分ける（v1 に `%` の D/E や `¥` は現れない。v2 に `x` の D/E は現れない）。
const NUM = /^(-?\d+(?:\.\d+)?)$/
const VALUE_RE: Record<Format, Record<Unit, RegExp>> = {
  1: {
    x:      /^(-?\d+(?:\.\d+)?)x$/,
    pct:    /^(-?\d+(?:\.\d+)?)%$/,
    de:     /^(-?\d+(?:\.\d+)?)x$/,
    moneyB: /^\$(-?\d+(?:\.\d+)?)B$/,
    raw:    NUM,
  },
  2: {
    x:      /^(-?\d+(?:\.\d+)?)x$/,
    pct:    /^(-?\d+(?:\.\d+)?)%$/,
    de:     /^(-?\d+(?:\.\d+)?)%$/,
    // 通貨記号は `$` `¥` か「ISOコード3文字＋空白」。engine.ts の currencySymbol() と対。
    moneyB: /^(?:\$|¥|[A-Z]{3} )?(-?\d+(?:\.\d+)?)B$/,
    raw:    /^(?:\$|¥|[A-Z]{3} )?(-?\d+(?:\.\d+)?)$/,
  },
}

const SEP = ' | '

function detectFormat(tokens: string[]): Format {
  return tokens.some(t => t.trim() === FORMAT_TOKEN) ? 2 : 1
}

/**
 * 1トークンが `fmtFundamentals()` の書式に完全一致するか。
 * キーがホワイトリストにあり、かつ値が `N/A` か単位付き数値のときだけ「書式トークン」。
 * AIの文が「D/E=2.81xは投資基準超過…」のようにキー名で始まることが実データにあるため、
 * キー名だけで判定してはいけない。
 */
function matchToken(token: string, format: Format): { field: keyof FundamentalsData; value: number | undefined } | null {
  const eq = token.indexOf('=')
  if (eq <= 0) return null
  const spec = SPEC.find(s => s.key === token.slice(0, eq))
  if (!spec) return null
  const raw = token.slice(eq + 1)
  if (raw === 'N/A') return { field: spec.field, value: undefined }
  const m = VALUE_RE[format][spec.unit].exec(raw)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  // `de`（D/E）は v1/v2 とも数値をそのまま（v2 は正準の%、v1 は単位不明の保存値）。
  const value = spec.unit === 'pct' ? n / 100 : spec.unit === 'moneyB' ? n * 1e9 : n
  return { field: spec.field, value }
}

/**
 * `KEY=VALUE` トークンを厳密に読み、書式の世代と v1 の注記を添えて返す。
 * `data` は採用できた項目だけを持つ（`N/A`・書式違い・未知キーは入らない）。
 * `legacy` は v1 で D/E が採用できたときだけ付く（D/E が無い記録に注記は要らない）。
 */
export function parseFundamentalsWithMeta(text: string | null | undefined): ParsedFundamentals {
  const data: Partial<FundamentalsData> = {}
  if (!text) return { data, format: 1 }
  const tokens = text.split(SEP)
  const format = detectFormat(tokens)
  for (const tokenRaw of tokens) {
    const hit = matchToken(tokenRaw.trim(), format)
    if (!hit || hit.value === undefined) continue
    data[hit.field] = hit.value
  }
  const legacy: FundamentalsLegacy | undefined =
    format === 1 && data.debtToEquity != null ? { debtToEquityUnitUnknown: true } : undefined
  return legacy ? { data, format, legacy } : { data, format }
}

/**
 * `KEY=VALUE` トークンを厳密に読む（`parseFundamentalsWithMeta().data` と同じ）。
 * 返り値は採用できた項目だけを持つ（`N/A`・書式違い・未知キーは入らない）。
 */
export function parseFundamentals(text: string | null | undefined): Partial<FundamentalsData> {
  return parseFundamentalsWithMeta(text).data
}

/**
 * 書式トークンでも `-` でも `fmt=2` でもない先頭トークン（＝AIの文）を返す。無ければ空文字。
 * 書式トークンより後ろにAIの文が来ることは無い（engine.ts が先頭に付ける）ので、
 * 最初の書式トークンで打ち切る。
 */
export function fundamentalsProse(text: string | null | undefined): string {
  if (!text) return ''
  const tokens = text.split(SEP)
  const format = detectFormat(tokens)
  const prose: string[] = []
  for (const tokenRaw of tokens) {
    const token = tokenRaw.trim()
    if (token === '' || token === '-') continue
    if (token === FORMAT_TOKEN || matchToken(token, format)) break
    prose.push(token)
  }
  return prose.join(SEP)
}
