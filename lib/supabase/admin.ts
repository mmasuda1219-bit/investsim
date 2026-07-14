// server-only: service-roleキーを扱うため、クライアントバンドルへの混入をビルド時に遮断する。
// SUPABASE_SERVICE_ROLE_KEY は秘密。絶対に NEXT_PUBLIC_ を付けないこと。
import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

let client: SupabaseClient | null = null

/** service-roleキーが設定されているか（Supabase永続化を使えるか）。 */
export function hasServiceRole(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}

/**
 * RLSをバイパスするserver専用クライアント。認証セッションは不要なので永続化しない。
 * モジュールスコープでキャッシュ（サーバーレスの同一インスタンス内で再利用）。
 */
export function getAdminClient(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) {
      throw new Error(
        'Supabase admin client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY'
      )
    }
    client = createClient(url, key, { auth: { persistSession: false } })
  }
  return client
}
