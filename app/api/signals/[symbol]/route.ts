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

    // 単位の変換（2026-09-11）: `FundamentalsData.debtToEquity` は Yahoo 原値の%表記（78.4 ＝ 0.78倍。
    // 規約は types/index.ts に明記）。一方 lib/investors/*.ts の5モデルの閾値は倍率で書かれている
    // （dalio `> 2.0`／graham `< 0.5`／lynch `< 0.3` など）ので、渡す手前で /100 して倍率に直したコピーを渡す。
    // 元オブジェクトは変えない（スクリーニング側 lib/backtest は%前提のまま正しい）。
    const fundamentalsForModels =
      fundamentals.debtToEquity == null
        ? fundamentals
        : { ...fundamentals, debtToEquity: fundamentals.debtToEquity / 100 }

    const signals: Record<string, Signal> = {}
    for (const investor of investors) {
      signals[investor.id] = investor.analyze({ quote, history, fundamentals: fundamentalsForModels })
    }

    return NextResponse.json({ symbol, signals }, {
      headers: { 'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=60' },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compute signals'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
