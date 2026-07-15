import { NextResponse } from 'next/server'
import { getQuote, getHistory, getFundamentals } from '@/lib/market'
import { calcMA, calcRSI, calcMACD, calcBB } from '@/lib/technicals'
import { runBacktest, BacktestDataError } from '@/lib/backtest/run'
import { interpretTheory, InterpretError } from '@/lib/report/interpret'
import { INTERPRET_MODEL } from '@/lib/report/claude'
import { listSessions } from '@/lib/ai-trader/store'
import { normalizeLearningMemory, buildLearningContext } from '@/lib/ai-trader/memory'
import type { HistoricalBar } from '@/types'
import type {
  ReportRequest,
  ReportIndicator,
  PreparedBundle,
} from '@/lib/report/types'

export const runtime = 'nodejs'
export const maxDuration = 60

const VALID_INDICATORS: ReportIndicator[] = ['ma', 'rsi', 'macd', 'bb', 'stoch', 'roc', 'breakout']

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
  if (/HTTP 429/.test(message)) {
    return {
      status: 502,
      error: 'データ提供元（Yahoo Finance）が混雑しています（レート制限）。1〜2分ほど待ってから再試行してください。',
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

// Human-readable technical summary of recent real bars (same signals the
// AI trader uses; formatting only — indicator math reused from lib/technicals).
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

  const detail = `MA20=${ma20?.toFixed(2) ?? '-'} MA50=${ma50?.toFixed(2) ?? '-'} RSI=${rsi?.toFixed(1) ?? '-'} MACD=${macd?.macd?.toFixed(2) ?? '-'}`
  return [trend, rsiSig, macdSig, bbSig].filter(Boolean).join(' | ') + ` (${detail})`
}

// Latest session's learning context. Missing sessions are fine ('' — slice 1
// stores nothing itself; this only READS the ai-trader store).
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

// POST /api/report/prepare
// Validate → Haiku interpret (422 on failure) → real-data backtest (502 on
// data failure) → current snapshot + learning context → PreparedBundle.
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

  const theoryText = typeof body?.theoryText === 'string' ? body.theoryText.trim() : ''
  if (!theoryText) {
    return NextResponse.json({ error: 'theoryText is required' }, { status: 400 })
  }
  if (theoryText.length > 2000) {
    return NextResponse.json({ error: 'theoryText is too long (max 2000 chars)' }, { status: 400 })
  }

  // Indicators are an OPTIONAL HINT since slice 2 — empty array is fine
  // (= no hint, interpreter picks from the full rule catalog). Unknown ids
  // are silently dropped for backward/forward payload compatibility.
  const rawIndicators = Array.isArray(body?.indicators) ? body.indicators : []
  const indicators = rawIndicators.filter(
    (i): i is ReportIndicator => VALID_INDICATORS.includes(i as ReportIndicator),
  )

  const maPeriod =
    typeof body?.maPeriod === 'number' && body.maPeriod >= 2 && body.maPeriod <= 200
      ? Math.floor(body.maPeriod)
      : undefined

  const initialCapital =
    typeof body?.initialCapital === 'number' && body.initialCapital > 0
      ? Math.min(body.initialCapital, 10_000_000)
      : 100_000

  const request: ReportRequest = { symbol, theoryText, indicators, maPeriod, initialCapital }

  // ── 1. Haiku interpretation (no silent default — principle 9) ────────
  let interpreted
  try {
    interpreted = await interpretTheory(request)
  } catch (err) {
    if (err instanceof InterpretError) {
      return NextResponse.json({ error: err.message }, { status: 422 })
    }
    const message = err instanceof Error ? err.message : 'interpretation failed'
    return NextResponse.json({ error: `理論の解釈に失敗しました: ${message}` }, { status: 500 })
  }

  try {
    // ── 2. Real-data backtest (allowMock:false inside runBacktest) ─────
    const result = await runBacktest({
      symbol,
      period: '1y',
      condition: interpreted.condition,
      initialCapital,
    })

    // ── 3. Current snapshot (real quote/technicals/fundamentals) ───────
    const [quote, recentBars, fundamentals] = await Promise.all([
      getQuote(symbol, { allowMock: false }), // 原則9: モック現在値をレポートに混ぜない
      getHistory(symbol, '3mo', { allowMock: false }),
      getFundamentals(symbol),
    ])
    const technicals = summarizeTechnicals(recentBars, quote.price)

    // ── 4. Learning context from the latest AI session (read-only) ─────
    const learningContext = await collectLearningContext()

    const bundle: PreparedBundle = {
      request,
      interpreted,
      backtest: {
        symbol: result.symbol,
        currency: result.currency,
        period: result.period,
        startDate: result.startDate,
        endDate: result.endDate,
        barCount: result.equityCurve.length,
        initialCapital: result.initialCapital,
        finalValue: result.finalValue,
        metrics: result.metrics,
        // Equity curve intentionally dropped (token economy); trades kept.
        trades: result.trades,
      },
      current: { quote, technicals, fundamentals },
      learningContext,
      sources: [
        'Yahoo Finance（リアルタイム株価・1年日足ヒストリカル・3ヶ月日足）',
        'Yahoo Finance（ファンダメンタル指標）',
        'InvestSimバックテストエンジン（lib/backtest・実データ純計算）',
        'InvestSim AIセッション学習メモリ（過去の仮想売買の教訓）',
        `Claude AI（理論解釈: ${INTERPRET_MODEL} / レポート生成: ${process.env.REPORT_AI_MODEL || 'claude-opus-4-8'}）`,
      ],
      preparedAt: new Date().toISOString(),
    }

    return NextResponse.json({ bundle })
  } catch (err) {
    // Real-data fetch/backtest failure => 422/502 (never mock fallback here).
    const { status, error } = classifyDataError(err, symbol)
    return NextResponse.json({ error }, { status })
  }
}
