'use client'

import { useSearchParams } from 'next/navigation'
import { Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { safeNextPath } from '@/lib/auth/next-path'

function LoginForm() {
  const searchParams = useSearchParams()
  const errorMsg = searchParams.get('error')
  // 「やる」「振り返る」の途中で来た人を、ログイン後に元の場所へ返すための戻り先。
  // ここでも検証はするが、最終判断は /auth/callback 側（URLは手で書けるため）。
  const next = safeNextPath(searchParams.get('next'))

  const signInWithGoogle = async () => {
    const supabase = createClient()
    const callback = new URL('/auth/callback', window.location.origin)
    if (next) callback.searchParams.set('next', next)
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: callback.toString() },
    })
  }

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="bg-panel border border-border rounded-2xl p-8 w-full max-w-sm text-center">
        <div className="text-3xl mb-2">📈</div>
        <h1 className="text-ink text-xl font-bold mb-1">InvestSim</h1>
        <p className="text-muted text-sm mb-6">
          ログインすると、売買と判断の記録が
          <br />
          あなたのアカウントに残ります
        </p>

        {errorMsg && (
          <div className="mb-4 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            {errorMsg === 'auth_failed' ? '認証に失敗しました。もう一度お試しください。' : decodeURIComponent(errorMsg)}
          </div>
        )}

        <button
          onClick={signInWithGoogle}
          className="w-full flex items-center justify-center gap-3 bg-card text-ink border border-border font-medium py-3 px-4 rounded-xl hover:bg-surface transition-colors"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
          </svg>
          Googleでログイン
        </button>

        {/* 「見るだけOK・保存はログイン」の方針をここでも明示する。
            旧文言は削除済みのスクリーナー機能を指していた。 */}
        <p className="text-muted text-xs mt-4 leading-relaxed">
          「見る」「まねる」はログインなしで使えます。
          {next && (
            <>
              <br />
              ログイン後は元のページに戻ります。
            </>
          )}
        </p>
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  )
}
