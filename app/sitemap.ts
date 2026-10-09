import type { MetadataRoute } from 'next'
import { SHOW_AI_WATCH } from '@/lib/features'

/**
 * sitemap.xml（S1「3段の道」・2026-09-29 新設）。
 *
 * `/watch`（AIの判断）の扱いは lib/features.ts の SHOW_AI_WATCH に連動する**二択**（2026-10-09 オーナー指示「いったん全面的に隠す」）:
 *  - true  … 公開。ナビの段から外しても検索エンジンと利用者が「随時に利用可能」な状態を機械で示すため、ここに載せる。
 *            noindex にしない（監督指針 VII-3-1(2)②イ）。
 *  - false … 全面非表示。画面が 404 なので載せない（存在しない URL を sitemap に書かない）。
 * その中間＝「ログインした人にだけ見せる」形は作らない（同指針「会員登録等を行わないと投資情報等を購入・利用できない…場合には
 * 登録が必要」）。どちらの規則も scripts/check-watch-reachable.ts が同じ定数を読んで見る。
 * このファイルは普段は変更禁止（check-primary-sources.ts・check-review-record.ts が存在を見る）。
 *
 * Next.js の `app/sitemap.ts` 規約（node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/sitemap.md）:
 * default export が `MetadataRoute.Sitemap`（url 必須・lastModified 等は任意）を返すと `/sitemap.xml` で配信される。
 * 既定でキャッシュされる静的なルートハンドラ。
 *
 * lastModified は付けない（`new Date()` を書くとビルドのたびに「更新した」と偽る＝原則9 の隣）。
 * BASE は app/layout.tsx の metadataBase と同じ値（layout を import すると React の層を引き込むので文字列で持つ）。
 */
const BASE = 'https://investsim-nine.vercel.app'

/** 公開ページ（SHOW_AI_WATCH が true なら5本・false なら4本）。ログインが要る操作面（/review/backfill・/auth）と補助機能（/simulate）は載せない */
const PUBLIC_PATHS: readonly string[] = ['/', '/watch', '/trade', '/learn', '/review'].filter(p => p !== '/watch' || SHOW_AI_WATCH)

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map(p => ({ url: `${BASE}${p}` }))
}
