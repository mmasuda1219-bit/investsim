import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { resetPortfolio } from '@/lib/portfolio/server'

export const runtime = 'nodejs'

// POST /api/portfolio/reset — 現金・持ち株・取引記録を初期状態に戻す。
// 「振り返る」のリセットボタンから呼ぶ。取り消せない操作なので、確認はUI側で必ず取ること。
export async function POST() {
  const userId = await getCurrentUserId()
  if (!userId) {
    return NextResponse.json(
      { error: 'unauthenticated', message: 'ログインが必要です' },
      { status: 401, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  try {
    const portfolio = await resetPortfolio(userId)
    return NextResponse.json(portfolio, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'reset failed'
    console.error('[portfolio] reset failed:', message)
    return NextResponse.json({ error: 'reset_failed' }, { status: 500 })
  }
}
