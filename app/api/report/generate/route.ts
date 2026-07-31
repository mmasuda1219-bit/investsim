import { NextResponse } from 'next/server'
import { buildReportPrompt } from '@/lib/report/prompt'
import { streamReportClaude } from '@/lib/report/claude'
import { isReaderProfile } from '@/lib/report/profile'
import type { PreparedBundle, ReaderProfile } from '@/lib/report/types'

export const runtime = 'nodejs'
export const maxDuration = 300

// Minimal structural check — the bundle is produced by our own prepare
// endpoint, but generate is a separate public route so we don't trust blindly.
// R1 shape: structured condition (no theoryText/interpreted), fundamentalGate,
// aiEvidence, and backtest that is null when the fundamental gate failed.
function isBundle(b: unknown): b is PreparedBundle {
  if (typeof b !== 'object' || b === null) return false
  const o = b as Record<string, unknown>
  const request = o.request as Record<string, unknown> | undefined
  const gate = o.fundamentalGate as Record<string, unknown> | undefined
  return (
    typeof request?.symbol === 'string' &&
    typeof request?.condition === 'object' && request.condition !== null &&
    typeof gate?.passed === 'boolean' && Array.isArray(gate?.evaluations) &&
    // backtest is null exactly when the gate failed (skipped run)
    (o.backtest === null || (typeof o.backtest === 'object' && o.backtest !== null)) &&
    typeof o.aiEvidence === 'object' && o.aiEvidence !== null &&
    typeof o.current === 'object' && o.current !== null &&
    typeof o.learningContext === 'string' &&
    Array.isArray(o.sources)
  )
}

// POST /api/report/generate
// PreparedBundle in → Opus Markdown report out as a text/plain stream.
// SDK streaming when ANTHROPIC_API_KEY is set; CLI fallback emits one chunk.
export async function POST(req: Request) {
  let body: { bundle?: unknown; profile?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }

  if (!isBundle(body?.bundle)) {
    return NextResponse.json({ error: 'bundle is missing or malformed' }, { status: 400 })
  }

  // 読者プロファイル（/analyze S1）はレポートの強調・語り口だけを変えるレンズで
  // あり、ゲート判定・数値・バックテストには一切関与しない。不正/未知な値は
  // 400にせず黙って無視する（安全側フォールバック — 未回答時の既存挙動と同じ）。
  const profile: ReaderProfile | undefined = isReaderProfile(body?.profile) ? body.profile : undefined

  try {
    const prompt = buildReportPrompt(body.bundle, profile)
    // 4500 tokens — information density is the R1 priority (fits within
    // maxDuration=300 streaming budget).
    const stream = await streamReportClaude(prompt, { maxTokens: 4500 })

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
