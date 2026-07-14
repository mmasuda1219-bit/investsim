import { NextRequest, NextResponse } from 'next/server'
import { getSession } from '@/lib/ai-trader/engine'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const session = await getSession(id)
  if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  return NextResponse.json(session)
}
