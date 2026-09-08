import { NextResponse } from 'next/server'
import { UNIVERSE_META, topByMarketCap, filterUniverse } from '@/lib/market/universe'

// GET /api/universe — 取引できる銘柄一覧の «入口»。
//
//   ?top=N          時価総額の大きい順に N 件（既定30・上限200）
//   ?minMarketCap=  時価総額の下限（USD）で絞る
//
// 全件（約5,500件）をそのまま返す口はあえて用意しない。画面に5,500件を並べても
// 選べないし、クライアントに1MBのJSONを送る意味がない。「多くを扱えること」は
// 検索（/api/search）で担保し、一覧は常に «上位N件» に留める。
export const runtime = 'nodejs'

const DEFAULT_TOP = 30
const MAX_TOP = 200

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url)

  const topRaw = Number(searchParams.get('top') ?? DEFAULT_TOP)
  const top = Number.isFinite(topRaw) ? Math.min(Math.max(Math.trunc(topRaw), 1), MAX_TOP) : DEFAULT_TOP

  const minRaw = Number(searchParams.get('minMarketCap'))
  const minMarketCap = Number.isFinite(minRaw) && minRaw > 0 ? minRaw : undefined

  const pool = minMarketCap ? filterUniverse({ minMarketCap }) : null
  const stocks = (pool ? pool.slice(0, top) : topByMarketCap(top)).map(s => ({
    symbol: s.symbol,
    name: s.name,
    exchange: s.exchange,
    sector: s.sector,
    marketCap: s.marketCap,
  }))

  return NextResponse.json(
    {
      meta: UNIVERSE_META,
      // 絞り込みをかけたときは «その条件に何件あるか» を返す。全体件数だけ出すと
      // 画面が「5,489件から選べます」と言いながら30件しか出さない説明になる。
      matched: pool ? pool.length : UNIVERSE_META.count,
      stocks,
    },
    { headers: { 'Cache-Control': 'public, s-maxage=3600, stale-while-revalidate=86400' } },
  )
}
