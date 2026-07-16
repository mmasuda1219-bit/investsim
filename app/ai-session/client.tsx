'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import Link from 'next/link'
import dynamic from 'next/dynamic'
import type { Trade, TradeReference } from '@/components/TradingChart'
import ReferencePanel from '@/components/ReferencePanel'
import type { AISession, AIDecision, AITrade, Holding, EquityPoint } from '@/lib/ai-trader/engine'
import type { ClosedTrade } from '@/lib/ai-trader/memory'
import { normalizeLearningMemory } from '@/lib/ai-trader/memory'

const TradingChart = dynamic(() => import('@/components/TradingChart'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[500px] bg-[#0f1117] rounded-xl text-gray-400 animate-pulse text-sm">
      チャートデータ読み込み中…
    </div>
  ),
})

const EquityChart = dynamic(
  () => import('@/components/EquityChart').then(m => m.EquityChart),
  { ssr: false, loading: () => <div className="h-56 flex items-center justify-center text-gray-500 text-sm bg-[#0f1117] rounded-lg">グラフ読込中...</div> }
)

// ── Helpers ───────────────────────────────────────────────────────────────
const pnlCls = (v: number) => v > 0 ? 'text-emerald-400' : v < 0 ? 'text-red-400' : 'text-gray-400'
const fmtUSD = (n: number, dec = 2) =>
  `$${n.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec })}`
const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`

function ago(iso: string) {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60)   return `${s}秒前`
  if (s < 3600) return `${Math.floor(s / 60)}分前`
  return `${Math.floor(s / 3600)}時間前`
}

// NY市場日付(YYYY-MM-DD)。サーバー側の自動tick日次カウンタと同じ基準で「本日 n/3」を表示するため。
function nyDate() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date())
}
// 本日の自動tick回数（dateが今日でなければ0扱い）。
function autoCountToday(session: AISession): number {
  const a = session.auto
  if (!a) return 0
  return a.date === nyDate() ? a.count : 0
}

// Convert AI trades to TradingChart Trade format (with pairing for PnL display)
function toChartTrades(aiTrades: AITrade[], symbol: string): Trade[] {
  const filtered = [...aiTrades]
    .filter(t => t.symbol === symbol)
    .reverse() // oldest first

  const result: Trade[] = []
  const pendingBuyIds: string[] = []

  filtered.forEach((t, i) => {
    const id = `ai_${symbol}_${i}_${t.action}`
    const ref: TradeReference = {
      summary: t.reason,
      analysis: `【テクニカル分析】\n${t.technicals}\n\n【ファンダメンタル分析】\n${t.fundamentals}`,
      indicators: [],
      sources: t.sources.map(s => ({
        title: s,
        type: s.includes('Claude') ? 'model' as const
          : s.includes('News') ? 'news' as const
          : 'model' as const,
      })),
    }

    if (t.action === 'buy') {
      result.push({
        id, symbol: t.symbol, investor: 'AI TRADER',
        action: 'BUY',
        date: t.timestamp.slice(0, 10),
        price: t.price, shares: t.shares,
        reference: ref,
      })
      pendingBuyIds.push(id)
    } else {
      const pairedTradeId = pendingBuyIds.shift()
      result.push({
        id, symbol: t.symbol, investor: 'AI TRADER',
        action: 'SELL',
        date: t.timestamp.slice(0, 10),
        price: t.price, shares: t.shares,
        pairedTradeId,
        reference: ref,
      })
    }
  })

  return result
}

// ── Start screen ──────────────────────────────────────────────────────────
function StartScreen({ onStart }: { onStart: (capital: number) => void }) {
  const [capital, setCapital] = useState(100000)
  const [loading, setLoading] = useState(false)

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-2">
          <div className="text-4xl font-black tracking-tight">
            <span className="text-emerald-400">AI</span>
            <span className="text-white"> TRADER</span>
          </div>
          <p className="text-gray-400 text-sm leading-relaxed">
            Claude が自律的にリアルタイム市場データを分析し、<br />
            ファンダメンタル＋テクニカル＋ニュースを総合判断して<br />
            仮想売買を行います
          </p>
        </div>

        <div className="flex items-center justify-center gap-5 text-xs text-gray-500">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Yahoo Finance</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> ファンダメンタル分析</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block" /> Claude AI</span>
        </div>

        <div className="bg-gray-900 border border-gray-700 rounded-2xl p-6 space-y-4 text-left">
          <div>
            <label className="text-xs text-gray-500 block mb-2">初期資金 (USD)</label>
            <input
              type="number"
              value={capital}
              onChange={e => setCapital(Number(e.target.value))}
              min={10000} max={10000000} step={10000}
              className="w-full bg-gray-950 border border-gray-700 rounded-lg px-4 py-3 text-white text-sm focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[50000, 100000, 500000].map(v => (
              <button
                key={v}
                onClick={() => setCapital(v)}
                className={`py-2 rounded-lg text-xs font-medium border transition-colors ${
                  capital === v
                    ? 'border-emerald-500 text-emerald-400 bg-emerald-500/10'
                    : 'border-gray-700 text-gray-500 hover:border-gray-500 hover:text-gray-300'
                }`}
              >
                ${(v / 1000).toFixed(0)}K
              </button>
            ))}
          </div>
          <button
            onClick={() => { setLoading(true); onStart(capital) }}
            disabled={loading}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold py-3 rounded-xl text-sm transition-colors"
          >
            {loading ? '分析開始中...' : '▶ 自動売買を開始する'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Nav (module-level to prevent remount on every render) ─────────────────
interface NavBarProps {
  session: AISession | null
  ticking: boolean
}
function NavBar({ session, ticking }: NavBarProps) {
  return (
    <nav className="border-b border-gray-800 bg-gray-900/90 backdrop-blur px-6 py-3 flex items-center gap-4 sticky top-0 z-30">
      <div className="font-bold text-lg tracking-tight">
        <span className="text-emerald-400">Invest</span>Sim
      </div>
      <span className="text-xs text-gray-500 border border-gray-700 px-2 py-0.5 rounded">Beta</span>
      <div className="flex items-center gap-2 ml-2">
        <Link
          href="/"
          className="text-xs text-gray-500 hover:text-gray-300 px-2.5 py-1 rounded-lg transition-colors"
        >
          著名投資家シミュレーション
        </Link>
        <span className="text-xs text-emerald-400 border-b border-emerald-500 pb-0.5 font-semibold">AI TRADER</span>
      </div>
      {session && (
        <div className="ml-auto flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border ${
            ticking
              ? 'border-yellow-600/50 text-yellow-400 bg-yellow-500/10 animate-pulse'
              : 'border-emerald-600/40 text-emerald-400 bg-emerald-500/10'
          }`}>
            <span className="w-1.5 h-1.5 rounded-full bg-current" />
            {ticking ? '分析中...' : 'LIVE'}
          </div>
          <div className={`text-sm font-bold tabular-nums ${pnlCls(session.pnl)}`}>
            {session.pnl >= 0 ? '+' : ''}{fmtUSD(session.pnl)} ({fmtPct(session.pnlPct)})
          </div>
          <div className="text-xs text-gray-600">Tick #{session.tickCount}</div>
        </div>
      )}
    </nav>
  )
}

// ── Main component ────────────────────────────────────────────────────────
export function AISessionClient() {
  const [session, setSession]     = useState<AISession | null>(null)
  const [ticking, setTicking]     = useState(false)
  const [autoTick, setAutoTick]   = useState(true)
  const [interval, setIntervalS]  = useState(120)
  const [countdown, setCountdown] = useState(0)
  const [error, setError]         = useState<string | null>(null)
  const [tab, setTab]             = useState<'performance' | 'decisions' | 'trades' | 'learning'>('performance')
  const [hydrated, setHydrated]   = useState(false)
  const [restoring, setRestoring] = useState(true)

  // Chart state
  const [chartSymbol, setChartSymbol] = useState('AAPL')
  const [viewPeriod, setViewPeriod]   = useState<'1y' | '5y' | '10y'>('1y')
  const [selectedTrade, setSelectedTrade] = useState<Trade | null>(null)

  const autoRef    = useRef(false)
  const sessionRef = useRef<AISession | null>(null)
  const timerRef   = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickingRef = useRef(false)

  useEffect(() => { sessionRef.current = session }, [session])
  useEffect(() => { autoRef.current = autoTick }, [autoTick])

  useEffect(() => {
    if (!hydrated) return
    localStorage.setItem('ai_auto_tick', autoTick ? '1' : '0')
  }, [autoTick, hydrated])
  useEffect(() => {
    if (!hydrated) return
    localStorage.setItem('ai_tick_interval', String(interval))
  }, [interval, hydrated])

  // Restore session on mount
  useEffect(() => {
    const savedAuto     = localStorage.getItem('ai_auto_tick')
    const savedInterval = localStorage.getItem('ai_tick_interval')
    if (savedAuto     !== null) setAutoTick(savedAuto === '1')
    if (savedInterval !== null) setIntervalS(Number(savedInterval))
    setHydrated(true)

    const savedId = localStorage.getItem('ai_session_id')
    const restore = async () => {
      try {
        if (savedId) {
          const res = await fetch(`/api/ai-session/${savedId}`)
          if (res.ok) {
            const data = await res.json()
            if (!data.error) { setSession(data); return }
          }
          localStorage.removeItem('ai_session_id')
        }
        const listRes = await fetch('/api/ai-session')
        if (listRes.ok) {
          const list: AISession[] = await listRes.json()
          if (list.length > 0) {
            setSession(list[0])
            localStorage.setItem('ai_session_id', list[0].id)
          }
        }
      } finally {
        setRestoring(false)
      }
    }
    restore()
  }, [])

  const runTick = useCallback(async (sessOverride?: AISession) => {
    const sess = sessOverride ?? sessionRef.current
    if (!sess || tickingRef.current) return
    tickingRef.current = true
    setTicking(true)
    setError(null)
    try {
      const res = await fetch(`/api/ai-session/${sess.id}/tick`, { method: 'POST' })
      const data: AISession = await res.json()
      if (res.status === 409) { setError((data as any).message ?? '自動分析実行中です'); return }
      if ((data as any).error) { setError((data as any).error); return }
      setSession(data)
      sessionRef.current = data
    } catch {
      setError('分析に失敗しました')
    } finally {
      tickingRef.current = false
      setTicking(false)
    }
  }, [])

  const startSession = useCallback(async (capital: number) => {
    setError(null)
    try {
      const res = await fetch('/api/ai-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capital }),
      })
      const data: AISession = await res.json()
      setSession(data)
      sessionRef.current = data
      localStorage.setItem('ai_session_id', data.id)
      setAutoTick(true)
      runTick(data)
    } catch {
      setError('セッション開始に失敗しました')
    }
  }, [runTick])

  // サーバー側「自動運転」トグル。PATCHで auto.enabled を切り替える。
  const [autoDriveSaving, setAutoDriveSaving] = useState(false)
  const toggleAutoDrive = useCallback(async () => {
    const sess = sessionRef.current
    if (!sess || autoDriveSaving) return
    const next = !(sess.auto?.enabled ?? false)
    setAutoDriveSaving(true)
    setError(null)
    try {
      const res = await fetch(`/api/ai-session/${sess.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto: { enabled: next } }),
      })
      const data: AISession = await res.json()
      if ((data as any).error) { setError((data as any).error); return }
      setSession(data)
      sessionRef.current = data
    } catch {
      setError('自動運転の切り替えに失敗しました')
    } finally {
      setAutoDriveSaving(false)
    }
  }, [autoDriveSaving])

  // Auto-tick countdown
  useEffect(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (!autoTick || !session) { setCountdown(0); return }

    let remaining = interval
    setCountdown(remaining)
    timerRef.current = setInterval(async () => {
      remaining--
      setCountdown(remaining)
      if (remaining <= 0) {
        remaining = interval
        setCountdown(remaining)
        if (autoRef.current) await runTick()
      }
    }, 1000)

    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTick, interval, session?.id])

  // Auto-switch chart to most recently traded symbol
  useEffect(() => {
    if (!session) return
    const holdings = Object.keys(session.holdings)
    if (holdings.length > 0 && !holdings.includes(chartSymbol)) {
      setChartSymbol(holdings[0])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.tickCount])

  // useMemo must be called unconditionally before any early returns (Rules of Hooks)
  const sessionTrades = session?.trades ?? []
  const chartTrades = useMemo(
    () => toChartTrades(sessionTrades, chartSymbol),
    [sessionTrades, chartSymbol]
  )

  // Loading
  if (restoring) return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center">
      <div className="flex items-center gap-3 text-gray-400">
        <div className="w-5 h-5 border-2 border-gray-700 border-t-emerald-400 rounded-full animate-spin" />
        <span className="text-sm">セッション復元中...</span>
      </div>
    </div>
  )

  if (!session) return (
    <div className="min-h-screen bg-gray-950 text-white">
      <NavBar session={null} ticking={false} />
      <StartScreen onStart={startSession} />
    </div>
  )

  const {
    pnl, pnlPct, totalValue, cash, capital, tickCount, lastTickAt,
    holdings = {},
    decisions = [],
    trades = [],
  } = session
  const learning = normalizeLearningMemory(session.learning)
  const holdingSymbols = Object.keys(holdings)
  const allSymbols = Array.from(new Set([...holdingSymbols, ...(session.watchlist ?? [])].slice(0, 8)))

  const PERIODS: { label: string; value: '1y' | '5y' | '10y' }[] = [
    { label: '1年', value: '1y' },
    { label: '5年', value: '5y' },
    { label: '10年', value: '10y' },
  ]

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <NavBar session={session} ticking={ticking} />

      {error && (
        <div className="max-w-screen-2xl mx-auto px-6 pt-4">
          <div className="bg-red-900/30 border border-red-700/40 rounded-lg px-4 py-2 text-red-400 text-sm">{error}</div>
        </div>
      )}

      <div className="max-w-screen-2xl mx-auto px-6 py-5 grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-5">

        {/* ── Left Sidebar ─────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Portfolio */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest">ポートフォリオ</div>
            <div className="space-y-2.5">
              {[
                { label: '総資産', value: fmtUSD(totalValue, 0), cls: 'font-bold text-white' },
                { label: '現金', value: fmtUSD(cash, 0), cls: 'text-gray-300' },
                { label: '損益', value: `${pnl >= 0 ? '+' : ''}${fmtUSD(pnl)} (${fmtPct(pnlPct)})`, cls: `font-bold ${pnlCls(pnl)}` },
                { label: '初期資金', value: fmtUSD(capital, 0), cls: 'text-gray-500' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-gray-500">{label}</span>
                  <span className={`tabular-nums ${cls}`}>{value}</span>
                </div>
              ))}
            </div>
            {/* Cash bar */}
            <div>
              <div className="flex justify-between text-xs text-gray-600 mb-1">
                <span>現金比率</span>
                <span>{((cash / totalValue) * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${Math.min((cash / totalValue) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Holdings */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">
              保有銘柄 <span className="text-gray-700">({holdingSymbols.length}/5)</span>
            </div>
            {holdingSymbols.length === 0 ? (
              <p className="text-xs text-gray-700">ポジションなし</p>
            ) : (
              <div className="space-y-2">
                {holdingSymbols.map(sym => {
                  const pos = holdings[sym] as Holding
                  return (
                    <button
                      key={sym}
                      onClick={() => setChartSymbol(sym)}
                      className={`w-full text-left rounded-lg p-2.5 border transition-colors ${
                        chartSymbol === sym
                          ? 'border-emerald-600/50 bg-emerald-900/10'
                          : 'border-gray-800 hover:border-gray-600'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-mono font-semibold text-sm text-white">{sym}</span>
                        <span className="text-xs text-gray-500">{pos.shares.toFixed(2)}株</span>
                      </div>
                      <div className="flex justify-between text-xs mt-0.5">
                        <span className="text-gray-600">avg {fmtUSD(pos.avgCost)}</span>
                        <span className="text-gray-400">{fmtUSD(pos.shares * pos.avgCost, 0)}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Learning */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">学習状態</div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">クローズ取引</span>
                <span className="text-gray-300">{learning.stats.totalTrades}件</span>
              </div>
              {learning.stats.totalTrades > 0 && (
                <>
                  <div className="flex justify-between">
                    <span className="text-gray-500">勝率</span>
                    <span className={pnlCls(learning.stats.winRate - 50)}>{learning.stats.winRate}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">平均利益</span>
                    <span className="text-emerald-400">+{learning.stats.avgGainPct}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">平均損失</span>
                    <span className="text-red-400">{learning.stats.avgLossPct}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500">合計P&L</span>
                    <span className={`font-semibold ${pnlCls(learning.stats.totalPnl)}`}>
                      {learning.stats.totalPnl >= 0 ? '+' : ''}{fmtUSD(learning.stats.totalPnl, 0)}
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">学習済み教訓</span>
                <span className="text-gray-300">{learning.lessons.length}件</span>
              </div>
            </div>
          </div>

          {/* Controls */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4 space-y-3">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest">Auto Tick</div>
            <div className="flex items-center justify-between">
              <select
                value={interval}
                onChange={e => setIntervalS(Number(e.target.value))}
                className="bg-gray-800 border border-gray-700 text-xs text-gray-300 px-2 py-1.5 rounded-lg"
              >
                <option value={60}>60秒</option>
                <option value={120}>2分</option>
                <option value={300}>5分</option>
                <option value={600}>10分</option>
              </select>
              {autoTick && countdown > 0 && (
                <span className="text-sm font-mono font-bold text-gray-400">{countdown}s</span>
              )}
              <button
                onClick={() => setAutoTick(v => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors ${autoTick ? 'bg-emerald-600' : 'bg-gray-700'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoTick ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <button
              onClick={() => runTick()}
              disabled={ticking}
              className="w-full bg-emerald-700 hover:bg-emerald-600 disabled:opacity-40 text-white text-xs font-bold py-2 rounded-lg transition-colors"
            >
              {ticking ? '⟳ 分析中...' : '▶ 今すぐ Tick 実行'}
            </button>

            {/* サーバー側 自動運転（ブラウザを閉じてもcronがtickする）*/}
            <div className="pt-1 border-t border-gray-800 space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-xs font-semibold text-gray-400">自動運転</div>
                  <div className="text-[11px] text-gray-600">ブラウザを閉じてもサーバーが自動でtick</div>
                </div>
                <button
                  onClick={toggleAutoDrive}
                  disabled={autoDriveSaving}
                  className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${session.auto?.enabled ? 'bg-emerald-600' : 'bg-gray-700'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${session.auto?.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div className="flex justify-between text-[11px]">
                <span className="text-gray-600">本日の自動tick</span>
                <span className={`tabular-nums font-mono ${session.auto?.enabled ? 'text-emerald-400' : 'text-gray-500'}`}>
                  {autoCountToday(session)}/3
                </span>
              </div>
            </div>
            <button
              onClick={() => {
                setSession(null)
                setAutoTick(false)
                localStorage.removeItem('ai_session_id')
                localStorage.removeItem('ai_auto_tick')
              }}
              className="w-full border border-gray-700 text-gray-500 hover:text-gray-300 text-xs py-1.5 rounded-lg transition-colors"
            >
              ✕ セッションをリセット
            </button>
          </div>

          {/* Data sources */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 p-4">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-3">データソース</div>
            <div className="space-y-2 text-xs text-gray-500">
              {[
                { color: 'bg-blue-400',   label: 'Yahoo Finance',        sub: 'リアルタイム株価・10年チャート' },
                { color: 'bg-emerald-400', label: 'ファンダメンタル分析', sub: 'PER/ROE/ROA/FCF/D&E' },
                { color: 'bg-yellow-400', label: 'Yahoo Finance News',   sub: '最新ニュースヘッドライン' },
                { color: 'bg-purple-400', label: 'Claude Sonnet 4.6',   sub: 'AI売買判断エンジン' },
              ].map(s => (
                <div key={s.label} className="flex items-start gap-2">
                  <span className={`w-2 h-2 rounded-full ${s.color} mt-0.5 shrink-0`} />
                  <div>
                    <div className="text-gray-400">{s.label}</div>
                    <div className="text-gray-700 text-[11px]">{s.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right Main Content ───────────────────────────────────────── */}
        <div className="space-y-5 min-w-0">

          {/* Symbol + Period controls — same style as investsim */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 px-5 py-4 flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-gray-500">銘柄</span>
              <div className="flex flex-wrap gap-1.5">
                {allSymbols.map(sym => (
                  <button
                    key={sym}
                    onClick={() => setChartSymbol(sym)}
                    className={`text-xs px-2.5 py-1 rounded border font-mono transition-colors ${
                      chartSymbol === sym
                        ? 'bg-emerald-900/50 border-emerald-600 text-emerald-300'
                        : holdingSymbols.includes(sym)
                          ? 'bg-emerald-950/30 border-emerald-800 text-emerald-500 hover:border-emerald-600'
                          : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {sym}
                    {holdingSymbols.includes(sym) && <span className="ml-1 text-emerald-400">●</span>}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2 ml-auto">
              <span className="text-xs text-gray-500">表示期間</span>
              <div className="flex gap-1">
                {PERIODS.map(p => (
                  <button
                    key={p.value}
                    onClick={() => setViewPeriod(p.value)}
                    className={`text-xs px-3 py-1 rounded border transition-colors font-medium ${
                      viewPeriod === p.value
                        ? 'bg-blue-900/50 border-blue-600 text-blue-300'
                        : 'bg-gray-800 border-gray-700 text-gray-400 hover:border-gray-500'
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
              <span className="text-xs text-gray-700 ml-1 hidden sm:inline">← ドラッグで遡れます</span>
            </div>
          </div>

          {/* TradingChart with AI trade markers */}
          <TradingChart
            symbol={chartSymbol}
            viewPeriod={viewPeriod}
            trades={chartTrades}
            onTradeClick={t => setSelectedTrade(t)}
          />

          {/* Tabs */}
          <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
            <div className="flex border-b border-gray-800 overflow-x-auto">
              {([
                { key: 'performance', label: '📈 運用成績' },
                { key: 'decisions',   label: 'AI判断ログ',  count: decisions.length },
                { key: 'trades',      label: '売買履歴',    count: trades.length },
                { key: 'learning',    label: '学習・教訓',  count: learning.lessons.length },
              ] as const).map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-5 py-3 text-xs font-semibold whitespace-nowrap transition-colors ${
                    tab === t.key
                      ? 'text-white border-b-2 border-emerald-400 bg-emerald-500/5'
                      : 'text-gray-500 hover:text-gray-300'
                  }`}
                >
                  {t.label}
                  {'count' in t && t.count > 0 && (
                    <span className="ml-1.5 bg-gray-800 text-gray-400 text-xs px-1.5 py-0.5 rounded-full">
                      {t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="p-5">

              {/* Performance tab */}
              {tab === 'performance' && (() => {
                const s = session.stats ?? {}
                const eq = session.equityHistory ?? []
                const latest = eq[eq.length - 1]
                const benchPct = latest?.benchmarkPct
                const spyValue = benchPct != null ? capital * (1 + benchPct / 100) : null
                const alpha = spyValue != null ? totalValue - spyValue : null
                return (
                  <div className="space-y-5">
                    <div>
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-xs text-gray-500 font-semibold uppercase tracking-wider">エクイティカーブ</span>
                        <span className="flex items-center gap-1 text-xs text-emerald-400"><span className="w-3 h-0.5 bg-emerald-400 inline-block"/>AI</span>
                        <span className="flex items-center gap-1 text-xs text-gray-500"><span className="w-3 h-0.5 bg-gray-500 inline-block"/>SPY</span>
                      </div>
                      <EquityChart history={eq} capital={capital} height={220} />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: '運用日数',        value: `${s.daysRunning ?? 0}日` },
                        { label: '年率換算リターン', value: `${(s.annualizedReturnPct ?? 0) >= 0 ? '+' : ''}${(s.annualizedReturnPct ?? 0).toFixed(1)}%`, cls: pnlCls(s.annualizedReturnPct ?? 0) },
                        { label: '最大ドローダウン', value: `-${(s.maxDrawdownPct ?? 0).toFixed(1)}%`, cls: 'text-red-400' },
                        { label: 'シャープレシオ',  value: (s.sharpeRatio ?? 0).toFixed(2), cls: (s.sharpeRatio ?? 0) > 1 ? 'text-emerald-400' : 'text-gray-300' },
                        { label: 'AI総リターン',    value: `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`, cls: pnlCls(pnlPct) },
                        { label: 'SPYリターン',     value: benchPct != null ? `${benchPct >= 0 ? '+' : ''}${benchPct.toFixed(2)}%` : 'N/A', cls: pnlCls(benchPct ?? 0) },
                        { label: 'アルファ',        value: alpha != null ? `${alpha >= 0 ? '+' : ''}$${Math.abs(alpha).toFixed(0)}` : 'N/A', cls: pnlCls(alpha ?? 0) },
                        { label: '勝率',            value: `${(s.winRate ?? 0).toFixed(0)}%`, cls: (s.winRate ?? 0) >= 50 ? 'text-emerald-400' : 'text-red-400' },
                      ].map(({ label, value, cls }) => (
                        <div key={label} className="bg-gray-950 border border-gray-800 rounded-xl p-3">
                          <div className="text-xs text-gray-600 mb-1">{label}</div>
                          <div className={`text-base font-bold tabular-nums ${cls ?? 'text-white'}`}>{value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="text-xs text-gray-700 text-center">
                      {eq.length} ポイント記録済み · 総取引 {s.totalTradeCount ?? 0}件 · Tick #{tickCount} · {ago(lastTickAt)}
                    </div>
                  </div>
                )
              })()}

              {/* AI Decisions tab */}
              {tab === 'decisions' && (
                decisions.length === 0 ? (
                  <div className="text-gray-600 text-sm py-10 text-center">
                    Tickを実行するとClaudeの判断ログが表示されます
                  </div>
                ) : (
                  <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
                    {decisions.slice(0, 20).map((dec: AIDecision, i) => {
                      const actionStyle: Record<string, string> = {
                        buy:   'bg-emerald-900/40 border-emerald-700 text-emerald-300',
                        sell:  'bg-red-900/40 border-red-700 text-red-300',
                        hold:  'bg-yellow-900/40 border-yellow-700 text-yellow-300',
                        watch: 'bg-gray-800 border-gray-700 text-gray-400',
                      }
                      const actionLabel: Record<string, string> = { buy: '買い', sell: '売り', hold: 'ホールド', watch: '監視' }
                      return (
                        <div key={i} className="border border-gray-800 rounded-xl p-4 hover:border-gray-700 transition-colors">
                          <div className="flex flex-wrap items-center gap-2 mb-2">
                            <span className="font-mono font-bold text-white">{dec.symbol}</span>
                            <span className="text-xs text-gray-600">{dec.name}</span>
                            <span className={`text-xs px-2 py-0.5 rounded border font-semibold ${actionStyle[dec.action] ?? actionStyle.watch}`}>
                              {actionLabel[dec.action] ?? dec.action}
                            </span>
                            <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                              dec.confidence === 'high' ? 'bg-emerald-900/40 text-emerald-400'
                              : dec.confidence === 'medium' ? 'bg-yellow-900/40 text-yellow-400'
                              : 'bg-red-900/40 text-red-400'
                            }`}>
                              {dec.confidence}
                            </span>
                            <span className="ml-auto font-mono font-bold text-sm">{fmtUSD(dec.price)}</span>
                            <span className={`text-xs tabular-nums ${pnlCls(dec.change)}`}>
                              {dec.change >= 0 ? '+' : ''}{dec.change.toFixed(2)}%
                            </span>
                          </div>
                          <p className="text-sm text-gray-200 mb-3 leading-relaxed">{dec.reasoning}</p>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                            <div className="bg-gray-950 rounded-lg p-2.5">
                              <div className="text-gray-600 mb-1 font-medium">テクニカル</div>
                              <div className="text-gray-400">{dec.technicals}</div>
                            </div>
                            <div className="bg-gray-950 rounded-lg p-2.5">
                              <div className="text-gray-600 mb-1 font-medium">ファンダメンタル</div>
                              <div className="text-gray-400 line-clamp-2">{dec.fundamentals}</div>
                            </div>
                          </div>
                          {dec.newsInfluence && (
                            <div className="mt-2 text-xs text-gray-500 flex items-start gap-1">
                              <span className="text-yellow-500 shrink-0">📰</span>
                              {dec.newsInfluence}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap gap-1">
                            {dec.sources.map((src, si) => (
                              <span key={si} className="text-xs bg-gray-800 text-gray-500 px-2 py-0.5 rounded-full">{src}</span>
                            ))}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              )}

              {/* Trades tab */}
              {tab === 'trades' && (
                trades.length === 0 ? (
                  <div className="text-gray-600 text-sm py-10 text-center">取引履歴なし</div>
                ) : (
                  <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                    <table className="w-full text-xs min-w-[700px]">
                      <thead className="sticky top-0 bg-gray-900">
                        <tr className="text-gray-500 border-b border-gray-800">
                          <th className="text-left py-2 pr-4 font-medium">時刻</th>
                          <th className="text-left py-2 pr-4 font-medium">銘柄</th>
                          <th className="text-left py-2 pr-4 font-medium">売買</th>
                          <th className="text-right py-2 pr-4 font-medium">株数</th>
                          <th className="text-right py-2 pr-4 font-medium">価格</th>
                          <th className="text-right py-2 pr-4 font-medium">合計</th>
                          <th className="text-left py-2 font-medium">判断根拠</th>
                        </tr>
                      </thead>
                      <tbody>
                        {trades.map((t: AITrade, i) => (
                          <tr key={i} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                            <td className="py-2.5 pr-4 text-gray-600">{ago(t.timestamp)}</td>
                            <td className="py-2.5 pr-4">
                              <button
                                onClick={() => setChartSymbol(t.symbol)}
                                className="font-mono font-semibold text-white hover:text-emerald-400 transition-colors"
                              >
                                {t.symbol}
                              </button>
                            </td>
                            <td className="py-2.5 pr-4">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                t.action === 'buy'
                                  ? 'bg-emerald-900/50 text-emerald-400'
                                  : 'bg-red-900/50 text-red-400'
                              }`}>
                                {t.action === 'buy' ? '▲ 買い' : '▼ 売り'}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 text-right tabular-nums font-mono text-gray-300">{t.shares.toFixed(3)}</td>
                            <td className="py-2.5 pr-4 text-right tabular-nums font-mono">{fmtUSD(t.price)}</td>
                            <td className="py-2.5 pr-4 text-right tabular-nums font-mono font-semibold">{fmtUSD(t.total, 0)}</td>
                            <td className="py-2.5 text-gray-500 max-w-xs">
                              <div className="truncate">{t.reason}</div>
                              {t.technicals && <div className="text-gray-700 truncate text-[11px]">{t.technicals}</div>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )
              )}

              {/* Learning tab */}
              {tab === 'learning' && (
                <div className="space-y-6">
                  <div>
                    <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-3">
                      Claude が学んだ教訓
                      {learning.lessons.length === 0 && (
                        <span className="ml-2 text-gray-700 normal-case font-normal">(取引を積むと自動生成されます)</span>
                      )}
                    </div>
                    {learning.lessons.length > 0 ? (
                      <div className="space-y-2">
                        {learning.lessons.map((lesson, i) => (
                          <div key={i} className="flex items-start gap-3 bg-gray-950 rounded-lg p-3 border border-gray-800">
                            <span className="text-emerald-500 font-bold text-xs mt-0.5 shrink-0 font-mono">{i + 1}</span>
                            <p className="text-sm text-gray-300 leading-relaxed">{lesson}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-gray-700 text-sm py-6 text-center bg-gray-950 rounded-xl border border-gray-800">
                        3 Tick実行後、クローズした取引があれば教訓が自動生成されます
                      </div>
                    )}
                  </div>

                  {learning.closedTrades && learning.closedTrades.length > 0 && (
                    <div>
                      <div className="text-xs text-gray-500 font-semibold uppercase tracking-wider mb-3">クローズ済み取引</div>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {(learning.closedTrades as ClosedTrade[]).slice(0, 15).map((t, i) => (
                          <div key={i} className={`flex items-start gap-3 rounded-lg p-3 border ${
                            t.outcome === 'profit'
                              ? 'border-emerald-900/50 bg-emerald-950/20'
                              : 'border-red-900/50 bg-red-950/20'
                          }`}>
                            <span className={`text-sm font-bold ${t.outcome === 'profit' ? 'text-emerald-400' : 'text-red-400'}`}>
                              {t.outcome === 'profit' ? '✓' : '✗'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 text-xs">
                                <span className="font-mono font-bold text-white">{t.symbol}</span>
                                <span className={`font-bold tabular-nums ${pnlCls(t.pnlPct)}`}>
                                  {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%
                                </span>
                                <span className={`tabular-nums ${pnlCls(t.pnl)}`}>
                                  ({t.pnl >= 0 ? '+' : ''}{fmtUSD(t.pnl, 0)})
                                </span>
                                <span className="text-gray-600">保有{t.holdingHours}h</span>
                              </div>
                              <p className="text-xs text-gray-600 mt-0.5 truncate">{t.entryReasoning}</p>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Reference panel (slide-over) for AI trade details */}
      <ReferencePanel trade={selectedTrade} onClose={() => setSelectedTrade(null)} />
    </div>
  )
}
