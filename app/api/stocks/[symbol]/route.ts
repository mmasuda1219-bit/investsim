import { NextResponse } from 'next/server'
import { getQuote } from '@/lib/market'
import { findStock } from '@/lib/market/universe'

// GET /api/stocks/:symbol — 1銘柄の現在値。
//
// allowMock:false は外さないこと（原則9）。
// ここは /trade が売買前に価格を取りに来る経路で、既定の allowMock:true のままだと
// Yahoo が落ちた時に providers/mock の «乱数で揺らした架空価格» が返り、利用者は
// それを実勢だと思って買ってしまう。実データが無いときは値を作らず 502 で止める。
// /trade 側の「価格を取得できませんでした」表示は、この失敗を受ける前提で書かれている。
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> }
) {
  const { symbol: rawSymbol } = await params
  const symbol = rawSymbol.trim().toUpperCase()

  try {
    const quote = await getQuote(symbol, { allowMock: false })
    const listed = findStock(symbol)
    return NextResponse.json(
      {
        ...quote,
        // 一覧に載っている銘柄は、生成時点で公式の上場リストにあり実価格が取れたもの。
        // 載っていなくても «存在しない» とは限らない（新規上場・一覧生成後の変更）ので、
        // 画面側が «未確認» と表現できるようにフラグと出典だけ渡す。
        listed: Boolean(listed),
        exchange: listed?.exchange,
        sector: listed?.sector,
      },
      { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=30' } },
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to fetch quote'
    // 502 = 上流のデータ源が返せなかった。入力ミス（存在しない銘柄）と
    // データ源の障害を画面側が区別できるよう、判っている範囲を添える。
    return NextResponse.json(
      { error: message, symbol, listed: Boolean(findStock(symbol)) },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
