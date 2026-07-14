import { NextRequest, NextResponse } from 'next/server'
import { startSession, listSessions } from '@/lib/ai-trader/engine'

export async function GET() {
  const sessions = await listSessions()
  return NextResponse.json(sessions)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const capital = typeof body.capital === 'number' ? body.capital : 100000
  const session = await startSession(capital)
  return NextResponse.json(session)
}
