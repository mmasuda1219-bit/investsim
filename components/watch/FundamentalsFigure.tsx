// /watch S1: ファンダメンタルの図。3層構造。
//
//   層1 スタットタイル4枚 … PER / ROE / 売上成長率 / D/E（数字と「何の数字か」の一言）
//   層2 RangeMeter        … 52週レンジの中での現在地
//   層3 全項目テーブル    … 折りたたみ。グループ分けして右揃えの数字列
//
// variant:
//   'full'（既定） … 層1＋層2 を常時、層3 を DetailsSection の折りたたみで出す
//   'inline'       … 層1＋層2 だけ。層3 は呼び出し側（EvidenceMap の行）が `FundamentalsTable` を
//                     自分の開閉の中に置く（根拠マップの開閉手段を1つに揃えるため）
//
// 原則9: 欠損は「未取得」と書き、なぜ無いかまで添える。
//   ・13項目の中で無い … 判断時点でデータ元（Yahoo Finance）から値が返らず N/A だった
//   ・13項目の外（6項目）… サイト側の当時の実装が保存していなかった（取得失敗ではない）
// 原則11: 「割安」「優良」などの評価語はサイト側で書かない。解釈はAIの文だけ。
// 前期比データが無いので delta / sparkline は出さない。

import type { FundamentalsData } from '@/types'
import DetailsSection from '@/components/analyze/DetailsSection'
import RangeMeter, { fmtAmount } from '@/components/watch/RangeMeter'
import { PARSEABLE_FIELDS, type FundamentalsLegacy } from '@/lib/ai-trader/fundamentals-parse'

export interface FundamentalsFigureProps {
  data: Partial<FundamentalsData>
  symbol: string
  /** 現在値（RangeMeter の現在地）。DecisionCard の price をそのまま渡す。 */
  price: number
  /**
   * この記録が持ちうる項目。旧判断（fundamentals 文字列のパース由来）は 13 項目。
   * 省略時は 13 項目（PARSEABLE_FIELDS）。
   */
  savedFields?: ReadonlyArray<keyof FundamentalsData>
  /** 'inline' は層1＋層2 だけ（層3 は `FundamentalsTable` を呼び出し側が置く）。既定 'full'。 */
  variant?: 'inline' | 'full'
  /**
   * 旧書式（v1）の記録についての注記（`parseFundamentalsWithMeta().legacy`）。
   * `debtToEquityUnitUnknown` のとき D/E は保存値をそのまま単位なしで出し、注記を添える。
   */
  legacy?: FundamentalsLegacy
}

// 'de' は D/E 専用。FundamentalsData.debtToEquity は Yahoo 原値の%表記（78.4 ＝ 0.78倍）なので
// 「78.4%（0.78倍）」と出す。v1 の記録（単位不明）は legacy で分岐する。
type Kind = 'x' | 'pct' | 'de' | 'amount' | 'big'

interface Row { field: keyof FundamentalsData; label: string; kind: Kind }
interface Group { title: string; rows: Row[] }

/** 全19項目。グループ分けは designer 指定。 */
const GROUPS: Group[] = [
  { title: '値段の高さ', rows: [
    { field: 'pe',         label: 'PER（株価収益率）',   kind: 'x' },
    { field: 'pb',         label: 'PBR（株価純資産倍率）', kind: 'x' },
    { field: 'pegRatio',   label: 'PEG',               kind: 'x' },
    { field: 'evToEbitda', label: 'EV/EBITDA',         kind: 'x' },
  ] },
  { title: '稼ぐ力', rows: [
    { field: 'roe',             label: 'ROE（自己資本利益率）', kind: 'pct' },
    { field: 'roa',             label: 'ROA（総資産利益率）',   kind: 'pct' },
    { field: 'operatingMargin', label: '営業利益率',            kind: 'pct' },
    { field: 'grossMargin',     label: '粗利益率',              kind: 'pct' },
    { field: 'profitMargin',    label: '純利益率',              kind: 'pct' },
    { field: 'eps',             label: 'EPS（1株利益）',        kind: 'amount' },
  ] },
  { title: '伸び', rows: [
    { field: 'revenueGrowth',  label: '売上成長率', kind: 'pct' },
    { field: 'earningsGrowth', label: '利益成長率', kind: 'pct' },
  ] },
  { title: '潰れにくさ', rows: [
    { field: 'debtToEquity', label: 'D/E（負債資本比率）', kind: 'de' },
    { field: 'currentRatio', label: '流動比率',            kind: 'x' },
    { field: 'freeCashflow', label: 'フリーキャッシュフロー', kind: 'big' },
  ] },
  { title: '規模・還元', rows: [
    { field: 'marketCap',     label: '時価総額', kind: 'big' },
    { field: 'dividendYield', label: '配当利回り', kind: 'pct' },
  ] },
  { title: '株価の位置', rows: [
    { field: 'week52High', label: '52週高値', kind: 'amount' },
    { field: 'week52Low',  label: '52週安値', kind: 'amount' },
  ] },
]

const ALL_FIELDS: ReadonlyArray<keyof FundamentalsData> = GROUPS.flatMap(g => g.rows.map(r => r.field))
const LABEL_OF: Record<keyof FundamentalsData, string> = Object.fromEntries(
  GROUPS.flatMap(g => g.rows.map(r => [r.field, r.label])),
) as Record<keyof FundamentalsData, string>

const currencyOf = (symbol: string): '$' | '¥' => (/\.T$/i.test(symbol) ? '¥' : '$')

const fmtX   = (n: number) => `${n.toLocaleString('ja-JP', { maximumFractionDigits: 2 })}倍`
const fmtPct = (n: number) => `${(n * 100).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}%`
/** 大きな金額。ドルは 10億ドル（B）単位、円は億円単位。 */
const fmtBig = (currency: '$' | '¥', n: number) =>
  currency === '¥'
    ? `¥${(n / 1e8).toLocaleString('ja-JP', { maximumFractionDigits: 0 })}億`
    : `$${(n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`

/** D/E（正準＝Yahoo 原値の%）: 「78.4%」。 */
const fmtDE = (n: number) => `${n.toLocaleString('ja-JP', { maximumFractionDigits: 1 })}%`
/** D/E の%を倍率に読み替えた文字列: 78.4 → 「0.78」。 */
const deTimes = (n: number) => (n / 100).toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
/** v1 の D/E（単位不明）: 保存値をそのまま、単位なし（推測で換算しない＝原則9）。 */
const fmtDEUnknown = (n: number) => n.toLocaleString('ja-JP', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

/** v1 記録の D/E に添える注記。値は当時AIに渡したもの。 */
const LEGACY_DE_NOTE =
  'この判断のときにAIへ渡した数字を、そのまま表示しています。当時は記録のしかたに不具合があり、「倍」なのか「%」なのかが記録から分かりません（9月11日に修正済み）。AIの文章も当時のままです。'

function fmtValue(kind: Kind, currency: '$' | '¥', n: number, legacy?: FundamentalsLegacy): string {
  switch (kind) {
    case 'x':      return fmtX(n)
    case 'pct':    return fmtPct(n)
    case 'de':     return legacy?.debtToEquityUnitUnknown ? fmtDEUnknown(n) : `${fmtDE(n)}（${deTimes(n)}倍）`
    case 'amount': return fmtAmount(currency, n)
    case 'big':    return fmtBig(currency, n)
  }
}

/** 層1のタイル。値が無ければ「未取得」と理由。評価語は書かない。 */
function StatTile({ label, note, value, caveat }: { label: string; note: string; value?: string; caveat?: string }) {
  return (
    <div className="bg-surface border border-border rounded-xl px-3 py-2.5 min-w-0">
      <div className="text-xs text-muted">{label}</div>
      {value != null ? (
        <div className="text-2xl font-semibold text-ink leading-tight mt-0.5 break-words">{value}</div>
      ) : (
        <div className="text-base font-semibold text-muted leading-tight mt-1">未取得</div>
      )}
      <div className="text-[13px] text-ink-2 leading-snug mt-1">
        {value != null ? note : 'この判断のときは、数字が手に入りませんでした'}
      </div>
      {value != null && caveat && (
        <div className="text-[13px] text-muted leading-snug mt-1">{caveat}</div>
      )}
    </div>
  )
}

export interface FundamentalsTableProps {
  data: Partial<FundamentalsData>
  symbol: string
  savedFields?: ReadonlyArray<keyof FundamentalsData>
  /** 旧書式（v1）の注記。`FundamentalsFigureProps.legacy` と同じ。 */
  legacy?: FundamentalsLegacy
}

/** 層3: 全項目テーブル＋欠損の説明。折りたたみの殻は持たない（呼び出し側が包む）。 */
export function FundamentalsTable({ data, symbol, savedFields = PARSEABLE_FIELDS, legacy }: FundamentalsTableProps) {
  const currency = currencyOf(symbol)
  const saved = new Set(savedFields)
  const unsaved = ALL_FIELDS.filter(f => !saved.has(f))
  const missingSaved = savedFields.filter(f => data[f] == null)

  return (
    <div className="space-y-3">
      <table className="w-full text-sm">
        <caption className="sr-only">ファンダメンタルの全項目</caption>
        {GROUPS.map(group => {
          const rows = group.rows.filter(r => saved.has(r.field))
          if (rows.length === 0) return null
          return (
            <tbody key={group.title}>
              <tr>
                <th scope="rowgroup" colSpan={2} className="text-left text-xs text-muted font-semibold pt-3 pb-1">
                  {group.title}
                </th>
              </tr>
              {rows.map(r => {
                const n = data[r.field]
                return (
                  <tr key={r.field} className="border-t border-border">
                    <th scope="row" className="text-left font-normal text-ink-2 py-1.5 pr-3">{r.label}</th>
                    <td className={`text-right py-1.5 font-mono tabular-nums ${n != null ? 'text-ink' : 'text-muted'}`}>
                      {n != null ? fmtValue(r.kind, currency, n, legacy) : '未取得'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          )
        })}
      </table>

      {legacy?.debtToEquityUnitUnknown && data.debtToEquity != null && (
        <p className="text-sm text-muted leading-relaxed max-w-[42rem]">
          D/E の値は{LEGACY_DE_NOTE}。
        </p>
      )}

      <p className="text-sm text-muted leading-relaxed max-w-[42rem]">
        {savedFields.length}項目のうち {missingSaved.length} 項目が未取得
        {missingSaved.length > 0 && '（この判断のときは、数字が手に入りませんでした）'}
      </p>

      {unsaved.length > 0 && (
        <p className="text-sm text-muted leading-relaxed max-w-[42rem]">
          この判断の時点では、以下の{unsaved.length}項目は保存されていません（当時のサイトの実装が記録していなかったもので、取得に失敗したのではありません）:
          {' '}
          {unsaved.map(f => LABEL_OF[f]).join('、')}
        </p>
      )}
    </div>
  )
}

export default function FundamentalsFigure({
  data,
  symbol,
  price,
  savedFields = PARSEABLE_FIELDS,
  variant = 'full',
  legacy,
}: FundamentalsFigureProps) {
  const currency = currencyOf(symbol)
  const de = data.debtToEquity
  const deUnitUnknown = legacy?.debtToEquityUnitUnknown === true
  const unsavedCount = ALL_FIELDS.filter(f => !new Set(savedFields).has(f)).length
  const scopeTitle = unsavedCount > 0
    ? `全項目を見る（この判断に保存されていた範囲・${savedFields.length}項目）`
    : `全項目を見る（${ALL_FIELDS.length}項目）`

  const v = (field: keyof FundamentalsData, kind: Kind) => {
    const n = data[field]
    return n != null ? fmtValue(kind, currency, n) : undefined
  }

  return (
    <div className="space-y-4">
      {/* 層1: スタットタイル */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        <StatTile label="PER"     note="今の株価は1年の利益の何年分か"        value={v('pe', 'x')} />
        <StatTile label="ROE"     note="株主のお金で年に何%稼いだか"          value={v('roe', 'pct')} />
        <StatTile label="売上成長率" note="前年から何%伸びたか"               value={v('revenueGrowth', 'pct')} />
        {/* D/E: v2 は「78.4%」＋「負債は自己資本の 0.78 倍」。v1（単位不明）は保存値そのまま・単位なし・注記つき */}
        <StatTile
          label="D/E"
          note={de != null && !deUnitUnknown ? `負債は自己資本の ${deTimes(de)} 倍` : '自己資本に対して借金がどれだけか'}
          value={de != null ? (deUnitUnknown ? fmtDEUnknown(de) : fmtDE(de)) : undefined}
          caveat={de != null && deUnitUnknown ? LEGACY_DE_NOTE : undefined}
        />
      </div>

      {/* 層2: 52週レンジ */}
      <RangeMeter low={data.week52Low} high={data.week52High} current={price} currency={currency} />

      {/* 層3: 全項目テーブル（折りたたみ）。inline では呼び出し側が置く */}
      {variant === 'full' && (
        <DetailsSection title={scopeTitle}>
          <FundamentalsTable data={data} symbol={symbol} savedFields={savedFields} legacy={legacy} />
        </DetailsSection>
      )}
    </div>
  )
}
