import Link from 'next/link'

/**
 * 404 ページ（2026-10-09 レビュー W6）。
 *
 * notFound()（app/watch/page.tsx が lib/features.ts の SHOW_AI_WATCH=false のとき投げる）と、どの route にも当たらない URL の
 * 両方でこれが描かれる（node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/not-found.md）。
 * /watch は昨日まで sitemap に載っていた URL なので、検索結果やブックマークから来る人がいる。Next.js 既定の英語
 * （404 | This page could not be found.）ではなく、日本語1文と戻り先の文字リンク2本を出す。
 *
 * 地・ナビ・フッターは app/layout.tsx（root）が描く（:root が暗い地に一本化済みなので、ここで色を塗らない）。
 * 見出しは text-h1 text-ink（scripts/check-headings.ts の規則）。主ボタン（bg-brand）は置かない。
 * props は受け取れない（not-found の規約）。
 */
export default function NotFound() {
  return (
    <div className="max-w-3xl mx-auto space-y-4 py-10">
      <h1 className="text-h1 text-ink">このページは見つかりませんでした。</h1>
      <p className="text-body text-ink-2">URL が変わったか、いまは公開していないページです。</p>
      <p className="flex flex-wrap gap-x-6 gap-y-1 text-small">
        <Link href="/" className="text-brand hover:underline">トップへ戻る</Link>
        <Link href="/trade" className="text-brand hover:underline">01 書く へ進む</Link>
      </p>
    </div>
  )
}
