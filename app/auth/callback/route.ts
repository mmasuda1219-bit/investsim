import { NextResponse } from 'next/server'
import { safeNextPath } from '@/lib/auth/next-path'

export async function GET(req: Request) {
  const { searchParams, origin } = new URL(req.url)
  const code = searchParams.get('code')

  // next はURLに書かれてくる＝利用者が自由に細工できる。ここで «同一サイト内のパス» に
  // 限定しないと、ログインを踏ませて外部サイトへ飛ばす誘導に使える。
  // 通らなかったものは黙ってトップに落とす（攻撃の成否を教えない）。
  const next = safeNextPath(searchParams.get('next')) ?? '/'
  const redirectTo = `${origin}${next}`

  // 失敗しても戻り先を保つ。ログインし直したときに元の場所へ戻れるようにするため。
  const loginUrl = (error: string) => {
    const u = new URL('/auth/login', origin)
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
