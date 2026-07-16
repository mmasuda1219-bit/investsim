// AI-trader track-record collection for /report (R1).
//
// READ-ONLY over lib/ai-trader/store (all sessions, Supabase or local file).
// Aggregates the AI trader's own virtual trading history on the report's
// symbol into structured evidence for the Opus prompt: closed trades
// (entry/exit price, pnlPct, holding time, reasoning), recent decisions and
// lessons that mention the symbol. Everything here is REAL recorded activity
// of the AI sessions — nothing is synthesized (原則9).

import { listSessions } from '@/lib/ai-trader/store'
import { normalizeLearningMemory } from '@/lib/ai-trader/memory'
import type { ClosedTrade, DecisionRecord } from '@/lib/ai-trader/memory'
import type { AiTraderEvidence, AiTraderRecentTrade } from './types'

const MAX_RECENT_TRADES = 8
const MAX_LESSONS = 6
const MAX_DECISIONS = 6

export function emptyEvidence(): AiTraderEvidence {
  return {
    hasData: false,
    tradeCount: 0,
    winRate: 0,
    avgPnlPct: 0,
    recentTrades: [],
    relevantLessons: [],
    decisionsSummary: '',
  }
}

function toRecentTrade(t: ClosedTrade): AiTraderRecentTrade {
  return {
    entryAt: t.entryAt,
    exitAt: t.exitAt,
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    pnlPct: t.pnlPct,
    holdingHours: t.holdingHours,
    entryReasoning: (t.entryReasoning ?? '').slice(0, 120),
    exitReasoning: (t.exitReasoning ?? '').slice(0, 120),
    outcome: t.outcome,
  }
}

function fmtDecision(d: DecisionRecord): string {
  const when = (d.timestamp ?? '').slice(0, 10)
  return `${when} ${d.action.toUpperCase()} @${d.price.toFixed(2)}（確信度:${d.confidence}） ${(d.reasoning ?? '').slice(0, 90)}`
}

/**
 * Collect the AI trader's structured evidence for ONE symbol across ALL
 * sessions. Returns hasData:false (never throws) when there are no sessions,
 * no activity on the symbol, or the store read fails.
 */
export async function collectAiTraderEvidence(symbol: string): Promise<AiTraderEvidence> {
  try {
    const sessions = await listSessions() // newest-first
    if (sessions.length === 0) return emptyEvidence()

    const closed: ClosedTrade[] = []
    const decisions: DecisionRecord[] = []
    const lessons: string[] = []

    for (const session of sessions) {
      const mem = normalizeLearningMemory(session.learning)
      for (const t of mem.closedTrades) {
        if (t.symbol === symbol) closed.push(t)
      }
      for (const d of mem.allDecisions) {
        if (d.symbol === symbol) decisions.push(d)
      }
      // Lessons/insights are free text — keep only ones naming this symbol.
      const pools = [
        mem.lessons, mem.fundamentalInsights, mem.newsInsights,
        mem.causalChains, mem.tradingBiases, mem.strategyNotes,
      ]
      for (const pool of pools) {
        for (const line of pool) {
          if (typeof line === 'string' && line.includes(symbol)) lessons.push(line)
        }
      }
    }

    if (closed.length === 0 && decisions.length === 0 && lessons.length === 0) {
      return emptyEvidence()
    }

    // Newest-first within each session already; order across sessions by exitAt.
    closed.sort((a, b) => (b.exitAt ?? '').localeCompare(a.exitAt ?? ''))
    decisions.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? ''))

    const wins = closed.filter((t) => t.outcome === 'profit').length
    const winRate = closed.length > 0
      ? parseFloat(((wins / closed.length) * 100).toFixed(1))
      : 0
    const avgPnlPct = closed.length > 0
      ? parseFloat((closed.reduce((s, t) => s + t.pnlPct, 0) / closed.length).toFixed(2))
      : 0

    const uniqueLessons = Array.from(new Set(lessons)).slice(0, MAX_LESSONS)
    const decisionsSummary = decisions.slice(0, MAX_DECISIONS).map(fmtDecision).join('\n')

    return {
      hasData: true,
      tradeCount: closed.length,
      winRate,
      avgPnlPct,
      recentTrades: closed.slice(0, MAX_RECENT_TRADES).map(toRecentTrade),
      relevantLessons: uniqueLessons,
      decisionsSummary,
    }
  } catch {
    // Store unavailable — evidence is optional enrichment, never a hard failure.
    return emptyEvidence()
  }
}
