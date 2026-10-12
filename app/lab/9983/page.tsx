import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SHOW_LAB_9983 } from '@/lib/features'
import { Lab9983Client } from './client'

/**
 * 「添削プロトタイプ」の隠しページ（/lab/9983・2026-10-09・S-A・DECISIONS 同日）。
 * ファーストリテイリング（9983）1社・手入力の実データ（lib/lab/9983.ts）・AI なし。
 *
 *  - lib/features.ts の SHOW_LAB_9983 が false の間は notFound() で 404（node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md）
 *  - true でも **noindex**（metadata.robots。同 generate-metadata.md の robots）・app/sitemap.ts に足さない・どこからもリンクしない
 *  - 到達の条件に session / user / cookies / headers / auth を入れない（SHOW_AI_WATCH と同じ不変条件）
 *  - 中身は ./client.tsx（ブラウザの中だけで完結。保存も送信も無い）
 */
export const metadata: Metadata = SHOW_LAB_9983
  ? { title: '添削プロトタイプ（9983） — InvestSim', robots: { index: false, follow: false } }
  : { robots: { index: false, follow: false } }

export default function Lab9983Page() {
  if (!SHOW_LAB_9983) notFound()
  return (
    <div className="pt-1 pb-4 md:pb-5">
      <Lab9983Client />
    </div>
  )
}
