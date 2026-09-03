import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { getPortfolio } from '@/lib/portfolio/server'

export const runtime = 'nodejs'

// GET /api/portfolio — ログイン中の利用者の現金・持ち株・取引記録を返す。
// 未ログインは401。「見るのは自由・保存はログイン」の方針で、記録が残る面だけを守る。
export async function GET() {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'ログインすると売買の記録を残せます' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  try {
    const portfolio = await getPortfolio(userId)
    return NextResponse.json(portfolio, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'portfolio read failed'
    console.error('[portfolio] GET failed:', message)
    return NextResponse.json({ error: 'read_failed' }, { status: 500 })
  }
}
