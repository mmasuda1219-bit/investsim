// server-onlyを含まない純関数のみ。lib/supabase/admin.ts（server-only）と
// lib/screen/cache.ts（tsxスモーク対象）の両方から安全にimportできる共有モジュール。
// ここに実処理（Supabaseクライアント生成等）を置かないこと — それはadmin.tsの責務。

/** service-roleキーが設定されているか（Supabase永続化を使えるか）。環境変数を読むだけ。 */
export function hasServiceRole(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY
  )
}
