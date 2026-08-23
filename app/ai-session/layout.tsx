/**
 * /ai-session はページ内に専用ヘッダー（NavBar）を持ち、全幅で描画する前提の
 * 画面。ルートレイアウトが付ける共通の左右余白をここだけ打ち消して、既存の
 * 見た目を保つ。ヘッダー二重（SiteNav と NavBar でロゴが縦に2つ並ぶ）を
 * 解消する再編の際に、この打ち消しごと削除する。
 */
export default function AiSessionLayout({ children }: { children: React.ReactNode }) {
  return <div className="-mx-4 sm:-mx-6 -my-5">{children}</div>
}
