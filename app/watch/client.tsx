'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import dynamic from 'next/dynamic'
import type { AISession, AIDecision, AITrade, Holding, EquityPoint } from '@/lib/ai-trader/engine'
import type { ClosedTrade } from '@/lib/ai-trader/memory'
import { normalizeLearningMemory } from '@/lib/ai-trader/memory'
import type { InvestorId, HistoricalBar } from '@/types'
import type { TradeMarker } from '@/components/AITradeChart'
import TradeLog, { pairRoundTrips, fmtPrice, fmtMoneySigned, isJPSymbol } from '@/components/watch/TradeLog'
import { MasterSignals } from '@/components/MasterSignals'
import { SHOW_INVESTOR_MODELS } from '@/lib/features'
import { INVESTOR_META_BY_ID } from '@/lib/investors/registry'
import { MarketOverview } from '@/components/MarketOverview'
import ProcessReplay from '@/components/watch/replay/ProcessReplay'
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
// 売買の合計額。単価は TradeLog の fmtPrice と同じ規則（`.T` は円・整数）で、
// 合計は整数で出す。同じページで通貨表記を揃えるため（COMPANY.md 原則10）。
const fmtTradeTotal = (symbol: string, n: number) =>
  isJPSymbol(symbol)
    ? `¥${Math.round(n).toLocaleString('en-US')}`
    : `${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

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

// ── Start screen（運営者だけ） ────────────────────────────────────────────
// A アプリ型（DESIGN.md §6-6）: 白い帯1本に入力を並べる。中央揃え・大きな飾り文字は使わない。
// 選択肢は「押せる塊」なので枠を持てる（§6-18 選択チップ: 角丸 6px、選択中は --brand-tint＋--brand の枠）。
function StartScreen({ onStart }: { onStart: (capital: number, persona?: InvestorId) => void }) {
  const [capital, setCapital] = useState(100000)
  const [persona, setPersona] = useState<InvestorId | undefined>(undefined)
  const [loading, setLoading] = useState(false)

  const chip = (selected: boolean) =>
    `min-h-11 rounded-field border px-3 py-2 text-small font-semibold tabular-nums transition-colors focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 ${
      selected ? 'border-brand bg-brand-tint text-brand' : 'border-border-input bg-card text-ink hover:bg-surface'
    }`

  return (
    <section className="space-y-2">
      <h2 className="text-small text-muted">AI TRADER</h2>
      <div className="bg-card rounded-card px-4 py-5 space-y-4">
        <p className="text-body text-ink-2 max-w-[42rem]">
          Claude が自律的にリアルタイム市場データを分析し、ファンダメンタル＋テクニカル＋ニュースを総合判断して仮想売買を行います
        </p>
        <p className="text-small text-muted">Yahoo Finance・ファンダメンタル分析・Claude AI</p>

        <div>
          <label htmlFor="ai-start-capital" className="text-small text-ink-2 block mb-2">初期資金 (USD)</label>
          <input
            id="ai-start-capital"
            type="number"
            value={capital}
            onChange={e => setCapital(Number(e.target.value))}
            min={10000} max={10000000} step={10000}
            className="w-full rounded-field border border-border-input bg-card px-4 py-3 text-body text-ink tabular-nums focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
          />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {[50000, 100000, 500000].map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setCapital(v)}
              aria-pressed={capital === v}
              className={chip(capital === v)}
            >
              ${(v / 1000).toFixed(0)}K
            </button>
          ))}
        </div>
        <div>
          {/* 見出しと選択肢を結び付ける（読み上げで「投資家人格」のグループと分かる） */}
          <p id="ai-start-persona-label" className="text-small text-ink-2 mb-2">投資家人格</p>
          <div role="group" aria-labelledby="ai-start-persona-label" className="grid grid-cols-2 gap-2">
            {PERSONA_OPTIONS.map(opt => (
              <button
                key={opt.label}
                type="button"
                onClick={() => setPersona(opt.id)}
                aria-pressed={persona === opt.id}
                className={chip(persona === opt.id)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        {/* 主ボタン（§6-1）: この画面の1つの目的。 */}
        <button
          type="button"
          onClick={() => { setLoading(true); onStart(capital, persona) }}
          disabled={loading}
          className="inline-flex h-12 w-full items-center justify-center rounded-card bg-brand px-5 text-body font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
        >
          {loading ? '分析開始中...' : '▶ 自動売買を開始する'}
        </button>
      </div>
    </section>
  )
}

// ── Page header (module-level to prevent remount on every render) ─────────
// 見出しは1ページに1つ（h1・DESIGN.md §5-2）。以前は page.tsx の見出しと、この位置にあった
// 貼り付く帯（NavBar: sticky・「AIの判断」「Beta」「最終更新」「損益」「Tick #」）とで
// 見出しも貼り付く帯も二重だった。貼り付く帯は SiteNav の1本だけにする（§6-7）。
// 状態は実際にその状態のときだけ出す: 「分析中...」は tick が走っている間だけ。それ以外は
// «最後に分析した時刻» という検証可能な事実を出す。損益と Tick 番号は、この下の「最新の分析」
// と「運用の記録」に同じ値があるのでここでは繰り返さない（成績を上に大きく出さない・§1-4）。
interface PageHeaderProps {
  session: AISession | null
  ticking: boolean
}
function PageHeader({ session, ticking }: PageHeaderProps) {
  return (
    <header>
      <p className="text-small text-muted">01 見る</p>
      <h1 className="text-h1 text-ink text-balance">AIの判断と、その根拠を読む</h1>
      <p className="mt-1 flex flex-wrap items-center gap-x-3 text-small text-muted">
        <span>Beta</span>
        {session && (ticking ? (
          <span className="text-ink-2 whitespace-nowrap" role="status">分析中...</span>
        ) : (
          <span className="tabular-nums whitespace-nowrap">最終更新 {ago(session.lastTickAt)}</span>
        ))}
      </p>
    </header>
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
  const [chartData, setChartData] = useState<{ symbol: string; history: HistoricalBar[]; trades: TradeMarker[]; outOfRangeTrades: number } | null>(null)
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
  // ちらつかせない）。tick が進んだとき（lastTickAt の変化）に取り直す。
  // trades.length を鍵にすると、記録が200件で切られた後は変化しなくなる。
  const sessionId  = session?.id
  const lastTickKey = session?.lastTickAt ?? ''
  useEffect(() => {
    if (!sessionId || !chartSymbol) return
    let cancelled = false
    setChartLoading(true)
    setChartError(null)
    fetch(`/api/ai-session/${sessionId}/chart/${encodeURIComponent(chartSymbol)}`, { cache: 'no-store' })
      .then(async r => {
        const d = await r.json()
        if (!r.ok || d.error) throw new Error(d.error ?? `HTTP ${r.status}`)
        return d as { history: HistoricalBar[]; trades: TradeMarker[]; outOfRangeTrades?: number }
      })
      .then(d => {
        if (!cancelled) setChartData({
          symbol: chartSymbol,
          history: d.history ?? [],
          trades: d.trades ?? [],
          outOfRangeTrades: d.outOfRangeTrades ?? 0,
        })
      })
      .catch(e => { if (!cancelled) setChartError(e instanceof Error ? e.message : '価格データの取得に失敗しました') })
      .finally(() => { if (!cancelled) setChartLoading(false) })
    return () => { cancelled = true }
  }, [sessionId, chartSymbol, lastTickKey])

  // Loading: 完成時と同じ形の薄い枠（DESIGN.md §6-12）。画面全体をぐるぐるで覆わない。
  if (restoring) return (
    <div className="max-w-[760px] mx-auto space-y-6">
      <PageHeader session={null} ticking={false} />
      <ul className="bg-card rounded-card motion-safe:animate-pulse" aria-busy="true" aria-label="セッション復元中...">
        {[0, 1, 2].map(i => (
          <li key={i} className="mx-4 border-t border-border first:border-t-0 py-4 space-y-2">
            <div className="h-4 w-40 rounded-field bg-surface" />
            <div className="h-4 w-full rounded-field bg-surface" />
          </li>
        ))}
      </ul>
      <p className="text-small text-muted">セッション復元中...</p>
    </div>
  )

  if (!session) return (
    <div className="max-w-[760px] mx-auto space-y-6">
      <PageHeader session={null} ticking={false} />
      <MarketOverview />
      {/* セッション作成は運営者だけの操作。読むだけの人にフォームを見せると
          「自分がAIを起動する場所」に見えてしまうし、実際APIも通らない。
          一般の利用者には、まだ記録が無いことを正直に伝える。 */}
      {isAdmin ? (
        <StartScreen onStart={startSession} />
      ) : (
        // 空: 何が無いかを書く（§6-12）。見本の架空データで埋めない。枠線で囲わず白い帯に。
        <div className="bg-card rounded-card px-4 py-5 space-y-2">
          <p className="text-body font-semibold text-ink">まだAIの記録がありません</p>
          <p className="text-body text-ink-2 max-w-[42rem]">
            このページは、AIが実際の市場データを読んで下した売買判断を、そのまま公開している記録です。
            最初の分析が行われると、いつ・どの銘柄を・なぜ選び・何をどう判断したのかがここに並びます。
          </p>
          <p className="text-small text-muted max-w-[42rem]">
            分析を動かせるのは運営者だけです。読むのはログインなしで自由にできます。
          </p>
        </div>
      )}
      {/* 名人のシグナル。「見る」＝AIと名人の判断を読む面なので、AIの下に並べる */}
      {SHOW_INVESTOR_MODELS && (
        <MasterSignals />
      )}
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
  // 分析対象の一覧と当日変化率（旧 TickSummary の入力）は ProcessReplay が session から自分で組む。
  // 表示中の銘柄の名前・現在値（チャートの最終終値＝実データ）・往復件数
  const chartHolding = holdings[chartSymbol] as Holding | undefined
  const chartName =
    chartHolding?.name ?? trades.find(t => t.symbol === chartSymbol)?.name ?? ''
  const chartReady = chartData != null && chartData.symbol === chartSymbol
  const lastClose  = chartReady && chartData.history.length > 0
    ? chartData.history[chartData.history.length - 1].close
    : undefined
  // 往復は1回だけ計算し、件数と表の両方に使う。「今日」はここで1度だけ取る。
  const roundTrips = chartSymbol
    ? pairRoundTrips(trades, chartSymbol, chartHolding, lastClose, new Date())
    : []
  const roundTripCount = roundTrips.length

  return (
    // 地（--surface）は page.tsx が敷く。ここに bg-background を置くと、灰の地の上に
    // --bg の柱が立つ（3a と同じ事故）ので、根は無地にする。
    <div>
      {/* ── 上半分: 見出し・市場の状況・最新の分析・この回の判断（A アプリ型・中央 760px）。
          下半分（運用の記録）の class は従来のまま。ただし layout.tsx の負のマージンが消えたので
          実幅は <main>（max-w-6xl・px-4/6）に従い狭くなる（切り分け3b-2 で組み直す）。 ── */}
      <div className="max-w-[760px] mx-auto space-y-6">
        <PageHeader session={session} ticking={ticking} />

        {error && (
          // エラーは面の色（--danger-tint）で示し、角丸の枠線で囲わない（§6-12）。
          <div role="alert" className="bg-danger-tint rounded-card px-4 py-3 text-small text-danger">{error}</div>
        )}

        <MarketOverview />

        {/* ── 主役: 分析の過程の再生（DESIGN.md §6-19・切り分け⑤-2） ──────────
            «AIがいつ・なぜその銘柄を選び・何をどう判断したか» をページの最初に置く。
            以前はタブの中の max-h-[560px] の枠に押し込まれ、開いた人が最初に見るのは
            運用成績（＝結果の数字）だった。読ませたい順に並べ替える。
            TickSummary（最新の分析の要約）が持っていた情報（Tick 番号・時刻・監視→候補→保有→分析対象の
            件数・分析対象の銘柄と当日変化率・判断が記録されなかった回の注記）は ProcessReplay の
            見出し行と段1・段6に含まれる。回の選択と足の取得は ProcessReplay が自分で持つ。 */}
        <ProcessReplay session={session} />

        <section className="space-y-2">
          {/* 見出しは帯の外（灰の上）に small/--muted（§6-6） */}
          <div className="flex items-baseline gap-x-3 gap-y-1 flex-wrap">
            <h2 className="text-small text-muted">
              {decisionsFromLatestTick || watchlist.length === 0 ? 'この回のAIの判断' : '最後に記録されたAIの判断'}
            </h2>
            {/* どの人格（投資家の考え方）で判断したかを読者に見せる（2026-09-17 S2・DESIGN §6-11）。
                session.persona は engine.ts の AISession に元からある項目で、無ければ汎用の人格。 */}
            <span className="text-caption text-muted">
              {session.persona
                ? `${INVESTOR_META_BY_ID[session.persona]?.label ?? session.persona}の考え方で判断`
                : '特定の投資家の考え方は使っていません'}
            </span>
            <span className="ml-auto text-caption text-muted tabular-nums">{latestDecisions.length}件</span>
          </div>

          {latestDecisions.length === 0 ? (
            <div className="bg-card rounded-card px-4 py-5">
              <p className="text-body text-ink-2 max-w-[42rem]">
                この回の判断は記録されていません。
              </p>
            </div>
          ) : (
            // 判断1件＝帯の中の1まとまり。帯はここが持ち、区切り線は DecisionCard が持つ（帯の中に帯を入れない）。
            <div className="bg-card rounded-card">
              {latestDecisions.map((dec, i) => (
                <DecisionCard
                  key={dec.symbol + '-' + i}
                  decision={dec}
                  held={holdingSymbols.includes(dec.symbol)}
                />
              ))}
            </div>
          )}
        </section>

        {olderDecisions.length > 0 && (showOlder ? (
          <section className="space-y-2">
            <div className="flex items-baseline justify-between gap-4 flex-wrap">
              <h2 className="text-small text-muted">これより前の判断</h2>
              <span className="text-caption text-muted tabular-nums">
                {Math.min(olderDecisions.length, OLDER_DECISION_LIMIT)}件を表示 / 記録{olderDecisions.length}件
              </span>
            </div>
            <div className="bg-card rounded-card">
              {olderDecisions.slice(0, OLDER_DECISION_LIMIT).map((dec, i) => (
                <DecisionCard
                  key={'old-' + dec.symbol + '-' + i}
                  decision={dec}
                  held={holdingSymbols.includes(dec.symbol)}
                />
              ))}
            </div>
          </section>
        ) : (
          // 文字ボタン（§6-1）: 枠なし・--brand・ホバーで下線。全幅の枠線の箱にしない。
          <button
            type="button"
            onClick={() => setShowOlder(true)}
            className="inline-flex min-h-11 items-center rounded-field text-small text-brand hover:underline focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
          >
            これより前の判断も読む（記録{olderDecisions.length}件）
          </button>
        ))}

        {/* 免責（§6-11）: small・--ink-2。判断のブロックの直下、位置と文言はそのまま。 */}
        <p className="text-small text-ink-2 max-w-[42rem]">
          ここにあるのは、AIが仮想資金で行った売買判断の記録です。読む人への推奨ではありません。
          AIの読み筋を教材として読み、自分ならどう考えるかを比べるために使ってください。
        </p>

        {/* 名人の考え方（ルールブック）。「見る」＝AIと名人の判断を読む面なので、AIの判断の直下に置く
            （旧: ページ最下部の運用の記録の後ろ。2026-09-17 S2）。
            key: chartSymbol が後から決まっても MasterSignals の useState 初期値は追わないので、作り直す。 */}
        {SHOW_INVESTOR_MODELS && (
          <MasterSignals key={chartSymbol || 'AAPL'} initialSymbol={chartSymbol || undefined} />
        )}
      </div>

      {/* ここから下は補助情報。判断を読み終えた人が «で、結果はどうなったのか» を
          追うための面なので、必ず判断より下に置く。
          切り分け3b-2: 上半分と同じ A アプリ型・中央 760px の1列にした（旧: max-w-screen-2xl の
          2列 xl:grid-cols-[260px_1fr]。3b-1 で <main> の内側に入り、幅と左右の余白がずれていた）。
          灰の地は page.tsx が敷いているので、ここでは重ねて敷かない。見出しは帯の外に small/--muted、
          内容は枠線なしの白い帯（bg-card rounded-card）に載せ、帯の中に帯を入れない（DESIGN.md §6-6）。
          並び順は旧スマホ幅（1列に落ちたとき）の順のまま。 */}
      <div className="max-w-[760px] mx-auto mt-12 space-y-6">
        <div className="border-t border-border pt-6">
          <h2 className="text-body font-semibold text-ink">運用の記録</h2>
          <p className="text-small text-muted mt-1 max-w-[42rem]">
            判断の積み重ねが、仮想資金の増減としてどう出たか。銘柄ごとの取引チャートと往復・成績・売買履歴・学んだ教訓。
          </p>
        </div>

        {/* ポートフォリオ（旧: 左の小箱）。複数の数字は1行の数字にする（§2・/review の「資産」と同じ形）。
            AI の運用成績を成果として大きく見せない（§1-4）ので、数字は small にとどめる。
            現金比率の横棒（角丸 999px・既製の緑）は同じ値を文字で出しているので外した（§5-4）。 */}
        <section className="space-y-2">
          <h3 className="text-small text-muted">ポートフォリオ</h3>
          <dl className="bg-card rounded-card px-4 py-3 min-h-14 flex flex-wrap items-center gap-x-6 gap-y-1">
            {[
              { label: '総資産', value: fmtUSD(totalValue, 0), cls: 'font-semibold text-ink' },
              { label: '現金', value: fmtUSD(cash, 0), cls: 'text-ink-2' },
              { label: '損益', value: `${pnl >= 0 ? '+' : ''}${fmtUSD(pnl)} (${fmtPct(pnlPct)})`, cls: `font-semibold ${pnlCls(pnl)}` },
              { label: '初期資金', value: fmtUSD(capital, 0), cls: 'text-ink-2' },
              { label: '現金比率', value: `${((cash / totalValue) * 100).toFixed(0)}%`, cls: 'text-ink-2' },
            ].map(({ label, value, cls }) => (
              <div key={label} className="flex items-baseline gap-2">
                <dt className="text-small text-muted">{label}</dt>
                <dd className={`text-small tabular-nums ${cls}`}>{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* 保有銘柄（旧: 左の小箱）。1銘柄＝帯の中の1行で、行全体が押せる範囲（§6-6）。押すと下の
            チャートと往復表がその銘柄に切り替わる。選択中は --brand-tint の下地（§5-1「選択中の下地」）と
            aria-pressed で示す。行の区切りは文字の左端から始まる線（内側の div が持つ）。 */}
        <section className="space-y-2">
          <h3 className="text-small text-muted">
            保有銘柄 <span className="tabular-nums">({holdingSymbols.length}/5)</span>
          </h3>
          {holdingSymbols.length === 0 ? (
            <p className="bg-card rounded-card px-4 py-4 text-small text-muted">ポジションなし</p>
          ) : (
            <ul className="bg-card rounded-card overflow-hidden">
              {holdingSymbols.map(sym => {
                const pos = holdings[sym] as Holding
                const selected = chartSymbol === sym
                return (
                  <li key={sym} className="group">
                    <button
                      type="button"
                      onClick={() => setChartSymbol(sym)}
                      aria-pressed={selected}
                      className={`block w-full px-4 text-left transition-colors focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2 ${
                        selected ? 'bg-brand-tint' : 'hover:bg-surface'
                      }`}
                    >
                      <span className="min-h-14 py-2 flex items-center justify-between gap-3 border-t border-border group-first:border-t-0">
                        <span className="min-w-0">
                          <span className="block text-body font-semibold text-ink">{sym}</span>
                          <span className="block text-small text-muted tabular-nums">{pos.shares.toFixed(2)}株</span>
                        </span>
                        {/* W7: 銘柄ごとの金額は銘柄の通貨で（.T は円）。総資産・現金は engine が USD で持つのでそのまま */}
                        <span className="text-right tabular-nums">
                          <span className="block text-small text-ink">{fmtPrice(sym, pos.shares * pos.avgCost)}</span>
                          <span className="block text-small text-muted">avg {fmtPrice(sym, pos.avgCost)}</span>
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        {/* 学習状態（旧: 左の小箱）。1行の数字にする（§2）。勝率は損益ではないので緑/赤を付けない
            （§5-1: 緑/赤は損益だけ。§1-4: 勝率を成果として強調しない）。 */}
        <section className="space-y-2">
          <h3 className="text-small text-muted">学習状態</h3>
          <dl className="bg-card rounded-card px-4 py-3 min-h-14 flex flex-wrap items-center gap-x-6 gap-y-1 text-small tabular-nums">
            <div className="flex items-baseline gap-2">
              <dt className="text-muted">クローズ取引</dt>
              <dd className="text-ink-2">{learning.stats.totalTrades}件</dd>
            </div>
            {learning.stats.totalTrades > 0 && (
              <>
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted">勝率</dt>
                  <dd className="text-ink-2">{learning.stats.winRate}%</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted">平均利益</dt>
                  <dd className="text-emerald-700">+{learning.stats.avgGainPct}%</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted">平均損失</dt>
                  <dd className="text-red-700">{learning.stats.avgLossPct}%</dd>
                </div>
                <div className="flex items-baseline gap-2">
                  <dt className="text-muted">合計P&L</dt>
                  <dd className={`font-semibold ${pnlCls(learning.stats.totalPnl)}`}>
                    {learning.stats.totalPnl >= 0 ? '+' : ''}{fmtUSD(learning.stats.totalPnl, 0)}
                  </dd>
                </div>
              </>
            )}
            <div className="flex items-baseline gap-2">
              <dt className="text-muted">学習済み教訓</dt>
              <dd className="text-ink-2">{learning.lessons.length}件</dd>
            </div>
          </dl>
        </section>

        {/* 運営者の操作 — 運営者だけ。
            AIを1回動かすと13銘柄分の呼び出しが走り、費用はオーナー負担。リセットは
            サイトの記録そのものを消す。以前はどちらも訪問者が押せる状態だった。
            隠すのは親切のためで、権限の実体は各APIルート側にある。
            3b-2: 英字の小見出し「Auto Tick」を日本語の small/--muted に。名前の無い丸いスイッチ
            （角丸 999px）は、文字で状態が読める切り替えボタン（role="switch"・選択チップの形 §6-18）にした。 */}
        {isAdmin && (
          <section className="space-y-2">
            <h3 className="text-small text-muted">自動 Tick</h3>
            <div className="bg-card rounded-card">
              <div className="mx-4 py-3 flex flex-wrap items-center gap-3">
                <select
                  value={interval}
                  onChange={e => setIntervalS(Number(e.target.value))}
                  aria-label="自動 Tick の間隔"
                  className="min-h-11 rounded-field border border-border-input bg-card px-3 text-body text-ink focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
                >
                  <option value={60}>60秒</option>
                  <option value={120}>2分</option>
                  <option value={300}>5分</option>
                  <option value={600}>10分</option>
                </select>
                {autoTick && countdown > 0 && (
                  <span className="text-small font-semibold text-ink-2 tabular-nums">{countdown}s</span>
                )}
                <button
                  type="button"
                  role="switch"
                  aria-checked={autoTick}
                  aria-label="自動 Tick"
                  onClick={() => setAutoTick(v => !v)}
                  className={`ml-auto min-h-11 rounded-field border px-3 text-small font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 ${autoTick ? 'border-brand bg-brand-tint text-brand' : 'border-border-input bg-card text-ink hover:bg-surface'}`}
                >
                  {autoTick ? 'オン' : 'オフ'}
                </button>
              </div>
              <div className="mx-4 border-t border-border py-3">
                <button
                  type="button"
                  onClick={() => runTick()}
                  disabled={ticking}
                  className="inline-flex h-11 w-full items-center justify-center rounded-card bg-brand px-4 text-small font-semibold text-on-brand transition-colors hover:bg-brand-strong disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
                >
                  {ticking ? '⟳ 分析中...' : '▶ 今すぐ Tick 実行'}
                </button>
              </div>

              {/* サーバー側 自動運転（ブラウザを閉じてもcronがtickする）*/}
              <div className="mx-4 border-t border-border py-3 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-body font-semibold text-ink">自動運転</p>
                    <p className="text-small text-muted">ブラウザを閉じてもサーバーが自動でtick</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={!!session.auto?.enabled}
                    aria-label="自動運転"
                    onClick={toggleAutoDrive}
                    disabled={autoDriveSaving}
                    className={`shrink-0 min-h-11 rounded-field border px-3 text-small font-semibold transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 ${session.auto?.enabled ? 'border-brand bg-brand-tint text-brand' : 'border-border-input bg-card text-ink hover:bg-surface'}`}
                  >
                    {session.auto?.enabled ? 'オン' : 'オフ'}
                  </button>
                </div>
                <div className="flex justify-between text-small">
                  <span className="text-muted">本日の自動tick</span>
                  <span className={`tabular-nums ${session.auto?.enabled ? 'text-ink' : 'text-muted'}`}>
                    {autoCountToday(session)}/3
                  </span>
                </div>
              </div>
              <div className="mx-4 border-t border-border py-3">
                <button
                  type="button"
                  onClick={() => {
                    setSession(null)
                    setAutoTick(false)
                    localStorage.removeItem('ai_session_id')
                    localStorage.removeItem('ai_auto_tick')
                  }}
                  className="inline-flex h-11 w-full items-center justify-center rounded-card border border-border-input bg-card px-4 text-small text-ink-2 transition-colors hover:bg-surface focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2"
                >
                  ✕ セッションをリセット
                </button>
              </div>
            </div>
          </section>
        )}

        {/* データソース（旧: 左の小箱）。色の丸印（既製色）は意味を運ばない飾りなので外し、文字の行に。 */}
        <section className="space-y-2">
          <h3 className="text-small text-muted">データソース</h3>
          <ul className="bg-card rounded-card">
            {[
              { label: 'Yahoo Finance',        sub: 'リアルタイム株価・10年チャート' },
              { label: 'ファンダメンタル分析', sub: 'PER/ROE/ROA/FCF/D&E' },
              { label: 'Yahoo Finance News',   sub: '最新ニュースヘッドライン' },
              { label: 'Claude (Anthropic)', sub: 'AI売買判断エンジン' },
            ].map(s => (
              <li key={s.label} className="mx-4 border-t border-border first:border-t-0 py-3">
                <p className="text-small text-ink-2">{s.label}</p>
                <p className="text-small text-muted">{s.sub}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* 銘柄ごとの取引を追う面。銘柄タブ（図の外・上）→ 取引チャート → 往復表。
            買い/売りの方向は色で運ばない（AITradeChart / TradeLog のコメント参照）。
            銘柄の選択は選択チップ（§6-18: 角丸 6px、選択中は --brand-tint の下地＋--brand の枠）。
            チャートと往復表はそれぞれ白い帯1本。帯の中に帯・枠を入れない（§6-6）。 */}
        {logSymbols.length === 0 ? (
          <p className="bg-card rounded-card px-4 py-5 text-body text-ink-2">
            まだ売買の記録がありません。AIが最初の売買を行うと、銘柄ごとの取引チャートと往復の記録がここに並びます。
          </p>
        ) : (
          <>
            <section className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-small text-muted">銘柄</span>
                <div className="flex flex-wrap gap-2" role="tablist" aria-label="取引記録の銘柄">
                  {logSymbols.map(sym => {
                    const held = holdingSymbols.includes(sym)
                    const selected = chartSymbol === sym
                    return (
                      <button
                        key={sym}
                        type="button"
                        role="tab"
                        aria-selected={selected}
                        onClick={() => setChartSymbol(sym)}
                        className={`min-h-11 rounded-field border px-3 text-small font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-offset-2 ${selected ? 'border-brand bg-brand-tint text-brand' : 'border-border-input bg-card text-ink hover:bg-surface'}`}
                      >
                        {sym}
                        {held && <span className="ml-1.5 text-caption font-normal text-muted">●保有中</span>}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="bg-card rounded-card px-4 py-4">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mb-3">
                  <span className="text-body font-semibold text-ink">{chartSymbol}</span>
                  {chartName && <span className="text-small text-ink-2">{chartName}</span>}
                  <span className="text-caption text-muted ml-auto">直近6か月・日足</span>
                </div>
                {chartError && !chartReady ? (
                  // 取得できなかったことは --warning-ink の文字で。枠で囲わず、図と同じ高さに左揃え（§5-1・§6-12）
                  <p className="h-[380px] flex items-center text-small text-warning-ink">
                    価格データを取得できませんでした（{chartError}）
                  </p>
                ) : chartData ? (
                  <div className="relative">
                    {/* 再取得に失敗しても前回の描画は残す。ただし「最新」に見せない。
                        図の上に浮く注意の札（§6-5 注意: --warning-tint の面＋--warning-ink の文字） */}
                    {chartError && chartReady && (
                      <p className="absolute top-2 left-2 z-10 rounded-field bg-warning-tint px-2 py-1 text-caption text-warning-ink">
                        最新の取得に失敗しました。前回の表示です
                      </p>
                    )}
                    <div className={chartLoading ? 'opacity-50 transition-opacity' : 'transition-opacity'}>
                      <AITradeChart
                        data={chartData.history}
                        trades={chartData.trades}
                        symbol={chartData.symbol}
                        height={380}
                      />
                    </div>
                    {chartReady && chartData.outOfRangeTrades > 0 && (
                      <p className="mt-2 text-caption text-muted">
                        表示期間より前の取引 {chartData.outOfRangeTrades} 件はチャートに描いていません（下の往復表には載っています）
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="h-[380px] flex items-center text-small text-muted">
                    チャート読込中...
                  </p>
                )}
              </div>
            </section>

            <section className="space-y-2">
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h3 className="text-small text-muted">この銘柄の往復</h3>
                <span className="text-caption text-muted tabular-nums">{roundTripCount}件</span>
                <span className="text-caption text-muted ml-auto">買い→売りの1対＝1行。未決済も1行として出す</span>
              </div>
              {/* 表の帯。横スクロールは TradeLog の中（帯の内側）だけで起きる（§6-18） */}
              <div className="bg-card rounded-card overflow-hidden">
                <TradeLog symbol={chartSymbol} rows={roundTrips} />
              </div>
            </section>
          </>
        )}

        {/* 運用成績・売買履歴・学習・教訓のタブ（旧: タブと中身をまとめて囲った箱）。
            タブの行は灰の地の上に置き、現在のタブは --ink/600＋下に 2px の --brand の線（§6-8）。
            件数はピル型の札（角丸 999px）ではなく文字で（§2「札は状態にだけ」）。中身はそれぞれ白い帯に載せる。 */}
        <section className="space-y-4">
          <div className="flex overflow-x-auto border-b border-border" role="tablist" aria-label="運用の記録の表示">
            {([
              { key: 'performance', label: '運用成績' },
              { key: 'trades',      label: '売買履歴',    count: trades.length },
              { key: 'learning',    label: '学習・教訓',  count: learning.lessons.length },
            ] as const).map(t => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`min-h-11 px-4 border-b-2 text-small whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-focus focus-visible:-outline-offset-2 ${
                  tab === t.key
                    ? 'border-brand text-ink font-semibold'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {t.label}
                {'count' in t && t.count > 0 && (
                  <span className="ml-1.5 text-caption font-normal text-muted tabular-nums">
                    {t.count}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Performance tab */}
          {tab === 'performance' && (() => {
            const s = session.stats ?? {}
            const eq = session.equityHistory ?? []
            const latest = eq[eq.length - 1]
            const benchPct = latest?.benchmarkPct
            const spyValue = benchPct != null ? capital * (1 + benchPct / 100) : null
            const alpha = spyValue != null ? totalValue - spyValue : null
            return (
              <div className="space-y-6">
                <div className="space-y-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <h3 className="text-small text-muted">エクイティカーブ</h3>
                    <span className="flex items-center gap-1 text-small text-emerald-700"><span className="w-3 h-0.5 bg-emerald-400 inline-block"/>AI</span>
                    <span className="flex items-center gap-1 text-small text-muted"><span className="w-3 h-0.5 bg-[var(--muted)] inline-block"/>SPY</span>
                  </div>
                  <div className="bg-card rounded-card px-4 py-4">
                    <EquityChart history={eq} capital={capital} height={220} />
                  </div>
                </div>
                {/* 運用成績: 数字タイル8枚の格子 → 表1つ（§2・§6-6「数字タイルの格子は作らない」）。
                    項目と文言は変えない（残すか消すかは DESIGN.md §11-2 の法務の未決。ここは見せ方だけ控えめにする）。
                    AI の成績を成果として大きく見せない（§1-4・RULES #14）: 大きな太字をやめ、small・右揃え・tabular-nums。
                    緑/赤は損益（リターン・アルファ・ドローダウン）だけに残し、勝率とシャープレシオの良し悪しの色は外した（§5-1）。 */}
                <div className="space-y-2">
                  <div className="bg-card rounded-card overflow-hidden">
                    <table className="w-full text-small">
                      <tbody>
                        {[
                          { label: '運用日数',        value: `${s.daysRunning ?? 0}日` },
                          { label: '年率換算リターン', value: `${(s.annualizedReturnPct ?? 0) >= 0 ? '+' : ''}${(s.annualizedReturnPct ?? 0).toFixed(1)}%`, cls: pnlCls(s.annualizedReturnPct ?? 0) },
                          { label: '最大ドローダウン', value: `-${(s.maxDrawdownPct ?? 0).toFixed(1)}%`, cls: 'text-red-700' },
                          { label: 'シャープレシオ',  value: (s.sharpeRatio ?? 0).toFixed(2) },
                          { label: 'AI総リターン',    value: `${pnlPct >= 0 ? '+' : ''}${pnlPct.toFixed(2)}%`, cls: pnlCls(pnlPct) },
                          { label: 'SPYリターン',     value: benchPct != null ? `${benchPct >= 0 ? '+' : ''}${benchPct.toFixed(2)}%` : 'N/A', cls: pnlCls(benchPct ?? 0) },
                          { label: 'アルファ',        value: alpha != null ? `${alpha > 0 ? '+' : alpha < 0 ? '−' : '±'}$${Math.abs(alpha).toFixed(0)}` : 'N/A', cls: pnlCls(alpha ?? 0) }, // 符号は §5-2（負は U+2212・ゼロは ±。pnlCls と同じ3分岐）
                          { label: '勝率',            value: `${(s.winRate ?? 0).toFixed(0)}%` },
                        ].map(({ label, value, cls }: { label: string; value: string; cls?: string }) => (
                          <tr key={label} className="border-t border-border first:border-t-0">
                            <th scope="row" className="px-4 py-3 text-left font-normal text-muted">{label}</th>
                            <td className={`px-4 py-3 text-right tabular-nums whitespace-nowrap ${cls ?? 'text-ink'}`}>{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="text-caption text-muted tabular-nums">
                    {eq.length} ポイント記録済み · 総取引 {s.totalTradeCount ?? 0}件 · Tick #{tickCount} · {ago(lastTickAt)}
                  </p>
                </div>
              </div>
            )
          })()}

          {/* Trades tab */}
          {tab === 'trades' && (
            trades.length === 0 ? (
              <p className="bg-card rounded-card px-4 py-5 text-body text-ink-2">取引履歴なし</p>
            ) : (
              // 表（§6-18）: 見出し行は small/--muted を --surface の上に、数字は右揃え、行の区切りは --border。
              // 横・縦のスクロールは帯の内側だけ。thead の sticky はこのスクロール枠の中でだけ効く（ページ上部には貼り付かない）。
              <div className="bg-card rounded-card overflow-hidden">
                <div className="overflow-x-auto max-h-[560px] overflow-y-auto">
                  <table className="w-full text-small min-w-[700px]">
                    <thead className="sticky top-0 bg-surface">
                      <tr className="text-muted">
                        <th className="text-left px-4 py-2 font-normal whitespace-nowrap">時刻</th>
                        <th className="text-left px-4 py-2 font-normal whitespace-nowrap">銘柄</th>
                        <th className="text-left px-4 py-2 font-normal whitespace-nowrap">売買</th>
                        <th className="text-right px-4 py-2 font-normal whitespace-nowrap">株数</th>
                        <th className="text-right px-4 py-2 font-normal whitespace-nowrap">価格</th>
                        <th className="text-right px-4 py-2 font-normal whitespace-nowrap">合計</th>
                        <th className="text-left px-4 py-2 font-normal whitespace-nowrap">判断根拠</th>
                      </tr>
                    </thead>
                    <tbody>
                      {trades.map((t: AITrade, i) => (
                        <tr key={i} className="border-t border-border">
                          <td className="px-4 py-3 text-muted tabular-nums whitespace-nowrap">{ago(t.timestamp)}</td>
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => setChartSymbol(t.symbol)}
                              className="font-mono font-semibold text-ink hover:text-accent transition-colors"
                            >
                              {t.symbol}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            {/* 方向の札は無彩色＋記号のピル型（DESIGN.md §6-5・DECISIONS 2026-09-10）。
                                行のホバーの塗り（bg-surface）は札と同じ色で札が消えるので外した */}
                            <span className="rounded-full bg-surface px-2.5 text-small font-semibold text-ink whitespace-nowrap">
                              {t.action === 'buy' ? '▲ 買い' : '▼ 売り'}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-mono text-ink-2">{t.shares.toFixed(3)}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-mono">{fmtPrice(t.symbol, t.price)}</td>
                          <td className="px-4 py-3 text-right tabular-nums font-mono font-semibold">{fmtTradeTotal(t.symbol, t.total)}</td>
                          <td className="px-4 py-3 text-ink-2 max-w-xs">
                            <div className="truncate">{t.reason}</div>
                            {t.technicals && <div className="text-muted truncate text-small">{t.technicals}</div>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )
          )}

          {/* Learning tab — 小見出しは日本語の small/--muted（旧: 英字風の大文字＋字間を広げた小見出し）。
              教訓・原則・クローズ済み取引は、それぞれ白い帯1本の中の行（旧: 1件ずつ枠線の小箱・中央揃えの空箱）。 */}
          {tab === 'learning' && (
            <div className="space-y-6">
              <div className="space-y-2">
                <h3 className="text-small text-muted">
                  Claude が学んだ教訓
                  {learning.lessons.length === 0 && (
                    <span className="ml-2">(取引を積むと自動生成されます)</span>
                  )}
                </h3>
                {learning.lessons.length > 0 ? (
                  <ol className="bg-card rounded-card">
                    {learning.lessons.map((lesson, i) => (
                      <li key={i} className="mx-4 border-t border-border first:border-t-0 py-3 flex items-start gap-3">
                        <span className="text-small text-muted tabular-nums shrink-0 pt-0.5">{i + 1}</span>
                        <p className="text-body text-ink-2 max-w-[42rem]">{lesson}</p>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="bg-card rounded-card px-4 py-5 text-small text-muted">
                    3 Tick実行後、クローズした取引があれば教訓が自動生成されます
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <h3 className="text-small text-muted">
                  今回提示した原則 <span className="tabular-nums">({session.knowledgeShown?.length ?? 0}件)</span>
                </h3>
                {session.knowledgeShown && session.knowledgeShown.length > 0 ? (
                  // 旧: ピル型の札（角丸 999px・既製の緑）。札は状態にだけ使う（§2）ので、帯の中の文字の行に。
                  <ul className="bg-card rounded-card">
                    {session.knowledgeShown.map((k) => (
                      <li key={k.id} className="mx-4 border-t border-border first:border-t-0 py-3 text-small text-ink-2">
                        {k.title}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="bg-card rounded-card px-4 py-5 text-small text-muted">
                    知識ベース未接続（supabase/migrations/0003_knowledge_items.sql の実行と scripts/sync-knowledge.ts の同期が必要）
                  </p>
                )}
              </div>

              {learning.closedTrades && learning.closedTrades.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-small text-muted">クローズ済み取引</h3>
                  {/* 旧: 1件ずつ緑/赤の面＋枠線の小箱。帯1本の中の行にし、結果は ✓/✗＋符号付きの数字の色だけで示す（§6-4） */}
                  <ul className="bg-card rounded-card max-h-64 overflow-y-auto">
                    {(learning.closedTrades as ClosedTrade[]).slice(0, 15).map((t, i) => (
                      <li key={i} className="mx-4 border-t border-border first:border-t-0 py-3 flex items-start gap-3">
                        <span className={`text-body font-semibold ${t.outcome === 'profit' ? 'text-emerald-700' : 'text-red-700'}`}>
                          {t.outcome === 'profit' ? '✓' : '✗'}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="flex flex-wrap items-center gap-x-2 text-small">
                            <span className="font-semibold text-ink">{t.symbol}</span>
                            <span className={`font-semibold tabular-nums ${pnlCls(t.pnlPct)}`}>
                              {t.pnlPct >= 0 ? '+' : ''}{t.pnlPct.toFixed(2)}%
                            </span>
                            <span className={`tabular-nums ${pnlCls(t.pnl)}`}>
                              ({/* W7: 同じページの往復表と通貨を揃える（.T は円） */fmtMoneySigned(t.symbol, t.pnl)})
                            </span>
                            <span className="text-muted tabular-nums">保有{t.holdingHours}h</span>
                          </div>
                          <p className="text-small text-ink-2 mt-1 truncate">{t.entryReasoning}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
