// ── Closed trade record ───────────────────────────────────────────────────
export interface ClosedTrade {
  id: string
  symbol: string
  name: string
  entryPrice: number
  exitPrice: number
  shares: number
  entryAt: string
  exitAt: string
  pnl: number
  pnlPct: number
  holdingHours: number
  entryReasoning: string
  technicals: string
  fundamentals: string
  newsAtEntry: string[]       // news headlines at time of entry
  exitReasoning: string       // why the AI sold
  outcome: 'profit' | 'loss'
}

// ── Decision record — every decision per tick ─────────────────────────────
export interface DecisionRecord {
  id: string
  timestamp: string
  symbol: string
  action: 'buy' | 'sell' | 'hold' | 'watch'
  price: number
  confidence: 'high' | 'medium' | 'low'
  reasoning: string
  technicals: string
  fundamentals: string
  newsHeadlines: string[]
}

// ── Enhanced learning memory ──────────────────────────────────────────────
export interface LearningMemory {
  // Trade outcomes
  closedTrades: ClosedTrade[]
  // Every decision ever made (buy/sell/hold/watch)
  allDecisions: DecisionRecord[]
  // Claude-generated insights
  lessons: string[]                // general lessons from trade outcomes
  fundamentalInsights: string[]    // which fundamentals actually predicted outcomes
  newsInsights: string[]           // news patterns and what they led to
  causalChains: string[]           // macro→sector→stock chain reasoning
  tradingBiases: string[]          // identified systematic biases/habits
  strategyNotes: string[]          // strategic adjustments for next period
  // Tracking
  lastLearnTickCount: number
  patterns: string[]               // legacy compat
  // Stats
  stats: {
    totalTrades: number
    wins: number
    losses: number
    winRate: number
    avgGainPct: number
    avgLossPct: number
    totalPnl: number
    bestTrade: ClosedTrade | null
    worstTrade: ClosedTrade | null
  }
}

export function createLearningMemory(): LearningMemory {
  return {
    closedTrades: [],
    allDecisions: [],
    lessons: [],
    fundamentalInsights: [],
    newsInsights: [],
    causalChains: [],
    tradingBiases: [],
    strategyNotes: [],
    lastLearnTickCount: 0,
    patterns: [],
    stats: {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      avgGainPct: 0, avgLossPct: 0, totalPnl: 0,
      bestTrade: null, worstTrade: null,
    },
  }
}

// 旧フォーマットで永続化されたセッションは learning の入れ子フィールド
// （fundamentalInsights / newsInsights / causalChains / tradingBiases /
//  strategyNotes / allDecisions 等）を欠くことがある。createLearningMemory() の
// デフォルトで欠損分を補完し、buildLearningContext などの .length / .slice を安全にする。
export function normalizeLearningMemory(
  m: Partial<LearningMemory> | undefined | null,
): LearningMemory {
  const base = createLearningMemory()
  if (!m) return base
  return {
    ...base,
    ...m,
    stats: { ...base.stats, ...(m.stats ?? {}) },
  }
}

// ── Record a closed trade ─────────────────────────────────────────────────
export function recordClosedTrade(
  memory: LearningMemory,
  trade: Omit<ClosedTrade, 'id' | 'outcome'>
): void {
  const outcome: ClosedTrade['outcome'] = trade.pnl >= 0 ? 'profit' : 'loss'
  const closed: ClosedTrade = {
    ...trade,
    id: `ct_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    outcome,
  }
  memory.closedTrades.unshift(closed)
  if (memory.closedTrades.length > 200) memory.closedTrades.pop()
  recomputeStats(memory)
}

// ── Record a decision (every tick, every symbol) ──────────────────────────
export function recordDecisions(
  memory: LearningMemory,
  decisions: DecisionRecord[]
): void {
  memory.allDecisions.unshift(...decisions)
  // Keep last 500 decisions
  if (memory.allDecisions.length > 500) {
    memory.allDecisions = memory.allDecisions.slice(0, 500)
  }
}

function recomputeStats(memory: LearningMemory): void {
  const trades = memory.closedTrades
  if (trades.length === 0) return

  const wins   = trades.filter(t => t.outcome === 'profit')
  const losses = trades.filter(t => t.outcome === 'loss')

  const avgGain = wins.length > 0
    ? wins.reduce((s, t) => s + t.pnlPct, 0) / wins.length : 0
  const avgLoss = losses.length > 0
    ? losses.reduce((s, t) => s + t.pnlPct, 0) / losses.length : 0

  let best = trades[0]; let worst = trades[0]
  for (const t of trades) {
    if (t.pnlPct > best.pnlPct) best = t
    if (t.pnlPct < worst.pnlPct) worst = t
  }

  memory.stats = {
    totalTrades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: parseFloat(((wins.length / trades.length) * 100).toFixed(1)),
    avgGainPct: parseFloat(avgGain.toFixed(2)),
    avgLossPct: parseFloat(avgLoss.toFixed(2)),
    totalPnl: parseFloat(trades.reduce((s, t) => s + t.pnl, 0).toFixed(2)),
    bestTrade: best,
    worstTrade: worst,
  }
}

// ── Build rich learning context for Claude prompt ─────────────────────────
export function buildLearningContext(memory: LearningMemory): string {
  const hasAnyData =
    memory.closedTrades.length > 0 ||
    memory.lessons.length > 0 ||
    memory.allDecisions.length > 0

  if (!hasAnyData) return '（まだ学習データなし — 取引を重ねるほど精度が上がります）'

  const parts: string[] = []

  // 1. General lessons
  if (memory.lessons.length > 0) {
    parts.push('■ 蒸留教訓（過去取引から学んだ最重要ルール）\n'
      + memory.lessons.slice(0, 10).map(l => `• ${l}`).join('\n'))
  }

  // 2. Fundamental insights
  if (memory.fundamentalInsights.length > 0) {
    parts.push('■ ファンダメンタル洞察（実際に効いた指標）\n'
      + memory.fundamentalInsights.slice(0, 6).map(l => `• ${l}`).join('\n'))
  }

  // 3. News patterns
  if (memory.newsInsights.length > 0) {
    parts.push('■ ニュースパターン（読み方と結果の相関）\n'
      + memory.newsInsights.slice(0, 6).map(l => `• ${l}`).join('\n'))
  }

  // 4. Causal chains
  if (memory.causalChains.length > 0) {
    parts.push('■ 連想チェーン（マクロ→セクター→銘柄の因果）\n'
      + memory.causalChains.slice(0, 5).map(l => `• ${l}`).join('\n'))
  }

  // 5. Trading biases
  if (memory.tradingBiases.length > 0) {
    parts.push('■ 自分の取引の癖・バイアス（積極的に修正すべき点）\n'
      + memory.tradingBiases.slice(0, 5).map(l => `• ${l}`).join('\n'))
  }

  // 6. Strategy notes
  if (memory.strategyNotes.length > 0) {
    parts.push('■ 戦略レビュー（直近の方針調整）\n'
      + memory.strategyNotes.slice(0, 4).map(l => `• ${l}`).join('\n'))
  }

  // 7. Performance stats
  const { winRate, avgGainPct, avgLossPct, totalTrades, bestTrade, worstTrade } = memory.stats
  if (totalTrades > 0) {
    const statsLine = `■ パフォーマンス統計\n• 勝率${winRate}% | 平均利益${avgGainPct >= 0 ? '+' : ''}${avgGainPct}% | 平均損失${avgLossPct.toFixed(2)}% | クローズ取引${totalTrades}件`
    const best  = bestTrade  ? `| 最良: ${bestTrade.symbol} +${bestTrade.pnlPct.toFixed(1)}%` : ''
    const worst = worstTrade && worstTrade.id !== bestTrade?.id
      ? `| 最悪: ${worstTrade.symbol} ${worstTrade.pnlPct.toFixed(1)}%` : ''
    parts.push(`${statsLine} ${best} ${worst}`)
  }

  // 8. Recent closed trades (raw signal for pattern detection)
  const recent = memory.closedTrades.slice(0, 8)
  if (recent.length > 0) {
    const lines = recent.map(t =>
      `${t.outcome === 'profit' ? '✓' : '✗'} ${t.symbol} ${t.pnlPct >= 0 ? '+' : ''}${t.pnlPct.toFixed(1)}% 保有${t.holdingHours}h | 理由:${(t.entryReasoning ?? '').slice(0, 50)} | 売:${(t.exitReasoning ?? '').slice(0, 40)}`
    )
    parts.push('■ 直近クローズ取引（生データ）\n' + lines.join('\n'))
  }

  // 9. Recent decision patterns (what was watched/held and why)
  const recentDecisions = memory.allDecisions.slice(0, 20)
  const watchHold = recentDecisions.filter(d => d.action === 'watch' || d.action === 'hold')
  if (watchHold.length > 0) {
    const lines = watchHold.slice(0, 5).map(d =>
      `${d.action.toUpperCase()} ${d.symbol} @${d.price.toFixed(0)} | ${(d.reasoning ?? '').slice(0, 60)}`
    )
    parts.push('■ 直近の監視・ホールド判断（見送った銘柄の追跡用）\n' + lines.join('\n'))
  }

  return parts.join('\n\n')
}

// ── Distilled-lesson usage summary (pure, for /report honest display) ─────
// Extracts the distilled lessons EXACTLY as buildLearningContext() above
// selects them (same categories, same slice limits: lessons 10 / fundamental 6
// / news 6 / causal 5 / biases 5 / strategy 4). The /report learningUsage
// population must equal what the prompt actually receives (原則9 — never show
// unused lessons as "used"). Keep the limits in sync with buildLearningContext.
export interface DistilledLessonsSummary {
  /** Whether ANY distilled lesson exists (raw trades/decisions excluded). */
  hasData: boolean
  /** Total number of lesson items that reach the prompt. */
  count: number
  /** The lesson texts (category-prefixed), in prompt order. */
  items: string[]
}

export function summarizeDistilledLessons(memory: LearningMemory): DistilledLessonsSummary {
  // Same entry gate as buildLearningContext's hasAnyData (closedTrades /
  // lessons / allDecisions — insights alone do NOT open it). When the gate is
  // closed, buildLearningContext returns only a placeholder string, so any
  // insight-only memory (migration/corruption edge case) must report hasData:
  // false here too — otherwise we'd claim lessons as "used" that never reached
  // the prompt (原則9). Keep this condition in sync with buildLearningContext.
  const gateOpen =
    memory.closedTrades.length > 0 ||
    memory.lessons.length > 0 ||
    memory.allDecisions.length > 0
  if (!gateOpen) return { hasData: false, count: 0, items: [] }

  const items = [
    ...memory.lessons.slice(0, 10).map(l => `教訓: ${l}`),
    ...memory.fundamentalInsights.slice(0, 6).map(l => `ファンダ洞察: ${l}`),
    ...memory.newsInsights.slice(0, 6).map(l => `ニュースパターン: ${l}`),
    ...memory.causalChains.slice(0, 5).map(l => `連想チェーン: ${l}`),
    ...memory.tradingBiases.slice(0, 5).map(l => `取引バイアス: ${l}`),
    ...memory.strategyNotes.slice(0, 4).map(l => `戦略ノート: ${l}`),
  ]
  return { hasData: items.length > 0, count: items.length, items }
}

// ── Trigger learning generation every tick if data exists ─────────────────
export function shouldLearnNow(memory: LearningMemory, currentTickCount: number): boolean {
  // Generate learning every tick as long as there's any closed trade
  if (memory.closedTrades.length === 0) return false
  // But throttle: don't regenerate if we just did it this tick
  return currentTickCount > memory.lastLearnTickCount
}
