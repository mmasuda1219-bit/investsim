import { NextResponse } from 'next/server'
import { runScreener, type ScreenerFilters } from '@/lib/screener'

export async function POST(req: Request) {
  try {
    const body = await req.json()
    const filters: ScreenerFilters = {
      maxPer:           body.maxPer,
      maxPbr:           body.maxPbr,
      minRoe:           body.minRoe,
      maxDebtToEquity:  body.maxDebtToEquity,
      minMarketCap:     body.minMarketCap,
      minRevenueGrowth: body.minRevenueGrowth,
      investorBuy:      body.investorBuy,
    }
    const results = await runScreener(filters)
    return NextResponse.json({ results, count: results.length })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Screener error'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
