import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/ai-trader/engine'
import { getHistory } from '@/lib/market'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; symbol: string }> }
) {
  const { id, symbol } = await params
  const session = getSession(id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  try {
    const history = await getHistory(symbol, '3mo')

    const trades = session.trades
      .filter(t => t.symbol === symbol)
      .map(t => {
        const tSec = Math.floor(new Date(t.timestamp).getTime() / 1000)
        let closest = history[0]
        let minDiff = Infinity
        for (const bar of history) {
          const diff = Math.abs(bar.time - tSec)
          if (diff < minDiff) { minDiff = diff; closest = bar }
        }
        return {
          time:      closest?.time ?? tSec,
          action:    t.action,
          price:     t.price,
          shares:    t.shares,
          total:     t.total,
          reason:    t.reason,
          timestamp: t.timestamp,
        }
      })

    return NextResponse.json({ history, trades })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Failed to fetch chart'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
