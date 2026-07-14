'use client'

import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { PreparedBundle, ReportIndicator } from '@/lib/report/types'
import { describeCondition } from '@/lib/report/prompt'

const INDICATOR_OPTIONS: { id: ReportIndicator; label: string }[] = [
  { id: 'ma',   label: '移動平均（MAクロス）' },
  { id: 'rsi',  label: 'RSI（売られすぎ反発）' },
  { id: 'macd', label: 'MACD（シグナルクロス）' },
  { id: 'bb',   label: 'ボリンジャーバンド（ブレイク）' },
]

type Phase = 'idle' | 'preparing' | 'generating' | 'done'

// ── Minimal Markdown renderer (headings / bullets / bold) — no deps ────────
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**')
      ? <strong key={`${keyPrefix}-${i}`} className="text-white font-semibold">{part.slice(2, -2)}</strong>
      : <span key={`${keyPrefix}-${i}`}>{part}</span>
  )
}

function MarkdownView({ text }: { text: string }) {
  const lines = text.split('\n')
  return (
    <div className="space-y-1.5 text-sm leading-relaxed text-slate-300">
      {lines.map((line, i) => {
        if (line.startsWith('## ')) {
          return (
            <h2 key={i} className="text-white text-base font-bold mt-5 mb-1 pb-1 border-b border-border">
              {line.slice(3)}
            </h2>
          )
        }
        if (line.startsWith('### ')) {
          return <h3 key={i} className="text-white text-sm font-semibold mt-3">{line.slice(4)}</h3>
        }
        if (/^\s*[-•*]\s+/.test(line)) {
          return (
            <div key={i} className="flex gap-2 pl-2">
              <span className="text-slate-500 shrink-0">•</span>
              <span>{renderInline(line.replace(/^\s*[-•*]\s+/, ''), `l${i}`)}</span>
            </div>
          )
        }
        if (line.trim() === '') return <div key={i} className="h-1" />
        return <p key={i}>{renderInline(line, `l${i}`)}</p>
      })}
    </div>
  )
}

export default function ReportPage() {
  const [symbol, setSymbol] = useState('AAPL')
  const [theoryText, setTheoryText] = useState('')
  const [indicators, setIndicators] = useState<Set<ReportIndicator>>(new Set(['ma']))
  const [maPeriod, setMaPeriod] = useState('20')
  const [capital, setCapital] = useState('100000')

  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [bundle, setBundle] = useState<PreparedBundle | null>(null)
  const [report, setReport] = useState('')
  const runningRef = useRef(false)

  const toggleIndicator = (id: ReportIndicator) => {
    setIndicators(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const run = async () => {
    if (runningRef.current) return
    runningRef.current = true
    setError(null)
    setBundle(null)
    setReport('')
    setPhase('preparing')

    try {
      // ── Stage 1: prepare（Haiku解釈＋実データバックテスト）──────────
      const prepRes = await fetch('/api/report/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          theoryText,
          indicators: Array.from(indicators),
          maPeriod: Number(maPeriod) || undefined,
          initialCapital: Number(capital) || undefined,
        }),
      })
      if (!prepRes.ok) {
        const err = await prepRes.json().catch(() => ({}))
        throw new Error(err.error ?? `準備に失敗しました (HTTP ${prepRes.status})`)
      }
      const { bundle: prepared } = (await prepRes.json()) as { bundle: PreparedBundle }
      setBundle(prepared)

      // ── Stage 2: generate（Opusストリーミング）─────────────────────
      setPhase('generating')
      const genRes = await fetch('/api/report/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bundle: prepared }),
      })
      if (!genRes.ok || !genRes.body) {
        const err = await genRes.json().catch(() => ({}))
        throw new Error(err.error ?? `生成に失敗しました (HTTP ${genRes.status})`)
      }

      const reader = genRes.body.getReader()
      const decoder = new TextDecoder()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value, { stream: true })
        if (chunk) setReport(prev => prev + chunk)
      }
      const tail = decoder.decode()
      if (tail) setReport(prev => prev + tail)

      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました')
      setPhase('idle')
    } finally {
      runningRef.current = false
    }
  }

  const busy = phase === 'preparing' || phase === 'generating'
  const m = bundle?.backtest.metrics

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">AIレポート</h1>
        <p className="text-muted text-sm mt-1">
          あなたの投資理論を1年の実データでバックテストし、現状分析と根拠つき未来予想をAI（Opus）がレポートにまとめます。
        </p>
      </div>

      {/* Form */}
      <div className="bg-panel border border-border rounded-xl p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs text-muted mb-2">銘柄シンボル</label>
            <input
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              placeholder="AAPL / 7203.T"
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-2">MA期間（日・MA使用時）</label>
            <input
              type="number" min="2" max="200" step="1"
              value={maPeriod}
              onChange={e => setMaPeriod(e.target.value)}
              disabled={!indicators.has('ma')}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500 disabled:opacity-40"
            />
          </div>
          <div>
            <label className="block text-xs text-muted mb-2">初期資金（仮想）</label>
            <input
              type="number" min="1000" step="1000"
              value={capital}
              onChange={e => setCapital(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs text-muted mb-2">
            あなたの投資理論（自由記述 — AIが売買ルールに解釈します）
          </label>
          <textarea
            value={theoryText}
            onChange={e => setTheoryText(e.target.value)}
            rows={4}
            maxLength={2000}
            placeholder="例: 移動平均線を上に抜けたタイミングで買って、下に抜けたら売る順張り戦略が有効だと思う"
            className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500 resize-y"
          />
        </div>

        <div>
          <label className="block text-xs text-muted mb-2">検証に使う指標（AIはこの中から選びます）</label>
          <div className="flex flex-wrap gap-3">
            {INDICATOR_OPTIONS.map(({ id, label }) => (
              <label key={id} className="flex items-center gap-2 text-sm text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={indicators.has(id)}
                  onChange={() => toggleIndicator(id)}
                  className="accent-blue-500"
                />
                {label}
              </label>
            ))}
          </div>
        </div>

        <button
          onClick={run}
          disabled={busy || !theoryText.trim() || indicators.size === 0}
          className={`px-6 py-2.5 text-white text-sm font-medium rounded-lg transition-colors ${
            busy || !theoryText.trim() || indicators.size === 0
              ? 'bg-slate-700 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500'
          }`}
        >
          {phase === 'preparing' ? '実データを準備中...'
            : phase === 'generating' ? 'レポート生成中...'
            : 'レポート生成'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Progress */}
      {busy && (
        <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-5 h-5 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin" />
            <div className="text-sm text-slate-300">
              {phase === 'preparing'
                ? 'ステップ1/2: 理論をAIが解釈し、Yahoo Financeの実データでバックテスト中...'
                : 'ステップ2/2: Opusがレポートを執筆中（少しずつ表示されます）...'}
            </div>
          </div>
        </div>
      )}

      {/* Prepared bundle summary */}
      {bundle && m && (
        <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-white font-semibold text-sm">バックテスト実行結果（実データ・1年日足）</h2>
          <p className="text-xs text-muted">
            解釈されたルール: <span className="text-slate-300">{describeCondition(bundle.interpreted.condition)}</span>
          </p>
          <p className="text-xs text-muted">解釈メモ: {bundle.interpreted.note}</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="bg-surface/50 rounded-lg p-3">
              <p className="text-muted text-xs mb-1">総リターン</p>
              <p className={`font-mono font-bold ${m.totalReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                {m.totalReturnPct >= 0 ? '+' : ''}{m.totalReturnPct.toFixed(2)}%
              </p>
            </div>
            <div className="bg-surface/50 rounded-lg p-3">
              <p className="text-muted text-xs mb-1">勝率</p>
              <p className="text-white font-mono font-bold">{m.winRate.toFixed(0)}%</p>
            </div>
            <div className="bg-surface/50 rounded-lg p-3">
              <p className="text-muted text-xs mb-1">最大DD</p>
              <p className="text-red-400 font-mono font-bold">-{m.maxDrawdownPct.toFixed(2)}%</p>
            </div>
            <div className="bg-surface/50 rounded-lg p-3">
              <p className="text-muted text-xs mb-1">取引数</p>
              <p className="text-white font-mono font-bold">{m.tradeCount}件</p>
            </div>
          </div>
        </div>
      )}

      {/* Report body (streamed) */}
      {report && (
        <div className="bg-panel border border-border rounded-xl p-6">
          <MarkdownView text={report} />
          {phase === 'generating' && (
            <span className="inline-block w-2 h-4 bg-blue-400 animate-pulse ml-1 align-text-bottom" />
          )}
        </div>
      )}

      {/* Disclaimer */}
      {(report || bundle) && (
        <p className="text-xs text-muted/60 leading-relaxed">
          ※ 本レポートは過去の実市場データとAI推論に基づく参考情報であり、将来の成果を保証するものではありません。
          資金はすべて仮想です。投資判断はご自身の責任で行ってください。レポートは保存されません（画面を離れると消えます）。
        </p>
      )}
    </div>
  )
}
