import { NextRequest, NextResponse } from 'next/server'
import { runTick } from '@/lib/ai-trader/engine'
import { tryAcquireTickLock, releaseTickLock } from '@/lib/ai-trader/store'
import { consumeAiQuota, limitFromEnv } from '@/lib/ai-usage/limit'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { isAdminUserId } from '@/lib/auth/admin'

// 手動tickは認証が無く、1回で13銘柄分のAI呼び出しを回す。自動tick（cron経由・
// CRON_SECRETで認証済み）には lib/ai-trader/auto.ts の日次上限3回/セッションが既にあるが、
// この «手動» 経路には何も無かった。全体上限で総額を抑え、セッション上限で1人が全体枠を
// 食い潰すのを防ぐ。カウンタは自動tick側とは別枠にして、公開側の濫用がcronを止めないようにする。
const GLOBAL_LIMIT  = () => limitFromEnv('AI_TICK_DAILY_LIMIT', 100)
const SESSION_LIMIT = () => limitFromEnv('AI_TICK_SESSION_DAILY_LIMIT', 10)

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
  // AIセッションはサイトに1本の公開記録。読むのは誰でも自由だが «動かす» のは運営者だけ。
  // これまでは誰でも押せて、1回で13銘柄分のAI呼び出し＝オーナーの費用が出ていく状態だった。
  // 日次上限より先に判定する（他人の押下で上限枠を減らさないため）。
  if (!isAdminUserId(await getCurrentUserId())) {
    return NextResponse.json(
      { error: 'forbidden', message: 'AIを動かせるのは運営者のみです。判断の記録は自由に読めます' },
      { status: 403, headers: { 'Cache-Control': 'no-store' } },
    )
  }

  try {
    const { id } = await params

    // 日次上限。ロック取得より «前» に消費する。ロックを取ってから拒否すると、
    // 上限に達した相手が自動tickのロックを奪って進行を止められてしまうため。
    const quota = await consumeAiQuota({
      globalBucket: 'tick:manual:global', globalLimit: GLOBAL_LIMIT(),
      scopedBucket: `tick:manual:session:${id}`, scopedLimit: SESSION_LIMIT(),
    })
    if (!quota.allowed) {
      if (quota.deniedBy === 'unavailable' || quota.deniedBy === 'config') {
        return NextResponse.json(
          { error: 'ai_quota_unavailable', message: 'ただいま分析を実行できません。時間をおいて試してください' },
          { status: 503, headers: { 'Cache-Control': 'no-store' } },
        )
      }
      const message = quota.deniedBy === 'global'
        ? `本日の手動分析の上限（サイト全体で${quota.globalLimit}回）に達しました。自動運転は通常どおり続きます`
        : `本日の手動分析の上限（${quota.scopedLimit}回）に達しました。自動運転は通常どおり続きます`
      return NextResponse.json(
        { error: 'ai_quota_exceeded', scope: quota.deniedBy, message },
        { status: 429, headers: { 'Cache-Control': 'no-store' } },
      )
    }

    // 自動tick（cron）との二重実行を防ぐ。取得できなければ409（手動側は自動側の日次カウンタに触れない）。
    const token = await tryAcquireTickLock(id, 5 * 60_000)
    if (!token) {
      return NextResponse.json(
        { error: 'auto_tick_in_progress', message: '自動分析の実行中です。少し待って再試行してください' },
        { status: 409 }
      )
    }
    try {
      const session = await runTick(id)
      return NextResponse.json(session)
    } finally {
      await releaseTickLock(id, token)
    }
  } catch (err) {
    console.error('[tick] runTick failed:', err)
    const msg = err instanceof Error ? err.message : 'Tick failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
