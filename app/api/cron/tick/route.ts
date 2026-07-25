import { NextRequest, NextResponse } from 'next/server'
import { listAutoTickTargets, runAutoTick } from '@/lib/ai-trader/auto'

// child_process(CLIフォールバック)を使う可能性があるため Node.js ランタイムを明示。
export const runtime = 'nodejs'
// Vercel Hobby は関数上限60秒。宣言値はそれを超えられないため 60 に合わせる。
// 1回のcronで1セッションだけ確実に完了させ、残りは1日3回のcronで古い順に前進させる。
export const maxDuration = 60

// CRON_SECRET を Bearer で検証する。未設定 or 不一致は 401。
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

// HOTFIX(2026-07-24): TIME_BUDGET_MSは「次のセッションを開始するか」しか見ておらず、
// 実行中の1件（runAutoTick）自体の長さは無制限だった。外部呼び出し(Claude API・市場データ)が
// 想定外に長引くと、この関数がVercelのmaxDuration(60s)そのものでハードkillされ、
// GitHub Actions側には504/curlのタイムアウトとして現れ「エラーになったのか成功したのか」が
// 一切わからなくなっていた（実際に自動tickが繰り返し504で失敗していた根本原因の一つ）。
// runAutoTickは中断できないため真のキャンセルではないが、残余バジェットで確実に応答を返し、
// 「時間切れで今回は見送った」ことを正直に返せるようにする（過少実行側に倒す・既存方針を維持）。
// レビュー指摘(2026-07-25): withDeadlineはtimeoutで応答を打ち切るが、元のpromise(runAutoTick)自体は
// キャンセルされず裏で走り続ける。学習ティックはClaude呼び出しが2回で最悪~80秒になり得るため、
// 「timeoutと報告したのに裏で完走(売買・当日カウント消費)」というズレが起き得る。504自体は解消済み
// だが実態把握のため、打ち切り後もpromiseの最終決着(完走/失敗)をログに残す（二重resolve/rejectはしない）。
function withDeadline<T>(
  promise: Promise<T>,
  ms: number,
  onTimeout: () => T,
  onLateSettle?: (result: { ok: true; value: T } | { ok: false; error: unknown }) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      resolve(onTimeout())
    }, ms)
    promise.then(
      (v) => {
        if (!settled) { settled = true; clearTimeout(timer); resolve(v); return }
        // 応答はtimeoutで既に返した後の遅延完走。呼び出し側にafter-deadlineの決着を通知する。
        onLateSettle?.({ ok: true, value: v })
      },
      // 実際のエラーはtimeoutで揉み消さず素通しする（呼び出し側の既存catchが'error'として扱う）。
      (err) => {
        if (!settled) { settled = true; clearTimeout(timer); reject(err); return }
        onLateSettle?.({ ok: false, error: err })
      },
    )
  })
}

async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const results: Array<{ id: string; ran: boolean; reason?: string; lockDegraded?: boolean }> = []
  // 経過時間バジェット。maxDuration(60s・Hobby)手前で打ち切り、残りは次回cronが古い順に拾う。
  const startedAt = Date.now()
  const TIME_BUDGET_MS = 50_000
  try {
    // 1回のcronで最大1件（1tick数十秒をHobbyの60秒関数上限に確実に収める）。
    const targets = await listAutoTickTargets(1)
    // 逐次実行（Promise.allではなく順番に）。レート制限・関数タイムアウトへの配慮。
    // 1セッションの失敗が他を止めないよう個別try。
    for (const t of targets) {
      if (Date.now() - startedAt > TIME_BUDGET_MS) {
        results.push({ id: t.id, ran: false, reason: 'time_budget' })
        continue
      }
      try {
        // 残余バジェットで打ち切る（runAutoTick自体は中断できないが、応答は必ず時間内に返す）。
        const remaining = Math.max(1_000, TIME_BUDGET_MS - (Date.now() - startedAt))
        const r = await withDeadline(
          runAutoTick(t.id),
          remaining,
          () => ({ ran: false as const, reason: 'timeout' }),
          (late) => {
            if (late.ok) {
              console.log(
                '[cron/tick] session %s completed AFTER deadline: ran=%s reason=%s',
                t.id, late.value.ran, late.value.reason,
              )
            } else {
              console.error(`[cron/tick] session ${t.id} failed AFTER deadline:`, late.error)
            }
          },
        )
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
