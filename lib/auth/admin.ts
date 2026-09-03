// 「このサイトの運営者か」の判定。
//
// AIセッションは «サイトに1本» の公開記録で、全員が同じものを読む（オーナー決定・2026-09-03）。
// 「見る」の定義が「AIや名人がいまの相場をどう見て、なぜそう判断したかを読む」である以上、
// 全員が同じ記録の積み上がりを読むほうが教材として強く、AI費用も人数で増えない。
//
// その代わり «動かす» 操作（Tick実行・自動運転の切替・セッション作成）は運営者だけに限る。
// これまでは誰でも押せた。訪問者がリセットすれば記録が消え、Tickを押せばオーナーの
// AI料金が使われる状態だった。読むのは自由、動かすのは運営者だけ、に分ける。
//
// 判定は環境変数の user id 一致で行う。役割をDBに持たせるほどの分岐がまだ無いため
// （原則8: 早すぎる抽象化は禁止）。運営者が増えたらカンマ区切りで足す。
import 'server-only'

/**
 * 未設定なら «誰も運営者ではない»（fail-closed）。
 * 設定を忘れた状態で全員が運営者になるより、誰も操作できないほうが安全。
 */
export function isAdminUserId(userId: string | null | undefined): boolean {
  if (!userId) return false
  const ids = (process.env.ADMIN_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return ids.includes(userId)
}
