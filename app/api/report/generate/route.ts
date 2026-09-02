import { NextResponse } from 'next/server'
import { buildReportPrompt } from '@/lib/report/prompt'
import { streamReportClaude } from '@/lib/report/claude'
import { isReaderProfile } from '@/lib/report/profile'
import { consumeAiQuota, clientIp, limitFromEnv } from '@/lib/ai-usage/limit'
import type { PreparedBundle, ReaderProfile } from '@/lib/report/types'

export const runtime = 'nodejs'
export const maxDuration = 300

// このルートは Opus 4.8 を最大4500トークンで回す（1回$0.15前後）。認証が無く誰でも
// 叩けるため、日次上限で «オーナーの財布» を守る。全体上限が実質の支出上限で、
// IP上限は1人が全体枠を食い潰さないための補助（IPは偽装されうる）。
// 数値は環境変数で上書きできる（本番はVercelのProject Settings）。
const GLOBAL_LIMIT = () => limitFromEnv('AI_REPORT_DAILY_LIMIT', 50)
const IP_LIMIT     = () => limitFromEnv('AI_REPORT_IP_DAILY_LIMIT', 5)

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

  // 日次上限。AIを呼ぶ «直前» に消費する（入力検証を通ったものだけを1回と数える）。
  const ip = clientIp(req)
  const quota = await consumeAiQuota({
    globalBucket: 'report:global', globalLimit: GLOBAL_LIMIT(),
    scopedBucket: `report:ip:${ip}`, scopedLimit: IP_LIMIT(),
  })
  if (!quota.allowed) {
    // カウンタ自体が読めない場合（マイグレーション0004未実行・DB不調）は、通さず503。
    // 費用のガードなので、壊れたときは «止める» 側に倒す（fail-closed）。
    if (quota.deniedBy === 'unavailable' || quota.deniedBy === 'config') {
      return NextResponse.json(
        { error: 'ai_quota_unavailable', message: 'ただいまAIレポートを利用できません。時間をおいて試してください' },
        { status: 503, headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const message = quota.deniedBy === 'global'
      ? `本日のAIレポートの上限（サイト全体で${quota.globalLimit}回）に達しました。日本時間の翌朝にリセットされます`
      : `本日のAIレポートの上限（1人${quota.scopedLimit}回）に達しました。日本時間の翌朝にリセットされます`
    return NextResponse.json(
      { error: 'ai_quota_exceeded', scope: quota.deniedBy, message },
      { status: 429, headers: { 'Cache-Control': 'no-store' } },
    )
  }

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
