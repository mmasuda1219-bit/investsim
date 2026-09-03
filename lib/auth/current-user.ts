// APIルートから «いま誰がログインしているか» を得るための唯一の入口。
//
// getUser() は Cookie のJWTを Supabase に問い合わせて検証する。getSession() と違い、
// クライアントが細工したCookieをそのまま信じない。保存系のAPIはこちらだけを使うこと。
//
// 認証が未設定（ローカルで env が無い等）でも例外で500にせず null を返す。
// 呼び出し側は「ログインしていない」と同じ扱いにする＝安全側（保存させない）に倒れる。
import 'server-only'
import { createClient } from '@/lib/supabase/server'

export async function getCurrentUserId(): Promise<string | null> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return null
  }
  try {
    const supabase = await createClient()
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) return null
    return data.user.id
  } catch {
    return null
  }
}
