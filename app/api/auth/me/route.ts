import { NextResponse } from 'next/server'
import { getCurrentUserId } from '@/lib/auth/current-user'
import { isAdminUserId } from '@/lib/auth/admin'

export const runtime = 'nodejs'

// GET /api/auth/me — 画面が «誰として見ているか» を知るための入口。
//
// 未ログインでも200を返す（signedIn:false）。ここを401にすると、ログインしていない
// だけの状態が «エラー» として扱われ、「見るのは自由」の面で無用な失敗表示が出る。
//
// isAdmin は表示の出し分け（Tick実行・自動運転などの操作UIを隠す）にだけ使う。
// 実際の権限判定は各APIルート側で必ずやり直すこと。ここを信じて画面だけ隠しても、
// APIを直接叩かれれば意味がない。
export async function GET() {
  const userId = await getCurrentUserId()
  return NextResponse.json(
    { signedIn: !!userId, isAdmin: isAdminUserId(userId) },
    { headers: { 'Cache-Control': 'no-store' } },
  )
}
