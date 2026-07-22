// server-only: service-roleキーを扱うため、クライアントバンドルへの混入をビルド時に遮断する。
// SUPABASE_SERVICE_ROLE_KEY は秘密。絶対に NEXT_PUBLIC_ を付けないこと。
import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { hasServiceRole } from './env'

let client: SupabaseClient | null = null

// hasServiceRole() の実体は server-only を含まない ./env に切り出し済み
// （lib/screen/cache.ts 等、tsxから読む必要があるモジュールと共有するため）。
// ここでは既存の呼び出し元互換のため再exportするだけ。
export { hasServiceRole }

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
