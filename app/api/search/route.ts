import { NextResponse } from 'next/server'
import { searchStocks } from '@/lib/market'

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()

  if (!q || q.length < 1) {
    return NextResponse.json([])
  }

  try {
    const results = await searchStocks(q)
    return NextResponse.json(results)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Search failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
