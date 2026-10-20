import type { MetadataRoute } from 'next'
import { SHOW_AI_WATCH, SHOW_LAB_9983 } from '@/lib/features'

/**
 * sitemap.xml（S1「3段の道」・2026-09-29 新設）。
 *
 * `/watch`（AIの判断）の扱いは lib/features.ts の SHOW_AI_WATCH に連動する**二択**（2026-10-09 オーナー指示「いったん全面的に隠す」）:
 *  - true  … 公開。ナビの段から外しても検索エンジンと利用者が「随時に利用可能」な状態を機械で示すため、ここに載せる。
 *            noindex にしない（監督指針 VII-3-1(2)②イ）。
 *  - false … 全面非表示。画面が 404 なので載せない（存在しない URL を sitemap に書かない）。
 * その中間＝「ログインした人にだけ見せる」形は作らない（同指針「会員登録等を行わないと投資情報等を購入・利用できない…場合には
 * 登録が必要」）。どちらの規則も scripts/check-watch-reachable.ts が同じ定数を読んで見る。
 *
 * `/study`（「学ぶ」・4段の1段目）も同じ**二択**の作法で SHOW_LAB_9983 に連動する（2026-10-19 S-L1a・DECISIONS 同日）。
 * 2026-10-09 に隠しページ /lab/9983 として作ったときは「noindex・sitemap に載せない」だったが、公開に変えたので載せる。
 * false に戻すと画面が 404 になるので、ここからも消える。
 *
 * このファイルは普段は変更禁止（check-primary-sources.ts・check-review-record.ts が存在を見る）。
 * 2026-10-19 に /study を足すため scripts/check-lab-9983.ts (f) の凍結一覧から外した（next.config.ts は凍結のまま）。
 *
 * Next.js の `app/sitemap.ts` 規約（node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/01-metadata/sitemap.md）:
 * default export が `MetadataRoute.Sitemap`（url 必須・lastModified 等は任意）を返すと `/sitemap.xml` で配信される。
 * 既定でキャッシュされる静的なルートハンドラ。
 *
 * lastModified は付けない（`new Date()` を書くとビルドのたびに「更新した」と偽る＝原則9 の隣）。
 * BASE は app/layout.tsx の metadataBase と同じ値（layout を import すると React の層を引き込むので文字列で持つ）。
 */
const BASE = 'https://investsim-nine.vercel.app'

/** 公開ページ（基本の4本＋/study は SHOW_LAB_9983・/watch は SHOW_AI_WATCH に連動）。
 *  ログインが要る操作面（/review/backfill・/auth）と補助機能（/simulate）は載せない。
 *  1行に収める（check-watch-reachable.ts が `const PUBLIC_PATHS` の行に SHOW_AI_WATCH があることを見る） */
const PUBLIC_PATHS: readonly string[] = ['/', '/study', '/watch', '/trade', '/learn', '/review'].filter(p => (p !== '/watch' || SHOW_AI_WATCH) && (p !== '/study' || SHOW_LAB_9983))

export default function sitemap(): MetadataRoute.Sitemap {
  return PUBLIC_PATHS.map(p => ({ url: `${BASE}${p}` }))
}
