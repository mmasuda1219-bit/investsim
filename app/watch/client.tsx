'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { AISession, AIDecision, AITrade, Holding, EquityPoint } from '@/lib/ai-trader/engine'
import type { ClosedTrade } from '@/lib/ai-trader/memory'
import { normalizeLearningMemory } from '@/lib/ai-trader/memory'
import type { InvestorId, HistoricalBar } from '@/types'
import type { TradeMarker } from '@/components/AITradeChart'
import TradeLog, { pairRoundTrips } from '@/components/watch/TradeLog'
import { MasterSignals } from '@/components/MasterSignals'
import { MarketOverview } from '@/components/MarketOverview'
import TickSummary from '@/components/watch/TickSummary'
import DecisionCard from '@/components/watch/DecisionCard'

// 銘柄ごとの取引チャート（終値＋MA20/50＋買▲/売▼）。lightweight-charts は SSR 不可。
const AITradeChart = dynamic(
  () => import('@/components/AITradeChart').then(m => m.AITradeChart),
  { ssr: false, loading: () => <div className="h-[380px] flex items-center justify-center text-muted text-sm bg-panel rounded-lg">チャート読込中...</div> }
)

const EquityChart = dynamic(
  () => import('@/components/EquityChart').then(m => m.EquityChart),
  { ssr: false, loading: () => <div className="h-56 flex items-center justify-center text-muted text-sm bg-panel rounded-lg">グラフ読込中...</div> }
)

// ── Helpers ───────────────────────────────────────────────────────────────
const pnlCls = (v: number) => v > 0 ? 'text-emerald-700' : v < 0 ? 'text-red-700' : 'text-ink-2'
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

// 買い→売りの往復ペアリング（旧 toChartTrades の FIFO）は
// components/watch/TradeLog.tsx の pairRoundTrips に移した。

// session.decisions は複数tickぶんが新しい順に最大50件積まれた1本の配列で、tickの境界は
// 記録されていない（AIDecisionに時刻が無い）。ただし1回のtickでは1銘柄につき1判断しか
// 出ないので、「先頭から、銘柄が重複しない連続した並び」が直近1回ぶんになる。
// 境界の判定が近似である点は正直に書いておく（engine側がtickIdを持てば厳密になる。別スライス）。
function leadingUniqueRun(decisions: AIDecision[]): AIDecision[] {
  const seen = new Set<string>()
  const out: AIDecision[] = []
  for (const d of decisions) {
    if (seen.has(d.symbol)) break
    seen.add(d.symbol)
    out.push(d)
  }
  return out
}

// 「これより前の判断」を開いたときに一度に出す上限。
const OLDER_DECISION_LIMIT = 12

// 投資家人格の選択肢。スライス1はバフェット＋汎用の2択のみ（他4人は後続スライスでテキスト追加）。
const PERSONA_OPTIONS: Array<{ id: InvestorId | undefined; label: string }> = [
  { id: undefined,   label: '汎用AIファンドマネージャー' },
  { id: 'buffett',   label: 'ウォーレン・バフェット' },
]

// ── Start screen ──────────────────────────────────────────────────────────
function StartScreen({ onStart }: { onStart: (capital: number, persona?: InvestorId) => void }) {
  const [capital, setCapital] = useState(100000)
  const [persona, setPersona] = useState<InvestorId | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  return (
    <div className="min-h-[80vh] flex items-center justify-center px-4">
      <div className="w-full max-w-md space-y-6 text-center">
        <div className="space-y-2">
          <div className="text-4xl font-black tracking-tight">
            <span className="text-emerald-700">AI</span>
            <span className="text-ink"> TRADER</span>
          </div>
          <p className="text-ink-2 text-base leading-relaxed max-w-[42rem] mx-auto">
            Claude が自律的にリアルタイム市場データを分析し、<br />
            ファンダメンタル＋テクニカル＋ニュースを総合判断して<br />
            仮想売買を行います
          </p>
        </div>

        <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-sm text-muted">
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-blue-400 inline-block" /> Yahoo Finance</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-emerald-400 inline-block" /> ファンダメンタル分析</span>
          <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full bg-purple-400 inline-block" /> Claude AI</span>
        </div>

        <div className="bg-panel border border-border rounded-2xl p-6 space-y-4 text-left">
          <div>
            <label className="text-sm text-ink-2 block mb-2">初期資金 (USD)</label>
            <input
              type="number"
              value={capital}
              onChange={e => setCapital(Number(e.target.value))}
              min={10000} max={10000000} step={10000}
              className="w-full bg-background border border-border rounded-lg px-4 py-3 text-ink text-base tabular-nums focus:outline-none focus:border-emerald-200 transition-colors"
            />
          </div>
          <div className="grid grid-cols-3 gap-2">
            {[50000, 100000, 500000].map(v => (
              <button
                key={v}
                onClick={() => setCapital(v)}
                className={`py-2 rounded-lg text-sm font-medium tabular-nums border transition-colors ${
                  capital === v
                    ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                    : 'border-border text-muted hover:border-accent hover:text-ink'
                }`}
              >
                ${(v / 1000).toFixed(0)}K
              </button>
            ))}
          </div>
          <div>
            <label className="text-sm text-ink-2 block mb-2">投資家人格</label>
            <div className="grid grid-cols-2 gap-2">
              {PERSONA_OPTIONS.map(opt => (
                <button
                  key={opt.label}
                  onClick={() => setPersona(opt.id)}
                  className={`py-2 rounded-lg text-sm font-medium border transition-colors ${
                    persona === opt.id
                      ? 'border-emerald-200 text-emerald-700 bg-emerald-50'
                      : 'border-border text-muted hover:border-accent hover:text-ink'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={() => { setLoading(true); onStart(capital, persona) }}
            disabled={loading}
            className="w-full bg-accent disabled:opacity-50 text-on-accent font-bold py-3 rounded-xl text-sm transition-colors"
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
    <nav className="border-b border-border bg-panel backdrop-blur px-4 sm:px-6 py-3 flex items-center gap-3 sm:gap-4 sticky top-0 z-30">
      {/* ロゴとページ間リンクはグローバルの SiteNav が持つ。ここに置くと
          ロゴが縦に2つ並ぶため、この帯は運用状態の表示だけに専念する。
          スマホ幅では横に詰まって「AIの判 / 断」「Tick / #1」と語中で折れるため、
          この帯の項目はすべて whitespace-nowrap で1行に固定する。 */}
      <span className="text-xl font-semibold text-ink whitespace-nowrap">AIの判断</span>
      <span className="text-xs text-muted border border-border px-2 py-0.5 rounded whitespace-nowrap">Beta</span>
      {session && (
        <div className="ml-auto flex items-center gap-2 sm:gap-3 min-w-0">
          {/* 常時点灯の「LIVE」は実態と合わない（自動tickは1日3回まで）。偽のリアルタイム風
              表示はこのサイトが最も避けたい視覚言語なので、実際に動いている間だけ状態を出し、
              それ以外は «最後に分析した時刻» という検証可能な事実を出す。 */}
          {ticking ? (
            <div className="flex items-center gap-1.5 text-sm px-2.5 py-1 rounded-full border border-border bg-surface text-ink-2 whitespace-nowrap shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
              分析中...
            </div>
          ) : (
            <span className="text-sm text-muted tabular-nums whitespace-nowrap shrink-0">
              最終更新 {ago(session.lastTickAt)}
            </span>
          )}
          <div className={`text-base font-bold tabular-nums whitespace-nowrap ${pnlCls(session.pnl)}`}>
            {session.pnl >= 0 ? '+' : ''}{fmtUSD(session.pnl)} ({fmtPct(session.pnlPct)})
          </div>
          {/* Tick番号は最も情報量が低いので、幅が足りないスマホでは落とす */}
          <div className="hidden sm:block text-sm text-muted tabular-nums whitespace-nowrap">Tick #{session.tickCount}</div>
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
  const [tab, setTab]             = useState<'performance' | 'trades' | 'learning'>('performance')
  const [showOlder, setShowOlder] = useState(false)
  const [hydrated, setHydrated]   = useState(false)
  const [restoring, setRestoring] = useState(true)
  // AIを動かせるのは運営者だけ。読むのは誰でも自由なので、既定はfalse（操作UIを出さない）。
  const [isAdmin, setIsAdmin]     = useState(false)

  // 銘柄ごとの取引チャート／往復表の状態。
  // chartSymbol の既定は「保有中の先頭、無ければ取引のあった先頭」（下の effect で決める）。
  const [chartSymbol, setChartSymbol] = useState('')
  const [chartData, setChartData] = useState<{ symbol: string; history: HistoricalBar[]; trades: TradeMarker[] } | null>(null)
  const [chartLoading, setChartLoading] = useState(false)
  const [chartError, setChartError] = useState<string | null>(null)

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

    // AIセッションは «サイトに1本» の公開記録で、全員が同じものを読む（オーナー決定・2026-09-03）。
    // 以前は localStorage に持ったidを自分のものとして復元し、無ければ一覧の先頭（＝他人の
    // セッション）を掴んで localStorage に書き込んでいた。「自分のもの」という概念が
    // 存在しないのに個人に紐づけていたのが誤りだったので、毎回サイトの記録を読みに行く。
    const restore = async () => {
      try {
        const listRes = await fetch('/api/ai-session', { cache: 'no-store' })
        if (listRes.ok) {
          const list: AISession[] = await listRes.json()
          if (list.length > 0) setSession(list[0])
        }
      } finally {
        setRestoring(false)
      }
    }
    restore()

    // «動かす» 操作は運営者だけ。表示を隠すのは親切のためで、権限の実体はAPI側にある
    // （ここを信じて画面だけ隠しても、APIを直接叩かれれば意味がない）。
    fetch('/api/auth/me', { cache: 'no-store' })
      .then(r => (r.ok ? r.json() : { isAdmin: false }))
      .then(d => setIsAdmin(!!d.isAdmin))
      .catch(() => setIsAdmin(false))

    // 個人に紐づく概念ではなくなったので、以前の版が書いた値を掃除しておく。
    localStorage.removeItem('ai_session_id')
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

  const startSession = useCallback(async (capital: number, persona?: InvestorId) => {
    setError(null)
    try {
      const res = await fetch('/api/ai-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ capital, persona }),
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
    // 運営者以外ではタイマーを回さない。回すと訪問者のブラウザが定期的にtickを叩き、
    // 403が返るだけの無駄な通信になる（読むだけの人には操作UIも出していない）。
    if (!isAdmin || !autoTick || !session) { setCountdown(0); return }

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
  }, [isAdmin, autoTick, interval, session?.id])

  // 取引記録のある銘柄（保有中を先頭に、続けて売買のあった銘柄を新しい順）。
  // フックは早期 return より前に置く（Rules of Hooks）。
  const logSymbols = useMemo(() => {
    if (!session) return [] as string[]
    const held   = Object.keys(session.holdings ?? {})
    const traded = (session.trades ?? []).map(t => t.symbol)
    return Array.from(new Set([...held, ...traded]))
  }, [session])

  // 既定は保有中の先頭、無ければ取引のあった先頭。利用者が選んだ銘柄が
  // まだ一覧にある間は tick が進んでも勝手に切り替えない。
  useEffect(() => {
    if (logSymbols.length === 0) return
    if (!chartSymbol || !logSymbols.includes(chartSymbol)) setChartSymbol(logSymbols[0])
  }, [logSymbols, chartSymbol])

  // 銘柄ごとの価格履歴＋売買マーカーを既存API（/chart/[symbol]）から取る。
  // 同時にマウントするチャートは1つ。再取得中は前の描画を薄く残す（スケルトンで
  // ちらつかせない）。取引が増えたとき（trades.length の変化）だけ取り直す。
  const sessionId  = session?.id
  const tradeCount = session?.trades?.length ?? 0
  useEffect(() => {
    if (!sessionId || !chartSymbol) return
    let cancelled = false
    setChartLoading(true)
    setChartError(null)
    fetch(`/api/ai-session/${sessionId}/chart/${encodeURIComponent(chartSymbol)}`, { cache: 'no-store' })
      .then(async r => {
        const d = await r.json()
        if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`)
        return d as { history: HistoricalBar[]; trades: TradeMarker[] }
      })
      .then(d => { if (!cancelled) setChartData({ symbol: chartSymbol, history: d.history ?? [], trades: d.trades ?? [] }) })
      .catch(e => { if (!cancelled) setChartError(e instanceof Error ? e.message : '価格データの取得に失敗しました') })
      .finally(() => { if (!cancelled) setChartLoading(false) })
    return () => { cancelled = true }
  }, [sessionId, chartSymbol, tradeCount])

  // Loading
  if (restoring) return (
    <div className="min-h-screen bg-background flex items-center justify-center">
      <div className="flex items-center gap-3 text-ink-2">
        <div className="w-5 h-5 border-2 border-border border-t-emerald-400 rounded-full animate-spin" />
        <span className="text-sm">セッション復元中...</span>
      </div>
    </div>
  )

  if (!session) return (
    <div className="min-h-screen bg-background text-ink">
      <NavBar session={null} ticking={false} />
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 pt-4">
        <MarketOverview />
      </div>
      {/* セッション作成は運営者だけの操作。読むだけの人にフォームを見せると
          「自分がAIを起動する場所」に見えてしまうし、実際APIも通らない。
          一般の利用者には、まだ記録が無いことを正直に伝える。 */}
      {isAdmin ? (
        <StartScreen onStart={startSession} />
      ) : (
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-16">
          <div className="max-w-[42rem] mx-auto bg-panel border border-border rounded-2xl px-6 py-10 space-y-3">
            <h2 className="text-xl font-semibold text-ink">まだAIの記録がありません</h2>
            <p className="text-base text-ink-2 leading-relaxed">
              このページは、AIが実際の市場データを読んで下した売買判断を、そのまま公開している記録です。
              最初の分析が行われると、いつ・どの銘柄を・なぜ選び・何をどう判断したのかがここに並びます。
            </p>
            <p className="text-sm text-muted leading-relaxed">
              分析を動かせるのは運営者だけです。読むのはログインなしで自由にできます。
            </p>
          </div>
        </div>
      )}
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 pb-10">
        <MasterSignals />
      </div>
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

  // この回でAIが見た銘柄。watchlist が正（engine が runTick の冒頭で書いている）。
  const watchlist = session.watchlist ?? []
  const latestDecisions = leadingUniqueRun(decisions)
  const olderDecisions  = decisions.slice(latestDecisions.length)
  // engine は「対象を選ぶ→AIに問う」の順なので、AIの応答が取れなかった回は
  // 「watchlistは新しいのに判断はひとつ前の回のまま」になる（実データで発生している）。
  // 直近の判断グループが全部watchlistに入っているときだけ「この回の判断」と名乗る。
  const watchSet = new Set(watchlist)
  const decisionsFromLatestTick =
    watchlist.length > 0 &&
    latestDecisions.length > 0 &&
    latestDecisions.every(d => watchSet.has(d.symbol))
  const analyzedSymbols = watchlist.length > 0 ? watchlist : latestDecisions.map(d => d.symbol)
  // 当日変化率は判断に載っている実測値だけを使う。判断が無い銘柄の数値は作らない。
  const changeBySymbol: Record<string, number | undefined> = {}
  if (decisionsFromLatestTick || watchlist.length === 0) {
    for (const d of latestDecisions) changeBySymbol[d.symbol] = d.change
  }
  // 表示中の銘柄の名前・現在値（チャートの最終終値＝実データ）・往復件数
  const chartHolding = holdings[chartSymbol] as Holding | undefined
  const chartName =
    chartHolding?.name ?? trades.find(t => t.symbol === chartSymbol)?.name ?? ''
  const chartReady = chartData != null && chartData.symbol === chartSymbol
  const lastClose  = chartReady && chartData.history.length > 0
    ? chartData.history[chartData.history.length - 1].close
    : undefined
  const roundTripCount = chartSymbol
    ? pairRoundTrips(trades, chartSymbol, chartHolding, lastClose).length
    : 0

  return (
    <div className="min-h-screen bg-background text-ink">
      <NavBar session={session} ticking={ticking} />

      {error && (
        <div className="max-w-screen-2xl mx-auto px-6 pt-4">
          <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-red-700 text-sm">{error}</div>
        </div>
      )}

      <div className="max-w-screen-2xl mx-auto px-6 pt-4">
        <MarketOverview />
      </div>

      {/* ── 主役: 最新tickの判断 ───────────────────────────────────────
          «AIがいつ・なぜその銘柄を選び・何をどう判断したか» をページの最初に置く。
          以前はタブの中の max-h-[560px] の枠に押し込まれ、開いた人が最初に見るのは
          運用成績（＝結果の数字）だった。読ませたい順に並べ替える。 */}
      <div className="max-w-screen-lg mx-auto px-4 sm:px-6 pt-5 space-y-5">
        <TickSummary
          lastTickAt={lastTickAt}
          tickCount={tickCount}
          analyzedSymbols={analyzedSymbols}
          holdingSymbols={holdingSymbols}
          changeBySymbol={changeBySymbol}
          decisionsRecorded={decisionsFromLatestTick || watchlist.length === 0}
        />

        <section className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-3">
            <h2 className="text-ink font-semibold">
              {decisionsFromLatestTick || watchlist.length === 0 ? 'この回のAIの判断' : '最後に記録されたAIの判断'}
            </h2>
            <span className="text-sm text-muted tabular-nums">{latestDecisions.length}件</span>
          </div>

          {latestDecisions.length === 0 ? (
            <div className="bg-panel border border-border rounded-2xl px-5 py-8">
              <p className="text-base text-ink-2 leading-relaxed max-w-[42rem]">
                この回の判断は記録されていません。
              </p>
            </div>
          ) : (
            latestDecisions.map((dec, i) => (
              <DecisionCard
                key={dec.symbol + '-' + i}
                decision={dec}
                held={holdingSymbols.includes(dec.symbol)}
              />
            ))
          )}

          {olderDecisions.length > 0 && (showOlder ? (
            <div className="space-y-4 pt-2">
              <div className="flex flex-wrap items-baseline gap-x-3 border-t border-border pt-5">
                <h3 className="text-ink font-semibold">これより前の判断</h3>
                <span className="text-sm text-muted tabular-nums">
                  {Math.min(olderDecisions.length, OLDER_DECISION_LIMIT)}件を表示 / 記録{olderDecisions.length}件
                </span>
              </div>
              {olderDecisions.slice(0, OLDER_DECISION_LIMIT).map((dec, i) => (
                <DecisionCard
                  key={'old-' + dec.symbol + '-' + i}
                  decision={dec}
                  held={holdingSymbols.includes(dec.symbol)}
                />
              ))}
            </div>
          ) : (
            <button
              onClick={() => setShowOlder(true)}
              className="w-full border border-border rounded-xl py-3 text-sm text-ink-2 hover:bg-surface transition-colors"
            >
              これより前の判断も読む（記録{olderDecisions.length}件）
            </button>
          ))}

          <p className="text-sm text-muted leading-relaxed max-w-[42rem]">
            ここにあるのは、AIが仮想資金で行った売買判断の記録です。読む人への推奨ではありません。
            AIの読み筋を教材として読み、自分ならどう考えるかを比べるために使ってください。
          </p>
        </section>
      </div>

      {/* ここから下は補助情報。判断を読み終えた人が «で、結果はどうなったのか» を
          追うための面なので、必ず判断より下に置く。 */}
      <div className="max-w-screen-lg mx-auto px-4 sm:px-6 pt-8">
        <h2 className="text-ink font-semibold border-t border-border pt-6">運用の記録</h2>
        <p className="text-sm text-muted leading-relaxed mt-1 max-w-[42rem]">
          判断の積み重ねが、仮想資金の増減としてどう出たか。銘柄ごとの取引チャートと往復・成績・売買履歴・学んだ教訓。
        </p>
      </div>

      <div className="max-w-screen-2xl mx-auto px-6 py-5 grid grid-cols-1 xl:grid-cols-[260px_1fr] gap-5">

        {/* ── Left Sidebar ─────────────────────────────────────────────── */}
        <div className="space-y-4">

          {/* Portfolio */}
          <div className="bg-panel rounded-xl border border-border p-4 space-y-3">
            <div className="text-sm font-semibold text-ink-2 uppercase tracking-widest">ポートフォリオ</div>
            <div className="space-y-2.5">
              {[
                { label: '総資産', value: fmtUSD(totalValue, 0), cls: 'font-bold text-ink' },
                { label: '現金', value: fmtUSD(cash, 0), cls: 'text-ink-2' },
                { label: '損益', value: `${pnl >= 0 ? '+' : ''}${fmtUSD(pnl)} (${fmtPct(pnlPct)})`, cls: `font-bold ${pnlCls(pnl)}` },
                { label: '初期資金', value: fmtUSD(capital, 0), cls: 'text-muted' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="flex justify-between text-sm">
                  <span className="text-muted">{label}</span>
                  <span className={`tabular-nums ${cls}`}>{value}</span>
                </div>
              ))}
            </div>
            {/* Cash bar */}
            <div>
              <div className="flex justify-between text-sm text-muted mb-1">
                <span>現金比率</span>
                <span className="tabular-nums">{((cash / totalValue) * 100).toFixed(0)}%</span>
              </div>
              <div className="h-1.5 bg-surface rounded-full overflow-hidden">
                <div
                  className="h-full bg-emerald-500 rounded-full transition-all"
                  style={{ width: `${Math.min((cash / totalValue) * 100, 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Holdings */}
          <div className="bg-panel rounded-xl border border-border p-4">
            <div className="text-sm font-semibold text-ink-2 uppercase tracking-widest mb-3">
              保有銘柄 <span className="text-muted tabular-nums">({holdingSymbols.length}/5)</span>
            </div>
            {holdingSymbols.length === 0 ? (
              <p className="text-sm text-muted">ポジションなし</p>
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
                          ? 'border-emerald-200 bg-emerald-50'
                          : 'border-border hover:border-accent'
                      }`}
                    >
                      <div className="flex justify-between items-center">
                        <span className="font-mono font-semibold text-base text-ink">{sym}</span>
                        <span className="text-sm text-muted tabular-nums">{pos.shares.toFixed(2)}株</span>
                      </div>
                      <div className="flex justify-between text-sm mt-0.5 tabular-nums">
                        <span className="text-muted">avg {fmtUSD(pos.avgCost)}</span>
                        <span className="text-ink-2">{fmtUSD(pos.shares * pos.avgCost, 0)}</span>
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Learning */}
          <div className="bg-panel rounded-xl border border-border p-4">
            <div className="text-sm font-semibold text-ink-2 uppercase tracking-widest mb-3">学習状態</div>
            <div className="space-y-2 text-sm tabular-nums">
              <div className="flex justify-between">
                <span className="text-muted">クローズ取引</span>
                <span className="text-ink-2">{learning.stats.totalTrades}件</span>
              </div>
              {learning.stats.totalTrades > 0 && (
                <>
                  <div className="flex justify-between">
                    <span className="text-muted">勝率</span>
                    <span className={pnlCls(learning.stats.winRate - 50)}>{learning.stats.winRate}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">平均利益</span>
                    <span className="text-emerald-700">+{learning.stats.avgGainPct}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">平均損失</span>
                    <span className="text-red-700">{learning.stats.avgLossPct}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted">合計P&L</span>
                    <span className={`font-semibold ${pnlCls(learning.stats.totalPnl)}`}>
                      {learning.stats.totalPnl >= 0 ? '+' : ''}{fmtUSD(learning.stats.totalPnl, 0)}
                    </span>
                  </div>
                </>
              )}
              <div className="flex justify-between">
                <span className="text-muted">学習済み教訓</span>
                <span className="text-ink-2">{learning.lessons.length}件</span>
              </div>
            </div>
          </div>

          {/* Controls — 運営者だけ。
              AIを1回動かすと13銘柄分の呼び出しが走り、費用はオーナー負担。リセットは
              サイトの記録そのものを消す。以前はどちらも訪問者が押せる状態だった。
              隠すのは親切のためで、権限の実体は各APIルート側にある。 */}
          {isAdmin && (
          <div className="bg-panel rounded-xl border border-border p-4 space-y-3">
            <div className="text-sm font-semibold text-ink-2 uppercase tracking-widest">Auto Tick</div>
            <div className="flex items-center justify-between">
              <select
                value={interval}
                onChange={e => setIntervalS(Number(e.target.value))}
                className="bg-surface border border-border text-sm text-ink-2 px-2 py-1.5 rounded-lg"
              >
                <option value={60}>60秒</option>
                <option value={120}>2分</option>
                <option value={300}>5分</option>
                <option value={600}>10分</option>
              </select>
              {autoTick && countdown > 0 && (
                <span className="text-sm font-mono font-bold text-ink-2">{countdown}s</span>
              )}
              <button
                onClick={() => setAutoTick(v => !v)}
                className={`relative w-9 h-5 rounded-full transition-colors ${autoTick ? 'bg-success' : 'bg-[var(--muted)]'}`}
              >
                <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${autoTick ? 'translate-x-4' : 'translate-x-0.5'}`} />
              </button>
            </div>
            <button
              onClick={() => runTick()}
              disabled={ticking}
              className="w-full bg-accent disabled:opacity-40 text-on-accent text-sm font-bold py-2 rounded-lg transition-colors"
            >
              {ticking ? '⟳ 分析中...' : '▶ 今すぐ Tick 実行'}
            </button>

            {/* サーバー側 自動運転（ブラウザを閉じてもcronがtickする）*/}
            <div className="pt-1 border-t border-border space-y-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-base font-semibold text-ink">自動運転</div>
                  <div className="text-sm text-muted leading-relaxed">ブラウザを閉じてもサーバーが自動でtick</div>
                </div>
                <button
                  onClick={toggleAutoDrive}
                  disabled={autoDriveSaving}
                  className={`relative w-9 h-5 rounded-full transition-colors disabled:opacity-50 ${session.auto?.enabled ? 'bg-success' : 'bg-[var(--muted)]'}`}
                >
                  <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${session.auto?.enabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </button>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted">本日の自動tick</span>
                <span className={`tabular-nums font-mono ${session.auto?.enabled ? 'text-emerald-700' : 'text-muted'}`}>
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
              className="w-full border border-border text-muted hover:text-ink-2 text-sm py-1.5 rounded-lg transition-colors"
            >
              ✕ セッションをリセット
            </button>
          </div>
          )}

          {/* Data sources */}
          <div className="bg-panel rounded-xl border border-border p-4">
            <div className="text-sm font-semibold text-ink-2 uppercase tracking-widest mb-3">データソース</div>
            <div className="space-y-2 text-sm text-muted">
              {[
                { color: 'bg-blue-400',   label: 'Yahoo Finance',        sub: 'リアルタイム株価・10年チャート' },
                { color: 'bg-emerald-400', label: 'ファンダメンタル分析', sub: 'PER/ROE/ROA/FCF/D&E' },
                { color: 'bg-yellow-400', label: 'Yahoo Finance News',   sub: '最新ニュースヘッドライン' },
                { color: 'bg-purple-400', label: 'Claude (Anthropic)', sub: 'AI売買判断エンジン' },
              ].map(s => (
                <div key={s.label} className="flex items-start gap-2">
                  <span className={`w-2 h-2 rounded-full ${s.color} mt-0.5 shrink-0`} />
                  <div>
                    <div className="text-ink-2">{s.label}</div>
                    <div className="text-muted text-sm leading-relaxed">{s.sub}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── Right Main Content ───────────────────────────────────────── */}
        <div className="space-y-5 min-w-0">

          {/* 銘柄ごとの取引を追う面。銘柄タブ（図の外・上）→ 取引チャート → 往復表。
              買い/売りの方向は色で運ばない（AITradeChart / TradeLog のコメント参照）。
              タブの選択も色相ではなく、枠線の濃さと文字の太さで示す。 */}
          {logSymbols.length === 0 ? (
            <div className="bg-panel rounded-xl border border-border px-5 py-8">
              <p className="text-base text-ink-2 leading-relaxed max-w-[42rem]">
                まだ売買の記録がありません。AIが最初の売買を行うと、銘柄ごとの取引チャートと往復の記録がここに並びます。
              </p>
            </div>
          ) : (
            <>
              <div className="bg-panel rounded-xl border border-border px-5 py-3 flex flex-wrap items-center gap-2">
                <span className="text-sm text-muted">銘柄</span>
                <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="取引記録の銘柄">
                  {logSymbols.map(sym => {
                    const held = holdingSymbols.includes(sym)
                    const selected = chartSymbol === sym
                    return (
                      <button
                        key={sym}
                        role="tab"
                        aria-selected={selected}
                        onClick={() => setChartSymbol(sym)}
                        className={`text-sm px-2.5 py-1 rounded border font-mono transition-colors ${
                          selected
                            ? 'bg-surface border-[var(--ink)] text-ink font-semibold'
                            : 'bg-panel border-border text-ink-2 hover:border-[var(--muted)]'
                        }`}
                      >
                        {sym}
                        {held && <span className="ml-1.5 text-xs font-sans font-normal text-ink-2">●保有中</span>}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="bg-panel rounded-xl border border-border p-5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-3">
                  <span className="font-mono font-semibold text-ink">{chartSymbol}</span>
                  {chartName && <span className="text-sm text-ink-2">{chartName}</span>}
                  <span className="text-xs text-muted ml-auto">直近3か月・日足</span>
                </div>
                {chartError && !chartReady ? (
                  <div className="h-[380px] flex items-center justify-center text-sm text-muted border border-border rounded-lg px-4 text-center">
                    価格データを取得できませんでした（{chartError}）
                  </div>
                ) : chartData ? (
                  <div className={chartLoading ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
                    <AITradeChart
                      data={chartData.history}
                      trades={chartData.trades}
                      symbol={chartData.symbol}
                      height={380}
                    />
                  </div>
                ) : (
                  <div className="h-[380px] flex items-center justify-center text-sm text-muted bg-panel rounded-lg">
                    チャート読込中...
                  </div>
                )}
              </div>

              <div className="bg-panel rounded-xl border border-border p-5">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-3">
                  <h3 className="text-ink font-semibold">この銘柄の往復</h3>
                  <span className="text-sm text-muted tabular-nums">{roundTripCount}件</span>
                  <span className="text-xs text-muted ml-auto">買い→売りの1対＝1行。未決済も1行として出す</span>
                </div>
                <TradeLog
                  symbol={chartSymbol}
                  trades={trades}
                  holding={chartHolding}
                  currentPrice={lastClose}
                />
              </div>
            </>
          )}

          {/* Tabs */}
          <div className="bg-panel rounded-xl border border-border overflow-hidden">
            <div className="flex border-b border-border overflow-x-auto">
              {([
                { key: 'performance', label: '運用成績' },
                { key: 'trades',      label: '売買履歴',    count: trades.length },
                { key: 'learning',    label: '学習・教訓',  count: learning.lessons.length },
              ] as const).map(t => (
                <button
                  key={t.key}
                  onClick={() => setTab(t.key)}
                  className={`px-5 py-3 text-sm font-semibold whitespace-nowrap transition-colors ${
                    tab === t.key
                      ? 'text-ink border-b-2 border-emerald-400 bg-emerald-50'
                      : 'text-muted hover:text-ink'
                  }`}
                >
                  {t.label}
                  {'count' in t && t.count > 0 && (
                    <span className="ml-1.5 bg-surface text-ink-2 text-xs tabular-nums px-1.5 py-0.5 rounded-full">
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
                        <span className="text-sm text-ink-2 font-semibold uppercase tracking-wider">エクイティカーブ</span>
                        <span className="flex items-center gap-1 text-sm text-emerald-700"><span className="w-3 h-0.5 bg-emerald-400 inline-block"/>AI</span>
                        <span className="flex items-center gap-1 text-sm text-muted"><span className="w-3 h-0.5 bg-[var(--muted)] inline-block"/>SPY</span>
                      </div>
                      <EquityChart history={eq} capital={capital} height={220} />
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {[
                        { label: '運用日数',        value: `${s.daysRunning ?? 0}日` },
                        { label: '年率換算リターン', value: `${(s.annualizedReturnPct ?? 0) >= 0 ? '+' : ''}${(s.annualizedReturnPct ?? 0).toFixed(1)}%`, cls: pnlCls(s.annualizedReturnPct ?? 0) },
                        { label: '最大ドローダウン', value: `-${(s.maxDrawdownPct ?? 0).toFixed(1)}%`, cls: 'text-red-700' },
                        { label: 'シャープレシオ',  value: (s.sharpeRatio ?? 0).toFixed(2), cls: (s.sharpeRatio ?? 0) > 1 ? 'text-emerald-700' : 'text-ink-2' },
                        { label: 'AI総リターン',    value: `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`, cls: pnlCls(pnlPct) },
                        { label: 'SPYリターン',     value: benchPct != null ? `${benchPct >= 0 ? '+' : ''}${benchPct.toFixed(2)}%` : 'N/A', cls: pnlCls(benchPct ?? 0) },
                        { label: 'アルファ',        value: alpha != null ? `${alpha >= 0 ? '+' : ''}$${Math.abs(alpha).toFixed(0)}` : 'N/A', cls: pnlCls(alpha ?? 0) },
                        { label: '勝率',            value: `${(s.winRate ?? 0).toFixed(0)}%`, cls: (s.winRate ?? 0) >= 50 ? 'text-emerald-700' : 'text-red-700' },
                      ].map(({ label, value, cls }) => (
                        <div key={label} className="bg-background border border-border rounded-xl p-3">
                          <div className="text-sm text-muted mb-1">{label}</div>
                          <div className={`text-base font-bold tabular-nums ${cls ?? 'text-ink'}`}>{value}</div>
                        </div>
                      ))}
                    </div>
                    <div className="text-sm text-muted text-center tabular-nums">
                      {eq.length} ポイント記録済み · 総取引 {s.totalTradeCount ?? 0}件 · Tick #{tickCount} · {ago(lastTickAt)}
                    </div>
                  </div>
                )
              })()}

              {/* Trades tab */}
              {tab === 'trades' && (
                trades.length === 0 ? (
                  <div className="text-muted text-base py-10 text-center">取引履歴なし</div>
                ) : (
                  <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                    <table className="w-full text-sm min-w-[700px]">
                      <thead className="sticky top-0 bg-panel">
                        <tr className="text-muted border-b border-border">
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
                          <tr key={i} className="border-b border-border hover:bg-surface transition-colors">
                            <td className="py-2.5 pr-4 text-muted tabular-nums">{ago(t.timestamp)}</td>
                            <td className="py-2.5 pr-4">
                              <button
                                onClick={() => setChartSymbol(t.symbol)}
                                className="font-mono font-semibold text-ink hover:text-accent transition-colors"
                              >
                                {t.symbol}
                              </button>
                            </td>
                            <td className="py-2.5 pr-4">
                              <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                                t.action === 'buy'
                                  ? 'bg-emerald-50 text-emerald-700'
                                  : 'bg-red-50 text-red-700'
                              }`}>
                                {t.action === 'buy' ? '▲ 買い' : '▼ 売り'}
                              </span>
                            </td>
                            <td className="py-2.5 pr-4 text-right tabular-nums font-mono text-ink-2">{t.shares.toFixed(3)}</td>
                            <td className="py-2.5 pr-4 text-right tabular-nums font-mono">{fmtUSD(t.price)}</td>
                            <td className="py-2.5 pr-4 text-right tabular-nums font-mono font-semibold">{fmtUSD(t.total, 0)}</td>
                            <td className="py-2.5 text-ink-2 max-w-xs">
                              <div className="truncate">{t.reason}</div>
                              {t.technicals && <div className="text-muted truncate text-sm">{t.technicals}</div>}
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
                    <div className="text-sm text-ink-2 font-semibold uppercase tracking-wider mb-3">
                      Claude が学んだ教訓
                      {learning.lessons.length === 0 && (
                        <span className="ml-2 text-muted normal-case font-normal">(取引を積むと自動生成されます)</span>
                      )}
                    </div>
                    {learning.lessons.length > 0 ? (
                      <div className="space-y-2">
                        {learning.lessons.map((lesson, i) => (
                          <div key={i} className="flex items-start gap-3 bg-background rounded-lg p-3 border border-border">
                            <span className="text-emerald-700 font-bold text-sm mt-0.5 shrink-0 font-mono tabular-nums">{i + 1}</span>
                            <p className="text-base text-ink-2 leading-relaxed max-w-[42rem]">{lesson}</p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-muted text-base py-6 text-center bg-background rounded-xl border border-border">
                        3 Tick実行後、クローズした取引があれば教訓が自動生成されます
                      </div>
                    )}
                  </div>

                  <div>
                    <div className="text-sm text-ink-2 font-semibold uppercase tracking-wider mb-3">
                      今回提示した原則 <span className="text-muted tabular-nums">({session.knowledgeShown?.length ?? 0}件)</span>
                    </div>
                    {session.knowledgeShown && session.knowledgeShown.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {session.knowledgeShown.map((k) => (
                          <span
                            key={k.id}
                            className="text-xs bg-emerald-50 text-emerald-700 border border-emerald-200 px-2.5 py-1 rounded-full"
                          >
                            {k.title}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-muted text-base leading-relaxed py-6 px-4 text-center bg-background rounded-xl border border-border">
                        知識ベース未接続（supabase/migrations/0003_knowledge_items.sql の実行と scripts/sync-knowledge.ts の同期が必要）
                      </div>
                    )}
                  </div>

                  {learning.closedTrades && learning.closedTrades.length > 0 && (
                    <div>
                      <div className="text-sm text-ink-2 font-semibold uppercase tracking-wider mb-3">クローズ済み取引</div>
                      <div className="space-y-2 max-h-64 overflow-y-auto">
                        {(learning.closedTrades as ClosedTrade[]).slice(0, 15).map((t, i) => (
                          <div key={i} className={`flex items-start gap-3 rounded-lg p-3 border ${
                            t.outcome === 'profit'
                              ? 'border-emerald-200 bg-emerald-50'
                              : 'border-red-200 bg-red-50'
                          }`}>
                            <span className={`text-base font-bold ${t.outcome === 'profit' ? 'text-emerald-700' : 'text-red-700'}`}>
                              {t.outcome === 'profit' ? '✓' : '✗'}
                            </span>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 text-sm">
                                <span className="font-mono font-bold text-ink">{t.symbol}</span>
                                <span className={`font-bold tabular-nums ${pnlCls(t.pnlPct)}`}>
                                  {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%
                                </span>
                                <span className={`tabular-nums ${pnlCls(t.pnl)}`}>
                                  ({t.pnl >= 0 ? '+' : ''}{fmtUSD(t.pnl, 0)})
                                </span>
                                <span className="text-muted tabular-nums">保有{t.holdingHours}h</span>
                              </div>
                              <p className="text-sm text-ink-2 leading-relaxed mt-1 truncate">{t.entryReasoning}</p>
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

      {/* 名人のシグナル。「見る」＝AIと名人の判断を読む面なので、AIの下に並べる */}
      <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 pb-10">
        <MasterSignals initialSymbol={chartSymbol || undefined} />
      </div>
    </div>
  )
}
