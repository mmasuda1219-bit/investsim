import type { MetadataRoute } from 'next'

/**
 * sitemap.xml（S1「3段の道」・2026-09-29 新設）。
 *
 * 目的は1つ: `/watch`（AIの判断）をナビの段から外しても、検索エンジンと利用者が「随時に利用可能」な状態を
 * 機械で示すこと（未ログインで読める状態を維持する法務の不変条件・DECISIONS.md 2026-09-29）。
 * `/watch` をここから消さない・`app/watch/page.tsx` を noindex にしない（scripts/check-watch-reachable.ts が見る）。
 *
 * Next.js の `app/sitemap.ts` 規約（node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/sitemap.md）:
 * default export が `MetadataRoute.Sitemap`（url 必須・lastModified 等は任意）を返すと `/sitemap.xml` で配信される。
 * 既定でキャッシュされる静的なルートハンドラ。
 *
 * lastModified は付けない（`new Date()` を書くとビルドのたびに「更新した」と偽る＝原則9 の隣）。
 * BASE は app/layout.tsx の metadataBase と同じ値（layout を import すると React の層を引き込むので文字列で持つ）。
 */
const BASE = 'https://investsim-nine.vercel.app'

/** 公開ページ5本。ログインが要る操作面（/review/backfill・/auth）と補助機能（/simulate）は載せない */
const PUBLIC_PATHS = ['/', '/watch', '/trade', '/learn', '/review'] as const

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map(p => ({ url: `${BASE}${p}` }))
}
