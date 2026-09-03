import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/ai-trader/engine'
import { upsertSession } from '@/lib/ai-trader/store'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { isAdminUserId } from '@/lib/auth/admin'

export const runtime = 'nodejs'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
