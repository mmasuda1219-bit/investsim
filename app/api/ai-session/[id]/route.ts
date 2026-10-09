import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/ai-trader/engine'
import { upsertSession } from '@/lib/ai-trader/store'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { isAdminUserId } from '@/lib/auth/admin'
import { SHOW_AI_WATCH } from '@/lib/features'

export const runtime = 'nodejs'

// GET はセッション1件の全 JSON（判断・売買・学習メモ）を返す読み出し口。2026-10-09 オーナー指示「いったん全面的に隠す」により、
// lib/features.ts の SHOW_AI_WATCH が false の間は画面 /watch・他の読み出し口（/api/ai-session・/latest・/api/markets・/chart）と
// 同じく 404・no-store（engine・Supabase に触る前に返す）。公開か全面非表示かの二択。ログイン状態で分けない（監督指針 VII-3-1(2)②）。
// 下の PATCH（自動運転の ON/OFF・運営者のみ）は表示ではないので定数を読まない（検査: scripts/check-watch-reachable.ts の E）。
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!SHOW_AI_WATCH) return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } })
  const { id } = await params
  const session = await getSession(id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  return NextResponse.json(session)
}

// 自動運転（サーバー側自動tick）のON/OFFのみを切り替える。date/count は保持。他フィールドは触らない。
// 運営者だけ。ONにするとcronがAIを回し続けるので、訪問者に切り替えさせるとオーナーの費用になる。
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!isAdminUserId(await getCurrentUserId())) {
    return NextResponse.json(
      { error: 'forbidden', message: '自動運転の切り替えは運営者のみです' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  const { id } = await params
  const session = await getSession(id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })

  let body: { auto?: { enabled?: boolean } }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (typeof body?.auto?.enabled !== 'boolean') {
    return NextResponse.json({ error: 'auto.enabled (boolean) required' }, { status: 400 })
  }

  const prev = session.auto ?? { enabled: false, date: '', count: 0 }
  session.auto = { enabled: body.auto.enabled, date: prev.date, count: prev.count }
  await upsertSession(session)
  return NextResponse.json(session)
}
