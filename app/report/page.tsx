'use client'

// /report R1 — structured condition picker (free-text theory REMOVED).
// One technical rule (radio, 8 rules, with period params) + dynamic
// fundamental AND-filter rows evaluated on CURRENT values only (static gate —
// stated in the UI). Output stays the streamed Markdown report (no PDF in R1).

import { useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type {
  CompositeCondition,
  FundamentalFilter,
  FundamentalMetric,
  TechnicalCondition,
} from '@/lib/backtest/types'
import {
  METRIC_INFO,
  FUNDAMENTAL_METRICS,
  OPERATOR_LABEL,
  toRawValue,
  formatMetricValue,
  describeFundamentalFilter,
} from '@/lib/backtest/fundamental'
import type { PreparedBundle, ChartData } from '@/lib/report/types'
import { describeCompositeCondition } from '@/lib/report/prompt'

type IndicatorId = TechnicalCondition['indicator']

const RULES: { id: IndicatorId; label: string; params: 'period' | 'dual' | 'none' }[] = [
  { id: 'ma_cross',      label: '移動平均クロス（終値×N日MA）',              params: 'period' },
  { id: 'ma_cross_dual', label: 'ゴールデンクロス（短期MA×長期MA）',         params: 'dual' },
  { id: 'rsi_reversal',  label: 'RSI反転（30回復で買い・70割れで売り）',      params: 'period' },
  { id: 'macd_cross',    label: 'MACDクロス（12,26,9固定）',                 params: 'none' },
  { id: 'bb_break',      label: 'ボリンジャーバンド突破（N日・±2σ）',        params: 'period' },
  { id: 'hl_break',      label: '高値/安値ブレイクアウト（前日までのN日）',   params: 'period' },
  { id: 'stoch_cross',   label: 'ストキャスティクス（%K/%D＋30/70ゾーン）',   params: 'period' },
  { id: 'roc_signal',    label: 'ROC 0ラインクロス（モメンタム）',           params: 'period' },
]

const DEFAULT_PERIODS: Record<IndicatorId, string> = {
  ma_cross: '20', ma_cross_dual: '', rsi_reversal: '14', macd_cross: '',
  bb_break: '20', hl_break: '20', stoch_cross: '14', roc_signal: '12',
}

const OPERATORS: FundamentalFilter['operator'][] = ['gte', 'gt', 'lte', 'lt']

interface FilterRow {
  key: number
  metric: FundamentalMetric
  operator: FundamentalFilter['operator']
  /** Human-unit input（%・10億等）。送信時に toRawValue で実単位へ変換 */
  value: string
}

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
  const [capital, setCapital] = useState('100000')

  // ── Technical rule picker ────────────────────────────────────────────
  const [indicator, setIndicator] = useState<IndicatorId>('ma_cross')
  const [periods, setPeriods] = useState<Record<IndicatorId, string>>({ ...DEFAULT_PERIODS })
  const [shortPeriod, setShortPeriod] = useState('20')
  const [longPeriod, setLongPeriod] = useState('50')

  // ── Fundamental AND-filter rows ──────────────────────────────────────
  const nextKey = useRef(1)
  const [filters, setFilters] = useState<FilterRow[]>([])

  const [phase, setPhase] = useState<Phase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [bundle, setBundle] = useState<PreparedBundle | null>(null)
  const [chartData, setChartData] = useState<ChartData | null>(null)
  const [report, setReport] = useState('')
  const runningRef = useRef(false)

  const addFilter = () => {
    setFilters(prev => [
      ...prev,
      { key: nextKey.current++, metric: 'pe', operator: 'lte', value: '' },
    ])
  }
  const removeFilter = (key: number) => setFilters(prev => prev.filter(f => f.key !== key))
  const updateFilter = (key: number, patch: Partial<FilterRow>) =>
    setFilters(prev => prev.map(f => (f.key === key ? { ...f, ...patch } : f)))

  const buildCondition = (): CompositeCondition | { error: string } => {
    const num = (s: string, fallback: number) => {
      const n = Number(s)
      return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
    }
    let technical: TechnicalCondition
    switch (indicator) {
      case 'ma_cross':      technical = { type: 'technical', indicator, period: num(periods.ma_cross, 20) }; break
      case 'ma_cross_dual': {
        const s = num(shortPeriod, 20)
        const l = num(longPeriod, 50)
        if (s >= l) return { error: '短期MAの期間は長期MAより小さくしてください' }
        technical = { type: 'technical', indicator, shortPeriod: s, longPeriod: l }
        break
      }
      case 'rsi_reversal':  technical = { type: 'technical', indicator, period: num(periods.rsi_reversal, 14) }; break
      case 'macd_cross':    technical = { type: 'technical', indicator }; break
      case 'bb_break':      technical = { type: 'technical', indicator, period: num(periods.bb_break, 20) }; break
      case 'hl_break':      technical = { type: 'technical', indicator, period: num(periods.hl_break, 20) }; break
      case 'stoch_cross':   technical = { type: 'technical', indicator, period: num(periods.stoch_cross, 14) }; break
      case 'roc_signal':    technical = { type: 'technical', indicator, period: num(periods.roc_signal, 12) }; break
    }

    const fundamentalFilters: FundamentalFilter[] = []
    for (const row of filters) {
      const v = Number(row.value)
      if (row.value.trim() === '' || !Number.isFinite(v)) {
        return { error: `ファンダ条件「${METRIC_INFO[row.metric].label}」の値を数値で入力してください` }
      }
      fundamentalFilters.push({
        metric: row.metric,
        operator: row.operator,
        value: toRawValue(row.metric, v), // 人間単位（%・10億）→ 実単位に変換して送信
      })
    }
    return { technical, fundamentalFilters }
  }

  const run = async () => {
    if (runningRef.current) return
    const condition = buildCondition()
    if ('error' in condition) { setError(condition.error); return }

    runningRef.current = true
    setError(null)
    setBundle(null)
    setChartData(null)
    setReport('')
    setPhase('preparing')

    try {
      // ── Stage 1: prepare（ゲート評価＋5年実データバックテスト）──────
      const prepRes = await fetch('/api/report/prepare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          symbol,
          condition,
          initialCapital: Number(capital) || undefined,
        }),
      })
      if (!prepRes.ok) {
        const err = await prepRes.json().catch(() => ({}))
        throw new Error(err.error ?? `準備に失敗しました (HTTP ${prepRes.status})`)
      }
      const { bundle: prepared, chartData: chart } =
        (await prepRes.json()) as { bundle: PreparedBundle; chartData: ChartData }
      setBundle(prepared)
      setChartData(chart)

      // ── Stage 2: generate（Opusストリーミング・ゲート不成立でも実行）──
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
      let received = 0 // ローカル計測（state更新は非同期のため）
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          const chunk = decoder.decode(value, { stream: true })
          if (chunk) {
            received += chunk.length
            setReport(prev => prev + chunk)
          }
        }
        const tail = decoder.decode()
        if (tail) {
          received += tail.length
          setReport(prev => prev + tail)
        }
      } catch {
        // サーバー側streamエラー or ネットワーク切断。部分表示は残したまま通知する。
        throw new Error(
          received > 0
            ? 'レポート生成が途中で中断されました（表示中の内容は部分的な結果です）。再試行してください。'
            : 'レポートの受信に失敗しました。ネットワークを確認して再試行してください。',
        )
      }
      if (received === 0) {
        throw new Error('AIからのレポートが空でした。少し待ってから再試行してください。')
      }

      setPhase('done')
    } catch (e) {
      // fetch自体の失敗（ネットワーク断など）は英語の "Failed to fetch" になるため翻訳する
      const message =
        e instanceof TypeError
          ? 'サーバーに接続できませんでした。ネットワークを確認して再試行してください。'
          : e instanceof Error ? e.message : 'エラーが発生しました'
      setError(message)
      setPhase('idle')
    } finally {
      runningRef.current = false
    }
  }

  const busy = phase === 'preparing' || phase === 'generating'
  const m = bundle?.backtest?.metrics
  const gate = bundle?.fundamentalGate
  const selectedRule = RULES.find(r => r.id === indicator)!

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">AIレポート</h1>
        <p className="text-muted text-sm mt-1">
          テクニカル条件＋ファンダメンタル条件を指定して過去5年の実データでバックテストし、
          現状分析・AIトレーダー実績・根拠つき未来予想をAI（Opus）がレポートにまとめます。
        </p>
      </div>

      {/* Form */}
      <div className="bg-panel border border-border rounded-xl p-5 space-y-5">
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
            <label className="block text-xs text-muted mb-2">初期資金（仮想）</label>
            <input
              type="number" min="1000" step="1000"
              value={capital}
              onChange={e => setCapital(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
            />
          </div>
        </div>

        {/* Technical rule picker */}
        <div>
          <label className="block text-xs text-muted mb-2">テクニカル条件（1つ選択）</label>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {RULES.map(rule => (
              <label
                key={rule.id}
                className={`flex items-center gap-2 text-sm rounded-lg border px-3 py-2 cursor-pointer transition-colors ${
                  indicator === rule.id
                    ? 'border-blue-500 bg-blue-950/30 text-white'
                    : 'border-border bg-surface text-slate-300 hover:border-slate-600'
                }`}
              >
                <input
                  type="radio"
                  name="rule"
                  checked={indicator === rule.id}
                  onChange={() => setIndicator(rule.id)}
                  className="accent-blue-500"
                />
                {rule.label}
              </label>
            ))}
          </div>

          {/* Rule params */}
          <div className="mt-3 flex flex-wrap items-end gap-4">
            {selectedRule.params === 'period' && (
              <div>
                <label className="block text-xs text-muted mb-1">期間（日）</label>
                <input
                  type="number" min="2" max="200" step="1"
                  value={periods[indicator]}
                  onChange={e => setPeriods(prev => ({ ...prev, [indicator]: e.target.value }))}
                  className="w-28 bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                />
              </div>
            )}
            {selectedRule.params === 'dual' && (
              <>
                <div>
                  <label className="block text-xs text-muted mb-1">短期MA（日）</label>
                  <input
                    type="number" min="2" max="199" step="1"
                    value={shortPeriod}
                    onChange={e => setShortPeriod(e.target.value)}
                    className="w-28 bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">長期MA（日）</label>
                  <input
                    type="number" min="3" max="200" step="1"
                    value={longPeriod}
                    onChange={e => setLongPeriod(e.target.value)}
                    className="w-28 bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </>
            )}
            {selectedRule.params === 'none' && (
              <p className="text-xs text-muted">このルールにパラメータはありません（12,26,9固定）</p>
            )}
          </div>
        </div>

        {/* Fundamental filters */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs text-muted">
              ファンダメンタル条件（任意・AND結合）
            </label>
            <button
              onClick={addFilter}
              disabled={filters.length >= 10}
              className="text-xs px-3 py-1 rounded-lg border border-border text-slate-300 hover:border-blue-500 hover:text-white transition-colors disabled:opacity-40"
            >
              ＋ 条件を追加
            </button>
          </div>
          {filters.length === 0 && (
            <p className="text-xs text-muted/70">条件なし（テクニカル条件のみでバックテストします）</p>
          )}
          <div className="space-y-2">
            {filters.map(row => (
              <div key={row.key} className="flex flex-wrap items-center gap-2">
                <select
                  value={row.metric}
                  onChange={e => updateFilter(row.key, { metric: e.target.value as FundamentalMetric })}
                  className="bg-surface border border-border rounded-lg px-2 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  {FUNDAMENTAL_METRICS.map(mId => (
                    <option key={mId} value={mId}>{METRIC_INFO[mId].label}</option>
                  ))}
                </select>
                <select
                  value={row.operator}
                  onChange={e => updateFilter(row.key, { operator: e.target.value as FundamentalFilter['operator'] })}
                  className="bg-surface border border-border rounded-lg px-2 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                >
                  {OPERATORS.map(op => (
                    <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>
                  ))}
                </select>
                <input
                  type="number" step="any"
                  value={row.value}
                  onChange={e => updateFilter(row.key, { value: e.target.value })}
                  placeholder={METRIC_INFO[row.metric].hint}
                  className="w-48 bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
                />
                <span className="text-xs text-muted/70">{METRIC_INFO[row.metric].hint}</span>
                <button
                  onClick={() => removeFilter(row.key)}
                  className="text-xs px-2 py-1.5 rounded-lg border border-border text-red-400 hover:border-red-500 transition-colors"
                >
                  削除
                </button>
              </div>
            ))}
          </div>
          <p className="text-xs text-amber-400/80 mt-2">
            ※ ファンダ条件は現在値による静的フィルタで、過去5年には遡及しません（過去の各時点のファンダメンタルは取得できないため）。
          </p>
        </div>

        <button
          onClick={run}
          disabled={busy}
          className={`px-6 py-2.5 text-white text-sm font-medium rounded-lg transition-colors ${
            busy ? 'bg-slate-700 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'
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
                ? 'ステップ1/2: 条件を検証し、Yahoo Financeの過去5年実データでバックテスト中...'
                : 'ステップ2/2: Opusがレポートを執筆中（少しずつ表示されます）...'}
            </div>
          </div>
        </div>
      )}

      {/* Prepared bundle summary */}
      {bundle && (
        <div className="bg-panel border border-border rounded-xl p-5 space-y-3">
          <h2 className="text-white font-semibold text-sm">
            実行結果（実データ・過去5年日足{chartData ? `・${chartData.bars.length}本` : ''}）
          </h2>
          <div className="bg-surface/50 border border-blue-900/50 rounded-lg p-3 space-y-1">
            <p className="text-xs text-blue-300 font-medium">実行した条件</p>
            <p className="text-sm text-white font-medium">
              {describeCompositeCondition(bundle.request.condition)}
            </p>
          </div>

          {/* Fundamental gate result */}
          {gate && gate.evaluations.length > 0 && (
            <div className={`rounded-lg p-3 space-y-1 border ${
              gate.passed ? 'bg-surface/50 border-green-900/50' : 'bg-surface/50 border-amber-800/60'
            }`}>
              <p className={`text-xs font-medium ${gate.passed ? 'text-green-400' : 'text-amber-400'}`}>
                ファンダメンタル・ゲート判定（現在値）: {gate.passed ? '成立' : '不成立'}
              </p>
              <ul className="space-y-0.5">
                {gate.evaluations.map((ev, i) => (
                  <li key={i} className="text-xs text-slate-300 font-mono">
                    {ev.result === 'pass' ? '✓' : '✗'} {describeFundamentalFilter(ev.filter)}
                    {' → '}
                    {ev.result === 'no_data'
                      ? '判定不能（実データ取得不可・不成立扱い）'
                      : `実測 ${ev.actual != null ? formatMetricValue(ev.filter.metric, ev.actual) : '-'}（${ev.result === 'pass' ? '成立' : '不成立'}）`}
                  </li>
                ))}
              </ul>
              {!gate.passed && (
                <p className="text-xs text-amber-400/90">
                  条件不成立のためバックテストはスキップされました。レポートは「不成立の理由と成立に必要な変化」を分析します。
                </p>
              )}
            </div>
          )}

          {/* Backtest metrics（gate成立時のみ）*/}
          {bundle.backtest && m && (
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
              <div className="bg-surface/50 rounded-lg p-3">
                <p className="text-muted text-xs mb-1">総リターン（5年）</p>
                <p className={`font-mono font-bold ${m.totalReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {m.totalReturnPct >= 0 ? '+' : ''}{m.totalReturnPct.toFixed(2)}%
                </p>
              </div>
              <div className="bg-surface/50 rounded-lg p-3">
                <p className="text-muted text-xs mb-1">バイ&ホールド</p>
                <p className={`font-mono font-bold ${bundle.backtest.buyHoldReturnPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {bundle.backtest.buyHoldReturnPct >= 0 ? '+' : ''}{bundle.backtest.buyHoldReturnPct.toFixed(2)}%
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
          )}

          {/* AI trader evidence teaser */}
          {bundle.aiEvidence.hasData && (
            <p className="text-xs text-muted">
              AIトレーダー実績: この銘柄を{bundle.aiEvidence.tradeCount}回売買
              {bundle.aiEvidence.tradeCount > 0 &&
                `（勝率${bundle.aiEvidence.winRate.toFixed(0)}%・平均${bundle.aiEvidence.avgPnlPct >= 0 ? '+' : ''}${bundle.aiEvidence.avgPnlPct.toFixed(2)}%）`}
              — 詳細はレポート本文の「AIトレーダーの実績」参照
            </p>
          )}
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
          資金はすべて仮想です。ファンダメンタル条件は現在値の静的評価であり過去には遡及しません。
          投資判断はご自身の責任で行ってください。レポートは保存されません（画面を離れると消えます）。
        </p>
      )}
    </div>
  )
}
