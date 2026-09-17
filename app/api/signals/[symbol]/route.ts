import { NextResponse } from 'next/server'
import { getQuote, getHistory, getFundamentals } from '@/lib/market'
import { findStock } from '@/lib/market/universe'
import investors from '@/lib/investors'
import type { Signal } from '@/types'

// GET /api/signals/:symbol — 名人5人（バフェット／ソロス／リンチ／グレアム／ダリオ）の判定。
//
// allowMock:false は外さないこと（原則9）。/watch の名人の区画（MasterSignals）と銘柄詳細の
// InvestorPanel がここを読む。既定の allowMock:true のままだと、実データ3経路が全滅したときに
// providers/mock の«乱数の株価・架空の財務»で判定が作られ、利用者はそれを名人の判断だと思って読む。
// 取れないときは値を作らず 502 で止める。画面側（MasterSignals.tsx／InvestorPanel.tsx）は
// 「シグナルを取得できませんでした」を出す前提で書かれている。
export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.toUpperCase()

  try {
    const [quote, history, fundamentals] = await Promise.all([
      getQuote(symbol, { allowMock: false }),
      getHistory(symbol, '1y', { allowMock: false }),
      getFundamentals(symbol, { allowMock: false }),
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
    // 502 = 上流のデータ源が返せなかった（app/api/stocks/[symbol]/route.ts と同じ形）。
    // 入力ミス（存在しない銘柄）とデータ源の障害を画面側が区別できるよう、判っている範囲を添える。
    return NextResponse.json(
      { error: message, symbol, listed: Boolean(findStock(symbol)) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
