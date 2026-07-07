import { NextResponse } from 'next/server'
import { getQuote, getHistory, getFundamentals } from '@/lib/market'
import investors from '@/lib/investors'
import type { Signal } from '@/types'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()

  try {
    const [quote, history, fundamentals] = await Promise.all([
      getQuote(symbol),
      getHistory(symbol, '1y'),
      getFundamentals(symbol),
    ])

    const signals: Record<string, Signal> = {}
    for (const investor of investors) {
      signals[investor.id] = investor.analyze({ quote, history, fundamentals })
    }

    return NextResponse.json({ symbol, signals }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compute signals'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
