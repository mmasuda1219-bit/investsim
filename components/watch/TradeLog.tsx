'use client'

import type { AITrade, Holding } from '@/lib/ai-trader/engine'

// ── 往復（買い→売りの1対）───────────────────────────────────────────────
// 1行＝1往復。対応づけは engine の意味論に合わせる:
//   - 同じ銘柄への再 buy は同一ポジションへの買い増し（avgCost を加重平均で再計算）
//   - sell は常に全株を手放す（engine.ts executeTrades）
// したがって「1回の売りは、それまでの未対応の買いを全部吸収して1往復」になる。
// 買値は Σ(price×shares)/Σshares の加重平均、株数は Σshares。
// もともと app/watch/client.tsx の toChartTrades にあったロジックをここへ移した。
export type RoundTripStatus =
  | 'win'        // 売却済み・利益
  | 'loss'       // 売却済み・損失
  | 'flat'       // 売却済み・損益ゼロ
  | 'open'       // 未決済（holdings にある）。損益は「含み」
  | 'unmatched'  // 買いの記録はあるが、対応する売りも保有も無い（記録の欠け）
  | 'noBuy'      // 売りの記録はあるが、対応する買いが無い（記録の欠け。trades は200件で切られる）

// 売買1件の根拠。旧 ReferencePanel（スライドオーバー）で読めていた
// テクニカル／ファンダメンタル／出典を落とさないために持つ。
export interface TradeAnalysis {
  technicals?:   string
  fundamentals?: string
  sources?:      string[]
}

export interface RoundTrip {
  status:     RoundTripStatus
  symbol:     string
  /** 最初の買いの日時（ISO）。noBuy は無し */
  buyAt?:     string
  /** 加重平均の買値（Σ(price×shares)/Σshares）。noBuy は無し */
  buyPrice?:  number
  /** 合計株数。noBuy は無し */
  buyShares?: number
  /** 買いが1件ならその理由。複数なら番号付きで並べる */
  buyReason?: string
  buyAnalysis?: TradeAnalysis
  /** この往復に畳まれた買いの件数（買い増しがあれば 2 以上） */
  buyCount:   number
  sellAt?:    string        // ISO（open/unmatched は無し）
  sellPrice?: number
  sellShares?: number
  sellReason?: string
  sellAnalysis?: TradeAnalysis
  /** 損益額。open は currentPrice が無いと undefined */
  pnl?:       number
  /** 損益%。open は currentPrice が無いと undefined */
  pnlPct?:    number
  /** 保有日数（open は now まで）。noBuy は不明 */
  daysHeld?:  number
}

const DAY_MS = 86_400_000

function daysBetween(fromIso: string, toMs: number): number {
  const d = (toMs - new Date(fromIso).getTime()) / DAY_MS
  return Math.max(0, Math.round(d))
}

function numbered(items: Array<string | undefined>): string | undefined {
  const present = items.map(s => (s ?? '').trim())
  if (present.every(s => s === '')) return undefined
  if (present.length === 1) return present[0]
  return present.map((s, i) => `${i + 1}) ${s || '—'}`).join('\n')
}

// 複数の買いを1往復に畳むときの根拠。1件ならそのまま、複数なら番号付き。
function mergeBuys(buys: AITrade[]): {
  buyPrice: number
  buyShares: number
  buyReason?: string
  buyAnalysis: TradeAnalysis
} {
  const sumShares = buys.reduce((a, b) => a + b.shares, 0)
  // 記録の total は小数2桁・shares は4桁に丸められているため、price×shares で
  // 加重する（買いが1件なら買値そのもの。engine の avgCost の計算と同じ）。
  const sumTotal  = buys.reduce((a, b) => a + b.price * b.shares, 0)
  const sources = Array.from(new Set(buys.flatMap(b => b.sources ?? [])))
  return {
    buyPrice:  sumShares > 0 ? sumTotal / sumShares : 0,
    buyShares: sumShares,
    buyReason: numbered(buys.map(b => b.reason)),
    buyAnalysis: {
      technicals:   numbered(buys.map(b => b.technicals)),
      fundamentals: numbered(buys.map(b => b.fundamentals)),
      sources:      sources.length > 0 ? sources : undefined,
    },
  }
}

/**
 * 売買記録を「往復」に畳む。
 * @param trades   session.trades（新しい順で入っている）
 * @param symbol   対象銘柄
 * @param holding  未決済ポジション（あれば1行として必ず出す）
 * @param currentPrice 含み損益の計算に使う現在値（無ければ含み損益は空欄）
 * @param now      「今日」。保有日数の基準。呼び出し側から渡す（決定的にするため）
 */
export function pairRoundTrips(
  trades: AITrade[],
  symbol: string,
  holding: Holding | undefined,
  currentPrice: number | undefined,
  now: Date,
): RoundTrip[] {
  const oldestFirst = [...trades].filter(t => t.symbol === symbol).reverse()
  const nowMs = now.getTime()

  const closed: RoundTrip[] = []
  let pendingBuys: AITrade[] = []

  for (const t of oldestFirst) {
    if (t.action === 'buy') {
      pendingBuys.push(t)
      continue
    }
    if (t.action !== 'sell') continue

    if (pendingBuys.length === 0) {
      // 買いの記録が無い売り。trades は200件で古い順に切られるので、長期運用で
      // 実際に起きる。黙って消すと記録の欠けが隠れるので、行として出す。
      closed.push({
        status:     'noBuy',
        symbol,
        buyCount:   0,
        sellAt:     t.timestamp,
        sellPrice:  t.price,
        sellShares: t.shares,
        sellReason: t.reason,
        sellAnalysis: { technicals: t.technicals, fundamentals: t.fundamentals, sources: t.sources },
      })
      continue
    }

    // engine の sell は全株を手放す＝それまでの買い全部がこの1往復に畳まれる。
    const m = mergeBuys(pendingBuys)
    const first = pendingBuys[0]
    const pnl    = (t.price - m.buyPrice) * t.shares
    const pnlPct = m.buyPrice > 0 ? (t.price / m.buyPrice - 1) * 100 : 0
    closed.push({
      status:     pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'flat',
      symbol,
      buyAt:      first.timestamp,
      buyPrice:   m.buyPrice,
      buyShares:  m.buyShares,
      buyReason:  m.buyReason,
      buyAnalysis: m.buyAnalysis,
      buyCount:   pendingBuys.length,
      sellAt:     t.timestamp,
      sellPrice:  t.price,
      sellShares: t.shares,
      sellReason: t.reason,
      sellAnalysis: { technicals: t.technicals, fundamentals: t.fundamentals, sources: t.sources },
      pnl,
      pnlPct,
      daysHeld:   daysBetween(first.timestamp, new Date(t.timestamp).getTime()),
    })
    pendingBuys = []
  }

  // 未決済の往復は必ず1行として出す。隠すと「勝った往復だけ」が並び、
  // 記録が実態より良く見える（COMPANY.md 原則9）。
  // 値は holdings（＝現在の実ポジション）を正とする。買い増しがあった場合は
  // avgCost に畳まれているので、残った pendingBuys はこの1行に吸収される。
  const open: RoundTrip[] = []
  if (holding && holding.shares > 0) {
    const hasCur = typeof currentPrice === 'number' && Number.isFinite(currentPrice)
    const multi = pendingBuys.length > 1 ? mergeBuys(pendingBuys) : undefined
    open.push({
      status:    'open',
      symbol,
      buyAt:     holding.entryAt,
      buyPrice:  holding.avgCost,
      buyShares: holding.shares,
      buyReason: multi?.buyReason ?? holding.entryReasoning,
      buyAnalysis: multi?.buyAnalysis
        ?? { technicals: holding.entryTechnicals, fundamentals: holding.entryFundamentals },
      buyCount:  Math.max(1, pendingBuys.length),
      pnl:       hasCur ? (currentPrice! - holding.avgCost) * holding.shares : undefined,
      pnlPct:    hasCur && holding.avgCost > 0 ? (currentPrice! / holding.avgCost - 1) * 100 : undefined,
      daysHeld:  daysBetween(holding.entryAt, nowMs),
    })
  } else if (pendingBuys.length > 0) {
    // 保有が無いのに買いが残っている＝売りの記録が欠けている。消さずに出す。
    // 買い増し分は同じポジションなので1行に畳む。
    const m = mergeBuys(pendingBuys)
    const first = pendingBuys[0]
    open.push({
      status:    'unmatched',
      symbol,
      buyAt:     first.timestamp,
      buyPrice:  m.buyPrice,
      buyShares: m.buyShares,
      buyReason: m.buyReason,
      buyAnalysis: m.buyAnalysis,
      buyCount:  pendingBuys.length,
      daysHeld:  daysBetween(first.timestamp, nowMs),
    })
  }

  // 新しいものを上に。未決済（＝いちばん新しい状態）を先頭に置く。
  return [...open, ...closed.reverse()]
}

// ── 通貨 ──────────────────────────────────────────────────────────────────
// `.T` は円（整数）、それ以外はドル（小数2桁）。
// 同じページの他の表示（app/watch/client.tsx の売買履歴タブ）もこの関数を使う。
export function isJPSymbol(symbol: string) { return symbol.endsWith('.T') }

export function fmtPrice(symbol: string, n: number) {
  return isJPSymbol(symbol)
    ? `¥${Math.round(n).toLocaleString('en-US')}`
    : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
export function fmtMoneySigned(symbol: string, n: number) {
  const sign = n > 0 ? '+' : n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return isJPSymbol(symbol)
    ? `${sign}¥${Math.round(abs).toLocaleString('en-US')}`
    : `${sign}$${abs.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}
function fmtPctSigned(n: number) {
  return `${n > 0 ? '+' : ''}${n.toFixed(2)}%`
}
// NY市場日付（サーバーの日次カウンタ・他の表示と同じ基準）
function dateNY(iso: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date(iso))
}

// ── 表示 ──────────────────────────────────────────────────────────────────
// 結果の色は「✓/✗ のアイコン＋符号付き数値」とセットでのみ使う。
// 買い/売りの方向には色を使わない（AITradeChart 側のコメント参照）。
// 行の背景は塗らず、左端2pxの罫（border-l-2）だけで状態を示す。
const STATUS_STYLE: Record<RoundTripStatus, { icon: string; label: string; text: string; rule: string }> = {
  win:       { icon: '✓', label: '利益',   text: 'text-[var(--success)]', rule: 'border-[var(--success)]' },
  loss:      { icon: '✗', label: '損失',   text: 'text-[var(--danger)]',  rule: 'border-[var(--danger)]'  },
  flat:      { icon: '=', label: '±0',     text: 'text-ink-2',            rule: 'border-[var(--border)]'  },
  open:      { icon: '○', label: '保有中', text: 'text-ink-2',            rule: 'border-[var(--border)]'  },
  unmatched: { icon: '?', label: '売り記録なし', text: 'text-muted',      rule: 'border-[var(--border)]'  },
  noBuy:     { icon: '?', label: '買い記録なし', text: 'text-muted',      rule: 'border-[var(--border)]'  },
}

// 理由の下に畳んで置く根拠（テクニカル／ファンダメンタル／出典）。
// 旧 ReferencePanel で読めていた情報を、行の中で開けるようにして残す。
function AnalysisDetails({ a }: { a?: TradeAnalysis }) {
  const has = !!(a && (a.technicals || a.fundamentals || (a.sources && a.sources.length > 0)))
  if (!has) return null
  return (
    <details className="mt-1">
      <summary className="text-xs text-muted cursor-pointer select-none hover:text-ink-2">根拠を開く</summary>
      <div className="mt-1.5 space-y-1.5 text-xs text-ink-2 leading-relaxed whitespace-pre-wrap">
        {a!.technicals && (
          <div><span className="text-muted">テクニカル: </span>{a!.technicals}</div>
        )}
        {a!.fundamentals && (
          <div><span className="text-muted">ファンダメンタル: </span>{a!.fundamentals}</div>
        )}
        {a!.sources && a!.sources.length > 0 && (
          <div><span className="text-muted">出典: </span>{a!.sources.join(' / ')}</div>
        )}
      </div>
    </details>
  )
}

interface Props {
  symbol: string
  /** pairRoundTrips の結果。呼び出し側で1回だけ計算して渡す */
  rows:   RoundTrip[]
}

export default function TradeLog({ symbol, rows }: Props) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted py-6 text-center">
        この銘柄では、まだ売買の記録がありません
      </p>
    )
  }

  const th = 'py-2 px-3 font-medium text-muted text-xs whitespace-nowrap'
  const num = 'font-mono tabular-nums text-right whitespace-nowrap'

  return (
    // 横に伸びるのはこの表だけ。ページ本体を横スクロールさせない。
    <div className="overflow-x-auto">
      <table className="w-full min-w-[880px] text-sm border-collapse">
        <thead>
          <tr className="border-b border-border">
            <th className={`${th} text-left`}>結果</th>
            <th className={`${th} text-right`}>損益%</th>
            <th className={`${th} text-left`}>買った日・値</th>
            <th className={`${th} text-left`}>売った日・値</th>
            <th className={`${th} text-right`}>保有日数</th>
            <th className={`${th} text-right`}>損益額</th>
            <th className={`${th} text-left`}>買った理由</th>
            <th className={`${th} text-left`}>売った理由</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const s = STATUS_STYLE[r.status]
            const isOpen = r.status === 'open'
            const hasPnl = typeof r.pnl === 'number' && typeof r.pnlPct === 'number'
            // 含み損益も同じ ✓/✗ の規則で色をつけるが、「含み」と明記して確定損益と区別する
            const pnlText = hasPnl
              ? (r.pnl! > 0 ? 'text-[var(--success)]' : r.pnl! < 0 ? 'text-[var(--danger)]' : 'text-ink-2')
              : 'text-muted'
            return (
              <tr key={`${r.buyAt ?? 'nobuy'}-${r.sellAt ?? 'open'}-${i}`} className="border-b border-border align-top">
                {/* 左端2pxのステータス罫。背景は塗らない */}
                <td className={`py-2.5 px-3 border-l-2 ${s.rule} whitespace-nowrap`}>
                  <span className={`font-semibold ${s.text}`}>
                    <span aria-hidden="true">{s.icon}</span> {s.label}
                  </span>
                </td>
                <td className={`py-2.5 px-3 ${num} font-semibold ${pnlText}`}>
                  {hasPnl ? (
                    <>
                      {fmtPctSigned(r.pnlPct!)}
                      {isOpen && <span className="ml-1 text-xs font-normal text-muted">含み</span>}
                    </>
                  ) : (
                    <span className="font-normal">—</span>
                  )}
                </td>
                <td className="py-2.5 px-3 whitespace-nowrap">
                  {r.buyAt && r.buyPrice != null && r.buyShares != null ? (
                    <>
                      <div className="text-ink-2 tabular-nums">
                        {dateNY(r.buyAt)}
                        {r.buyCount > 1 && (
                          <span className="ml-1 text-xs text-muted">ほか買い増し{r.buyCount - 1}回</span>
                        )}
                      </div>
                      <div className="font-mono tabular-nums text-ink">
                        {fmtPrice(symbol, r.buyPrice)}
                        <span className="ml-1 text-xs text-muted">× {r.buyShares.toFixed(2)}</span>
                        {r.buyCount > 1 && <span className="ml-1 text-xs text-muted">平均</span>}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
                <td className="py-2.5 px-3 whitespace-nowrap">
                  {r.sellAt && r.sellPrice != null ? (
                    <>
                      <div className="text-ink-2 tabular-nums">{dateNY(r.sellAt)}</div>
                      <div className="font-mono tabular-nums text-ink">
                        {fmtPrice(symbol, r.sellPrice)}
                        {r.sellShares != null && (
                          <span className="ml-1 text-xs text-muted">× {r.sellShares.toFixed(2)}</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <span className="text-muted">{isOpen ? '未売却' : '—'}</span>
                  )}
                </td>
                <td className={`py-2.5 px-3 ${num} text-ink-2`}>
                  {typeof r.daysHeld === 'number' ? `${r.daysHeld}日` : '—'}
                </td>
                <td className={`py-2.5 px-3 ${num} font-semibold ${pnlText}`}>
                  {hasPnl ? (
                    <>
                      {fmtMoneySigned(symbol, r.pnl!)}
                      {isOpen && <span className="ml-1 text-xs font-normal text-muted">含み</span>}
                    </>
                  ) : (
                    <span className="font-normal">—</span>
                  )}
                </td>
                <td className="py-2.5 px-3 text-ink-2 leading-relaxed min-w-[14rem] max-w-[22rem]">
                  <div className="line-clamp-3 whitespace-pre-line" title={r.buyReason ?? ''}>{r.buyReason || '—'}</div>
                  <AnalysisDetails a={r.buyAnalysis} />
                </td>
                <td className="py-2.5 px-3 text-ink-2 leading-relaxed min-w-[14rem] max-w-[22rem]">
                  <div className="line-clamp-3" title={r.sellReason ?? ''}>{r.sellReason || '—'}</div>
                  <AnalysisDetails a={r.sellAnalysis} />
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
