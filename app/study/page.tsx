import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SHOW_LAB_9983 } from '@/lib/features'
import { LAB_9983 } from '@/lib/lab/9983'
import { Lab9983Client } from './client'

/**
 * 「学ぶ」（/study・2026-10-19 S-L1a・DECISIONS 同日）。4段「学ぶ → くらべる → 書く → 振り返り」の1段目。
 * 中身は 2026-10-09 に隠しページ /lab/9983 として作った「添削プロトタイプ」そのもの（1社・手入力の実データ
 * lib/lab/9983.ts・AI なし）。住所を /study に移して公開した。
 *
 *  - lib/features.ts の SHOW_LAB_9983 が false の間は notFound() で 404（全面非表示に戻す口。
 *    node_modules/next/dist/docs/01-app/03-api-reference/04-functions/not-found.md）
 *  - true なら公開: 検索に載せる（metadata.robots を書かない＝既定の index, follow）・app/sitemap.ts に載せる・入口はナビ（S-L1b）
 *  - **公開か全面非表示かの二択**。到達の条件に session / user / cookies / headers / auth を入れない（SHOW_AI_WATCH と同じ不変条件。
 *    監督指針 VII-3-1(2)②「会員登録等を行わないと投資情報等を購入・利用できない…場合には登録が必要」）
 *  - 社名を題の主役にしない（1社は練習用の例題であって、推すものではない）
 *  - 中身は ./client.tsx（ブラウザの中だけで完結。保存も送信も無い）
 *  - 検査: scripts/check-lab-9983.ts (e)(g)
 */

/** 題と説明文の社名・証券コードは data（lib/lab/9983.ts）から組む。画面の本文も同じ出所なので、
 *  銘柄を差し替えたときに題だけ古い社名が残ることが起きない（二重管理をしない。検査 (e)） */
const c = LAB_9983.company
const TITLE = `決算の読み方を練習する（例題: ${c.name} ${c.code}） — InvestSim`
const DESCRIPTION = `1社（${c.name}・${c.code}）を固定した練習用の題材です。会社が公表した決算の数字を見て、つながりをたどり、判断メモを書き、添削を読みます。売買を勧めるものではありません。`

/**
 * openGraph と twitter を**この段で書き直す**理由
 * （node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md「Ordering」§:
 *  入れ子のフィールド openGraph・robots・twitter は後の段が前の段を**丸ごと上書き**する＝浅いマージ）:
 * 書かないと app/layout.tsx の値（ホームの題・説明・url: '/'）がそのまま継承され、SNS に貼ったとき
 * ホームの顔で出てしまう。逆に title・description・url だけ書くと親の type・locale・siteName が消える。
 * **画像も消える**: og:image は app/opengraph-image.png のファイル規約から付くが、それは「その段の
 * openGraph」に足される形なので、ここで openGraph を書くと一緒に落ちる（実測: 書く前は og:image あり・
 * 書いた後は無し）。そのため images を明示する。URL はビルドが配信する /opengraph-image.png
 * （Route 一覧の ○ /opengraph-image.png・実測 200 image/png）。寸法はファイル規約が出していた値と同じ。
 * url と images は相対で書ける（親の metadataBase と合成される。同 docs「metadataBase」§）。
 * siteName は app/layout.tsx の SITE_NAME と同じ値（あちらは export していないので文字で持つ。変えるときは両方）。
 */
const OG_IMAGE = { url: '/opengraph-image.png', width: 1200, height: 630, type: 'image/png' } as const

export const metadata: Metadata = SHOW_LAB_9983
  ? {
      title: TITLE,
      description: DESCRIPTION,
      openGraph: {
        type: 'website',
        locale: 'ja_JP',
        siteName: 'InvestSim',
        title: TITLE,
        description: DESCRIPTION,
        url: '/study',
        images: [OG_IMAGE],
      },
      twitter: {
        card: 'summary_large_image',
        title: TITLE,
        description: DESCRIPTION,
        images: [OG_IMAGE.url],
      },
    }
  : {}

export default function StudyPage() {
  if (!SHOW_LAB_9983) notFound()
  return (
    <div className="pt-1 pb-4 md:pb-5">
      <Lab9983Client />
    </div>
  )
}
