import { NextRequest, NextResponse } from 'next/server'
import { getHistory, isPeriod } from '@/lib/market'

// 銘柄詳細（/stocks/[symbol]）のチャートが読むデータ。
//
// components/ChartWithControls.tsx は元からここを呼んでいたのに、ルート自体が
// 存在せず 404 を返していた（＝銘柄詳細のチャートが常に「データ取得失敗」）。
// 期間トークンは providers/yahoo2 の RANGE_MAP が分足まで対応済みなので、
// 変換は増やさずそのまま渡す。
//
// 原則9（過去データは必ず実データ）: allowMock:false。取れなければモックで
// 埋めず、エラーとして返して画面に「取れなかった」と出す。チャートは
// «過去に何が起きたか» を見る面なので、作り物を混ぜると判断の練習が成立しない。
export const runtime = 'nodejs'
// 相場データの往復があるので、既定のタイムアウトだと長い期間で切れることがある。
export const maxDuration = 30

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol: raw } = await params
  const symbol = raw.trim().toUpperCase()
  if (!symbol) {
    return NextResponse.json({ error: '銘柄が指定されていません' }, { status: 400 })
  }

  const rawPeriod = new URL(req.url).searchParams.get('period')
  // 未知の期間は既定（3ヶ月）に寄せる。ここで400にすると、リンクを踏んだだけの
  // 利用者にエラー画面が出る（PeriodSelector の既定と揃える）。
  const period = isPeriod(rawPeriod) ? rawPeriod : '3mo'

  try {
    const bars = await getHistory(symbol, period, { allowMock: false })
    // ChartWithControls は配列をそのまま受ける。包むと Array.isArray に落ちる。
    return NextResponse.json(bars, {
      // 相場は動くが、同じ期間を何度も引き直す必要はない。短めに寝かせて
      // Yahoo への往復（429の原因）を減らす。
      headers: { 'Cache-Control': 'public, max-age=60, stale-while-revalidate=300' },
    })
  } catch (err) {
    console.error(`[stocks/history] ${symbol} ${period}:`, err)
    return NextResponse.json(
      { error: `${symbol} の株価データを取得できませんでした` },
      { status: 502, headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
