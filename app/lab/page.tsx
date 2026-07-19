'use client'

import { useEffect, useRef, useState } from 'react'
import {
  createChart, createSeriesMarkers,
  LineSeries, ColorType, LineStyle,
  type IChartApi, type Time,
} from 'lightweight-charts'
import type { BacktestResult, NeedsPresetId } from '@/lib/backtest/types'
import { NEEDS_PRESETS, NEEDS_PRESET_IDS, type LabNeedsResponse } from '@/lib/backtest/presets'
import { describeFundamentalFilter, formatMetricValue } from '@/lib/backtest/fundamental'
import { US_UNIVERSE } from '@/lib/market/us-universe'

type LabMode = 'technical' | 'needs' | 'investor'

const MODE_TABS: { id: LabMode; label: string; disabled?: boolean }[] = [
  { id: 'technical', label: 'テクニカル' },
  { id: 'needs',     label: 'ニーズ軸で選ぶ' },
  { id: 'investor',  label: '投資家モデル' },
]

// 投資家モデル（S2で実装 — 表示のみ・選択不可）
const INVESTOR_MODELS = ['バフェット', 'グレアム', 'リンチ', 'ソロス', 'ダリオ']

function formatMoney(v: number, currency: string) {
  return v.toLocaleString(currency === 'JPY' ? 'ja-JP' : 'en-US', {
    style: 'currency', currency,
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  })
}

function formatDate(unixSeconds: number) {
  return new Date(unixSeconds * 1000).toISOString().slice(0, 10)
}

// Equity curve + buy/sell markers (lightweight-charts v5).
function EquityChart({ result }: { result: BacktestResult }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)

  useEffect(() => {
    if (!containerRef.current || result.equityCurve.length === 0) return
    const t = (v: number) => v as unknown as Time

    chartRef.current?.remove()
    chartRef.current = null

    const chart = createChart(containerRef.current, {
      layout: { background: { type: ColorType.Solid, color: '#0f172a' }, textColor: '#94a3b8' },
      grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
      rightPriceScale: { borderColor: '#334155' },
      timeScale: { borderColor: '#334155', timeVisible: false, secondsVisible: false },
      width: containerRef.current.clientWidth,
      height: 360,
    })

    const up = result.finalValue >= result.initialCapital
    const equity = chart.addSeries(LineSeries, {
      color: up ? '#22c55e' : '#ef4444',
      lineWidth: 2, priceLineVisible: false, lastValueVisible: true,
    })
    equity.setData(result.equityCurve.map(p => ({ time: t(p.time), value: p.value })))

    // Baseline: initial capital.
    const base = chart.addSeries(LineSeries, {
      color: '#475569', lineWidth: 1, lineStyle: LineStyle.Dashed,
      priceLineVisible: false, lastValueVisible: false,
    })
    base.setData(result.equityCurve.map(p => ({ time: t(p.time), value: result.initialCapital })))

    if (result.trades.length > 0) {
      createSeriesMarkers(
        equity,
        result.trades.map(tr => tr.action === 'buy'
          ? { time: t(tr.time), position: 'belowBar' as const, color: '#22c55e', shape: 'arrowUp' as const, text: 'BUY' }
          : { time: t(tr.time), position: 'aboveBar' as const, color: '#ef4444', shape: 'arrowDown' as const, text: 'SELL' },
        ),
      )
    }

    chart.timeScale().fitContent()
    chartRef.current = chart

    const onResize = () => {
      if (containerRef.current) chartRef.current?.applyOptions({ width: containerRef.current.clientWidth })
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      chartRef.current?.remove()
      chartRef.current = null
    }
  }, [result])

  return <div ref={containerRef} className="w-full" />
}

export default function LabPage() {
  const [mode, setMode] = useState<LabMode>('technical')
  const [symbol, setSymbol] = useState('AAPL')
  const [maPeriod, setMaPeriod] = useState('20')
  const [presetId, setPresetId] = useState<NeedsPresetId>('stable')
  const [capital, setCapital] = useState('100000')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<BacktestResult | null>(null)
  const [needsRes, setNeedsRes] = useState<LabNeedsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    if (mode === 'investor') return // 近日対応 — 実行不可
    setLoading(true)
    setError(null)
    setResult(null)
    setNeedsRes(null)
    try {
      // 排他: モードに応じたフィールドのみ送る（needs に condition は同梱しない）
      const payload = mode === 'technical'
        ? {
            mode: 'technical',
            symbol,
            condition: { type: 'technical', indicator: 'ma_cross', period: Number(maPeriod) || 20 },
            initialCapital: Number(capital) || 100_000,
          }
        : {
            mode: 'needs',
            symbol,
            presetId,
            initialCapital: Number(capital) || 100_000,
          }
      const res = await fetch('/api/lab/backtest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.error ?? `HTTP ${res.status}`)
      }
      const data = await res.json()
      if (mode === 'needs') {
        const nr = data as LabNeedsResponse
        setNeedsRes(nr)
        setResult(nr.result)
      } else {
        setResult(data as BacktestResult)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  const m = result?.metrics
  const returnPositive = (m?.totalReturnPct ?? 0) >= 0
  const technicalActive = mode === 'technical'
  const needsActive = mode === 'needs'
  // ニーズ軸は米国株（USD建て）想定。日本株（.T）は時価総額閾値の目安がずれるため
  // 実行前に警告する（ブロックはしない — S3の通貨別閾値/自動絞り込みで本対応）。
  const nonUsWarning = needsActive && symbol.trim().toUpperCase().endsWith('.T')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">バックテスト・ラボ</h1>
        <p className="text-muted text-sm mt-1">
          条件を1つ選んで、実データ日足で売買ルールを検証します（テクニカル=1年、ニーズ軸=5年）。AIは使わない純計算です。
        </p>
      </div>

      {/* Config */}
      <div className="bg-panel border border-border rounded-xl p-5 space-y-5">
        {/* Mode selector — 3択排他 */}
        <div>
          <p className="text-xs text-muted mb-2">条件モード（いずれか1つ）</p>
          <div className="inline-flex rounded-lg border border-border overflow-hidden">
            {MODE_TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => setMode(tab.id)}
                className={`px-4 py-2 text-sm font-medium transition-colors ${
                  mode === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-surface text-slate-400 hover:text-slate-200'
                }`}
              >
                {tab.label}
                {tab.id === 'investor' && (
                  <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 align-middle">近日対応</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Common inputs */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-muted mb-2">銘柄シンボル</label>
            <input
              value={symbol}
              onChange={e => setSymbol(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') run() }}
              placeholder={needsActive ? 'AAPL / MSFT' : 'AAPL / 7203.T'}
              list="us-universe"
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500"
            />
            <datalist id="us-universe">
              {US_UNIVERSE.map(s => (
                <option key={s.symbol} value={s.symbol}>{s.name}</option>
              ))}
            </datalist>
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

        {/* ── Technical panel ── */}
        <div className={`border border-border rounded-lg p-4 space-y-3 transition-opacity ${technicalActive ? '' : 'opacity-50'}`}>
          <p className="text-sm text-white font-medium">テクニカル条件（MA上抜け/下抜け・1年）</p>
          <div className="max-w-xs">
            <label className="block text-xs text-muted mb-2">MA期間（日）</label>
            <input
              type="number" min="2" max="200" step="1"
              value={maPeriod}
              disabled={!technicalActive}
              onChange={e => setMaPeriod(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-white text-sm font-mono focus:outline-none focus:border-blue-500 disabled:cursor-not-allowed"
            />
          </div>
          <p className="text-xs text-muted">
            ルール: 終値がMA{Number(maPeriod) || 20}を上抜けたら全額買い、下抜けたら全て売り（仮想資金）。
          </p>
        </div>

        {/* ── Needs panel ── */}
        <div className={`border border-border rounded-lg p-4 space-y-3 transition-opacity ${needsActive ? '' : 'opacity-50'}`}>
          <p className="text-sm text-white font-medium">ニーズ軸で選ぶ（5年・銘柄の参加条件つき）</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {NEEDS_PRESET_IDS.map(id => {
              const p = NEEDS_PRESETS[id]
              const selected = needsActive && presetId === id
              return (
                <label
                  key={id}
                  className={`block rounded-lg border p-3 transition-colors ${
                    selected ? 'border-blue-500 bg-blue-950/30' : 'border-border bg-surface/50'
                  } ${needsActive ? 'cursor-pointer hover:border-blue-600' : 'cursor-not-allowed'}`}
                >
                  <span className="flex items-start gap-2">
                    <input
                      type="radio"
                      name="needs-preset"
                      value={id}
                      checked={presetId === id}
                      disabled={!needsActive}
                      onChange={() => setPresetId(id)}
                      className="mt-1 accent-blue-500"
                    />
                    <span>
                      <span className="block text-sm text-white font-medium">{p.label}</span>
                      <span className="block text-xs text-muted mt-1 leading-relaxed">「{p.description}」</span>
                    </span>
                  </span>
                </label>
              )
            })}
          </div>
          <ul className="text-xs text-muted space-y-1 leading-relaxed list-disc list-inside">
            <li>ニーズ軸プリセットは<span className="text-slate-300">米国株（USD建て）を想定</span>しています。時価総額の閾値はUSD建て・米国株を想定した目安です。</li>
            <li>ファンダ条件（時価総額・配当利回り）は<span className="text-slate-300">現在値での参加可否判定</span>です（過去5年に遡及しません）。</li>
            <li>今回は選んだ銘柄への適用です。条件に合う銘柄の自動絞り込みは今後対応。</li>
            <li>短期売買（デイトレード）は今後対応（日中足のデータ源が未整備のため）。</li>
          </ul>
          {nonUsWarning && (
            <p className="text-xs text-amber-400 bg-amber-950/30 border border-amber-700 rounded-lg px-3 py-2 leading-relaxed">
              ニーズ軸プリセットは米国株（USD建て）想定です。日本株（.T）では時価総額閾値の目安が実態とずれる可能性があります（実行は可能）。
            </p>
          )}
        </div>

        {/* ── Investor panel（disabled placeholder — S2） ── */}
        <div className="border border-border rounded-lg p-4 space-y-3 opacity-50">
          <p className="text-sm text-white font-medium">
            投資家モデル
            <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-slate-700 text-slate-300 align-middle">近日対応</span>
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {INVESTOR_MODELS.map(name => (
              <label key={name} className="flex items-center gap-1.5 text-sm text-slate-400 cursor-not-allowed">
                <input type="radio" name="investor-model" disabled className="accent-blue-500" />
                {name}
              </label>
            ))}
          </div>
          <p className="text-xs text-muted">著名投資家の投資スタイルを条件に写像して検証する機能を準備中です。</p>
        </div>

        <button
          onClick={run}
          disabled={loading || mode === 'investor'}
          className={`px-6 py-2.5 text-white text-sm font-medium rounded-lg transition-colors ${
            loading || mode === 'investor' ? 'bg-slate-700 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-500'
          }`}
        >
          {mode === 'investor' ? '投資家モデルは近日対応' : loading ? 'バックテスト実行中...' : 'バックテスト実行'}
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-900/30 border border-red-700 rounded-xl px-4 py-3 text-red-300 text-sm">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-panel border border-border rounded-xl p-8 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-slate-600 border-t-blue-500 rounded-full animate-spin mx-auto" />
          <p className="text-muted text-sm">実データを取得して計算中...</p>
        </div>
      )}

      {/* Needs: gate result（pass/fail・実測値）＋内部条件の説明 */}
      {needsRes && !loading && (
        <div className={`border rounded-xl p-5 space-y-3 ${
          needsRes.gatePassed ? 'bg-panel border-border' : 'bg-amber-950/30 border-amber-700'
        }`}>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded ${
              needsRes.gatePassed ? 'bg-green-900/50 text-green-400' : 'bg-amber-900/50 text-amber-400'
            }`}>
              {needsRes.gatePassed ? '参加条件 成立' : '参加条件 不成立'}
            </span>
            <h2 className="text-white font-semibold text-sm">
              プリセット「{needsRes.presetLabel}」の判定（現在値）
            </h2>
          </div>

          {!needsRes.gatePassed && needsRes.gateFailReason && (
            <p className="text-amber-300 text-sm leading-relaxed">
              {needsRes.gateFailReason}
              <br />
              <span className="text-amber-400/80 text-xs">条件不成立のためバックテストは実行していません。</span>
            </p>
          )}

          {/* 判定の内訳（実測値つき） */}
          <div className="space-y-1.5">
            {needsRes.gate.evaluations.map((ev, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 bg-surface/50 rounded-lg text-xs">
                <span className={`shrink-0 font-bold px-2 py-0.5 rounded ${
                  ev.result === 'pass' ? 'bg-green-900/50 text-green-400'
                    : ev.result === 'fail' ? 'bg-red-900/50 text-red-400'
                    : 'bg-slate-700 text-slate-300'
                }`}>
                  {ev.result === 'pass' ? '成立' : ev.result === 'fail' ? '不成立' : '判定不能'}
                </span>
                <span className="text-slate-300">{describeFundamentalFilter(ev.filter)}</span>
                <span className="text-muted font-mono ml-auto">
                  実測: {ev.actual != null ? formatMetricValue(ev.filter.metric, ev.actual) : 'データなし'}
                </span>
              </div>
            ))}
          </div>

          {/* 内部条件の説明 */}
          <div className="pt-1">
            <p className="text-xs text-muted mb-1.5">このプリセットの実際の条件:</p>
            <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside leading-relaxed">
              {needsRes.conditionNotes.map((note, i) => <li key={i}>{note}</li>)}
            </ul>
          </div>
        </div>
      )}

      {/* Results */}
      {result && m && !loading && (
        <div className="space-y-5">
          <p className="text-xs text-muted">
            {result.symbol}（{result.currency}）｜ {formatDate(result.startDate)} → {formatDate(result.endDate)}
            ｜ {result.equityCurve.length}営業日
          </p>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
            <div className="bg-panel border border-border rounded-xl p-4">
              <p className="text-muted text-xs mb-1">総リターン</p>
              <p className={`text-xl font-bold font-mono ${returnPositive ? 'text-green-400' : 'text-red-400'}`}>
                {returnPositive ? '+' : ''}{m.totalReturnPct.toFixed(2)}%
              </p>
              <p className="text-xs text-muted mt-0.5">{formatMoney(result.finalValue, result.currency)}</p>
            </div>
            <div className="bg-panel border border-border rounded-xl p-4">
              <p className="text-muted text-xs mb-1">勝率</p>
              <p className="text-white text-xl font-bold font-mono">{m.winRate.toFixed(0)}%</p>
              <p className="text-xs text-muted mt-0.5">往復トレード基準</p>
            </div>
            <div className="bg-panel border border-border rounded-xl p-4">
              <p className="text-muted text-xs mb-1">最大ドローダウン</p>
              <p className="text-red-400 text-xl font-bold font-mono">-{m.maxDrawdownPct.toFixed(2)}%</p>
            </div>
            <div className="bg-panel border border-border rounded-xl p-4">
              <p className="text-muted text-xs mb-1">シャープレシオ</p>
              <p className="text-white text-xl font-bold font-mono">{m.sharpeRatio.toFixed(2)}</p>
              <p className="text-xs text-muted mt-0.5">年率換算・rf=0</p>
            </div>
            <div className="bg-panel border border-border rounded-xl p-4">
              <p className="text-muted text-xs mb-1">取引件数</p>
              <p className="text-white text-xl font-bold font-mono">{m.tradeCount}件</p>
              <p className="text-xs text-muted mt-0.5">
                買: {result.trades.filter(t => t.action === 'buy').length} / 売: {result.trades.filter(t => t.action === 'sell').length}
              </p>
            </div>
          </div>

          {/* Equity curve */}
          <div className="bg-panel border border-border rounded-xl p-5">
            <h2 className="text-white font-semibold text-sm mb-3">資産曲線</h2>
            <EquityChart result={result} />
          </div>

          {/* Trade log */}
          <div className="bg-panel border border-border rounded-xl p-5">
            <h2 className="text-white font-semibold text-sm mb-3">トレード一覧</h2>
            {result.trades.length === 0 ? (
              <p className="text-muted text-sm">この期間・条件では売買シグナルが発生しませんでした。</p>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                {result.trades.map((t, i) => (
                  <div key={i} className="flex items-center gap-3 px-3 py-2 bg-surface/50 rounded-lg">
                    <span className={`shrink-0 text-xs font-bold px-2 py-0.5 rounded ${
                      t.action === 'buy' ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'
                    }`}>
                      {t.action === 'buy' ? 'BUY' : 'SELL'}
                    </span>
                    <span className="text-xs text-muted font-mono w-24">{formatDate(t.time)}</span>
                    <span className="text-xs text-slate-300 font-mono flex-1">
                      {t.shares.toFixed(4)}株 × {t.price.toFixed(2)}
                    </span>
                    <span className="text-xs text-slate-400 font-mono">
                      {formatMoney(t.value, result.currency)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Disclaimer */}
          <p className="text-xs text-muted/60 leading-relaxed">
            ※ 過去の実市場データに基づく参考情報です。シグナル発生日の終値で即約定する簡略モデルで、
            手数料・スリッページ・約定滑りは考慮していません。
            資金はすべて仮想であり、実際の投資成果を保証しません。
          </p>
        </div>
      )}
    </div>
  )
}
