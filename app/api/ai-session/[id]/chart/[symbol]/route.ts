import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/ai-trader/engine'
import { getHistory } from '@/lib/market'

// A trade is drawn on the chart only if a real bar exists within this window.
// Trades older than the fetched range would otherwise snap onto the oldest bar
// at a false position (review W2).
const MAX_SNAP_SEC = 3 * 24 * 60 * 60

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; symbol: string }> }
) {
  const { id, symbol } = await params
  const session = await getSession(id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  try {
    // 原則9: never draw markers / P&L on top of synthetic bars. If every real
    // provider fails, surface a 5xx so the client shows its error state.
    const history = await getHistory(symbol, '6mo', { allowMock: false })

    let outOfRangeTrades = 0
    const trades: Array<{
      time: number
      action: string
      price: number
      shares: number
      total: number
      reason: string
      timestamp: string
    }> = []

    for (const t of session.trades) {
      if (t.symbol !== symbol) continue
      const tSec = Math.floor(new Date(t.timestamp).getTime() / 1000)
      let closest = history[0]
      let minDiff = Infinity
      for (const bar of history) {
        const diff = Math.abs(bar.time - tSec)
        if (diff < minDiff) { minDiff = diff; closest = bar }
      }
      if (!closest || minDiff > MAX_SNAP_SEC) {
        outOfRangeTrades++
        continue
      }
      trades.push({
        time:      closest.time,
        action:    t.action,
        price:     t.price,
        shares:    t.shares,
        total:     t.total,
        reason:    t.reason,
        timestamp: t.timestamp,
      })
    }

    return NextResponse.json({ history, trades, outOfRangeTrades })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch chart'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
