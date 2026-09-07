import { NextResponse } from 'next/server'
import { getEarnings } from '@/lib/market/providers/yahoo2'

// 銘柄詳細（/stocks/[symbol]）の「決算情報」パネルが読むデータ。
//
// components/EarningsPanel.tsx は元からここを呼んでいたのに、ルート自体が存在せず
// 404 を返していた（＝決算パネルが常に「決算データを取得できませんでした」）。
//
// 原則9（実データ）: 取れなければ空で返す。作り物のEPSを出すと、
// 「決算をどう読むか」の練習そのものが嘘になる。
export const runtime = 'nodejs'
export const maxDuration = 30

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: raw } = await params
  const symbol = raw.trim().toUpperCase()
  if (!symbol) {
    return NextResponse.json({ epsHistory: [] }, { status: 400 })
  }

  try {
    const data = await getEarnings(symbol)
    return NextResponse.json(data, {
      // 決算は四半期に一度しか動かない。長めに寝かせてYahooへの往復を減らす。
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    })
  } catch (err) {
    console.error(`[stocks/earnings] ${symbol}:`, err)
    // パネル側は epsHistory の有無で «取れなかった» を表示する。ここで500の
    // エラー本文を返すと画面が壊れるので、形は保ったまま空で返す。
    return NextResponse.json({ epsHistory: [] }, { headers: { 'Cache-Control': 'no-store' } })
  }
}
