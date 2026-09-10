// /watch S1: 旧 `AIDecision.fundamentals` 文字列 → `Partial<FundamentalsData>` の純関数。
//
// `AIDecision.fundamentals` は「AIの1文 | PER=28.4x | ROE=31.2% | …」という形で、後半は
// engine.ts の `fmtFundamentals()` が生成した固定書式。自分たちのコードが書いた書式を
// 厳密に読み戻すだけなので捏造にはならない（原則9）。AIの文や書式に合わないトークンは
// 黙って捨てる。`N/A` は undefined のまま（0にしない）。
//
// `fmtFundamentals()` の実際の書式（2026-09 時点）:
//   PER=28.4x | PBR=5.1x | ROE=31.2% | ROA=N/A | 営業利益率=N/A | 粗利益率=N/A
//   | 売上成長=7.0% | D/E=0.67x | FCF=$1.2B | 時価総額=$226B | 配当利回り=1.5%
//   | 52週高値=123 | 安値=98
//   ・`x` `%` は先頭8項目。欠損時は `N/A`
//   ・`$…B` は10億ドル単位（FCF は負値あり: `$-1.2B`）。欠損時はトークン自体が無い
//   ・52週高値/安値は単位なしの整数。欠損時はトークン自体が無い
//   ・ファンダが丸ごと無いと全体が `-`

import type { FundamentalsData } from '@/types'

type Unit = 'x' | 'pct' | 'usdB' | 'raw'

/** ホワイトリスト（13項目）。この KEY 以外は無視する。 */
const SPEC: ReadonlyArray<{ key: string; field: keyof FundamentalsData; unit: Unit }> = [
  { key: 'PER',       field: 'pe',              unit: 'x' },
  { key: 'PBR',       field: 'pb',              unit: 'x' },
  { key: 'ROE',       field: 'roe',             unit: 'pct' },
  { key: 'ROA',       field: 'roa',             unit: 'pct' },
  { key: '営業利益率', field: 'operatingMargin', unit: 'pct' },
  { key: '粗利益率',   field: 'grossMargin',     unit: 'pct' },
  { key: '売上成長',   field: 'revenueGrowth',   unit: 'pct' },
  { key: 'D/E',       field: 'debtToEquity',    unit: 'x' },
  { key: 'FCF',       field: 'freeCashflow',    unit: 'usdB' },
  { key: '時価総額',   field: 'marketCap',       unit: 'usdB' },
  { key: '配当利回り', field: 'dividendYield',   unit: 'pct' },
  { key: '52週高値',   field: 'week52High',      unit: 'raw' },
  { key: '安値',       field: 'week52Low',       unit: 'raw' },
]

/** 旧書式に保存されうる `FundamentalsData` のフィールド（13項目）。 */
export const PARSEABLE_FIELDS: ReadonlyArray<keyof FundamentalsData> = SPEC.map(s => s.field)

// 正規表現リテラルで書く（文字列から組み立てるとエスケープ事故が起きやすい）。
const VALUE_RE: Record<Unit, RegExp> = {
  x:    /^(-?\d+(?:\.\d+)?)x$/,
  pct:  /^(-?\d+(?:\.\d+)?)%$/,
  usdB: /^\$(-?\d+(?:\.\d+)?)B$/,
  raw:  /^(-?\d+(?:\.\d+)?)$/,
}

const SEP = ' | '

/**
 * 1トークンが `fmtFundamentals()` の書式に完全一致するか。
 * キーがホワイトリストにあり、かつ値が `N/A` か単位付き数値のときだけ「書式トークン」。
 * AIの文が「D/E=2.81xは投資基準超過…」のようにキー名で始まることが実データにあるため、
 * キー名だけで判定してはいけない。
 */
function matchToken(token: string): { field: keyof FundamentalsData; value: number | undefined } | null {
  const eq = token.indexOf('=')
  if (eq <= 0) return null
  const spec = SPEC.find(s => s.key === token.slice(0, eq))
  if (!spec) return null
  const raw = token.slice(eq + 1)
  if (raw === 'N/A') return { field: spec.field, value: undefined }
  const m = VALUE_RE[spec.unit].exec(raw)
  if (!m) return null
  const n = Number(m[1])
  if (!Number.isFinite(n)) return null
  const value = spec.unit === 'pct' ? n / 100 : spec.unit === 'usdB' ? n * 1e9 : n
  return { field: spec.field, value }
}

/**
 * `KEY=VALUE` トークンを厳密に読む。
 * 返り値は採用できた項目だけを持つ（`N/A`・書式違い・未知キーは入らない）。
 */
export function parseFundamentals(text: string | null | undefined): Partial<FundamentalsData> {
  const out: Partial<FundamentalsData> = {}
  if (!text) return out
  for (const tokenRaw of text.split(SEP)) {
    const hit = matchToken(tokenRaw.trim())
    if (!hit || hit.value === undefined) continue
    out[hit.field] = hit.value
  }
  return out
}

/**
 * 書式トークンでも `-` でもない先頭トークン（＝AIの文）を返す。無ければ空文字。
 * 書式トークンより後ろにAIの文が来ることは無い（engine.ts が先頭に付ける）ので、
 * 最初の書式トークンで打ち切る。
 */
export function fundamentalsProse(text: string | null | undefined): string {
  if (!text) return ''
  const prose: string[] = []
  for (const tokenRaw of text.split(SEP)) {
    const token = tokenRaw.trim()
    if (token === '' || token === '-') continue
    if (matchToken(token)) break
    prose.push(token)
  }
  return prose.join(SEP)
}
