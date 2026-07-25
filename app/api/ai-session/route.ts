import { NextRequest, NextResponse } from 'next/server'
import { startSession, listSessions } from '@/lib/ai-trader/engine'
import { IMPLEMENTED_PERSONA_IDS } from '@/lib/ai-trader/personas'
import type { InvestorId } from '@/types'

// 実装済みの人格（lib/ai-trader/personas.tsのPERSONASレジストリ）だけを受理する。
// 未実装のIDまで受理すると「persona名を名乗るが実体はGENERIC」という乖離が起きるため（原則9のレビュー指摘）、
// ここでハードコード配列を持たず動的に導出する。
const VALID_PERSONAS: InvestorId[] = IMPLEMENTED_PERSONA_IDS

export async function GET() {
  const sessions = await listSessions()
  return NextResponse.json(sessions)
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const capital = typeof body.capital === 'number' ? body.capital : 100000
  const persona = VALID_PERSONAS.includes(body.persona) ? (body.persona as InvestorId) : undefined
  const session = await startSession(capital, persona)
  return NextResponse.json(session)
}
