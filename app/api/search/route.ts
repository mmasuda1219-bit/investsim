import { NextResponse } from 'next/server'
import { searchStocks } from '@/lib/market'
import { searchUniverse } from '@/lib/market/universe'
import type { SearchResult } from '@/types'

const LIMIT = 12

// GET /api/search?q=... — 銘柄検索。
//
// 一次ソースはローカルのユニバース（data/universe.json・約5,500銘柄）。
// ネットワークを介さないので即時に返り、Yahoo が Vercel の IP を 429 で
// 弾いている間も «検索できない» にはならない。
// Yahoo の検索は二次で、ユニバース生成後に上場した銘柄や日本株（.T）を拾うために残す。
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)
  const q = searchParams.get('q')?.trim()
  if (!q) return NextResponse.json([])

  const seen = new Set<string>()
  const results: SearchResult[] = []
  const push = (r: SearchResult) => {
    if (seen.has(r.symbol) || results.length >= LIMIT) return
    seen.add(r.symbol)
    results.push(r)
  }

  for (const s of searchUniverse(q, LIMIT)) {
    push({ symbol: s.symbol, name: s.name, type: 'EQUITY', market: 'US' })
  }

  // ユニバースだけで埋まったなら外部呼び出しは省く（検索1回ごとに Yahoo を叩かない）。
  if (results.length < LIMIT) {
    try {
      for (const s of await searchStocks(q)) push(s)
    } catch {
      // 二次ソースの失敗で検索全体を落とさない。一次ソースの結果はそのまま返す。
    }
  }

  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600' },
  })
}
