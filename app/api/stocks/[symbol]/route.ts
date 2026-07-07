import { NextResponse } from 'next/server'
import { getQuote } from '@/lib/market'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  try {
    const { symbol } = await params
    const quote = await getQuote(symbol.toUpperCase())
    return NextResponse.json(quote, {
      headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch quote'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
