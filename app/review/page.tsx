'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { LoginLink } from '@/components/LoginLink'
import { buildJudgements } from '@/lib/review/judgement'
import { parseReason } from '@/lib/trade/reason'
import {
  fetchPortfolio,
  requestReset,
  getPortfolioValue,
  INITIAL_CASH,
  type Portfolio,
} from '@/lib/portfolio'

function formatUSD(value: number): string {
  return value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function formatDate(timestamp: number): string {
  const d = new Date(timestamp)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const hh = String(d.getHours()).padStart(2, '0')
  const min = String(d.getMinutes()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd} ${hh}:${min}`
}

/**
 * 保存された理由を表示する。
 *
 * 2026-09-03 から `/trade`・TradeModal は理由を «問いへの分解» で保存する
 * （見出し付きテキスト・lib/trade/reason.ts）。見出しがあれば問いごとに分けて出し、
 * 無ければ旧形式の自由記述としてそのまま出す。**旧データを欠けたように見せない。**
 */
function ReasonReadout({ text }: { text: string }) {
  const sections = parseReason(text)
  if (sections.length === 1 && sections[0].label === null) {
    return <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{sections[0].value}</p>
  }
  return (
    <dl className="space-y-1">
      {sections.map((s, i) => (
        <div key={`${s.label ?? 'free'}-${i}`} className="flex gap-2">
          <dt className="text-[11px] text-muted shrink-0 w-20 pt-0.5">{s.label ?? '—'}</dt>
          <dd className="text-sm text-slate-300 leading-relaxed whitespace-pre-line min-w-0">{s.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export default function PortfolioPage() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null)
  const [prices, setPrices] = useState<Record<string, number>>({})
  const [loadingPrices, setLoadingPrices] = useState(false)
  // null = まだ判定中。false = 未ログイン（この面は «記録を見る» 面なのでログインが要る）。
  const [signedIn, setSignedIn] = useState<boolean | null>(null)

  const applyPortfolio = (p: Portfolio) => {
    setPortfolio(p)
    if (p.positions.length > 0) {
      setLoadingPrices(true)
      Promise.all(
        p.positions.map(pos =>
          fetch(`/api/stocks/${pos.symbol}`)
            .then(r => r.json())
            .then(q => [pos.symbol, q.price] as [string, number])
            .catch(() => [pos.symbol, pos.avgCost] as [string, number])
        )
      ).then(entries => {
        setPrices(Object.fromEntries(entries))
        setLoadingPrices(false)
      })
    } else {
      setPrices({})
      setLoadingPrices(false)
    }
  }

  useEffect(() => {
    let alive = true
    fetchPortfolio().then(r => {
      if (!alive) return
      setSignedIn(r.status === 'ok')
      if (r.status === 'ok') applyPortfolio(r.portfolio)
    })
    return () => { alive = false }
  }, [])

  const handleReset = async () => {
    if (!confirm('ポートフォリオをリセットしますか？全ての取引履歴と保有株が削除されます。')) return
    const r = await requestReset()
    if (r.status === 'ok') applyPortfolio(r.portfolio)
    else if (r.status === 'unauthenticated') setSignedIn(false)
  }

  if (signedIn === false) {
    return (
      <div className="max-w-xl mx-auto space-y-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-emerald-400 uppercase">04 振り返る</p>
          <h1 className="text-2xl font-bold text-white mt-1">判断を振り返る</h1>
        </div>
        <div className="bg-panel border border-border rounded-xl p-8 text-center space-y-4">
          <p className="text-slate-300 text-sm">
            ここには<strong className="text-white">あなたの</strong>判断の記録が並びます。
          </p>
          <p className="text-muted text-xs leading-relaxed">
            記録はアカウントに保存されるので、ログインが必要です。<br />
            「見る」「まねる」はログインなしで使えます。
          </p>
          <div className="flex items-center justify-center gap-3 flex-wrap pt-1">
            <LoginLink className="px-4 py-2 bg-white text-gray-900 text-xs font-medium rounded-lg hover:bg-gray-100 transition-colors" />
            <Link href="/watch" className="px-4 py-2 bg-panel border border-border text-slate-300 hover:text-white hover:border-blue-500 text-xs font-medium rounded-lg transition-colors">
              ログインせずに見る
            </Link>
          </div>
        </div>
      </div>
    )
  }

  if (!portfolio) {
    return (
      <div className="space-y-6">
        <div className="bg-panel border border-border rounded-xl p-8 text-center text-muted text-sm animate-pulse">
          読み込み中...
        </div>
      </div>
    )
  }

  const totalValue = getPortfolioValue(portfolio.positions, prices)
  const totalAssets = totalValue + portfolio.cash
  const totalPnL = totalAssets - INITIAL_CASH
  const totalPnLPct = (totalPnL / INITIAL_CASH) * 100
  const pnlPositive = totalPnL >= 0

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-emerald-400 uppercase">04 振り返る</p>
          <h1 className="text-2xl font-bold text-white mt-1">判断を振り返る</h1>
          <p className="text-muted text-sm mt-1">
            見るべきは儲けた額ではなく、判断の中身です。初期資本 {formatUSD(INITIAL_CASH)}
          </p>
        </div>
        {/* whitespace-nowrap と shrink-0 が無いと、スマホ幅で見出しに押されて
            「リセ / ッ / ト」の3行に折れる（実測 64x58px）。 */}
        <button
          onClick={handleReset}
          className="shrink-0 whitespace-nowrap px-4 py-2 bg-red-900/40 hover:bg-red-800/60 border border-red-700 text-red-300 hover:text-red-200 text-sm font-medium rounded-lg transition-colors"
        >
          リセット
        </button>
      </div>

      {/* 判断と結果の突き合わせ — この面の主役。金額より先に出す */}
      <div>
        <h2 className="text-white font-semibold text-sm mb-3">判断と、その結果</h2>
        {(() => {
          const { judgements, closedCount, openCount, withEntryReason, entryCount } =
            buildJudgements(portfolio.trades)

          if (entryCount === 0) {
            return (
              <div className="bg-panel border border-border rounded-xl p-8 text-center space-y-2">
                <p className="text-sm text-slate-300">まだ判断の記録がありません</p>
                <p className="text-xs text-muted">
                  「やる」で売買すると、そのときに書いた理由と、あとで出た結果がここに並びます。
                </p>
                {/* 結果が出るまで待たずに始められる道を、空の状態でこそ見せる。
                    すでに実際に売買している人は、来た時点で振り返る材料を持っている。 */}
                <p className="text-xs text-muted leading-relaxed pt-1">
                  すでに実際に売買したことがあるなら、<strong className="text-slate-300">過去の取引を入れれば今日から振り返れます。</strong>
                </p>
                <div className="flex items-center justify-center gap-4 flex-wrap pt-1">
                  <Link href="/trade" className="text-xs text-emerald-400 hover:text-emerald-300">
                    やってみる →
                  </Link>
                  <Link href="/review/backfill" className="text-xs text-emerald-400 hover:text-emerald-300">
                    過去の取引を記録する →
                  </Link>
                </div>
              </div>
            )
          }

          return (
            <div className="space-y-3">
              {/* 数えられる事実だけを出す。判断の質を点数にはしない */}
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                <span>買った回数 <span className="text-slate-200 tabular-nums font-semibold">{entryCount}</span></span>
                <span>うち理由が残っているもの <span className="text-slate-200 tabular-nums font-semibold">{withEntryReason}</span></span>
                <span>結果が出たもの <span className="text-slate-200 tabular-nums font-semibold">{closedCount}</span></span>
                <span>保有中 <span className="text-slate-200 tabular-nums font-semibold">{openCount}</span></span>
              </div>

              {judgements.slice(0, 12).map((j, i) => {
                const closedTrade = j.pnlPct !== null
                const win = (j.pnlPct ?? 0) >= 0
                return (
                  <div key={`${j.symbol}-${j.entryAt}-${i}`} className="bg-panel border border-border rounded-xl p-4 space-y-3">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className="font-mono font-bold text-white text-sm">{j.symbol}</span>
                      {/* 練習場の売買と «実際にやった取引の記録» を必ず見分けられるようにする。
                          混ぜて見せると、どれが練習でどれが本物か本人にも分からなくなる。 */}
                      {j.source === 'past' && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded border border-blue-700/60 bg-blue-950/30 text-blue-300">
                          実際の取引の記録
                        </span>
                      )}
                      <span className="text-xs text-muted">{j.shares.toLocaleString()}株</span>
                      {closedTrade ? (
                        <>
                          <span className={`text-xs font-bold tabular-nums ${win ? 'text-green-400' : 'text-red-400'}`}>
                            {win ? '+' : ''}{j.pnlPct!.toFixed(2)}%
                          </span>
                          <span className="text-xs text-muted">{j.heldDays}日保有</span>
                        </>
                      ) : (
                        <span className="text-xs text-amber-500">保有中（結果はまだ出ていません）</span>
                      )}
                      <span className="text-xs text-muted ml-auto font-mono">{formatDate(j.entryAt)}</span>
                    </div>

                    <div className="space-y-2 pl-3 border-l-2 border-border">
                      <div>
                        <p className="text-[11px] text-muted mb-0.5">買ったときに考えていたこと</p>
                        {j.entryReason ? (
                          <ReasonReadout text={j.entryReason} />
                        ) : (
                          <p className="text-xs text-slate-600">理由が残っていません（記録を始める前の取引です）</p>
                        )}
                      </div>
                      {closedTrade && (
                        <div>
                          <p className="text-[11px] text-muted mb-0.5">売ったときに考えていたこと</p>
                          {j.exitReason ? (
                            <ReasonReadout text={j.exitReason} />
                          ) : (
                            <p className="text-xs text-slate-600">理由が残っていません</p>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                )
              })}

              <p className="text-[11px] text-muted leading-relaxed">
                買いと売りは「買った順に売れていく」とみなして対応づけています。
                練習場の売買と「実際の取引の記録」は別々に突き合わせます。
                {closedCount < 3 && '結果が出た取引が3件未満のため、傾向としてはまだ読めません。'}
                <Link href="/review/backfill" className="text-emerald-400 hover:text-emerald-300 ml-1">
                  過去の取引を記録する →
                </Link>
              </p>
            </div>
          )
        })()}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-panel border border-border rounded-xl p-5">
          <p className="text-muted text-xs mb-1">総資産</p>
          <p className="text-white text-2xl font-bold font-mono">{formatUSD(totalAssets)}</p>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <p className="text-muted text-xs mb-1">損益</p>
          <p className={`text-2xl font-bold font-mono ${pnlPositive ? 'text-green-400' : 'text-red-400'}`}>
            {pnlPositive ? '+' : ''}{formatUSD(totalPnL)}
          </p>
          <p className={`text-sm font-mono ${pnlPositive ? 'text-green-400' : 'text-red-400'}`}>
            ({pnlPositive ? '+' : ''}{totalPnLPct.toFixed(2)}%)
          </p>
        </div>
        <div className="bg-panel border border-border rounded-xl p-5">
          <p className="text-muted text-xs mb-1">現金</p>
          <p className="text-white text-2xl font-bold font-mono">{formatUSD(portfolio.cash)}</p>
        </div>
      </div>

      {/* Holdings Table */}
      <div>
        <h2 className="text-white font-semibold text-sm mb-3">保有銘柄</h2>
        {loadingPrices ? (
          <div className="bg-panel border border-border rounded-xl p-8 text-center text-muted text-sm animate-pulse">
            価格を取得中...
          </div>
        ) : portfolio.positions.length === 0 ? (
          <div className="bg-panel border border-border rounded-xl p-8 text-center text-muted text-sm space-y-3">
            <p>まだ保有銘柄がありません。</p>
            {/* 「銘柄を探す」は `/`（LP）に戻るだけで銘柄を探せず、「スクリーナー」は
                導線から外した `/screener` の旧名だった。実データで銘柄を出せるのは
                `/learn` の自動スクリーニングだけなので、文言と行き先を揃える。 */}
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <Link href="/learn" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium rounded-lg transition-colors">
                条件から銘柄を探す
              </Link>
              <Link href="/trade" className="px-4 py-2 bg-panel border border-border hover:border-blue-500 text-slate-300 hover:text-white text-xs font-medium rounded-lg transition-colors">
                自分で判断して売買する
              </Link>
            </div>
          </div>
        ) : (
          <div className="bg-panel border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted text-xs">
                    <th className="text-left px-4 py-3 font-medium">シンボル</th>
                    <th className="text-left px-4 py-3 font-medium">社名</th>
                    <th className="text-right px-4 py-3 font-medium">株数</th>
                    <th className="text-right px-4 py-3 font-medium">平均コスト</th>
                    <th className="text-right px-4 py-3 font-medium">現在値</th>
                    <th className="text-right px-4 py-3 font-medium">評価額</th>
                    <th className="text-right px-4 py-3 font-medium">損益</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {portfolio.positions.map(pos => {
                    const currentPrice = prices[pos.symbol] ?? pos.avgCost
                    const marketValue = pos.shares * currentPrice
                    const pnl = (currentPrice - pos.avgCost) * pos.shares
                    const pnlPct = ((currentPrice - pos.avgCost) / pos.avgCost) * 100
                    const posPositive = pnl >= 0
                    return (
                      <tr key={pos.symbol} className="hover:bg-surface/50 transition-colors">
                        <td className="px-4 py-3">
                          <Link
                            href={`/stocks/${pos.symbol}`}
                            className="font-mono font-bold text-blue-400 hover:text-blue-300 transition-colors"
                          >
                            {pos.symbol}
                          </Link>
                        </td>
                        <td className="px-4 py-3 text-slate-300 max-w-[180px] truncate">
                          {pos.name}
                        </td>
                        <td className="px-4 py-3 text-right text-white font-mono">
                          {pos.shares.toLocaleString()}株
                        </td>
                        <td className="px-4 py-3 text-right text-slate-300 font-mono">
                          {formatUSD(pos.avgCost)}
                        </td>
                        <td className="px-4 py-3 text-right text-white font-mono">
                          {formatUSD(currentPrice)}
                        </td>
                        <td className="px-4 py-3 text-right text-white font-mono">
                          {formatUSD(marketValue)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono">
                          <span className={posPositive ? 'text-green-400' : 'text-red-400'}>
                            {posPositive ? '+' : ''}{formatUSD(pnl)}<br />
                            <span className="text-xs">
                              ({posPositive ? '+' : ''}{pnlPct.toFixed(2)}%)
                            </span>
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Trade History */}
      <div>
        <h2 className="text-white font-semibold text-sm mb-3">取引履歴（最新10件）</h2>
        {portfolio.trades.length === 0 ? (
          <div className="bg-panel border border-border rounded-xl p-8 text-center text-muted text-sm">
            取引履歴がありません。
          </div>
        ) : (
          <div className="bg-panel border border-border rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-muted text-xs">
                    <th className="text-left px-4 py-3 font-medium">日時</th>
                    <th className="text-left px-4 py-3 font-medium">種別</th>
                    <th className="text-left px-4 py-3 font-medium">シンボル</th>
                    <th className="text-left px-4 py-3 font-medium">社名</th>
                    <th className="text-right px-4 py-3 font-medium">株数</th>
                    <th className="text-right px-4 py-3 font-medium">単価</th>
                    <th className="text-right px-4 py-3 font-medium">合計</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {portfolio.trades.slice(0, 10).map(trade => (
                    <tr key={trade.id} className="hover:bg-surface/50 transition-colors">
                      <td className="px-4 py-3 text-slate-300 text-xs font-mono whitespace-nowrap">
                        {formatDate(trade.timestamp)}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                          trade.action === 'buy'
                            ? 'bg-green-900/40 text-green-400'
                            : 'bg-red-900/40 text-red-400'
                        }`}>
                          {trade.action === 'buy' ? 'BUY' : 'SELL'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <Link
                          href={`/stocks/${trade.symbol}`}
                          className="font-mono font-bold text-blue-400 hover:text-blue-300 transition-colors"
                        >
                          {trade.symbol}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-slate-300 max-w-[160px] truncate">
                        {trade.name}
                      </td>
                      <td className="px-4 py-3 text-right text-white font-mono">
                        {trade.shares.toLocaleString()}株
                      </td>
                      <td className="px-4 py-3 text-right text-slate-300 font-mono">
                        {formatUSD(trade.price)}
                      </td>
                      <td className="px-4 py-3 text-right text-white font-mono">
                        {formatUSD(trade.shares * trade.price)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
