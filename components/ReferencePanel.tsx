'use client'

import type { Trade } from './TradingChart'

interface Props {
  trade: Trade | null
  onClose: () => void
}

const SIGNAL_STYLE: Record<string, string> = {
  bullish: 'bg-emerald-50 border-emerald-200 text-emerald-700',
  bearish: 'bg-red-50 border-red-200 text-red-700',
  neutral: 'bg-surface border-border text-ink-2',
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
      <div className="fixed right-0 top-0 h-full w-full max-w-lg z-50 bg-panel border-l border-border shadow-2xl overflow-y-auto flex flex-col">
        {/* Header */}
        <div className={`px-6 py-5 border-b border-border ${isBuy ? 'bg-emerald-50' : 'bg-red-50'}`}>
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className={`text-sm font-bold px-2 py-0.5 rounded ${isBuy ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'}`}>
                  {isBuy ? '▲ BUY' : '▼ SELL'}
                </span>
                <span className="text-sm text-muted font-mono">{trade.investor}モデル</span>
              </div>
              <div className="text-xl font-bold text-ink">{trade.symbol}</div>
              <div className="text-sm text-ink-2 font-mono mt-0.5">
                {trade.date} &nbsp;·&nbsp; ${trade.price.toFixed(2)} &nbsp;·&nbsp; {trade.shares}株
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-muted hover:text-ink transition-colors text-xl leading-none mt-1"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="flex-1 px-6 py-5 space-y-6">
          {/* Summary */}
          {ref?.summary && (
            <div>
              <h3 className="text-sm font-semibold text-ink-2 uppercase tracking-widest mb-2">判断サマリー</h3>
              <p className="text-sm text-ink leading-relaxed">{ref.summary}</p>
            </div>
          )}

          {/* Analysis */}
          {ref?.analysis && (
            <div>
              <h3 className="text-sm font-semibold text-ink-2 uppercase tracking-widest mb-2">詳細分析</h3>
              <p className="text-sm text-ink-2 leading-relaxed whitespace-pre-line">{ref.analysis}</p>
            </div>
          )}

          {/* Macro context */}
          {ref?.macroContext && (
            <div className="bg-surface rounded-lg px-4 py-3 border border-border">
              <div className="text-sm text-muted mb-1">🌐 マクロ環境</div>
              <p className="text-base text-ink-2 leading-relaxed max-w-[42rem]">{ref.macroContext}</p>
            </div>
          )}

          {/* Indicators */}
          {ref?.indicators && ref.indicators.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-ink-2 uppercase tracking-widest mb-3">判断指標</h3>
              <div className="space-y-2">
                {ref.indicators.map((ind, i) => (
                  <div key={i} className="flex items-start gap-3 py-2 border-b border-border last:border-0">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-ink-2 font-medium">{ind.name}</span>
                        <span className={`text-xs px-1.5 py-0.5 rounded border ${SIGNAL_STYLE[ind.signal]}`}>
                          {ind.signal === 'bullish' ? '強気' : ind.signal === 'bearish' ? '弱気' : '中立'}
                        </span>
                      </div>
                      <div className="text-sm text-muted mt-0.5 leading-relaxed">{ind.note}</div>
                    </div>
                    <div className="text-sm font-mono font-semibold text-ink whitespace-nowrap">{ind.value}</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Sources */}
          {ref?.sources && ref.sources.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-ink-2 uppercase tracking-widest mb-3">参照ソース</h3>
              <div className="space-y-2">
                {ref.sources.map((src, i) => (
                  <div key={i} className="flex items-center gap-2.5 py-2 border-b border-border last:border-0">
                    <span className="text-base">{SOURCE_ICON[src.type] ?? '🔗'}</span>
                    <div className="flex-1 min-w-0">
                      {src.url ? (
                        <a
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm text-blue-700 hover:text-blue-800 underline underline-offset-2 truncate block"
                        >
                          {src.title}
                        </a>
                      ) : (
                        <span className="text-sm text-ink-2">{src.title}</span>
                      )}
                      <span className="text-xs text-muted capitalize">{src.type}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {!ref && (
            <div className="text-sm text-muted text-center py-8">
              この取引の分析データはありません
            </div>
          )}
        </div>
      </div>
    </>
  )
}
