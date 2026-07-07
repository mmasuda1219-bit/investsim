import { NextRequest, NextResponse } from 'next/server'
import { runTick } from '@/lib/ai-trader/engine'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await runTick(id)
    return NextResponse.json(session)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Tick failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
