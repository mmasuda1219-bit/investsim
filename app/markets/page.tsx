'use client'

import { useEffect, useState } from 'react'
import type { MarketsResponse } from '@/app/api/markets/route'

/**
 * 旧 /markets。next.config.ts の 308 リダイレクトで /watch に送られるため通常は表示されない
 * （指数の要約は components/MarketOverview.tsx として /watch に吸収済み）。
 *
 * 2026-09-14: /api/markets がバフェット指標を返さなくなり、取れなかった指数を
 * ok:false・null で返す形に変わったので追従した。バフェット指標のゲージと解説は、
 * 実データの時価総額と GDP を取る仕組みが無いため外した（原則9）。
 */
export default function MarketsPage() {
  const [data, setData] = useState<MarketsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/markets')
      .then(r => r.json())
      .then((d: MarketsResponse) => {
        if (!d || !Array.isArray(d.indices)) throw new Error('形式が不正')
        setData(d)
      })
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="mx-auto max-w-7xl space-y-6">
      <h1 className="text-2xl font-bold text-ink">マーケット概況</h1>

      {/* ── 指数カード ── */}
      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-panel border border-border rounded-xl p-4 animate-pulse h-24" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-red-700 text-sm">データの取得に失敗しました。しばらくしてから再度お試しください。</p>
      )}

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {data.indices.map(idx => (
            <div key={idx.symbol} className="bg-panel border border-border rounded-xl p-4">
              <p className="text-muted text-xs mb-1 truncate">{idx.name}</p>
              {idx.ok ? (
                <>
                  <p className="text-ink text-xl font-bold font-mono">
                    {idx.symbol === '^TNX'
                      ? `${idx.price.toFixed(2)}%`
                      : idx.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                  </p>
                  <p className={`text-sm mt-1 ${idx.changePercent >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                    {idx.changePercent >= 0 ? '▲' : '▼'} {Math.abs(idx.changePercent).toFixed(2)}%
                  </p>
                </>
              ) : (
                // 取れなかった指数は数字を出さない（固定値や 0 で埋めない）
                <p className="text-muted text-sm">取得できませんでした</p>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
