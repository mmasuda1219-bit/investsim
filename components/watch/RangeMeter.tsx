// /watch S1: 52週レンジのメーター。
//
// 「安値 ── 現在地 ── 高値」を1本の台で見せる。汎用化しない（引数は3値＋通貨だけ）。
// dataviz 規則: 図だけを出さず、両端の実額・現在地の実額・レンジ内の位置（%）を必ず文字で添える。
// 原則9: 高値・安値のどちらかが無ければ図を描かず、無い理由を書く（0や仮の値で埋めない）。
//
// 色はライト基調トークンのみ。緑/赤は損益専用なのでここでは使わない。
// アクセント（--accent）は EvidenceMap の結論ノード専用なので、ここでは使わない。

export interface RangeMeterProps {
  low?: number
  high?: number
  current: number
  /** 実単位の通貨記号。`.T` 銘柄は '¥'、それ以外は '$'。 */
  currency: '$' | '¥'
}

/** DecisionCard の fmtPrice と同じ書式（円は整数、ドルは小数2桁）。$と¥を混ぜない。 */
export const fmtAmount = (currency: '$' | '¥', n: number) =>
  currency === '¥'
    ? `¥${n.toLocaleString('ja-JP', { maximumFractionDigits: 0 })}`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function RangeMeter({ low, high, current, currency }: RangeMeterProps) {
  if (low == null || high == null || !(high > low)) {
    return (
      <p className="text-sm text-muted leading-relaxed max-w-[42rem]">
        52週の高値・安値が取得できていないため、この図は出せません。
      </p>
    )
  }

  // 現在地がレンジ外（52週レンジ更新直後など）でも図が壊れないよう 0〜100 に留める。
  // 数字の方は留めずに実際の位置（%）を出す。
  const ratio = (current - low) / (high - low)
  const pct = Math.round(ratio * 100)
  const clamped = Math.min(100, Math.max(0, ratio * 100))

  return (
    <figure className="w-full">
      <figcaption className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <span className="text-sm text-ink-2">52週レンジの中での現在地</span>
        <span className="text-[13px] font-semibold text-ink tabular-nums">{fmtAmount(currency, current)}</span>
        <span className="text-[13px] text-ink-2">
          52週レンジの <span className="font-semibold text-ink tabular-nums">{pct}%</span> の位置
        </span>
      </figcaption>

      {/* 台。塗りは安値→現在地。現在地は点＋リング。 */}
      <div
        role="img"
        aria-label={`52週安値 ${fmtAmount(currency, low)}、52週高値 ${fmtAmount(currency, high)}、現在 ${fmtAmount(currency, current)}（レンジの ${pct}% の位置）`}
        className="relative w-full h-2 rounded bg-panel border border-border"
      >
        {/* globals.css に bg-border / bg-ink のユーティリティは無いので CSS 変数を直接使う */}
        <div
          aria-hidden
          className="absolute inset-y-0 left-0 rounded-l"
          style={{ width: `${clamped}%`, backgroundColor: 'var(--border)' }}
        />
        <span
          aria-hidden
          className="absolute top-1/2 block w-2.5 h-2.5 rounded-full -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${clamped}%`, backgroundColor: 'var(--ink)', boxShadow: '0 0 0 2px var(--panel)' }}
        />
      </div>

      <div className="mt-1.5 flex justify-between text-xs text-muted tabular-nums">
        <span>
          <span className="font-mono">{fmtAmount(currency, low)}</span> 安値
        </span>
        <span>
          高値 <span className="font-mono">{fmtAmount(currency, high)}</span>
        </span>
      </div>
    </figure>
  )
}
