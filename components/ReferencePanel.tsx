'use client'

import type { Trade } from './TradingChart'

interface Props {
  trade: Trade | null
  onClose: () => void
}

const SIGNAL_STYLE: Record<string, string> = {
  bullish: 'bg-emerald-900/40 border-emerald-700 text-emerald-300',
  bearish: 'bg-red-900/40 border-red-700 text-red-300',
  neutral: 'bg-gray-800 border-gray-700 text-gray-400',
}

const SOURCE_ICON: Record<string, string> = {
  filing: '📄',
  news: '📰',
  model: '🤖',
  earnings: '📊',
  macro: '🌐',
}

export default function ReferencePanel({ trade, onClose }: Props) {
  if (!trade) return null
  const ref = trade.reference
  const isBuy = trade.action === 'BUY'

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/50 z-40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 h-full w-full max-w-lg z-50 bg-gray-900 border-l border-gray-700 shadow-2xl overflow-y-auto flex flex-col">
        {/* Header */}
        <div className={`px-6 py-5 border-b border-gray-800 ${isBuy ? 'bg-emerald-950/40' : 'bg-red-950/40'}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-sm font-bold px-2 py-0.5 rounded ${isBuy ? 'bg-emerald-800 text-emerald-200' : 'bg-red-800 text-red-200'}`}>
                  {isBuy ? '▲ BUY' : '▼ SELL'}
                </span>
                <span className="text-xs text-gray-500 font-mono">{trade.investor}モデル</span>
              </div>
              <div className="text-xl font-bold text-white">{trade.symbol}</div>
              <div className="text-sm text-gray-400 font-mono mt-0.5">
                {trade.date} &nbsp;·&nbsp; ${trade.price.toFixed(2)} &nbsp;·&nbsp; {trade.shares}株
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-500 hover:text-white transition-colors text-xl leading-none mt-1"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 px-6 py-5 space-y-6">
          {/* Summary */}
          {ref?.summary && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">判断サマリー</h3>
              <p className="text-sm text-gray-200 leading-relaxed">{ref.summary}</p>
            </div>
          )}

          {/* Analysis */}
          {ref?.analysis && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-2">詳細分析</h3>
              <p className="text-sm text-gray-400 leading-relaxed whitespace-pre-line">{ref.analysis}</p>
            </div>
          )}

          {/* Macro context */}
          {ref?.macroContext && (
            <div className="bg-gray-800/60 rounded-lg px-4 py-3 border border-gray-700">
              <div className="text-xs text-gray-500 mb-1">🌐 マクロ環境</div>
              <p className="text-xs text-gray-300 leading-relaxed">{ref.macroContext}</p>
            </div>
          )}

          {/* Indicators */}
          {ref?.indicators && ref.indicators.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">判断指標</h3>
              <div className="space-y-2">
                {ref.indicators.map((ind, i) => (
                  <div key={i} className="flex items-start gap-3 py-2 border-b border-gray-800/50 last:border-0">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-400 font-medium">{ind.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${SIGNAL_STYLE[ind.signal]}`}>
                          {ind.signal === 'bullish' ? '強気' : ind.signal === 'bearish' ? '弱気' : '中立'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-500 mt-0.5">{ind.note}</div>
                    </div>
                    <div className="text-sm font-mono font-semibold text-white whitespace-nowrap">{ind.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sources */}
          {ref?.sources && ref.sources.length > 0 && (
            <div>
              <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">参照ソース</h3>
              <div className="space-y-2">
                {ref.sources.map((src, i) => (
                  <div key={i} className="flex items-center gap-2.5 py-2 border-b border-gray-800/50 last:border-0">
                    <span className="text-base">{SOURCE_ICON[src.type] ?? '🔗'}</span>
                    <div className="flex-1 min-w-0">
                      {src.url ? (
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 truncate block"
                        >
                          {src.title}
                        </a>
                      ) : (
                        <span className="text-xs text-gray-400">{src.title}</span>
                      )}
                      <span className="text-xs text-gray-600 capitalize">{src.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!ref && (
            <div className="text-sm text-gray-600 text-center py-8">
              この取引の分析データはありません
            </div>
          )}
        </div>
      </div>
    </>
  )
}
