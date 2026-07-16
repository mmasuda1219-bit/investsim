import { NextResponse } from 'next/server'
import { getQuote, getHistory, getFundamentals } from '@/lib/market'
import { calcMA, calcRSI, calcMACD, calcBB } from '@/lib/technicals'
import { runBacktest, BacktestDataError } from '@/lib/backtest/run'
import {
  evaluateFundamentalGate,
  describeFundamentalFilter,
  formatMetricValue,
} from '@/lib/backtest/fundamental'
import { parseCompositeCondition, ValidationError } from '@/lib/report/validate'
import { describeCompositeCondition } from '@/lib/report/prompt'
import { collectAiTraderEvidence } from '@/lib/report/evidence'
import { listSessions } from '@/lib/ai-trader/store'
import { normalizeLearningMemory, buildLearningContext } from '@/lib/ai-trader/memory'
import type { HistoricalBar } from '@/types'
import type { FundamentalGateResult } from '@/lib/backtest/fundamental'
import type {
  ReportRequest,
  PreparedBundle,
  BacktestSummary,
  ChartData,
  PrepareResponse,
} from '@/lib/report/types'

export const runtime = 'nodejs'
export const maxDuration = 60

// Map raw data-layer errors (already retried in the Yahoo provider) to
// user-facing Japanese + the right status. 4xx-ish causes (bad ticker,
// insufficient history) => 422; upstream trouble (429 after retries, 5xx,
// network) => 502.
function classifyDataError(err: unknown, symbol: string): { status: number; error: string } {
  if (err instanceof BacktestDataError) {
    return { status: 422, error: err.message }
  }
  const message = err instanceof Error ? err.message : String(err)
  if (/HTTP 404|No data|not found|delisted/i.test(message)) {
    return {
      status: 422,
      error: `銘柄「${symbol}」のデータが見つかりませんでした。ティッカーシンボル（例: AAPL, 7203.T）を確認してください。`,
    }
  }
  // All real-data providers were exhausted (index.ts combined-failure message).
  // This is NOT a transient blip you can wait out — it's typically Yahoo hard-
  // blocking the server IP (common on Vercel). Give an accurate, actionable hint.
  if (/unavailable for/.test(message)) {
    const hasTwelve = Boolean(process.env.TWELVE_DATA_API_KEY)
    const hint = hasTwelve
      ? '少し待って再試行しても改善しない場合は、しばらく時間をおいてください。'
      : 'この環境（特にVercel等のサーバー）ではYahooがIPを制限している可能性があります。環境変数 TWELVE_DATA_API_KEY（Twelve Dataの無料キー）を設定すると実データ取得が安定します。'
    return {
      status: 502,
      error: `実データの取得に失敗しました（全データ提供元が応答しませんでした）。${hint}`,
    }
  }
  if (/HTTP 429/.test(message)) {
    return {
      status: 502,
      error: 'データ提供元が混雑しています（レート制限）。少し待ってから再試行してください。改善しない場合は TWELVE_DATA_API_KEY の設定をご検討ください。',
    }
  }
  if (/HTTP (5\d\d|529)/.test(message)) {
    return {
      status: 502,
      error: 'データ提供元（Yahoo Finance）で一時的な障害が発生しています。少し待ってから再試行してください。',
    }
  }
  return { status: 502, error: `実データの取得・バックテストに失敗しました: ${message}` }
}

// Human-readable technical summary of recent real bars, WITH the actual
// values (MA20/50, RSI, MACD line/signal/histogram, BB upper/lower) — the
// report's accuracy-first prompt quotes these numbers directly.
function summarizeTechnicals(bars: HistoricalBar[], price: number): string {
  const ma20 = calcMA(bars, 20).at(-1)?.value
  const ma50 = calcMA(bars, 50).at(-1)?.value
  const rsi = calcRSI(bars).at(-1)?.value
  const macd = calcMACD(bars).at(-1)
  const bb = calcBB(bars).at(-1)

  const trend = ma20 && ma50
    ? price > ma20 && ma20 > ma50 ? '上昇トレンド(価格>MA20>MA50)'
      : price < ma20 && ma20 < ma50 ? '下落トレンド(価格<MA20<MA50)'
      : '横ばい・レンジ'
    : 'トレンド判定データ不足'

  const rsiSig = rsi != null
    ? rsi > 70 ? `RSI${rsi.toFixed(0)} 買われすぎ`
      : rsi < 30 ? `RSI${rsi.toFixed(0)} 売られすぎ`
      : `RSI${rsi.toFixed(0)} 中立`
    : ''

  const macdSig = macd ? (macd.histogram > 0 ? 'MACD強気' : 'MACD弱気') : ''
  const bbSig = bb
    ? price > bb.upper ? 'BB上限超え'
      : price < bb.lower ? 'BB下限割れ'
      : 'BBバンド内'
    : ''

  const detail = [
    `MA20=${ma20?.toFixed(2) ?? '-'}`,
    `MA50=${ma50?.toFixed(2) ?? '-'}`,
    `RSI(14)=${rsi?.toFixed(1) ?? '-'}`,
    `MACD=${macd?.macd?.toFixed(3) ?? '-'}`,
    `シグナル=${macd?.signal?.toFixed(3) ?? '-'}`,
    `ヒストグラム=${macd?.histogram?.toFixed(3) ?? '-'}`,
    `BB上限=${bb?.upper?.toFixed(2) ?? '-'}`,
    `BB中心=${bb?.middle?.toFixed(2) ?? '-'}`,
    `BB下限=${bb?.lower?.toFixed(2) ?? '-'}`,
  ].join(' ')
  return [trend, rsiSig, macdSig, bbSig].filter(Boolean).join(' | ') + ` (${detail})`
}

// Latest session's learning context (cross-symbol). Missing sessions are fine
// ('' — this only READS the ai-trader store).
async function collectLearningContext(): Promise<string> {
  try {
    const sessions = await listSessions() // sorted newest-first
    const latest = sessions[0]
    if (!latest) return ''
    return buildLearningContext(normalizeLearningMemory(latest.learning))
  } catch {
    return ''
  }
}

// Human-readable reason when the fundamental AND-gate fails (actual vs threshold).
function buildGateFailReason(gate: FundamentalGateResult): string {
  const failed = gate.evaluations.filter((e) => e.result !== 'pass')
  const parts = failed.map((e) => {
    const cond = describeFundamentalFilter(e.filter)
    if (e.result === 'no_data') return `「${cond}」→ 実データ取得不可のため判定不能（不成立扱い）`
    const actual = e.actual != null ? formatMetricValue(e.filter.metric, e.actual) : 'N/A'
    return `「${cond}」→ 実測 ${actual} で不成立`
  })
  return `ファンダメンタル条件が現在値で不成立: ${parts.join(' / ')}`
}

// POST /api/report/prepare (R1)
// Validate structured condition (400) → real fundamentals → AND-gate →
// (gate pass ⇒ 5y real-data backtest / fail ⇒ skip) → current snapshot →
// AI-trader evidence + learning context → { bundle, chartData }.
// No Haiku interpret step — the condition arrives structured from the UI.
export async function POST(req: Request) {
  let body: Record<string, unknown>
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  // ── Input validation ─────────────────────────────────────────────────
  const rawSymbol = body?.symbol
  if (typeof rawSymbol !== 'string' || !rawSymbol.trim()) {
    return NextResponse.json({ error: 'symbol is required' }, { status: 400 })
  }
  const symbol = rawSymbol.trim().toUpperCase()
  if (!/^[A-Z0-9.\-]{1,15}$/.test(symbol)) {
    return NextResponse.json({ error: 'invalid symbol format' }, { status: 400 })
  }

  let condition
  try {
    condition = parseCompositeCondition(body?.condition)
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 })
    }
    throw err
  }

  const initialCapital =
    typeof body?.initialCapital === 'number' && body.initialCapital > 0
      ? Math.min(body.initialCapital, 10_000_000)
      : 100_000

  const request: ReportRequest = { symbol, condition, initialCapital }

  try {
    // ── 1. Real fundamentals → AND-gate (current values, static) ───────
    // allowMock:false — a mock number must never decide the gate (原則9).
    // Unavailable data comes back as {} ⇒ 'no_data' ⇒ fail-closed but
    // explicitly reported as 判定不能.
    const fundamentals = await getFundamentals(symbol, { allowMock: false })
    const fundamentalGate = evaluateFundamentalGate(fundamentals, condition.fundamentalFilters)

    // ── 2. 5y real-data backtest — ONLY when the gate passed ───────────
    let backtest: BacktestSummary | null = null
    let equityCurve: ChartData['equityCurve'] = []
    let trades: ChartData['trades'] = []
    if (fundamentalGate.passed) {
      const result = await runBacktest({
        symbol,
        period: '5y',
        condition: condition.technical,
        initialCapital,
      })
      const firstPrice = result.equityCurve[0]?.price ?? 0
      const lastPrice = result.equityCurve[result.equityCurve.length - 1]?.price ?? 0
      backtest = {
        symbol: result.symbol,
        currency: result.currency,
        period: result.period,
        startDate: result.startDate,
        endDate: result.endDate,
        barCount: result.equityCurve.length,
        initialCapital: result.initialCapital,
        finalValue: result.finalValue,
        metrics: result.metrics,
        // Equity curve intentionally dropped from the bundle (token economy);
        // it goes into chartData below instead. Trades kept for the prompt.
        trades: result.trades,
        buyHoldReturnPct: firstPrice > 0
          ? parseFloat((((lastPrice - firstPrice) / firstPrice) * 100).toFixed(2))
          : 0,
      }
      equityCurve = result.equityCurve
      trades = result.trades
    }

    // ── 3. Current snapshot + 5y bars for the client chart ─────────────
    // (5y bars are served from the provider's short TTL cache when the
    // backtest above already fetched them.)
    const [quote, recentBars, fiveYearBars] = await Promise.all([
      getQuote(symbol, { allowMock: false }), // 原則9: モック現在値をレポートに混ぜない
      getHistory(symbol, '3mo', { allowMock: false }),
      getHistory(symbol, '5y', { allowMock: false }),
    ])
    const technicals = summarizeTechnicals(recentBars, quote.price)

    // ── 4. AI trader evidence (this symbol) + learning context ─────────
    const [aiEvidence, learningContext] = await Promise.all([
      collectAiTraderEvidence(symbol),
      collectLearningContext(),
    ])

    const bundle: PreparedBundle = {
      request,
      conditionDescription: describeCompositeCondition(condition),
      period: '5y',
      fundamentalGate,
      backtest,
      ...(fundamentalGate.passed ? {} : { gateFailReason: buildGateFailReason(fundamentalGate) }),
      current: { quote, technicals, fundamentals },
      aiEvidence,
      learningContext,
      sources: [
        'Yahoo Finance（リアルタイム株価・過去5年日足ヒストリカル・直近3ヶ月日足）',
        'Yahoo Finance（ファンダメンタル指標・現在値）',
        'InvestSimバックテストエンジン（lib/backtest・実データ純計算・5年日足）',
        'InvestSim AIトレーダー実績（全AIセッションの実売買記録・銘柄別）',
        'InvestSim AIセッション学習メモリ（過去の仮想売買の教訓）',
        `Claude AI（レポート生成: ${process.env.REPORT_AI_MODEL || 'claude-opus-4-8'}）`,
      ],
      preparedAt: new Date().toISOString(),
    }

    // Chart payload lives NEXT TO the bundle — the client can draw 5y OHLC +
    // equity curve + trade markers, but none of it reaches the Opus prompt.
    const chartData: ChartData = {
      symbol,
      period: '5y',
      bars: fiveYearBars,
      equityCurve,
      trades,
    }

    const response: PrepareResponse = { bundle, chartData }
    return NextResponse.json(response)
  } catch (err) {
    // Real-data fetch/backtest failure => 422/502 (never mock fallback here).
    const { status, error } = classifyDataError(err, symbol)
    return NextResponse.json({ error }, { status })
  }
}
