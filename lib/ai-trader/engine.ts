import { spawn } from 'child_process'
import { getQuote, getHistory, getFundamentals } from '@/lib/market'
import { calcMA, calcRSI, calcMACD, calcBB } from '@/lib/technicals'
import { fetchNews } from './news'
import {
  createLearningMemory,
  normalizeLearningMemory,
  recordClosedTrade,
  recordDecisions,
  buildLearningContext,
  shouldLearnNow,
  type LearningMemory,
  type ClosedTrade,
  type DecisionRecord,
} from './memory'
import type { StockQuote, FundamentalsData, InvestorId } from '@/types'
import { getPersonaText } from './personas'

// AIモデルID（環境変数で上書き可）。tickは頻繁・高速・低コストが要件なので Haiku を既定に。
// sonnet-4-6 だと1呼び出し+データ取得で約55秒かかり Vercel の60秒関数タイムアウトを不定期に
// 超えて 504（画面上「分析に失敗しました」）になる。Haiku は生成が2〜3倍速く合計35秒前後で
// 安定し、$1/$5 と安価。深い分析が要るレポート機能は別途 Opus を使う。
// より賢いモデルで運用したい場合は Vercel Pro で maxDuration を伸ばし AI_MODEL で上書きする。
const AI_MODEL = process.env.AI_MODEL || 'claude-haiku-4-5'

// Claude呼び出し。ANTHROPIC_API_KEYがあればAnthropic APIを使う（公開サイト/本番・従量課金）。
// キーはオーナー自身のAnthropicアカウントで購入したAPIクレジットで課金される（Claude Codeサブスクとは別系統）。
// キーが無ければローカルのclaude CLIにフォールバック（ローカル開発専用。Vercel等にclaudeバイナリは無い）。
// 公開サイトで全AI（tick分析・仮想取引・学習）を動かすには、VercelのEnvにANTHROPIC_API_KEYを設定する。
function callClaude(prompt: string): Promise<string> {
  return process.env.ANTHROPIC_API_KEY ? callClaudeApi(prompt) : callClaudeCli(prompt)
}

// HOTFIX(2026-07-24): @anthropic-ai/sdkの既定値はtimeout=10分・maxRetries=2（429/5xx等を
// 自動でバックオフ再試行）。これはVercel Hobbyの関数上限(maxDuration=60s)を大きく超えており、
// tick中のClaude呼び出しが少しでも遅延・エラーになると自動tickが「エラーとして速やかに失敗する」
// のではなく「無音のままハングし続け、最終的にVercelのプラットフォームに強制killされて504」に
// なっていた（cron/tick/route.tsのTIME_BUDGET_MSは「次のセッションを開始するか」しか見ておらず、
// 実行中の1呼び出しの長さ自体は縛っていなかったため）。ここで明示的にtimeout/maxRetriesを絞り、
// 遅延時は「速く失敗して次tickに委ねる」（過少実行側に倒す・auto.tsの既存方針と同じ）に倒す。
const CLAUDE_TIMEOUT_MS = 20_000

async function callClaudeApi(prompt: string): Promise<string> {
  // 動的import: APIキー未設定のローカル環境ではSDKを読み込まない
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()
  const res = await client.messages.create(
    {
      model: AI_MODEL,
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    },
    { timeout: CLAUDE_TIMEOUT_MS, maxRetries: 1 },
  )
  return res.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
}

function callClaudeCli(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('claude', ['--print', '--model', AI_MODEL], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { err += d.toString() })
    proc.on('close', (code: number) => {
      if (code === 0) resolve(out)
      else reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 200)}`))
    })
    proc.stdin.write(prompt)
    proc.stdin.end()
  })
}

const UNIVERSE_US = [
  'AAPL','NVDA','MSFT','GOOGL','AMZN','META','TSLA',
  'JPM','BAC','V','MA','GS',
  'JNJ','LLY','PFE','MRK',
  'XOM','CVX',
  'KO','PG','WMT','COST','MCD',
  'AMD','INTC','ORCL','CRM','NFLX','ADBE',
  'SPY','QQQ','COIN','PLTR',
]
const UNIVERSE_JP = ['7203.T','6758.T','9984.T','6861.T','8306.T','4063.T','9432.T']
const UNIVERSE = [...UNIVERSE_US, ...UNIVERSE_JP]

export interface AITrade {
  timestamp: string
  symbol:    string
  name:      string
  action:    'buy' | 'sell'
  shares:    number
  price:     number
  total:     number
  reason:    string
  technicals: string
  fundamentals: string
  news:      string[]
  sources:   string[]
}

export interface AIDecision {
  symbol:       string
  name:         string
  action:       'buy' | 'sell' | 'hold' | 'watch'
  price:        number
  change:       number
  reasoning:    string
  newsInfluence: string
  news:         string[]
  technicals:   string
  fundamentals: string
  confidence:   'high' | 'medium' | 'low'
  sources:      string[]
}

export interface Holding {
  shares:      number
  avgCost:     number
  name:        string
  entryAt:     string
  entryReasoning: string
  entryTechnicals: string
  entryFundamentals: string
}

export interface EquityPoint {
  timestamp:  string
  totalValue: number
  cash:       number
  pnlPct:     number
  benchmarkPct?: number
}

export interface AISession {
  id:           string
  startedAt:    string
  lastTickAt:   string
  tickCount:    number
  capital:      number
  cash:         number
  holdings:     Record<string, Holding>
  trades:       AITrade[]
  decisions:    AIDecision[]
  watchlist:    string[]
  totalValue:   number
  pnl:          number
  pnlPct:       number
  marketContext: string
  learning:     LearningMemory
  equityHistory:    EquityPoint[]
  benchmarkStart:   number | null
  stats: {
    daysRunning:    number
    maxValue:       number
    minValue:       number
    maxDrawdownPct: number
    annualizedReturnPct: number
    sharpeRatio:    number
    totalTradeCount: number
    winRate:        number
  }
  // 自律学習ループ（サーバー側自動tick）の状態。enabled=trueのセッションのみcron/tickで実行される。
  // date は NY市場日付(YYYY-MM-DD)、count は当日の自動tick回数（日次上限のカウンタ）。
  auto?: { enabled: boolean; date: string; count: number }
  // 投資家人格（バフェット等）。未指定は汎用プロンプト（従来挙動）にフォールバックする。
  persona?: InvestorId
}

// 永続化はstore.tsに集約（Supabase JSONB blob / キー未設定ローカルはファイルにフォールバック）。
// 旧実装のグローバルMapキャッシュ（global.__aiSessions）は、Vercelサーバーレスで
// staleなスナップショットに巻き戻る学習消失事故の原因だったため完全撤去。
// 毎リクエスト read→write の素直な形にする。
export { getSession, listSessions } from './store'
import { getSession, upsertSession } from './store'

async function selectCandidates(n = 8): Promise<string[]> {
  const chunks = [UNIVERSE.slice(0, 20), UNIVERSE.slice(20)]
  const results: Array<{ symbol: string; changeAbs: number }> = []

  // 2チャンクを逐次awaitせず並列に走らせる（Vercelの関数タイムアウト対策で待ち時間短縮）。
  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      Promise.allSettled(
        chunk.map(async (sym) => {
          const q = await getQuote(sym)
          return { symbol: sym, changeAbs: Math.abs(q.changePercent) }
        })
      )
    )
  )
  for (const quotes of chunkResults) {
    for (const r of quotes) {
      if (r.status === 'fulfilled') results.push(r.value)
    }
  }

  results.sort((a, b) => b.changeAbs - a.changeAbs)
  return results.slice(0, n).map(r => r.symbol)
}

export interface StockContext {
  symbol:       string
  quote:        StockQuote
  fundamentals: FundamentalsData
  technicals:   string
  techDetail:   string
  news:         string[]
  sources:      string[]
}

async function buildStockContext(symbol: string): Promise<StockContext> {
  const [quote, history, fundamentals, news] = await Promise.all([
    getQuote(symbol),
    getHistory(symbol, '3mo'),
    getFundamentals(symbol),
    fetchNews(symbol, 5),
  ])

  const ma20  = calcMA(history, 20)
  const ma50  = calcMA(history, 50)
  const rsi14 = calcRSI(history)
  const macd  = calcMACD(history)
  const bb    = calcBB(history)

  const price       = quote.price
  const latestMA20  = ma20[ma20.length - 1]?.value
  const latestMA50  = ma50[ma50.length - 1]?.value
  const latestRSI   = rsi14[rsi14.length - 1]?.value
  const latestMACD  = macd[macd.length - 1]
  const latestBB    = bb[bb.length - 1]

  const trendSignal = latestMA20 && latestMA50
    ? price > latestMA20 && latestMA20 > latestMA50
      ? '上昇トレンド(価格>MA20>MA50)'
      : price < latestMA20 && latestMA20 < latestMA50
        ? '下落トレンド(価格<MA20<MA50)'
        : '横ばい・レンジ'
    : 'データ不足'

  const rsiSignal = latestRSI
    ? latestRSI > 70 ? `RSI${latestRSI.toFixed(0)} 買われすぎ`
      : latestRSI < 30 ? `RSI${latestRSI.toFixed(0)} 売られすぎ(反発候補)`
      : `RSI${latestRSI.toFixed(0)} 中立`
    : 'RSI不足'

  const macdSignal = latestMACD
    ? latestMACD.histogram > 0 ? 'MACD強気' : 'MACD弱気'
    : ''

  const bbSignal = latestBB && price
    ? price > latestBB.upper ? 'BB上限超え'
      : price < latestBB.lower ? 'BB下限割れ(反発候補)'
      : 'BB内'
    : ''

  const technicals = [trendSignal, rsiSignal, macdSignal, bbSignal].filter(Boolean).join(' | ')
  const techDetail = `MA20=${latestMA20?.toFixed(2) ?? '-'} MA50=${latestMA50?.toFixed(2) ?? '-'} RSI=${latestRSI?.toFixed(1) ?? '-'} MACD=${latestMACD?.macd?.toFixed(2) ?? '-'}`

  const newsHeadlines = news.map(n => {
    const age = Math.round((Date.now() / 1000 - n.publishedAt) / 3600)
    return `[${age}h前] ${n.title} (${n.publisher})`
  })

  const sources = ['Yahoo Finance (リアルタイム株価・チャート)', 'Yahoo Finance News (ニュース)']

  return { symbol, quote, fundamentals, technicals, techDetail, news: newsHeadlines, sources }
}

function fmtFundamentals(f: FundamentalsData): string {
  const n = (v?: number, suffix = '', mul = 1, dec = 1) =>
    v != null ? `${(v * mul).toFixed(dec)}${suffix}` : 'N/A'

  const parts = [
    `PER=${n(f.pe, 'x')}`,
    `PBR=${n(f.pb, 'x')}`,
    `ROE=${n(f.roe, '%', 100)}`,
    `ROA=${n(f.roa, '%', 100)}`,
    `営業利益率=${n(f.operatingMargin, '%', 100)}`,
    `粗利益率=${n(f.grossMargin, '%', 100)}`,
    `売上成長=${n(f.revenueGrowth, '%', 100)}`,
    `D/E=${n(f.debtToEquity, 'x', 1, 2)}`,
    f.freeCashflow != null ? `FCF=$${(f.freeCashflow / 1e9).toFixed(1)}B` : null,
    f.marketCap != null ? `時価総額=$${(f.marketCap / 1e9).toFixed(0)}B` : null,
    f.dividendYield != null ? `配当利回り=${(f.dividendYield * 100).toFixed(1)}%` : null,
    f.week52High != null ? `52週高値=${f.week52High.toFixed(0)}` : null,
    f.week52Low != null ? `安値=${f.week52Low.toFixed(0)}` : null,
  ].filter(Boolean)
  return parts.join(' | ')
}

// リスク管理・学習は人格に関わらず不変（COMPANY.mdで定めたリスク管理ルールとJSON出力契約の一部）。
// persona.criteria の項目数は人格ごとに異なる（バフェットは5項目・汎用は3項目）ため、番号はここで
// 一貫して振り直す。人格側テキストに固定の "4."/"5." を決め打ちで追記すると項目数が違う人格で
// 番号が重複するため（レビュー指摘で修正）、常にこの関数を経由して番号を割り当てる。
const RISK_MANAGEMENT_CRITERION = 'リスク管理: 1銘柄=資本の15-20%以内、最大5銘柄、現金20%以上維持'
const LEARNING_CRITERION = '学習: 過去の失敗パターンを避け、成功パターンを踏襲する'

function buildCriteriaBlock(persona: { criteria: string[] }): string {
  const items = [...persona.criteria, RISK_MANAGEMENT_CRITERION, LEARNING_CRITERION]
  return items.map((item, i) => `${i + 1}. ${item}`).join('\n')
}

async function askClaude(
  session: AISession,
  stockData: StockContext[]
): Promise<AIDecision[]> {

  const holdingsSummary = Object.entries(session.holdings).map(([sym, pos]) => {
    const hrsSince = Math.round((Date.now() - new Date(pos.entryAt).getTime()) / 3600000)
    return `${sym}(${pos.name}): ${pos.shares.toFixed(2)}株 平均取得$${pos.avgCost.toFixed(2)} 保有${hrsSince}h`
  }).join('\n') || 'なし'

  const stocksText = stockData.map(({ symbol, quote, fundamentals, technicals, news }) => `
【${symbol}】${quote.name}
• 現在値: ${quote.price.toFixed(2)} ${quote.currency}  前日比: ${quote.change >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%
• テクニカル: ${technicals}
• ファンダメンタル(バフェットコード): ${fmtFundamentals(fundamentals)}
• ニュース: ${news.length > 0 ? news.slice(0, 3).join(' / ') : 'なし'}`
  ).join('\n')

  const learningCtx = buildLearningContext(session.learning)
  const persona = getPersonaText(session.persona)

  const prompt = `${persona.roleLine}

【現在のポートフォリオ状態】
• 現金: $${session.cash.toFixed(2)} / 初期資本: $${session.capital.toFixed(2)}
• 合計資産: $${session.totalValue.toFixed(2)} (${session.pnl >= 0 ? '+' : ''}${session.pnlPct.toFixed(2)}%)
• 保有銘柄:
${holdingsSummary}

【分析対象銘柄】(ボラティリティ上位＋保有銘柄)
${stocksText}

【過去の経験・学習】
${learningCtx}

【判断基準】
${buildCriteriaBlock(persona)}

各銘柄についてJSON形式で判断を返してください:

\`\`\`json
[
  {
    "symbol": "AAPL",
    "action": "buy",
    "confidence": "high",
    "reasoning": "日本語2文以内の判断理由",
    "newsInfluence": "ニュースの影響（1文）",
    "techSignal": "テクニカル要約（1文）",
    "fundSignal": "ファンダメンタル評価（1文）"
  }
]
\`\`\`

actionは "buy" | "sell" | "hold" | "watch"。buyは現金十分な場合のみ。sellは保有銘柄のみ。`

  const text = await callClaude(prompt)
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/)
  if (!jsonMatch) return []

  try {
    const raw: any[] = JSON.parse(jsonMatch[1])
    return raw.map(r => {
      const sd = stockData.find(s => s.symbol === r.symbol)
      const f = sd?.fundamentals
      const fundStr = f ? fmtFundamentals(f) : '-'
      const sources = [
        'Yahoo Finance (株価・チャート)',
        'Yahoo Finance News',
        'Claude AI (分析エンジン)',
        'バフェットコード式ファンダメンタル分析',
      ]
      return {
        symbol:        r.symbol,
        name:          sd?.quote.name ?? r.symbol,
        action:        r.action ?? 'watch',
        price:         sd?.quote.price ?? 0,
        change:        sd?.quote.changePercent ?? 0,
        reasoning:     r.reasoning ?? '',
        newsInfluence: r.newsInfluence ?? '',
        news:          sd?.news.slice(0, 2) ?? [],
        technicals:    r.techSignal ?? sd?.technicals ?? '',
        fundamentals:  r.fundSignal ? `${r.fundSignal} | ${fundStr}` : fundStr,
        confidence:    r.confidence ?? 'medium',
        sources,
      } satisfies AIDecision
    })
  } catch {
    return []
  }
}

interface FullLearning {
  lessons: string[]
  fundamentalInsights: string[]
  newsInsights: string[]
  causalChains: string[]
  tradingBiases: string[]
  strategyNotes: string[]
}

async function generateFullLearning(memory: LearningMemory, session: AISession): Promise<FullLearning> {
  const empty: FullLearning = {
    lessons: [], fundamentalInsights: [], newsInsights: [],
    causalChains: [], tradingBiases: [], strategyNotes: [],
  }
  if (memory.closedTrades.length === 0) return empty

  const closedText = memory.closedTrades.slice(0, 15).map(t =>
    `[${t.outcome === 'profit' ? '利益' : '損失'}] ${t.symbol} ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(1)}% | 保有${t.holdingHours}h
  エントリー理由: ${t.entryReasoning}
  エグジット理由: ${t.exitReasoning}
  テクニカル: ${t.technicals}
  ファンダメンタル: ${t.fundamentals}
  入りニュース: ${(t.newsAtEntry ?? []).slice(0, 2).join(' / ') || 'なし'}`
  ).join('\n\n')

  const decisionText = memory.allDecisions.slice(0, 30).map(d =>
    `${d.action.toUpperCase()} ${d.symbol} @${d.price.toFixed(0)} [${d.confidence}] | ${d.reasoning.slice(0, 80)}`
  ).join('\n')

  const portfolioStatus = `総資産: $${session.totalValue.toFixed(0)} | 損益: ${session.pnlPct >= 0 ? '+' : ''}${session.pnlPct.toFixed(2)}% | 現金比率: ${((session.cash / session.totalValue) * 100).toFixed(0)}% | Tick数: ${session.tickCount}`

  const existingBiases = memory.tradingBiases.slice(0, 3).map(b => `• ${b}`).join('\n') || 'なし'

  const prompt = `あなたはAI投資エージェントの「内省・学習システム」です。以下のデータを分析し、次回の売買判断を改善するための学習を行ってください。

【ポートフォリオ現状】
${portfolioStatus}

【クローズ済み取引（詳細）】
${closedText}

【全判断ログ（直近30件）】
${decisionText}

【既知の癖・バイアス】
${existingBiases}

以下の6軸で分析し、JSONで返してください。各配列は最大5件。具体的・実践的に：

\`\`\`json
{
  "lessons": ["取引全体から得た最重要教訓（成功・失敗の根本原因）"],
  "fundamentalInsights": ["どのファンダメンタル指標が実際に予測力があったか（例: ROE>20%+低D/Eは保有中に安定、PER>50xは利確タイミングを早める）"],
  "newsInsights": ["ニュースの読み方パターン（例: Fed発言→翌日グロース安、決算beat後の売り場は翌日高値、セクター横断ニュースの連鎖）"],
  "causalChains": ["風が吹けば桶屋的な連想チェーン（例: 利上げ→ドル高→新興国通貨安→資源価格下落→資源株安、AI投資増→電力需要増→原発・電力株注目）"],
  "tradingBiases": ["自分の取引の癖・システマティックな偏り（例: RSI30以下で早期エントリーしすぎ、テック偏重、損切りが遅い）"],
  "strategyNotes": ["次のTickから実行すべき戦略調整（例: 現金比率30%以上維持、セクター分散を意識、ニュース反応は24h待ち戦略）"]
}
\`\`\``

  try {
    const text = await callClaude(prompt)
    const match = text.match(/```json\s*([\s\S]*?)\s*```/)
    if (!match) return empty
    const parsed = JSON.parse(match[1]) as Partial<FullLearning>
    return {
      lessons:             (parsed.lessons             ?? []).slice(0, 5),
      fundamentalInsights: (parsed.fundamentalInsights ?? []).slice(0, 5),
      newsInsights:        (parsed.newsInsights        ?? []).slice(0, 5),
      causalChains:        (parsed.causalChains        ?? []).slice(0, 5),
      tradingBiases:       (parsed.tradingBiases       ?? []).slice(0, 5),
      strategyNotes:       (parsed.strategyNotes       ?? []).slice(0, 5),
    }
  } catch {
    return empty
  }
}

function executeTrades(session: AISession, decisions: AIDecision[]): AITrade[] {
  const newTrades: AITrade[] = []
  const now = new Date().toISOString()
  const holdingCount = Object.keys(session.holdings).length

  // Record ALL decisions (buy/sell/hold/watch) for learning
  const decisionRecords: DecisionRecord[] = decisions.map((dec, i) => ({
    id: `dr_${Date.now()}_${i}`,
    timestamp: now,
    symbol: dec.symbol,
    action: dec.action,
    price: dec.price,
    confidence: dec.confidence,
    reasoning: dec.reasoning,
    technicals: dec.technicals,
    fundamentals: dec.fundamentals,
    newsHeadlines: dec.news,
  }))
  recordDecisions(session.learning, decisionRecords)

  for (const dec of decisions) {
    if (dec.action === 'buy' && session.cash > 500 && holdingCount < 5) {
      const allocation = Math.min(session.capital * 0.18, session.cash * 0.85)
      if (allocation < 200 || dec.price <= 0) continue

      const shares = allocation / dec.price
      const total  = shares * dec.price

      session.cash -= total
      if (!session.holdings[dec.symbol]) {
        session.holdings[dec.symbol] = {
          shares:           0,
          avgCost:          dec.price,
          name:             dec.name,
          entryAt:          now,
          entryReasoning:   dec.reasoning,
          entryTechnicals:  dec.technicals,
          entryFundamentals: dec.fundamentals,
        }
      }
      const pos = session.holdings[dec.symbol]
      const prevTotal = pos.shares * pos.avgCost
      pos.shares  += shares
      pos.avgCost  = (prevTotal + total) / pos.shares

      newTrades.push({
        timestamp:    now,
        symbol:       dec.symbol,
        name:         dec.name,
        action:       'buy',
        shares:       parseFloat(shares.toFixed(4)),
        price:        dec.price,
        total:        parseFloat(total.toFixed(2)),
        reason:       dec.reasoning,
        technicals:   dec.technicals,
        fundamentals: dec.fundamentals,
        news:         dec.news,
        sources:      dec.sources,
      })
    }

    if (dec.action === 'sell' && session.holdings[dec.symbol]) {
      const pos   = session.holdings[dec.symbol]
      const total = pos.shares * dec.price
      const pnl   = total - pos.shares * pos.avgCost
      const pnlPct = ((dec.price - pos.avgCost) / pos.avgCost) * 100
      const holdingHours = Math.round((Date.now() - new Date(pos.entryAt).getTime()) / 3600000)

      session.cash += total

      recordClosedTrade(session.learning, {
        symbol:            dec.symbol,
        name:              dec.name,
        entryPrice:        pos.avgCost,
        exitPrice:         dec.price,
        shares:            pos.shares,
        entryAt:           pos.entryAt,
        exitAt:            now,
        pnl:               parseFloat(pnl.toFixed(2)),
        pnlPct:            parseFloat(pnlPct.toFixed(2)),
        holdingHours,
        entryReasoning:    pos.entryReasoning,
        exitReasoning:     dec.reasoning,
        technicals:        dec.technicals,
        fundamentals:      dec.fundamentals,
        newsAtEntry:       dec.news,
      } satisfies Omit<ClosedTrade, 'id' | 'outcome'>)

      newTrades.push({
        timestamp:    now,
        symbol:       dec.symbol,
        name:         dec.name,
        action:       'sell',
        shares:       parseFloat(pos.shares.toFixed(4)),
        price:        dec.price,
        total:        parseFloat(total.toFixed(2)),
        reason:       dec.reasoning,
        technicals:   dec.technicals,
        fundamentals: dec.fundamentals,
        news:         dec.news,
        sources:      dec.sources,
      })
      delete session.holdings[dec.symbol]
    }
  }

  return newTrades
}

function emptyStats(): AISession['stats'] {
  return {
    daysRunning: 0, maxValue: 0, minValue: Infinity,
    maxDrawdownPct: 0, annualizedReturnPct: 0, sharpeRatio: 0,
    totalTradeCount: 0, winRate: 0,
  }
}

function updateStats(session: AISession) {
  const s = session.stats
  const v = session.totalValue

  if (s.maxValue === 0) s.maxValue = v
  if (s.minValue === Infinity) s.minValue = v
  s.maxValue = Math.max(s.maxValue, v)
  s.minValue = Math.min(s.minValue, v)

  const drawdown = ((s.maxValue - v) / s.maxValue) * 100
  s.maxDrawdownPct = Math.max(s.maxDrawdownPct, parseFloat(drawdown.toFixed(2)))

  s.daysRunning = Math.max(1, Math.round(
    (Date.now() - new Date(session.startedAt).getTime()) / 86400000
  ))

  const totalReturnPct = session.pnlPct
  s.annualizedReturnPct = parseFloat(
    (totalReturnPct / s.daysRunning * 365).toFixed(2)
  )

  if (session.equityHistory.length > 2) {
    const returns = session.equityHistory.slice(-30).map((p, i, arr) =>
      i === 0 ? 0 : (p.totalValue - arr[i - 1].totalValue) / arr[i - 1].totalValue
    ).slice(1)
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length
    const variance = returns.reduce((a, b) => a + (b - mean) ** 2, 0) / returns.length
    const stddev = Math.sqrt(variance)
    s.sharpeRatio = stddev > 0
      ? parseFloat(((mean / stddev) * Math.sqrt(252)).toFixed(2))
      : 0
  }

  s.totalTradeCount = session.trades.length
  s.winRate = session.learning.stats.winRate
}

export async function startSession(capital = 100000, persona?: InvestorId): Promise<AISession> {
  let benchmarkStart: number | null = null
  try {
    const spy = await getQuote('SPY')
    benchmarkStart = spy.price
  } catch { /* non-critical */ }

  const id = `session_${Date.now()}`
  const session: AISession = {
    id,
    startedAt:      new Date().toISOString(),
    lastTickAt:     new Date().toISOString(),
    tickCount:      0,
    capital,
    cash:           capital,
    holdings:       {},
    trades:         [],
    decisions:      [],
    watchlist:      [],
    totalValue:     capital,
    pnl:            0,
    pnlPct:         0,
    marketContext:  '',
    learning:       createLearningMemory(),
    equityHistory:  [],
    benchmarkStart,
    stats:          emptyStats(),
    auto:           { enabled: false, date: '', count: 0 },
    persona,
  }
  await upsertSession(session)
  return session
}

export async function runTick(sessionId: string): Promise<AISession> {
  const session = await getSession(sessionId)
  if (!session) throw new Error('Session not found')

  if (!session.equityHistory) session.equityHistory = []
  if (!session.stats)         session.stats = emptyStats()
  if (session.benchmarkStart === undefined) session.benchmarkStart = null
  // 古い/部分的な永続セッションが後続フィールドを欠いていても tick が落ちないよう補完する。
  // learning は「存在するが入れ子配列が欠損」の旧フォーマットもあるため、正規化でマージ補完する。
  session.learning = normalizeLearningMemory(session.learning)
  if (!session.decisions) session.decisions = []
  if (!session.trades)    session.trades = []
  if (!session.holdings)  session.holdings = {}
  if (!session.watchlist) session.watchlist = []

  const candidates = await selectCandidates(6)
  const combined = Array.from(new Set([...candidates, ...Object.keys(session.holdings)]))
  session.watchlist = combined

  type StockCtx = Awaited<ReturnType<typeof buildStockContext>>
  const rawData = await Promise.all(
    combined.map(sym => buildStockContext(sym).catch(() => null))
  )
  const enriched: StockCtx[] = []
  for (let i = 0; i < combined.length; i++) {
    const ctx = rawData[i]
    if (ctx) enriched.push(ctx)
  }

  const decisions = await askClaude(session, enriched)
  session.decisions = [...decisions, ...session.decisions].slice(0, 50)

  const newTrades = executeTrades(session, decisions)
  session.trades = [...newTrades, ...session.trades].slice(0, 200)

  const holdingValues = await Promise.all(
    Object.entries(session.holdings).map(async ([sym, pos]) => {
      try {
        const q = await getQuote(sym)
        return pos.shares * q.price
      } catch {
        return pos.shares * pos.avgCost
      }
    })
  )
  const holdingsTotal = holdingValues.reduce((a, b) => a + b, 0)
  session.totalValue = session.cash + holdingsTotal
  session.pnl        = session.totalValue - session.capital
  session.pnlPct     = (session.pnl / session.capital) * 100
  session.lastTickAt = new Date().toISOString()
  session.tickCount++

  let benchmarkPct: number | undefined
  if (session.benchmarkStart) {
    try {
      const spy = await getQuote('SPY')
      benchmarkPct = parseFloat(
        (((spy.price - session.benchmarkStart) / session.benchmarkStart) * 100).toFixed(2)
      )
    } catch { /* non-critical */ }
  }
  session.equityHistory.push({
    timestamp:    session.lastTickAt,
    totalValue:   parseFloat(session.totalValue.toFixed(2)),
    cash:         parseFloat(session.cash.toFixed(2)),
    pnlPct:       parseFloat(session.pnlPct.toFixed(2)),
    benchmarkPct,
  })
  if (session.equityHistory.length > 5000) session.equityHistory.shift()

  if (!session.stats) session.stats = emptyStats()
  updateStats(session)

  // 学習生成は 2回目の Claude 呼び出しになり、tick を Vercel の関数タイムアウト(60s)超えに
  // 追い込む主因。売買判断(1回目)は毎tick必須なので、学習は数tickに1回へ間引いて hot path を
  // 1呼び出しに抑える（tickCount ベースの決定的な判定）。
  const LEARN_EVERY_N_TICKS = 5
  if (session.tickCount % LEARN_EVERY_N_TICKS === 0 && shouldLearnNow(session.learning, session.tickCount)) {
    try {
      const fl = await generateFullLearning(session.learning, session)
      if (fl.lessons.length > 0 || fl.fundamentalInsights.length > 0) {
        // Merge new insights with existing, newest first, capped
        session.learning.lessons             = [...fl.lessons,             ...session.learning.lessons].slice(0, 15)
        session.learning.fundamentalInsights = [...fl.fundamentalInsights, ...session.learning.fundamentalInsights].slice(0, 10)
        session.learning.newsInsights        = [...fl.newsInsights,        ...session.learning.newsInsights].slice(0, 10)
        session.learning.causalChains        = [...fl.causalChains,        ...session.learning.causalChains].slice(0, 10)
        session.learning.tradingBiases       = [...fl.tradingBiases,       ...session.learning.tradingBiases].slice(0, 8)
        session.learning.strategyNotes       = fl.strategyNotes  // replace with latest strategy
        session.learning.lastLearnTickCount  = session.tickCount
      }
    } catch { /* non-critical — learning failure doesn't break tick */ }
  }

  // runTickで読み込んだセッションは、変更の有無に関わらず最後に必ず明示保存する
  // （tickを跨いだ学習の積み上げ＝原則11の学習ループを保証）。
  await upsertSession(session)
  return session
}
