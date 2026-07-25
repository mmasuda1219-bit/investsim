import { NextRequest, NextResponse } from 'next/server'
import { refreshStaleFundamentals } from '@/lib/screen/refresh'

// getFundamentals経由でネットワークfetchを行うため Node.js ランタイムを明示（cron/tickと同様）。
export const runtime = 'nodejs'
// Vercel Hobby は関数上限60秒。宣言値はそれを超えられないため 60 に合わせる。
// 1回のcronでは古い順に少数（REFRESH_BATCH）だけ更新し、残りは次回cronが引き続き古い順に前進させる。
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

  try {
    // universe_fundamentals はtick経路のロック機構(lock_until)とは別テーブルのため、
    // 同時実行の二重更新はupsertの冪等性で吸収でき、専用ロックは不要（tick側には一切触れない）。
    const result = await refreshStaleFundamentals()
    return NextResponse.json(result)
  } catch (err) {
    console.error('[cron/refresh-fundamentals] failed:', err)
    const msg = err instanceof Error ? err.message : 'refresh-fundamentals failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  return handle(req)
}

// GH Actions/手動確認どちらでも叩けるよう GET でも受ける（cron/tickと同様）。
export async function GET(req: NextRequest) {
  return handle(req)
}
