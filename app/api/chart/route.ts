import { NextRequest, NextResponse } from 'next/server'

// eslint-disable-next-line @typescript-eslint/no-require-imports
const YahooFinanceClass = require('yahoo-finance2').default

const yf = new YahooFinanceClass({ validation: { logErrors: false } })

interface YFQuote {
  date: Date
  open: number | null
  high: number | null
  low: number | null
  close: number | null
  volume: number | null
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const symbol = searchParams.get('symbol') || 'AAPL'
  const period = searchParams.get('period') || '5y'

  const years: Record<string, number> = { '1y': 1, '3y': 3, '5y': 5, '10y': 10 }
  const from = new Date()
  from.setFullYear(from.getFullYear() - (years[period] ?? 5))

  try {
    const result = await yf.chart(symbol, {
      period1: from.toISOString().split('T')[0],
      period2: new Date().toISOString().split('T')[0],
      interval: '1d',
    })

    const quotes = (result.quotes as YFQuote[])
      .filter((q) => q.open !== null && q.close !== null)
      .map((q) => ({
        time: Math.floor(new Date(q.date).getTime() / 1000),
        open: Number((q.open ?? 0).toFixed(2)),
        high: Number((q.high ?? 0).toFixed(2)),
        low: Number((q.low ?? 0).toFixed(2)),
        close: Number((q.close ?? 0).toFixed(2)),
        volume: q.volume ?? 0,
      }))
      .sort((a, b) => a.time - b.time)

    return NextResponse.json({ symbol, quotes })
  } catch (err) {
    return NextResponse.json(
      { error: `Failed to fetch data for ${symbol}`, detail: String(err) },
      { status: 500 }
    )
  }
}
