'use client'

import { useEffect, useState } from 'react'

interface IndexData {
  symbol: string
  name: string
  price: number
  change: number
  changePercent: number
}

interface BuffettData {
  value: number
  marketCap: number
  gdp: number
  label: string
  color: 'green' | 'yellow' | 'orange' | 'red'
}

interface MarketData {
  indices: IndexData[]
  buffettIndicator: BuffettData
}

const COLOR_MAP = {
  green:  { text: 'text-green-400',  border: 'border-green-500',  bg: 'bg-green-500' },
  yellow: { text: 'text-yellow-400', border: 'border-yellow-500', bg: 'bg-yellow-500' },
  orange: { text: 'text-orange-400', border: 'border-orange-500', bg: 'bg-orange-500' },
  red:    { text: 'text-red-400',    border: 'border-red-500',    bg: 'bg-red-500' },
}

// Zone boundaries as percentage of 0–200 range
const ZONES = [
  { pct: 75  / 200 * 100, label: '75%' },
  { pct: 90  / 200 * 100, label: '90%' },
  { pct: 115 / 200 * 100, label: '115%' },
  { pct: 135 / 200 * 100, label: '135%' },
]

export default function MarketsPage() {
  const [data, setData] = useState<MarketData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    fetch('/api/markets')
      .then(r => r.json())
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoading(false))
  }, [])

  return (
    <main className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      <h1 className="text-2xl font-bold text-white">マーケット概況</h1>

      {/* ── 指数カード ── */}
      {loading && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="bg-panel border border-border rounded-xl p-4 animate-pulse h-24" />
          ))}
        </div>
      )}

      {error && (
        <p className="text-red-400 text-sm">データの取得に失敗しました。しばらくしてから再度お試しください。</p>
      )}

      {data && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {data.indices.map(idx => (
              <div key={idx.symbol} className="bg-panel border border-border rounded-xl p-4">
                <p className="text-muted text-xs mb-1 truncate">{idx.name}</p>
                <p className="text-white text-xl font-bold font-mono">
                  {idx.symbol === '^TNX'
                    ? `${idx.price.toFixed(2)}%`
                    : idx.price.toLocaleString('en-US', { maximumFractionDigits: 0 })}
                </p>
                <p className={`text-sm mt-1 ${idx.changePercent >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {idx.changePercent >= 0 ? '▲' : '▼'} {Math.abs(idx.changePercent).toFixed(2)}%
                </p>
              </div>
            ))}
          </div>

          {/* ── バフェット指数 ── */}
          <section className="bg-panel border border-border rounded-xl p-6 space-y-5">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="text-lg font-semibold text-white">
                バフェット指数
                <span className="ml-2 text-sm font-normal text-muted">（株式時価総額 / GDP）</span>
              </h2>
              <span className={`text-sm font-medium px-3 py-1 rounded-full border ${COLOR_MAP[data.buffettIndicator.color].text} ${COLOR_MAP[data.buffettIndicator.color].border} bg-opacity-10`}>
                {data.buffettIndicator.label}
              </span>
            </div>

            {/* Gauge */}
            <div className="space-y-2">
              {/* Bar */}
              <div className="relative h-5 rounded-full overflow-hidden bg-gradient-to-r from-green-600 via-yellow-500 via-60% to-red-600">
                {/* Zone lines */}
                {ZONES.map(z => (
                  <div
                    key={z.pct}
                    className="absolute top-0 bottom-0 w-px bg-surface/60"
                    style={{ left: `${z.pct}%` }}
                  />
                ))}
              </div>

              {/* Zone labels */}
              <div className="relative h-4">
                {ZONES.map(z => (
                  <span
                    key={z.pct}
                    className="absolute text-xs text-muted -translate-x-1/2"
                    style={{ left: `${z.pct}%` }}
                  >
                    {z.label}
                  </span>
                ))}
              </div>

              {/* Marker row */}
              <div className="relative h-6 mt-1">
                <div
                  className="absolute -translate-x-1/2"
                  style={{ left: `${Math.min(data.buffettIndicator.value, 200) / 200 * 100}%` }}
                >
                  <div className={`flex flex-col items-center ${COLOR_MAP[data.buffettIndicator.color].text}`}>
                    <span className="text-xs font-bold font-mono">{data.buffettIndicator.value}%</span>
                    <span className="text-base leading-none">▲</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Interpretation */}
            <p className={`text-sm font-medium ${COLOR_MAP[data.buffettIndicator.color].text}`}>
              「{data.buffettIndicator.label}水準」
              {data.buffettIndicator.color === 'red' && ' — 市場全体が過熱している可能性があります。'}
              {data.buffettIndicator.color === 'orange' && ' — 株価が実体経済を上回っています。'}
              {data.buffettIndicator.color === 'yellow' && ' — 市場はおおむね適正な水準にあります。'}
              {data.buffettIndicator.color === 'green' && ' — 株価は割安圏にある可能性があります。'}
            </p>

            <div className="text-xs text-muted space-y-0.5">
              <p>時価総額（概算）: ${data.buffettIndicator.marketCap.toLocaleString()} 十億ドル</p>
              <p>米国GDP（2024年）: ${data.buffettIndicator.gdp.toLocaleString()} 十億ドル</p>
            </div>
          </section>

          {/* ── 解説 ── */}
          <section className="bg-panel border border-border rounded-xl p-6 space-y-3">
            <h2 className="text-base font-semibold text-white">バフェット指数とは？</h2>
            <p className="text-sm text-muted leading-relaxed">
              ウォーレン・バフェット氏が提唱した市場全体の割高・割安を測る指標です。
              全米株式時価総額（Wilshire 5000 指数で近似）を米国の名目 GDP で割り、パーセントで表します。
            </p>
            <ul className="text-sm text-muted space-y-1 list-disc list-inside">
              <li><span className="text-green-400 font-medium">75% 未満</span>：著しく割安 — 強気の買い場とされる</li>
              <li><span className="text-green-400 font-medium">75〜90%</span>：割安 — 良好な投資環境</li>
              <li><span className="text-yellow-400 font-medium">90〜115%</span>：適正水準 — 中立的な判断</li>
              <li><span className="text-orange-400 font-medium">115〜135%</span>：割高 — 慎重さが必要</li>
              <li><span className="text-red-400 font-medium">135% 超</span>：著しく割高 — 過熱リスクに注意</li>
            </ul>
            <p className="text-xs text-muted/60">
              ※ Wilshire 5000 の指数値を時価総額（十億ドル）の概算として使用しています。実際の時価総額とは異なる場合があります。
            </p>
          </section>
        </>
      )}
    </main>
  )
}
