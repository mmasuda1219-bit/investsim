import { NextRequest, NextResponse } from 'next/server'
import { runTick } from '@/lib/ai-trader/engine'

// 1 tickは 13銘柄分のデータ取得 + Claude API 呼び出しで数十秒かかる。
// Vercelのサーバーレス関数はデフォルトのタイムアウトが短く、これを超えると
// 赤いエラー帯（500）になる。関数の最大実行時間を明示的に伸ばす。
// Hobbyプランの上限は60秒。Proなら300まで上げてよい。
export const maxDuration = 60
// child_process(CLIフォールバック)を使うため Edge ではなく Node.js ランタイムを明示。
export const runtime = 'nodejs'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const session = await runTick(id)
    return NextResponse.json(session)
  } catch (err) {
    console.error('[tick] runTick failed:', err)
    const msg = err instanceof Error ? err.message : 'Tick failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
