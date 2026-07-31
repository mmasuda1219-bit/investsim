import { NextRequest, NextResponse } from 'next/server'
import { listLearnTargets, runLearnTick } from '@/lib/ai-trader/learn'

// Claude呼び出し（@anthropic-ai/sdk）を行うため Node.js ランタイムを明示（cron/tickと同様）。
export const runtime = 'nodejs'
// Vercel Hobby は関数上限60秒。宣言値はそれを超えられないため 60 に合わせる。
// 学習はClaude 1呼び出し（engine.tsのCLAUDE_LEARN_TIMEOUT_MS=40秒で上限済み）＋DB I/O のみで、
// tickのようにデータ取得を伴わないため、この枠を1セッションが単独で使える。
export const maxDuration = 60

// CRON_SECRET を Bearer で検証する（cron/tickと同じ強度）。未設定 or 不一致は 401。
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const results: Array<{ id: string; learned: boolean; reason?: string; lockDegraded?: boolean }> = []
  const startedAt = Date.now()
  const TIME_BUDGET_MS = 50_000
  try {
    // 1回のcronで最大1件。学習はtickと同じロックを奪うため、複数件を欲張ると
    // ロック保持時間が伸びてtickを不必要にブロックする。遅れている順に少しずつ前進させる。
    const targets = await listLearnTargets(1)
    for (const t of targets) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        results.push({ id: t.id, learned: false, reason: 'time_budget' })
        continue
      }
      try {
        const r = await runLearnTick(t.id)
        results.push({ id: t.id, learned: r.learned, reason: r.reason, lockDegraded: r.lockDegraded })
      } catch (err) {
        // 学習の失敗はtickを壊さない（tickは別エンドポイントで独立して回る）。
        console.error(`[cron/learn] session ${t.id} failed:`, err)
        results.push({ id: t.id, learned: false, reason: 'error' })
      }
    }
  } catch (err) {
    console.error('[cron/learn] failed:', err)
    const msg = err instanceof Error ? err.message : 'cron learn failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  return NextResponse.json({ processed: results.length, results })
}

export async function POST(req: NextRequest) {
  return handle(req)
}

// GH Actions/手動確認どちらでも叩けるよう GET でも受ける（cron/tickと同様）。
export async function GET(req: NextRequest) {
  return handle(req)
}
