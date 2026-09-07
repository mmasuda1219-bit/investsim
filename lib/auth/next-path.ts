// ログイン後の «戻り先»（next）の組み立てと検証。
//
// ログインは元のページを離れる操作なので、戻り先を持ち回らないと必ずトップに着地する。
// 「やる」「振り返る」の途中でログインを求める設計なので、戻れないと導線が切れる。
//
// サーバ（/auth/callback）とクライアント（各ログインリンク）の両方から使うため、
// server-only を付けない素のモジュールにしてある。

// 改行・タブ等の制御文字。リダイレクト先に混ざるとヘッダ細工の余地になる。
function hasControlChars(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i)
    if (code < 0x20 || code === 0x7f) return true
  }
  return false
}

/**
 * 外部サイトへ飛ばされない «同一サイト内のパス» だけを通す。それ以外は null。
 *
 * 検証をクライアント側だけでやっても意味がない（URLは手で書ける）ので、
 * 最終的にリダイレクトを発行する /auth/callback で必ず通すこと。
 */
export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw) return null
  // 絶対URL（http://evil.com）を弾く
  if (!raw.startsWith('/')) return null
  // "//evil.com" はスキーム相対URL＝別ドメイン。"/\evil.com" もブラウザによっては同じ扱い。
  if (raw.startsWith('//') || raw.startsWith('/\\')) return null
  if (hasControlChars(raw)) return null
  // ログイン関連へ戻すとループする
  if (raw.startsWith('/auth/')) return null
  return raw
}

/** 現在地に戻ってこられるログインリンクを作る。 */
export function loginHref(currentPath: string | null | undefined): string {
  const next = safeNextPath(currentPath)
  return next ? `/auth/login?next=${encodeURIComponent(next)}` : '/auth/login'
}
