import { NextResponse } from 'next/server'
import { safeNextPath } from '@/lib/auth/next-path'
import { resolveCallbackBase } from '@/lib/auth/callback-base'

export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')

  // 戻り先の土台。プロキシ（Vercel）の後ろでは req.url の origin が localhost 等になりうるので、
  // 本番では x-forwarded-host を優先する（決め方と検証は lib/auth/callback-base.ts）。
  const base = resolveCallbackBase({
    origin,
    forwardedHost: req.headers.get('x-forwarded-host'),
    forwardedProto: req.headers.get('x-forwarded-proto'),
    nodeEnv: process.env.NODE_ENV,
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
  })

  // next はURLに書かれてくる＝利用者が自由に細工できる。ここで «同一サイト内のパス» に
  // 限定しないと、ログインを踏ませて外部サイトへ飛ばす誘導に使える。
  // 通らなかったものは黙ってトップに落とす（攻撃の成否を教えない）。
  const next = safeNextPath(searchParams.get('next')) ?? '/'
  const redirectTo = `${base}${next}`

  // 失敗しても戻り先を保つ。ログインし直したときに元の場所へ戻れるようにするため。
  const loginUrl = (error: string) => {
    const u = new URL('/auth/login', base)
    if (next !== '/') u.searchParams.set('next', next)
    u.searchParams.set('error', error)
    return u.toString()
  }

  // Skip if Supabase is not configured
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.redirect(redirectTo)
  }

  if (code) {
    try {
      const { createClient } = await import('@/lib/supabase/server')
      const supabase = await createClient()
      const { error } = await supabase.auth.exchangeCodeForSession(code)
      if (error) {
        console.error('[auth/callback] exchangeCodeForSession error:', error.message)
        return NextResponse.redirect(loginUrl(error.message))
      }
    } catch (err) {
      console.error('[auth/callback] unexpected error:', err)
      return NextResponse.redirect(loginUrl('auth_failed'))
    }
  }

  return NextResponse.redirect(redirectTo)
}
