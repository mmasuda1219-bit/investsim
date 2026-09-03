import { NextRequest, NextResponse } from 'next/server'
import { startSession, listSessions } from '@/lib/ai-trader/engine'
import { IMPLEMENTED_PERSONA_IDS } from '@/lib/ai-trader/personas'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { isAdminUserId } from '@/lib/auth/admin'
import type { InvestorId } from '@/types'

// 実装済みの人格（lib/ai-trader/personas.tsのPERSONASレジストリ）だけを受理する。
// 未実装のIDまで受理すると「persona名を名乗るが実体はGENERIC」という乖離が起きるため（原則9のレビュー指摘）、
// ここでハードコード配列を持たず動的に導出する。
const VALID_PERSONAS: InvestorId[] = IMPLEMENTED_PERSONA_IDS

// AIセッションは «サイトに1本» の公開記録で、読むのは誰でも自由（「見る」はログイン不要）。
// 個人ごとのセッションは作らないので、ここで全件返しても他人のデータは含まれない。
export async function GET() {
  const sessions = await listSessions()
  return NextResponse.json(sessions)
}

// 作成は運営者だけ。誰でも作れると、その都度AIが動いてオーナーの費用が出ていく。
// 画面の「セッションをリセット」もこの経路なので、訪問者が記録を消せる状態でもあった。
export async function POST(req: NextRequest) {
  if (!isAdminUserId(await getCurrentUserId())) {
    return NextResponse.json(
      { error: 'forbidden', message: 'AIセッションの作成は運営者のみです' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    )
  }
  const body = await req.json().catch(() => ({}))
  const capital = typeof body.capital === 'number' ? body.capital : 100000
  const persona = VALID_PERSONAS.includes(body.persona) ? (body.persona as InvestorId) : undefined
  const session = await startSession(capital, persona)
  return NextResponse.json(session)
}
