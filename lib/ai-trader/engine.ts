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
  type LearningMemory,
  type ClosedTrade,
  type DecisionRecord,
} from './memory'
import type { StockQuote, FundamentalsData, InvestorId } from '@/types'
import { getPersonaText } from './personas'
import { extractDecisionArray } from './decision-parse'
import { listKnowledge, recordKnowledgeUsage } from '@/lib/knowledge/store'
import { selectKnowledgeForDecision, formatKnowledgeBlock, filterKnowledgeRefs } from '@/lib/knowledge/select'
import type { KnowledgeItem, KnowledgeKind } from '@/lib/knowledge/types'
// 監視母集団は lib/ai-trader/universe.ts（純データ・副作用なし）に置き、クライアント側の
// 画面(/watch)が「AIは何銘柄を監視しているのか」を同じ定義から読めるようにしている。
import { UNIVERSE, TICK_CANDIDATE_COUNT } from './universe'
// 4a(2026-09-11): tick ごとの過程の記録（DESIGN.md §6-19 の材料）。型と組み立ては純関数側に置く。
import {
  emptyTickRecord, makeStage, pushTick, decisionIdFor,
  type TickRecord, type TickAI, type TickUniverseRow, type TickContext,
} from './tick-record'

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
/** Claude呼び出しの上限。呼び出し側の性質（hot path/間引き）で使い分ける。 */
type CallClaudeOpts = { maxTokens?: number; timeoutMs?: number }

/** Claude の返事＋計測値。本文（text）は呼び出し側で使うだけで、記録（TickAI）には載せない。 */
interface ClaudeReply {
  text: string
  model: string
  inputTokens: number | null
  outputTokens: number | null
  stopReason: string
  ms: number
  promptChars: number
  responseChars: number
}

/** 4a: 計測値つきの呼び出し。CLI 経路は usage も stop_reason も無いので model:'cli'・トークン null。 */
async function callClaudeDetailed(prompt: string, opts: CallClaudeOpts = {}): Promise<ClaudeReply> {
  if (process.env.ANTHROPIC_API_KEY) return callClaudeApi(prompt, opts)
  const t0 = Date.now()
  const text = await callClaudeCli(prompt)
  return {
    text, model: 'cli', inputTokens: null, outputTokens: null, stopReason: 'cli',
    ms: Date.now() - t0, promptChars: prompt.length, responseChars: text.length,
  }
}

/** 既存の呼び出し口（generateFullLearning が使う）。本文だけ返す挙動は不変。 */
async function callClaude(prompt: string, opts: CallClaudeOpts = {}): Promise<string> {
  return (await callClaudeDetailed(prompt, opts)).text
}

/** SDK のタイムアウト（APIConnectionTimeoutError "Request timed out."）と withDeadline の "timed out" を同じ扱いにする。 */
function isTimeoutError(e: unknown): boolean {
  const name = (e as { name?: unknown })?.name
  const msg = e instanceof Error ? e.message : String(e)
  return name === 'APIConnectionTimeoutError' || /timed out/i.test(msg)
}

/**
 * askClaude が Claude 呼び出しで落ちたときに投げる。runTick はこれを捕まえて `ai` を TickRecord に
 * 積んで保存してから `original` を再送出する（呼び出し側が見るエラーは従来と同じ）。
 */
class AskClaudeError extends Error {
  constructor(readonly original: unknown, readonly ai: TickAI) {
    super(original instanceof Error ? original.message : String(original))
    this.name = 'AskClaudeError'
  }
}

// HOTFIX(2026-07-24): @anthropic-ai/sdkの既定値はtimeout=10分・maxRetries=2（429/5xx等を
// 自動でバックオフ再試行）。これはVercel Hobbyの関数上限(maxDuration=60s)を大きく超えており、
// tick中のClaude呼び出しが少しでも遅延・エラーになると自動tickが「エラーとして速やかに失敗する」
// のではなく「無音のままハングし続け、最終的にVercelのプラットフォームに強制killされて504」に
// なっていた。
//
// 修正(2026-07-30): 上の20秒・maxRetries=1は504を消した代わりに、自動tickを7/27以降ずっと
// 100%失敗させていた（GH Actionsは200を受け取るのでsuccess表示だが、中身は毎回
// `ran:false, reason:"error"`。Vercelログの実体は `Error: Request timed out.`）。
// 実測46秒の内訳が「データ取得6秒 + 20秒timeout + リトライ20秒timeout」で、判断1回が
// 20秒に収まらないのが真因。リトライは2回目も同じ理由で落ちるだけで40秒を溶かすので廃止し、
// 1回の試行に時間を全部与える。cron側のTIME_BUDGET_MS(50秒)に収まるよう
// 「データ取得+後処理(約10秒) + 判断35秒」で見積もる。
// 学習(2026-07-31にcron/learnへ分離)は専用エンドポイントの60秒枠を単独で使えるため、
// tickのhot pathに遠慮する必要がなくなった。20秒では生成が終わらず空振りしていたので広げる。
const CLAUDE_TIMEOUT_MS = 35_000
const CLAUDE_LEARN_TIMEOUT_MS = 40_000
// 生成時間はほぼ出力トークン数に比例するため、判断側は4096から絞る。ただし絞りすぎると
// JSONが途中で切れて閉じフェンスが無くなり、呼び出し側の正規表現が無マッチ＝静かに空判断に
// なる（銘柄数×1オブジェクトぶんの余裕を必ず残す）。学習側は6配列×5件で嵩むため据え置く。
const DECISION_MAX_TOKENS = 2500
const LEARN_MAX_TOKENS = 4096

async function callClaudeApi(prompt: string, opts: CallClaudeOpts = {}): Promise<ClaudeReply> {
  // 動的import: APIキー未設定のローカル環境ではSDKを読み込まない
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic()
  const t0 = Date.now()
  const res = await client.messages.create(
    {
      model: AI_MODEL,
      max_tokens: opts.maxTokens ?? DECISION_MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    },
    // maxRetries=0: 429等の一時失敗も1回で諦める。1日3回のcronが古い順に拾い直すので、
    // ここで粘るより関数上限内に確実に収める方を採る（過少実行側に倒す・auto.tsと同方針）。
    { timeout: opts.timeoutMs ?? CLAUDE_TIMEOUT_MS, maxRetries: 0 },
  )
  const text = res.content
    .filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text)
    .join('')
  // 計測(S4-0): 出力上限で打ち切られたかを常に1行残す。これが無いと「判断が半分しか無い」原因が
  // 誰にも分からない。DECISION_MAX_TOKENS の見直しはこのログの実測が貯まってから。
  const maxTokens = opts.maxTokens ?? DECISION_MAX_TOKENS
  console.warn(`[ai-trader] usage in=${res.usage?.input_tokens ?? '?'} out=${res.usage?.output_tokens ?? '?'} stop=${res.stop_reason ?? '?'} max=${maxTokens}`)
  if (res.stop_reason === 'max_tokens') {
    console.warn(`[ai-trader] 出力上限(max_tokens=${maxTokens})で打ち切られた。判断が欠けている可能性`)
  }
  return {
    text,
    model: res.model ?? AI_MODEL,
    inputTokens: res.usage?.input_tokens ?? null,
    outputTokens: res.usage?.output_tokens ?? null,
    stopReason: res.stop_reason ?? 'unknown',
    ms: Date.now() - t0,
    promptChars: prompt.length,
    responseChars: text.length,
  }
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
      if (code === 0) {
        // CLI 経路は usage も stop_reason も返さないので、打ち切り判定不能であることを明示する
        console.warn(`[ai-trader] usage in=? out=? stop=cli chars=${out.length}`)
        resolve(out)
      }
      else reject(new Error(`claude CLI exited ${code}: ${err.slice(0, 200)}`))
    })
    proc.stdin.write(prompt)
    proc.stdin.end()
  })
}


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
  // S2(知識配線): AIが実際に依拠したと申告したKNOWLEDGE.md由来の原則。任意フィールド
  // （旧永続セッションに無くても壊れない）。titleを非正規化で持つのは、古い判断でも
  // 知識ストア側の更新・削除に関わらず単体でUI描画できるようにするため。
  knowledgeRefs?: Array<{ id: string; title: string }>
  // 4a(2026-09-11): この判断が生まれた tick（AISession.ticks[].id）と、AI の返事を受け取った時刻。
  // 任意フィールド（旧判断には無い。読む側は `tickId ?? null`）。過程の詳細は ticks 側にあり、
  // ここには参照だけを持つ（判断ごとに走査結果を複製しない）。
  tickId?: string
  decidedAt?: string
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
  // S2(知識配線): 直近tickでプロンプトに提示した知識の集合のみ（最大6件）。引用されたか
  // どうかは問わない「提示」の記録。「引用」（実際に依拠したもの）はAIDecision.knowledgeRefs側。
  // 任意フィールド（旧永続セッションに無くても壊れない）。
  knowledgeShown?: Array<{ id: string; title: string; kind: KnowledgeKind }>
  // 4a(2026-09-11): tick ごとの過程の記録（直近 TICK_RECORD_LIMIT=12 件・新しい順）。DESIGN.md §6-19 の材料。
  // 任意フィールド（旧永続セッションに無い。読む側は `ticks ?? []`）。askClaude が失敗した tick も
  // stopReason 付きで残す。decisions / trades / equityHistory の作り方・件数はこの配列の有無で変わらない。
  ticks?: TickRecord[]
}

// 永続化はstore.tsに集約（Supabase JSONB blob / キー未設定ローカルはファイルにフォールバック）。
// 旧実装のグローバルMapキャッシュ（global.__aiSessions）は、Vercelサーバーレスで
// staleなスナップショットに巻き戻る学習消失事故の原因だったため完全撤去。
// 毎リクエスト read→write の素直な形にする。
export { getSession, listSessions } from './store'
import { getSession, upsertSession } from './store'

/**
 * 値動き（|前日比%|）の大きい順に n 銘柄を選ぶ。`candidates` の中身・順序は従来の戻り値と同じ。
 * 4a: 走査した40銘柄の結果を `universe`（UNIVERSE の並び順・順位つき）としても返す。
 * quote 取得に失敗した行は ok:false・changePercent/rank は null（0 で埋めない）。
 */
async function selectCandidates(n = 8): Promise<{ candidates: string[]; universe: TickUniverseRow[] }> {
  const chunks = [UNIVERSE.slice(0, 20), UNIVERSE.slice(20)]
  const results: Array<{ symbol: string; changeAbs: number; changePercent: number | null }> = []

  // 2チャンクを逐次awaitせず並列に走らせる（Vercelの関数タイムアウト対策で待ち時間短縮）。
  const chunkResults = await Promise.all(
    chunks.map((chunk) =>
      Promise.allSettled(
        chunk.map(async (sym) => {
          const q = await getQuote(sym)
          return {
            symbol: sym,
            changeAbs: Math.abs(q.changePercent),
            // 記録用。数値でない（NaN 等）場合は null にする（順位の計算は従来どおり changeAbs で行う）。
            changePercent: Number.isFinite(q.changePercent) ? q.changePercent : null,
          }
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
  const rankBySymbol = new Map(results.map((r, i) => [r.symbol, i + 1]))
  const rowBySymbol = new Map(results.map(r => [r.symbol, r]))
  const universe: TickUniverseRow[] = UNIVERSE.map(symbol => {
    const row = rowBySymbol.get(symbol)
    return row
      ? { symbol, changePercent: row.changePercent, ok: true, rank: rankBySymbol.get(symbol) ?? null }
      : { symbol, changePercent: null, ok: false, rank: null }
  })
  return { candidates: results.slice(0, n).map(r => r.symbol), universe }
}

export interface StockContext {
  symbol:       string
  quote:        StockQuote
  fundamentals: FundamentalsData
  technicals:   string
  techDetail:   string
  news:         string[]
  sources:      string[]
  // 4a(2026-09-11): 記録用。technicals/techDetail の文字列を作るのに使った数値そのもの（丸めは
  // lib/technicals の計算どおり）。算出できなかった指標は null。bars は取得した日足の本数。
  bars:         number
  indicators:   Pick<TickContext, 'ma20' | 'ma50' | 'rsi14' | 'macd' | 'bb'>
  /** getFundamentals が {}（データなし）以外を返したか */
  fundamentalsOk: boolean
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

  // 4a: 記録用の数値。文字列化（technicals/techDetail）は上のとおり不変で、ここは同じ値を数値のまま持つ。
  const indicators: StockContext['indicators'] = {
    ma20:  latestMA20 ?? null,
    ma50:  latestMA50 ?? null,
    rsi14: latestRSI ?? null,
    macd:  latestMACD ? { macd: latestMACD.macd, signal: latestMACD.signal, histogram: latestMACD.histogram } : null,
    bb:    latestBB ? { upper: latestBB.upper, middle: latestBB.middle, lower: latestBB.lower } : null,
  }

  return {
    symbol, quote, fundamentals, technicals, techDetail, news: newsHeadlines, sources,
    bars: history.length,
    indicators,
    fundamentalsOk: Object.keys(fundamentals).length > 0,
  }
}

/** 4a: StockContext から記録用の行を切り出す（ニュース見出しは news の `[Nh前] title (publisher)` をそのまま）。 */
function toTickContext(ctx: StockContext): TickContext {
  return {
    symbol: ctx.symbol,
    bars: ctx.bars,
    ...ctx.indicators,
    fundamentalsOk: ctx.fundamentalsOk,
    newsCount: ctx.news.length,
    newsHeadlines: ctx.news,
  }
}

/** 4a: buildStockContext が落ちた銘柄の行。数値は null・見出しは空（分析対象からは外れている）。 */
function failedTickContext(symbol: string, error: unknown): TickContext {
  return {
    symbol, bars: 0, ma20: null, ma50: null, rsi14: null, macd: null, bb: null,
    fundamentalsOk: false, newsCount: 0, newsHeadlines: [],
    error: (error instanceof Error ? error.message : String(error)).slice(0, 200),
  }
}

// 通貨コード(ISO 4217)→ 表示記号。USD/JPY 以外はコードをそのまま前置（例: "EUR 12.3B"）。
function currencySymbol(currency?: string): string {
  if (!currency) return ''
  const c = currency.toUpperCase()
  if (c === 'USD') return '$'
  if (c === 'JPY') return '¥'
  return `${c} `
}

// AI への入力に使うファンダ1行の書式 v2（2026-09-11）。
//  - D/E は FundamentalsData の正準単位（Yahoo 原値の%表記、types/index.ts 参照）のまま "%" で出す。
//    v1 は同じ数値に "x"（倍率）を付けていたため、AI が「D/E 49倍で高レバレッジ」と誤読していた。
//  - FCF・時価総額・52週高値/安値には銘柄の通貨記号を付ける（v1 は .T 銘柄にも "$" を付けていた）。
//  - 末尾に "fmt=2" トークンを足し、過去の v1 文字列と機械的に区別できるようにする
//    （lib/ai-trader/fundamentals-parse.ts が判定に使う）。数値のスケール（10億=B）は v1 と同じ。
function fmtFundamentals(f: FundamentalsData, currency?: string): string {
  const n = (v?: number, suffix = '', mul = 1, dec = 1) =>
    v != null ? `${(v * mul).toFixed(dec)}${suffix}` : 'N/A'
  const cur = currencySymbol(currency)

  const parts = [
    `PER=${n(f.pe, 'x')}`,
    `PBR=${n(f.pb, 'x')}`,
    `ROE=${n(f.roe, '%', 100)}`,
    `ROA=${n(f.roa, '%', 100)}`,
    `営業利益率=${n(f.operatingMargin, '%', 100)}`,
    `粗利益率=${n(f.grossMargin, '%', 100)}`,
    `売上成長=${n(f.revenueGrowth, '%', 100)}`,
    `D/E=${n(f.debtToEquity, '%', 1, 1)}`,
    f.freeCashflow != null ? `FCF=${cur}${(f.freeCashflow / 1e9).toFixed(1)}B` : null,
    f.marketCap != null ? `時価総額=${cur}${(f.marketCap / 1e9).toFixed(0)}B` : null,
    f.dividendYield != null ? `配当利回り=${(f.dividendYield * 100).toFixed(1)}%` : null,
    f.week52High != null ? `52週高値=${cur}${f.week52High.toFixed(0)}` : null,
    f.week52Low != null ? `安値=${cur}${f.week52Low.toFixed(0)}` : null,
    'fmt=2',
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

// S2(知識配線): hot path（tick）に知識ストアI/Oを足すと、2026-07-30に一度起きた
// 「無音のハング→504」を再来させうる。listKnowledge/recordKnowledgeUsageのどちらも
// このデッドラインで包み、超過・失敗時は必ずfail-open（[]/スキップ）にする。
const KNOWLEDGE_IO_TIMEOUT_MS = 2_000
// 4a: askClaude 失敗時に記録だけを保存する upsert の期限。cron の50秒枠のうち Claude の35秒を使い切った
// 後に呼ばれるため、ここで粘ると関数上限に達する。JSONB 1行（数百KB）の upsert は通常1秒未満。
const FAILED_TICK_SAVE_TIMEOUT_MS = 5_000

function withDeadline<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
    }),
  ])
}

/** listKnowledge を2秒デッドライン付きで呼ぶ。失敗・超過時は[]にフォールバックし、必ず1行warnする（無音にしない）。 */
async function loadKnowledgePoolSafely(): Promise<KnowledgeItem[]> {
  try {
    return await withDeadline(
      listKnowledge({ scope: 'global', limit: 60 }),
      KNOWLEDGE_IO_TIMEOUT_MS,
      'knowledge load',
    )
  } catch (e) {
    console.warn(`[knowledge] load skipped: ${e instanceof Error ? e.message : String(e)}`)
    return []
  }
}

/** recordKnowledgeUsage は内部で例外を握りつぶすが、ハング（応答が返らない）は救わないため
 *  ここでも独立にデッドラインを掛ける。失敗・超過時は1行warnして続行（判断・保存は止めない）。 */
async function recordKnowledgeUsageSafely(ids: string[]): Promise<void> {
  try {
    await withDeadline(recordKnowledgeUsage(ids), KNOWLEDGE_IO_TIMEOUT_MS, 'knowledge usage record')
  } catch (e) {
    console.warn(`[knowledge] usage record skipped: ${e instanceof Error ? e.message : String(e)}`)
  }
}

/** askClaude の戻り値。decisions の中身は従来と同じ。ai/decidedAt/note は 4a の記録用。 */
interface AskClaudeResult {
  decisions: AIDecision[]
  ai: TickAI
  /** AI の返事を受け取った時刻（判断の decidedAt に使う） */
  decidedAt: string
  /** 0件・一部欠落のときの補足（stage 'ai' の note に載せる）。正常時は undefined */
  note?: string
}

async function askClaude(
  session: AISession,
  stockData: StockContext[],
  knowledge: KnowledgeItem[]
): Promise<AskClaudeResult> {

  const holdingsSummary = Object.entries(session.holdings).map(([sym, pos]) => {
    const hrsSince = Math.round((Date.now() - new Date(pos.entryAt).getTime()) / 3600000)
    return `${sym}(${pos.name}): ${pos.shares.toFixed(2)}株 平均取得$${pos.avgCost.toFixed(2)} 保有${hrsSince}h`
  }).join('\n') || 'なし'

  const stocksText = stockData.map(({ symbol, quote, fundamentals, technicals, news }) => `
【${symbol}】${quote.name}
• 現在値: ${quote.price.toFixed(2)} ${quote.currency}  前日比: ${quote.change >= 0 ? '+' : ''}${quote.changePercent.toFixed(2)}%
• テクニカル: ${technicals}
• ファンダメンタル(バフェットコード): ${fmtFundamentals(fundamentals, quote.currency)}
• ニュース: ${news.length > 0 ? news.slice(0, 3).join(' / ') : 'なし'}`
  ).join('\n')

  const learningCtx = buildLearningContext(session.learning)
  const persona = getPersonaText(session.persona)

  // S2(知識配線): 0件なら空文字（formatKnowledgeBlockの契約）。ブロックが無い場合は
  // knowledgeSection自体が空文字になり、以下のテンプレートは既存(知識未接続時)と
  // バイト単位で同一の出力になる（【過去の経験・学習】ブロックの文言・順序は無改修）。
  const knowledgeBlockText = formatKnowledgeBlock(knowledge)
  const knowledgeSection = knowledgeBlockText ? `\n\n${knowledgeBlockText}` : ''
  const knowledgeTitleById = new Map(knowledge.map(k => [k.id, k.title]))
  const allowedKnowledgeIds = new Set(knowledge.map(k => k.id))

  const prompt = `${persona.roleLine}

【現在のポートフォリオ状態】
• 現金: $${session.cash.toFixed(2)} / 初期資本: $${session.capital.toFixed(2)}
• 合計資産: $${session.totalValue.toFixed(2)} (${session.pnl >= 0 ? '+' : ''}${session.pnlPct.toFixed(2)}%)
• 保有銘柄:
${holdingsSummary}

【分析対象銘柄】(ボラティリティ上位＋保有銘柄)
${stocksText}

【過去の経験・学習】
${learningCtx}${knowledgeSection}

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
    "fundSignal": "ファンダメンタル評価（1文）",
    "knowledgeRefs": ["km_xxxxxxxxxx"]
  }
]
\`\`\`

actionは "buy" | "sell" | "hold" | "watch"。buyは現金十分な場合のみ。sellは保有銘柄のみ。
knowledgeRefsは実際に依拠した【投資の原則（知識ベース）】のIDのみ。最大2件。無ければ []（体裁のために埋めない）。`

  // 4a: 失敗（タイムアウト・例外）は計測値を添えて AskClaudeError にくるむ。runTick が記録を保存してから
  // 元のエラーを再送出する。ここで握りつぶさない（従来どおり tick は失敗として扱う）。
  const askedAtMs = Date.now()
  let reply: ClaudeReply
  try {
    reply = await callClaudeDetailed(prompt)
  } catch (e) {
    throw new AskClaudeError(e, {
      model: process.env.ANTHROPIC_API_KEY ? AI_MODEL : 'cli',
      inputTokens: null,
      outputTokens: null,
      stopReason: isTimeoutError(e) ? 'timeout' : 'error',
      ms: Date.now() - askedAtMs,
      decisionsReturned: 0,
      decisionsExpected: stockData.length,
      promptChars: prompt.length,
      responseChars: null,
    })
  }
  const decidedAt = new Date().toISOString()
  const text = reply.text
  const aiBase: Omit<TickAI, 'stopReason' | 'decisionsReturned'> = {
    model: reply.model,
    inputTokens: reply.inputTokens,
    outputTokens: reply.outputTokens,
    ms: reply.ms,
    decisionsExpected: stockData.length,
    promptChars: reply.promptChars,
    responseChars: reply.responseChars,
  }
  // S4-0: 返事が max_tokens で打ち切られ閉じフェンスが無いと、旧実装（正規表現で ```json…``` を
  // 切り出し）は無マッチになり、12銘柄ぶん書けていても全部捨てて 0 件を返していた。
  // 完成している要素だけ救出し、欠落は必ず警告する（無音にしない）。
  const raw = extractDecisionArray(text) as any[]
  if (raw.length === 0) {
    console.warn('[ai-trader] 判断のJSONを1件も救出できなかった（出力の打ち切りか書式崩れ）')
    return {
      decisions: [],
      // 'empty' = 返事は来たが判断を1件も救出できなかった。元の stop_reason は note に残す。
      ai: { ...aiBase, stopReason: 'empty', decisionsReturned: 0 },
      decidedAt,
      note: `返事あり(stop=${reply.stopReason}, ${reply.responseChars}字)だが判断を1件も救出できず`,
    }
  }
  if (raw.length < stockData.length) {
    console.warn(`[ai-trader] ${stockData.length}銘柄中 ${raw.length} 件のみ救出。残りは出力の打ち切りで欠落した可能性`)
  }

  const decisions: AIDecision[] = (() => { try {
    return raw.map(r => {
      const sd = stockData.find(s => s.symbol === r.symbol)
      const f = sd?.fundamentals
      const fundStr = f ? fmtFundamentals(f, sd?.quote.currency) : '-'
      const sources = [
        'Yahoo Finance (株価・チャート)',
        'Yahoo Finance News',
        'Claude AI (分析エンジン)',
        'バフェットコード式ファンダメンタル分析',
      ]
      // 注入した知識集合(allowedKnowledgeIds)で検証してから使う。無い/不正なIDは全て捨てる。
      // 「最大2件」はプロンプト指示だけに委ねず、ここでも防御的に切る。
      const knowledgeRefs = filterKnowledgeRefs(r.knowledgeRefs, allowedKnowledgeIds)
        .slice(0, 2)
        .map(id => ({ id, title: knowledgeTitleById.get(id) ?? id }))
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
        knowledgeRefs,
      } satisfies AIDecision
    })
  } catch {
    return []
  } })()

  // 記録: 救出できた件数は最終的な decisions の件数（上の map が落ちて [] になった場合も含む）。
  const returned = decisions.length
  const partial = returned < stockData.length
  return {
    decisions,
    ai: { ...aiBase, stopReason: returned === 0 ? 'empty' : reply.stopReason, decisionsReturned: returned },
    decidedAt,
    note: returned === 0
      ? `返事あり(stop=${reply.stopReason})だが判断の組み立てに失敗`
      : partial ? `${stockData.length}銘柄中 ${returned} 件のみ救出 (stop=${reply.stopReason})` : undefined,
  }
}

/** 学習1回ぶんの生成結果。cron/learn 経路（learn.ts）がマージして永続化する。 */
export interface FullLearning {
  lessons: string[]
  fundamentalInsights: string[]
  newsInsights: string[]
  causalChains: string[]
  tradingBiases: string[]
  strategyNotes: string[]
}

export async function generateFullLearning(memory: LearningMemory, session: AISession): Promise<FullLearning> {
  const empty: FullLearning = {
    lessons: [], fundamentalInsights: [], newsInsights: [],
    causalChains: [], tradingBiases: [], strategyNotes: [],
  }
  // クローズした取引が無くても、保有中ポジションの含み損益と過去の判断（＝予想）から学ぶ
  // （2026-07-31変更）。中長期保有では手仕舞いが滅多に起きず、クローズ必須にすると
  // 学習が永久に始まらないうえ、短期決済の記録だけが教訓化されて方針が短期売買へ偏る。
  if (memory.closedTrades.length === 0 && memory.allDecisions.length === 0) return empty

  const closedText = memory.closedTrades.length === 0
    ? 'まだ手仕舞いした取引はない（未確定の保有で判断すること）'
    : memory.closedTrades.slice(0, 15).map(t =>
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

  // learn.ts（runLearnTick）経由ではsession全体の正規化を通らず、learning以外の
  // フィールドが欠けた旧フォーマットのまま渡されうる（runTickの`!session.decisions`等の
  // 補完は通らない）。3ファイルをまたぐ暗黙の不変条件に頼らず、ここでもローカルに防御する。
  const sessionDecisions = session.decisions ?? []
  const sessionHoldings  = session.holdings ?? {}

  // 保有中ポジションの含み損益＝「まだ手仕舞いしていない予想の途中経過」。
  // 現在値はネットワークを叩かず、直近の判断ログ（AIDecision.price）から引く。
  const latestPrice = new Map<string, number>()
  for (const d of sessionDecisions) {
    if (!latestPrice.has(d.symbol)) latestPrice.set(d.symbol, d.price)
  }
  // 保有件数はexecuteTradesのbuyゲート（holdingCount < 5）により実質最大5件に収まっているが、
  // それはこの関数の外側にある別の不変条件でしかない。将来そのゲートが変わっても
  // プロンプトが静かに肥大しJSON途中切れ/タイムアウトを招かないよう、ここでも独立に上限を掛ける
  // （closedText/decisionTextと同じ「防御的スライス」の考え方に揃えた）。
  const openText = Object.entries(sessionHoldings).slice(0, 10).map(([sym, pos]) => {
    const px = latestPrice.get(sym)
    // price===0は「実データ取得不可」のセンチネル（askClaudeのprice: sd?.quote.price ?? 0、
    // 買いガードのdec.price <= 0と同じ約束事）。よってここのtruthy判定で価格0を「不明」扱いに
    // するのは意図どおり（px !== undefinedに変えると価格0で誤った-100%等の含み損益が出る）。
    const pnl = px ? ((px - pos.avgCost) / pos.avgCost) * 100 : null
    const hrs = Math.round((Date.now() - new Date(pos.entryAt).getTime()) / 3600000)
    const pnlStr = pnl === null ? '含み損益不明' : `${pnl >= 0 ? '+' : ''}${pnl.toFixed(1)}%`
    return `[保有中] ${sym}(${pos.name}) ${pnlStr} | 保有${hrs}h | 平均取得$${pos.avgCost.toFixed(2)}
  エントリー理由: ${pos.entryReasoning}
  エントリー時テクニカル: ${pos.entryTechnicals}
  エントリー時ファンダ: ${pos.entryFundamentals}`
  }).join('\n\n') || 'なし'

  const portfolioStatus = `総資産: $${session.totalValue.toFixed(0)} | 損益: ${session.pnlPct >= 0 ? '+' : ''}${session.pnlPct.toFixed(2)}% | 現金比率: ${((session.cash / session.totalValue) * 100).toFixed(0)}% | Tick数: ${session.tickCount}`

  const existingBiases = memory.tradingBiases.slice(0, 3).map(b => `• ${b}`).join('\n') || 'なし'

  const prompt = `あなたはAI投資エージェントの「内省・学習システム」です。以下のデータを分析し、次回の売買判断を改善するための学習を行ってください。

【ポートフォリオ現状】
${portfolioStatus}

【クローズ済み取引（詳細）】
${closedText}

【保有中ポジション（＝まだ答え合わせが済んでいない予想の途中経過）】
${openText}

【全判断ログ（直近30件）】
${decisionText}

【既知の癖・バイアス】
${existingBiases}

【学習にあたっての注意】
- 手仕舞い済みの取引が少ない、または無い場合は、保有中ポジションの含み損益と判断ログ（＝予想）を材料に振り返ること。「クローズしていないから学べない」は誤り。
- 手仕舞い実績が少数のとき、その少数から「短期利確が常に正しい」と一般化しないこと。たまたま短期決済しか記録が無いだけで、中長期保有の成否はまだ判定されていない。サンプル数が少ない教訓には、その旨を明記すること。
- 含み損を抱えた保有については「エントリー時の根拠が今も成立しているか」を問い直すこと。含み益の銘柄だけを見て成功パターンを結論づけない。
- 教訓は保有期間の前提（数時間なのか数か月なのか）を明示すること。前提を書かない教訓は、時間軸の異なる判断に誤用される。

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
    const text = await callClaude(prompt, {
      maxTokens: LEARN_MAX_TOKENS,
      timeoutMs: CLAUDE_LEARN_TIMEOUT_MS,
    })
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
  // 4a: 過程の記録。開始時刻は関数の入口（セッション読み込みも含む）。各段は Date.now() で挟んで
  // stages に積む。組み立ては計算だけで、記録のための外部呼び出しは一切足していない（cron の50秒枠）。
  const startedAtMs = Date.now()
  const record = emptyTickRecord(startedAtMs)

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

  // 失敗 tick（askClaude が投げた場合）は、この2つを tick 前の値に戻してから記録だけを保存する。
  // 従来は失敗時に何も保存されなかったので、「失敗 tick が変えるのは ticks だけ」を保つため。
  const prevWatchlist = session.watchlist
  const prevKnowledgeShown = session.knowledgeShown

  // 4件: プロンプトと出力トークンを削り、判断1回をCLAUDE_TIMEOUT_MS内に収めるため（2026-07-30）。
  // combined = 候補 + 保有銘柄 なので、保有が増えると実際の分析対象はこれより多くなる。
  const candStartMs = Date.now()
  const { candidates, universe } = await selectCandidates(TICK_CANDIDATE_COUNT)
  const combined = Array.from(new Set([...candidates, ...Object.keys(session.holdings)]))
  session.watchlist = combined
  {
    const okRows = universe.filter(r => r.ok).length
    record.universe = universe
    record.selected = candidates
    record.heldAdded = combined.filter(s => !candidates.includes(s))
    record.stages.push(makeStage('candidates', candStartMs, Date.now(), candidates.length > 0,
      `${okRows}/${universe.length}銘柄の株価を取得・候補${candidates.length}件・保有から${record.heldAdded.length}件`))
  }

  // 銘柄ごとの材料集め。失敗した銘柄は従来どおり分析対象から外す（記録には error 付きの行を残す）。
  const ctxStartMs = Date.now()
  const settled = await Promise.allSettled(combined.map(sym => buildStockContext(sym)))
  const enriched: StockContext[] = []
  for (let i = 0; i < combined.length; i++) {
    const r = settled[i]
    if (r.status === 'fulfilled') {
      enriched.push(r.value)
      record.contexts.push(toTickContext(r.value))
    } else {
      record.contexts.push(failedTickContext(combined[i], r.reason))
    }
  }
  record.stages.push(makeStage('contexts', ctxStartMs, Date.now(), enriched.length > 0,
    `${enriched.length}/${combined.length}銘柄の材料を取得`))

  // S2(知識配線): knowledge_items未設定/未実行・タイムアウト時は[]にフォールバックする
  // （loadKnowledgePoolSafely内部でfail-open・1行warn）。selectKnowledgeForDecisionは
  // 純関数なので空プールなら[]を返し、formatKnowledgeBlockも空文字を返すため、
  // askClaudeへ渡すプロンプトは知識未接続時と完全に同一の挙動になる。
  const knStartMs = Date.now()
  const knowledgePool = await loadKnowledgePoolSafely()
  const selectedKnowledge = selectKnowledgeForDecision(knowledgePool, {
    persona: session.persona,
    symbols: combined,
  })
  session.knowledgeShown = selectedKnowledge.map(k => ({ id: k.id, title: k.title, kind: k.kind }))
  record.knowledge = selectedKnowledge.map(k => ({ id: k.id, title: k.title }))
  // 読み込み失敗は loadKnowledgePoolSafely の中で [] に畳まれ、ここからは「0件」としか見えない
  // （ok は段が完了したことだけを表す。失敗と0件の区別は本スライスでは付けない）。
  record.stages.push(makeStage('knowledge', knStartMs, Date.now(), true,
    `${knowledgePool.length}件から${selectedKnowledge.length}件を提示`))

  // AI に聞く。失敗（タイムアウト・例外）は stopReason 付きで記録を保存してから元のエラーを再送出する。
  // tickCount・equityHistory・decisions は進めない（今までの数え方のまま）。
  const aiStartMs = Date.now()
  let asked: AskClaudeResult
  try {
    asked = await askClaude(session, enriched, selectedKnowledge)
  } catch (e) {
    const original = e instanceof AskClaudeError ? e.original : e
    const msg = (original instanceof Error ? original.message : String(original)).slice(0, 200)
    record.ai = e instanceof AskClaudeError ? e.ai : {
      model: process.env.ANTHROPIC_API_KEY ? AI_MODEL : 'cli',
      inputTokens: null, outputTokens: null,
      stopReason: isTimeoutError(original) ? 'timeout' : 'error',
      ms: Date.now() - aiStartMs,
      decisionsReturned: 0, decisionsExpected: enriched.length,
      // プロンプトを組み立てる前に落ちた経路。文字数は不明なので null（0 で埋めない・原則9）。
      promptChars: null, responseChars: null,
    }
    record.stages.push(makeStage('ai', aiStartMs, Date.now(), false, msg))
    record.finishedAt = new Date().toISOString()
    session.watchlist = prevWatchlist
    session.knowledgeShown = prevKnowledgeShown
    session.ticks = pushTick(session.ticks, record)
    // 35秒のタイムアウト後に Supabase まで固まると関数上限（60秒）まで延びるため、記録の保存には期限を掛ける。
    // 超過・失敗は1行 warn して元のエラーを優先する（成功経路の upsertSession は従来どおり無期限）。
    try {
      await withDeadline(upsertSession(session), FAILED_TICK_SAVE_TIMEOUT_MS, 'failed tick save')
    } catch (saveErr) {
      console.warn(`[ai-trader] 失敗 tick の記録を保存できなかった: ${saveErr instanceof Error ? saveErr.message : String(saveErr)}`)
    }
    throw original
  }
  const { decisions, ai, decidedAt } = asked
  record.ai = ai
  record.stages.push(makeStage('ai', aiStartMs, Date.now(), decisions.length > 0, asked.note))
  for (const d of decisions) {
    d.tickId = record.id
    d.decidedAt = decidedAt
  }
  record.decisionIds = decisions.map(d => decisionIdFor(d.symbol, decidedAt))
  session.decisions = [...decisions, ...session.decisions].slice(0, 50)

  const tradeStartMs = Date.now()

  // 「提示」(knowledgeShown・上で記録済み)と「引用」(recordKnowledgeUsageで加算)を分離する。
  // 実際にAIが依拠したと申告し、注入集合での検証を通ったIDが1件以上あるときだけ加算する
  // （提示しただけを使用したと偽らない）。
  const usedKnowledgeIds = Array.from(
    new Set(decisions.flatMap(d => (d.knowledgeRefs ?? []).map(r => r.id)))
  )
  if (usedKnowledgeIds.length > 0) {
    await recordKnowledgeUsageSafely(usedKnowledgeIds)
  }

  const newTrades = executeTrades(session, decisions)
  session.trades = [...newTrades, ...session.trades].slice(0, 200)

  // 評価額の株価取得に失敗した銘柄は従来どおり取得単価で代用する（挙動は不変）。件数だけ記録の note に残す。
  let valuationFallbacks = 0
  const holdingValues = await Promise.all(
    Object.entries(session.holdings).map(async ([sym, pos]) => {
      try {
        const q = await getQuote(sym)
        return pos.shares * q.price
      } catch {
        valuationFallbacks++
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

  // 学習生成(2回目のClaude呼び出し)は 2026-07-31 に `lib/ai-trader/learn.ts` ＋
  // `/api/cron/learn` へ切り出した。tick内に置くと、売買判断が終わった後に学習が
  // cron側のTIME_BUDGET_MS(50秒)を食い潰し、(a)応答が`reason:"timeout"`と誤報される、
  // (b)最終upsertSessionが学習の後ろにあるため売買結果の保存まで道連れになる、
  // という2つの問題が起きていた（実際 tickCount=10 の回で発生）。
  // tickは「売買判断1回だけ」に保ち、学習は専用cronの独立した60秒枠で回す。

  // 4a: 'trade' 段は AI の返事を受けてから保存の直前まで（知識の使用記録・約定・評価額・指標更新）。
  // 'save' 段は保存そのものなので、この記録の中には所要を書けない（finishedAt が保存直前の時刻）。
  record.stages.push(makeStage('trade', tradeStartMs, Date.now(), true,
    `約定${newTrades.length}件` + (valuationFallbacks > 0 ? `・評価額の株価取得に失敗${valuationFallbacks}銘柄（取得単価で代用）` : '')))
  record.finishedAt = new Date().toISOString()
  session.ticks = pushTick(session.ticks, record)

  // runTickで読み込んだセッションは、変更の有無に関わらず最後に必ず明示保存する。
  await upsertSession(session)
  return session
}
