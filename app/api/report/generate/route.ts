import { NextResponse } from 'next/server'
import { buildReportPrompt } from '@/lib/report/prompt'
import { streamReportClaude } from '@/lib/report/claude'
import type { PreparedBundle } from '@/lib/report/types'

export const runtime = 'nodejs'
export const maxDuration = 300

// Minimal structural check — the bundle is produced by our own prepare
// endpoint, but generate is a separate public route so we don't trust blindly.
function isBundle(b: unknown): b is PreparedBundle {
  if (typeof b !== 'object' || b === null) return false
  const o = b as Record<string, unknown>
  return (
    typeof (o.request as Record<string, unknown> | undefined)?.symbol === 'string' &&
    typeof (o.request as Record<string, unknown> | undefined)?.theoryText === 'string' &&
    typeof o.interpreted === 'object' && o.interpreted !== null &&
    typeof o.backtest === 'object' && o.backtest !== null &&
    typeof o.current === 'object' && o.current !== null &&
    typeof o.learningContext === 'string' &&
    Array.isArray(o.sources)
  )
}

// POST /api/report/generate
// PreparedBundle in → Opus Markdown report out as a text/plain stream.
// SDK streaming when ANTHROPIC_API_KEY is set; CLI fallback emits one chunk.
export async function POST(req: Request) {
  let body: { bundle?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!isBundle(body?.bundle)) {
    return NextResponse.json({ error: 'bundle is missing or malformed' }, { status: 400 })
  }

  try {
    const prompt = buildReportPrompt(body.bundle)
    const stream = await streamReportClaude(prompt, { maxTokens: 3500 })

    return new Response(stream, {
      status: 200,
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-store',
        // Disable proxy buffering so tokens reach the client incrementally.
        'X-Accel-Buffering': 'no',
      },
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'report generation failed'
    return NextResponse.json(
      { error: `レポート生成に失敗しました: ${message}` },
      { status: 500 },
    )
  }
}
