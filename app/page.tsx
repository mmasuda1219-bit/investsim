'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import type { Signal } from '@/types'

const TradingChart = dynamic(() => import('@/components/TradingChart'), { ssr: false })

const SYMBOLS = ['AAPL', 'NVDA', 'MSFT', 'GOOGL', 'AMZN', 'TSLA', 'META', 'BRK-B', 'JPM', 'V']
const PERIODS: { label: string; value: '1y' | '5y' | '10y' }[] = [
  { label: '1年', value: '1y' },
  { label: '5年', value: '5y' },
  { label: '10年', value: '10y' },
]

const INVESTORS = ['バフェット', 'ソロス', 'リンチ', 'グレアム', 'ダリオ']
const INVESTOR_IDS: Record<string, string> = {
  バフェット: 'buffett',
  ソロス: 'soros',
  リンチ: 'lynch',
  グレアム: 'graham',
  ダリオ: 'dalio',
}
const INVESTOR_COLORS: Record<string, string> = {
  バフェット: 'bg-blue-900/40 border-blue-700 text-blue-300',
  ソロス: 'bg-purple-900/40 border-purple-700 text-purple-300',
  リンチ: 'bg-amber-900/40 border-amber-700 text-amber-300',
  グレアム: 'bg-cyan-900/40 border-cyan-700 text-cyan-300',
  ダリオ: 'bg-pink-900/40 border-pink-700 text-pink-300',
}

const ACTION_LABELS: Record<Signal['action'], string> = {
  buy: '買い',
  sell: '売り',
  hold: '様子見',
}
const ACTION_STYLES: Record<Signal['action'], string> = {
  buy: 'bg-emerald-900/50 text-emerald-400 border-emerald-700',
  sell: 'bg-red-900/50 text-red-400 border-red-700',
  hold: 'bg-gray-800 text-gray-400 border-gray-700',
}

export default function Home() {
  const [symbol, setSymbol] = useState('AAPL')
  const [customSymbol, setCustomSymbol] = useState('')
  const [viewPeriod, setViewPeriod] = useState<'1y' | '5y' | '10y'>('5y')
  const [selectedInvestor, setSelectedInvestor] = useState('バフェット')

  const [signals, setSignals] = useState<Record<string, Signal> | null>(null)
  const [signalsLoading, setSignalsLoading] = useState(true)
  const [signalsError, setSignalsError] = useState<string | null>(null)

  const activeSymbol = customSymbol.trim().toUpperCase() || symbol

  useEffect(() => {
    let cancelled = false
    setSignalsLoading(true)
    setSignalsError(null)
    setSignals(null)

    const timer = setTimeout(() => {
      fetch(`/api/signals/${encodeURIComponent(activeSymbol)}`)
        .then(async (res) => {
          const data = await res.json()
          if (!res.ok || data.error) throw new Error(data.error || 'シグナルの取得に失敗しました')
          if (!cancelled) setSignals(data.signals as Record<string, Signal>)
        })
        .catch((e) => {
          console.error('signals fetch failed:', e)
          if (!cancelled) setSignalsError('しばらくしてから再度お試しください')
        })
        .finally(() => {
          if (!cancelled) setSignalsLoading(false)
        })
    }, 350)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [activeSymbol])

  return (
    <div className="text-white">
      <div className="max-w-6xl mx-auto space-y-5">
        {/* CTA to autonomous AI trading engine */}
        <div className="bg-gradient-to-r from-emerald-900/40 to-blue-900/40 border border-emerald-800 rounded-xl px-5 py-4 flex flex-wrap items-center gap-4">
          <div>
            <div className="text-sm font-semibold text-emerald-300">AIが自律的に売買判断する本格エンジンを試す</div>
            <div className="text-xs text-gray-400 mt-0.5">Claude APIによるリアルタイム自律売買セッション — /ai-session</div>
          </div>
          <Link
            href="/ai-session"
            className="ml-auto text-sm font-medium px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 transition-colors text-white"
          >
            AIセッションを開始 →
          </Link>
        </div>

        {/* Controls */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-4 flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">銘柄</span>
            <div className="flex flex-wrap gap-1.5">
              {SYMBOLS.map((s) => (
                <button
                  key={s}
                  onClick={() => { setSymbol(s); setCustomSymbol('') }}
                  className={`text-xs px-2.5 py-1 rounded border font-mono transition-colors
                    ${activeSymbol === s && !customSymbol
                      ? 'bg-emerald-900/50 border-emerald-600 text-emerald-300'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`}
                >
                  {s}
                </button>
              ))}
            </div>
            <input
              type="text"
              placeholder="他の銘柄..."
              value={customSymbol}
              onChange={(e) => setCustomSymbol(e.target.value.toUpperCase())}
              className="w-28 text-xs bg-gray-800 border border-gray-700 rounded px-2.5 py-1 text-white placeholder-gray-600 focus:outline-none focus:border-gray-500"
            />
          </div>

          {/* Period buttons — controls visible range, data always 10y */}
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-gray-500">表示期間</span>
            <div className="flex gap-1">
              {PERIODS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => setViewPeriod(p.value)}
                  className={`text-xs px-3 py-1 rounded border transition-colors font-medium
                    ${viewPeriod === p.value
                      ? 'bg-blue-900/50 border-blue-600 text-blue-300'
                      : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'}`}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-700 ml-1">← 左ドラッグで更に遡れます</span>
          </div>
        </div>

        {/* Investor selector */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs text-gray-500">投資家モデル</span>
            {INVESTORS.map((inv) => (
              <button
                key={inv}
                onClick={() => setSelectedInvestor(inv)}
                className={`text-sm px-3 py-1.5 rounded-full border font-medium transition-all
                  ${selectedInvestor === inv
                    ? INVESTOR_COLORS[inv]
                    : 'bg-gray-800 border-gray-700 text-gray-500 hover:border-gray-500'}`}
              >
                {inv}
              </button>
            ))}
          </div>
          <div className="mt-3 text-xs text-gray-500 leading-relaxed">
            {selectedInvestor === 'バフェット' && 'バリュー投資・長期保有。PER＜15、ROE＞15%、低負債の割安株を厳選。内在価値の70%以下で買い、120%超で利確。'}
            {selectedInvestor === 'ソロス' && 'マクロ投資・反射理論。市場の誤認識を狙い、トレンド転換点で大きなポジション。短〜中期勝負。'}
            {selectedInvestor === 'リンチ' && '成長株投資・GARP。PEG＜1の高成長株を日常から発掘。市場が成長を認識する前に仕込む。'}
            {selectedInvestor === 'グレアム' && 'ディープバリュー。株価が純運転資本の2/3以下の超割安株のみ。安全マージン最優先。'}
            {selectedInvestor === 'ダリオ' && 'オールウェザー戦略。株30%・長期債40%・中期債15%・金7.5%・商品7.5%。リスクパリティで全天候型。'}
          </div>
        </div>

        {/* Chart */}
        <TradingChart symbol={activeSymbol} viewPeriod={viewPeriod} trades={[]} />

        {/* Real-time investor signals */}
        <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800 flex items-center gap-2">
            <span className="text-sm font-medium text-gray-300">投資家別リアルタイム判断</span>
            <span className="text-xs text-gray-600">— {activeSymbol}</span>
          </div>

          {signalsLoading && (
            <div className="px-5 py-10 text-center text-sm text-gray-500 animate-pulse">
              シグナルを計算中…
            </div>
          )}

          {!signalsLoading && signalsError && (
            <div className="px-5 py-10 text-center text-sm text-red-400">
              シグナルの取得に失敗しました: {signalsError}
            </div>
          )}

          {!signalsLoading && !signalsError && signals && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 p-5">
              {INVESTORS.map((inv) => {
                const signal = signals[INVESTOR_IDS[inv]]
                const isSelected = inv === selectedInvestor
                if (!signal) return null
                return (
                  <div
                    key={inv}
                    className={`rounded-lg border px-4 py-3 space-y-2 transition-all
                      ${isSelected ? `${INVESTOR_COLORS[inv]} ring-1 ring-inset ring-current/30` : 'bg-gray-800/50 border-gray-800'}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className={`text-sm font-semibold ${isSelected ? '' : 'text-gray-300'}`}>{inv}</span>
                      <span className={`text-xs px-2 py-0.5 rounded border font-bold ${ACTION_STYLES[signal.action]}`}>
                        {ACTION_LABELS[signal.action]}
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-gray-500">
                      <span>強度:</span>
                      {[1, 2, 3].map((n) => (
                        <span key={n} className={n <= signal.strength ? 'text-yellow-400' : 'text-gray-700'}>★</span>
                      ))}
                    </div>
                    {(signal.targetPrice != null || signal.stopLoss != null) && (
                      <div className="flex gap-4 text-xs font-mono">
                        {signal.targetPrice != null && (
                          <span className="text-emerald-400">目標: ${signal.targetPrice.toFixed(2)}</span>
                        )}
                        {signal.stopLoss != null && (
                          <span className="text-red-400">損切: ${signal.stopLoss.toFixed(2)}</span>
                        )}
                      </div>
                    )}
                    <ul className="text-xs text-gray-400 space-y-1 list-disc list-inside">
                      {signal.reasons.map((r, i) => (
                        <li key={i}>{r}</li>
                      ))}
                    </ul>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
