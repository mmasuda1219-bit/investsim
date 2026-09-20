'use client'

import { useState, useEffect, useRef } from 'react'
import { INVESTOR_META } from '@/lib/investors/registry'
import type { SimResult } from '@/lib/simulation'

// 表示名・説明・色・並び順は lib/investors/registry が単一の出所（このページで再定義しない）
const INVESTORS = INVESTOR_META

const UNIVERSES = [
  { id: 'large_cap', label: '大型株20銘柄', desc: 'S&P500 上位 時価総額大型株' },
  { id: 'value',     label: 'バリュー20銘柄', desc: '配当・低PBR重視の割安銘柄' },
  { id: 'growth',    label: 'グロース20銘柄', desc: '高成長テック・ハイグロース' },
]


function formatUSD(v: number) {
  return v.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 })
}

function MiniChart({ values }: { values: { date: string; value: number }[] }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<any>(null)

  useEffect(() => {
    if (!containerRef.current || values.length === 0) return
    let destroyed = false

    import('lightweight-charts').then(({ createChart, LineSeries, ColorType, LineStyle }) => {
      if (destroyed || !containerRef.current) return
      const chart = createChart(containerRef.current!, {
        layout: { background: { type: ColorType.Solid, color: 'transparent' }, textColor: '#94a3b8' },
        grid: { vertLines: { color: '#1e293b' }, horzLines: { color: '#1e293b' } },
        rightPriceScale: { borderColor: '#334155' },
        timeScale: { borderColor: '#334155', timeVisible: false },
        width: containerRef.current!.clientWidth,
        height: 160,
        handleScroll: false,
        handleScale: false,
      })

      const baseline = values[0].value
      const series = chart.addSeries(LineSeries, {
        color: values[values.length - 1].value >= baseline ? '#22c55e' : '#ef4444',
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
      })
      const baseLine = chart.addSeries(LineSeries, {
        color: '#475569',
        lineWidth: 1,
        lineStyle: LineStyle.Dashed,
        priceLineVisible: false,
        lastValueVisible: false,
      })

      series.setData(values.map(v => ({ time: v.date as any, value: v.value })))
      baseLine.setData(values.map(v => ({ time: v.date as any, value: baseline })))
      chart.timeScale().fitContent()
      chartRef.current = chart
    })

    return () => {
      destroyed = true
      chartRef.current?.remove()
      chartRef.current = null
    }
  }, [values])

  return <div ref={containerRef} className="w-full" />
}

export default function SimulatePage() {
  const [investorId, setInvestorId] = useState('buffett')
  const [universe, setUniverse]     = useState('large_cap')
  const [capital, setCapital]       = useState('100000')
  const [loading, setLoading]       = useState(false)
  const [result, setResult]         = useState<SimResult | null>(null)
  const [error, setError]           = useState<string | null>(null)
  const [elapsed, setElapsed]       = useState(0)

  useEffect(() => {
    if (!loading) return
    setElapsed(0)
    const t = setInterval(() => setElapsed(s => s + 1), 1000)
    return () => clearInterval(t)
  }, [loading])

  const run = async () => {
    setLoading(true)
    setError(null)
    setResult(null)
    try {
      const res = await fetch('/api/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          investorId,
          universe,
          startCapital: Number(capital) || 100_000,
        }),
      })
      if (!res.ok) {
        // 取れなかった理由はサーバーが和文で返す（lib/simulation.ts）。本文が JSON でない応答（HTML のエラーページ等）は
        // 和文の既定文にし、生の英語を見出しに出さない
        const err = await res.json().catch(() => ({}))
        throw new Error(typeof err?.error === 'string' ? err.error : `サーバーから結果を受け取れませんでした（HTTP ${res.status}）`)
      }
      // 200 でも本文が JSON でなければ（途中で切れた応答等）SyntaxError の英語が見出しに出るので和文にする
      const data: SimResult = await res.json().catch(() => { throw new Error('サーバーから結果を受け取れませんでした') })
      setResult(data)
    } catch (e) {
      // fetch 自体の失敗（回線切れ等）は英語の TypeError になるので和文に置き換える
      setError(e instanceof TypeError ? 'サーバーに接続できませんでした' : e instanceof Error ? e.message : 'エラーが発生しました')
    } finally {
      setLoading(false)
    }
  }

  const pnlPositive = (result?.pnl ?? 0) >= 0
  const selectedInvestor = INVESTORS.find(i => i.id === investorId)!

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-ink">AIシミュレーション</h1>
        <p className="text-muted text-sm mt-1">著名投資家のロジックで1ヶ月の自動売買をシミュレーション</p>
      </div>

      {/* Config */}
      <div className="bg-panel border border-border rounded-xl p-5 space-y-5">
        {/* Investor selector */}
        <div>
          <label className="block text-xs text-muted mb-2">投資家戦略を選択</label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {INVESTORS.map(inv => {
              const active = investorId === inv.id
              return (
                <button
                  key={inv.id}
                  onClick={() => setInvestorId(inv.id)}
                  style={active ? { borderColor: inv.color, backgroundColor: `${inv.color}1a` } : undefined}
                  className={`rounded-xl p-3 border text-left transition-all ${
                    active ? '' : 'border-border hover:border-accent bg-surface/30'
                  }`}
                >
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-ink text-sm font-bold mb-2"
                    style={{ backgroundColor: inv.color }}
                  >
                    {inv.initial}
                  </div>
                  <p className="text-sm font-semibold" style={active ? { color: inv.color } : undefined}>{inv.label}</p>
                  <p className="text-xs text-muted mt-0.5">{inv.description}</p>
                </button>
              )
            })}
          </div>
          {/* /watch・銘柄詳細の名人欄はルールブック（lib/investors/rulebooks）。ここは lib/investors/*.ts の analyze() の
              簡易版の条件で、別物であることを1行で断る（オーナー決定 2026-09-17） */}
          <p className="text-small text-ink-2 mt-2">このページの投資家の条件は簡易版で、ルールブックとは別のものです。</p>
        </div>

        {/* Universe + Capital */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-muted mb-2">銘柄ユニバース</label>
            <div className="space-y-2">
              {UNIVERSES.map(u => (
                <label key={u.id} className="flex items-start gap-3 cursor-pointer group">
                  <input
                    type="radio"
                    name="universe"
                    checked={universe === u.id}
                    onChange={() => setUniverse(u.id)}
                    className="mt-0.5 accent-blue-500"
                  />
                  <div>
                    <p className="text-sm text-ink-2 group-hover:text-ink transition-colors">{u.label}</p>
                    <p className="text-xs text-muted">{u.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs text-muted mb-2">初期資本（USD）</label>
            <input
              type="number"
              min="1000"
              step="1000"
              value={capital}
              onChange={e => setCapital(e.target.value)}
              className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-ink text-sm font-mono focus:outline-none focus:border-blue-200"
            />
            <p className="text-xs text-muted mt-1">
              {formatUSD(Number(capital) || 100_000)} からスタート
            </p>
          </div>
        </div>

        <button
          onClick={run}
          disabled={loading}
          style={loading ? undefined : { backgroundColor: selectedInvestor.color }}
          className={`px-6 py-2.5 text-sm font-medium rounded-lg transition-colors ${
            loading ? 'bg-surface text-muted cursor-not-allowed' : 'text-ink hover:opacity-80'
          }`}
        >
          {loading ? `シミュレーション中... (${elapsed}秒)` : '1ヶ月シミュレーション実行'}
        </button>
      </div>

      {/* Error: 取得できなかったことは --warning-ink で書く（§5-1 色のルール）。枠で囲わず白い帯に、文字は左揃え
          （§6-12 の三点形式: 何が起きたか／データはどうなったか／どうすればいいか）。app/stocks/[symbol]/page.tsx の
          catch と components/MasterSignals.tsx の「シグナルを取得できませんでした」と同じ型。新しい見せ方は作らない。
          仮の数字は出さない: run() が先に setResult(null) するので、エラー時に前回や見本の結果は描かれない */}
      {error && (
        <div className="bg-card rounded-card px-4 py-5 space-y-1">
          <p className="text-body text-warning-ink">{error}</p>
          <p className="text-body text-ink-2 max-w-[42rem]">
            実データが取れないときは、代わりの数字を作らずここで止めます。損益・勝率・売買履歴は表示していません。
          </p>
          <p className="text-body text-ink-2 max-w-[42rem]">
            時間をおいて、もう一度実行してください。
          </p>
        </div>
      )}

      {/* Loading */}
      {loading && (
        <div className="bg-panel border border-border rounded-xl p-8 text-center space-y-3">
          <div className="w-8 h-8 border-2 border-border border-t-blue-500 rounded-full animate-spin mx-auto" />
          <p className="text-muted text-sm">Yahoo Financeから実データを取得中...</p>
          <p className="text-xs text-muted">銘柄数によっては20〜30秒かかることがあります</p>
        </div>
      )}

      {/* Results */}
      {result && !loading && (
        <div className="space-y-5">
          {/* 除外した銘柄: 株価を取れなかった銘柄は lib/simulation.ts が黙って外すので、ここで必ず伝える（原則9・
              2026-09-17 レビュー指摘 W1）。上のエラー帯と同じ型（--warning-ink の1行目＋データの状態＋どうすればいいか）。
              空のとき（全銘柄で計算できたとき）は何も出さず、通常時の表示は変えない */}
          {result.excludedSymbols.length > 0 && (
            <div className="bg-card rounded-card px-4 py-5 space-y-1">
              {/* 1行に書く: JSX の改行は空白になり「銘柄 （」と隙間が入るため */}
              <p className="text-body text-warning-ink">
                {result.stockResults.length + result.excludedSymbols.length}銘柄中 {result.excludedSymbols.length} 銘柄（{result.excludedSymbols.join('・')}）は株価を取得できず、除外して計算しました
              </p>
              <p className="text-body text-ink-2 max-w-[42rem]">
                下の損益・勝率・売買履歴は、残りの {result.stockResults.length} 銘柄だけで計算した結果です。除外した銘柄の代わりの数字は作っていません。
              </p>
              <p className="text-body text-ink-2 max-w-[42rem]">
                時間をおいて、もう一度実行してください。
              </p>
            </div>
          )}

          {/* Period */}
          <p className="text-xs text-muted">
            シミュレーション期間: {result.startDate} → {result.endDate}（{result.simulationDays}営業日）
            ｜ 戦略: {result.investorNameJa}
          </p>

          {/* Summary cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div className="bg-panel border border-border rounded-xl p-4">
              <p className="text-muted text-xs mb-1">最終資産</p>
              <p className="text-ink text-xl font-bold font-mono">{formatUSD(result.finalValue)}</p>
              <p className="text-xs text-muted mt-0.5">初期: {formatUSD(result.startCapital)}</p>
            </div>
            <div className="bg-panel border border-border rounded-xl p-4">
              <p className="text-muted text-xs mb-1">損益</p>
              <p className={`text-xl font-bold font-mono ${pnlPositive ? 'text-green-700' : 'text-red-700'}`}>
                {pnlPositive ? '+' : ''}{formatUSD(result.pnl)}
              </p>
              <p className={`text-xs font-mono ${pnlPositive ? 'text-green-700' : 'text-red-700'}`}>
                {pnlPositive ? '▲' : '▼'} {Math.abs(result.pnlPct).toFixed(2)}%
              </p>
            </div>
            <div className="bg-panel border border-border rounded-xl p-4">
              <p className="text-muted text-xs mb-1">勝率</p>
              <p className="text-ink text-xl font-bold font-mono">{result.winRate.toFixed(0)}%</p>
              <p className="text-xs text-muted mt-0.5">
                {result.winningPositions}勝 / {result.losingPositions}敗
              </p>
            </div>
            <div className="bg-panel border border-border rounded-xl p-4">
              <p className="text-muted text-xs mb-1">総トレード数</p>
              <p className="text-ink text-xl font-bold font-mono">{result.trades.length}件</p>
              <p className="text-xs text-muted mt-0.5">
                買: {result.trades.filter(t => t.action === 'buy').length} / 売: {result.trades.filter(t => t.action === 'sell').length}
              </p>
            </div>
          </div>

          {/* Portfolio chart */}
          <div className="bg-panel border border-border rounded-xl p-5">
            <h2 className="text-ink font-semibold text-sm mb-3">ポートフォリオ推移</h2>
            <MiniChart values={result.dailyValues} />
          </div>

          {/* Stock results + Trade log side by side */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            {/* Stock signals */}
            <div className="bg-panel border border-border rounded-xl p-5">
              <h2 className="text-ink font-semibold text-sm mb-3">銘柄シグナル</h2>
              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {result.stockResults.sort((a, b) => (b.bought ? 1 : 0) - (a.bought ? 1 : 0)).map(s => (
                  <div key={s.symbol} className={`flex items-center justify-between px-3 py-2 rounded-lg ${s.bought ? 'bg-surface' : 'bg-surface/30'}`}>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-blue-700">{s.symbol}</span>
                      {s.bought && (
                        <span className="text-xs bg-blue-50 text-blue-700 px-1.5 py-0.5 rounded">保有</span>
                      )}
                    </div>
                    <div className="flex items-center gap-3">
                      {s.buyPrice && (
                        <span className={`text-xs font-mono ${s.pnlPct >= 0 ? 'text-green-700' : 'text-red-700'}`}>
                          {s.pnlPct >= 0 ? '+' : ''}{s.pnlPct.toFixed(1)}%
                        </span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                        s.signal === 'buy'  ? 'bg-green-50 text-green-700' :
                        s.signal === 'sell' ? 'bg-red-50 text-red-700' :
                        'bg-surface text-muted'
                      }`}>
                        {s.signal === 'buy' ? 'BUY' : s.signal === 'sell' ? 'SELL' : 'HOLD'}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Trade log */}
            <div className="bg-panel border border-border rounded-xl p-5">
              <h2 className="text-ink font-semibold text-sm mb-3">取引履歴</h2>
              {result.trades.length === 0 ? (
                <p className="text-muted text-sm">このユニバースでは買いシグナルが発生しませんでした</p>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                  {result.trades.map((t, i) => (
                    <div key={i} className="flex items-start gap-3 px-3 py-2 bg-surface/50 rounded-lg">
                      <span className={`shrink-0 mt-0.5 text-xs font-bold px-2 py-0.5 rounded ${
                        t.action === 'buy' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'
                      }`}>
                        {t.action === 'buy' ? 'BUY' : 'SELL'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <span className="font-mono font-bold text-sm text-ink">{t.symbol}</span>
                          <span className="text-xs text-muted font-mono">{t.date}</span>
                        </div>
                        <p className="text-xs text-ink-2 mt-0.5">
                          {t.shares.toFixed(2)}株 × ${t.price.toFixed(2)} = ${t.total.toLocaleString()}
                        </p>
                        {t.reasons[0] && (
                          <p className="text-xs text-muted mt-0.5 truncate">{t.reasons[0]}</p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Disclaimer */}
          <p className="text-xs text-muted/60 leading-relaxed">
            ※ このシミュレーションは過去の実市場データをもとにした参考情報です。実際の投資成果を保証するものではありません。
            投資判断はご自身の責任で行ってください。
          </p>
        </div>
      )}
    </div>
  )
}
