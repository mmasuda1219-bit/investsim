import { NextRequest, NextResponse } from 'next/server'
import { listAutoTickTargets, runAutoTick } from '@/lib/ai-trader/auto'

// child_process(CLIフォールバック)を使う可能性があるため Node.js ランタイムを明示。
export const runtime = 'nodejs'
// 最大5セッションを逐次tick。1tick数十秒 × 5 を包むため長めに（Vercel Pro前提）。
export const maxDuration = 300

// CRON_SECRET を Bearer で検証する。未設定 or 不一致は 401。
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const results: Array<{ id: string; ran: boolean; reason?: string; lockDegraded?: boolean }> = []
  // 経過時間バジェット。maxDuration(300s)手前で打ち切り、残りは次回cronが古い順に拾う。
  const startedAt = Date.now()
  const TIME_BUDGET_MS = 240_000
  try {
    // 1回のcronで最大3件（1tick数十秒×3を関数タイムアウトに収める）。
    const targets = await listAutoTickTargets(3)
    // 逐次実行（Promise.allではなく順番に）。レート制限・関数タイムアウトへの配慮。
    // 1セッションの失敗が他を止めないよう個別try。
    for (const t of targets) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        results.push({ id: t.id, ran: false, reason: 'time_budget' })
        continue
      }
      try {
        const r = await runAutoTick(t.id)
        results.push({ id: t.id, ran: r.ran, reason: r.reason, lockDegraded: r.lockDegraded })
      } catch (err) {
        console.error(`[cron/tick] session ${t.id} failed:`, err)
        results.push({ id: t.id, ran: false, reason: 'error' })
      }
    }
  } catch (err) {
    console.error('[cron/tick] failed:', err)
    const msg = err instanceof Error ? err.message : 'cron tick failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  return NextResponse.json({ processed: results.length, results })
}

export async function POST(req: NextRequest) {
  return handle(req)
}

// GH Actions/手動確認どちらでも叩けるよう GET でも受ける。
export async function GET(req: NextRequest) {
  return handle(req)
}
