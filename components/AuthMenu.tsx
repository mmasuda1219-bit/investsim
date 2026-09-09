'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { User } from '@supabase/supabase-js'
import { LogOut } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { LoginLink } from '@/components/LoginLink'

// Supabase未設定（ローカルでenvが無い等）でもクラッシュしないよう判定
const isConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

function displayName(user: User): string {
  const m = user.user_metadata ?? {}
  return m.full_name || m.name || user.email || 'ユーザー'
}

function avatarUrl(user: User): string | undefined {
  const m = user.user_metadata ?? {}
  return m.avatar_url || m.picture || undefined
}

export function AuthMenu() {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  // 未設定なら最初からready=true（effect内の同期setStateを避ける）
  const [ready, setReady] = useState(!isConfigured)

  useEffect(() => {
    if (!isConfigured) return
    const supabase = createClient()

    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user ?? null)
      setReady(true)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
    })

    return () => sub.subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    setUser(null)
    router.refresh()
  }

  // 認証未設定、または状態確定前は何も出さない（レイアウトのちらつき防止）
  if (!isConfigured || !ready) return null

  if (!user) {
    // shrink-0 で自分の幅を守る。ヘッダの幅が足りないときは、隣の検索ボックスが縮む。
    return (
      <LoginLink className="shrink-0 px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap bg-accent text-on-accent transition-colors" />
    )
  }

  const name = displayName(user)
  const avatar = avatarUrl(user)

  return (
    <div className="flex items-center gap-2">
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatar}
          alt={name}
          className="w-7 h-7 rounded-full border border-border"
          referrerPolicy="no-referrer"
        />
      ) : (
        <div className="w-7 h-7 rounded-full bg-accent text-on-accent text-xs font-bold flex items-center justify-center">
          {name.charAt(0).toUpperCase()}
        </div>
      )}
      <span className="text-sm text-ink-2 max-w-[10rem] truncate hidden sm:block">{name}</span>
      <button
        onClick={signOut}
        title="ログアウト"
        aria-label="ログアウト"
        className="p-1.5 rounded-lg text-muted hover:text-ink hover:bg-surface transition-colors"
      >
        <LogOut className="w-4 h-4" />
      </button>
    </div>
  )
}
