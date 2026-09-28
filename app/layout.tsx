import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
// 日本語フォント（Noto Sans JP・可変ウェイト）。
// `next/font/google` はビルド時にGoogleのCDNへ取りに行くため、過去に ETIMEDOUT で
// ビルドが不安定になった実績がある（DECISIONS.md 2026-07-08。そのため Geist は
// セルフホストの `geist` パッケージに置換済み）。同じ轍を踏まないよう、日本語も
// 同じ方針＝npmで配られるセルフホストのフォントパッケージを使い、ビルド時の外部
// フェッチをゼロにする。unicode-range で124サブセットに分割されているので、
// ブラウザは実際に描画する文字分のwoff2だけを取りに行く。
import '@fontsource-variable/noto-sans-jp'
import './globals.css'
import { SiteNav } from '@/components/SiteNav'

// 「AI自動売買」は (1) 実決済と誤読されうる (2) 助言性を帯びる、の2点で
// legal-compliance の懸念があり、原則11の転換（ゴールは人間の投資スキル向上）
// 後の実態とも合わないため改称した。
const SITE_NAME = 'InvestSim'
const SITE_TITLE = 'InvestSim — 投資判断の練習場'
// 2026-09-25 S1c: 名人（著名投資家）を画面から隠している間は、検索結果と OGP に出るこの1文にも出さない。
// 「無料」「リスクゼロ」「上手くなる」は書かない（legal-compliance 2026-09-25・DESIGN.md §7）。
const SITE_DESC =
  '買う理由を書いて残し、あとで実際の株価と読み返す練習場。仮想資金で、実際のお金は1円も動きません。'

export const metadata: Metadata = {
  // OG画像などの相対URLを絶対URLへ解決するために必須。
  metadataBase: new URL('https://investsim-nine.vercel.app'),
  title: SITE_TITLE,
  description: SITE_DESC,
  applicationName: SITE_NAME,
  // og:image / twitter:image は app/opengraph-image.png のファイル規約から
  // Next.js が自動生成する（ここで images を重複指定しない）。
  openGraph: {
    type: 'website',
    locale: 'ja_JP',
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESC,
    url: '/',
  },
  twitter: {
    card: 'summary_large_image',
    title: SITE_TITLE,
    description: SITE_DESC,
  },
}

// colorScheme は 'dark' を明示する（SV1a・2026-09-25。地を #0A0C10 に一本化した。DECISIONS.md 2026-09-24）。
// 端末の設定に追随させると、端末がライトモードのときに iOS Safari が select / input[type=number] を
// ライトで描画し、暗い地の上に白い入力欄だけが浮く（2026-09-11 以前の暗色 UI で実際に起きた事故の再来）。
// Windows のスクロールバー・iOS の引っぱり戻しの地もこの宣言で暗くなる。
// globals.css の `:root { color-scheme: dark }` と同じ値にそろえること（<meta> と CSS の両方が要る）。
// themeColor はモバイルのアドレスバー色。ページの地（--bg）と揃える。明暗の切り替えは作らない（DESIGN.md §9）。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0A0C10',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      {/* ハードコードの色（bg-background / text-ink 等）は globals.css のトークンを
          上書きしてしまい、トークンを差し替えても画面に反映されなかった。
          トークン側のユーティリティに寄せてあるので、明るい地→暗い地の転換（SV1a・2026-09-25）も
          globals.css の :root を差し替えるだけで追随した。 */}
      <body className="min-h-full flex flex-col bg-background text-ink">
        <SiteNav />
        {/* max-w が無いと大画面で本文が1行90文字まで伸びて読めない。
            スマホの下部ナビ（SiteNav の fixed・h-14）に隠れないための pb-20 は、下のフッターへ移した。 */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-5">
          {children}
        </main>
        {/* フッターの枠（DESIGN.md §4-2 R10「全ページ共通」・legal-compliance 2026-09-25）。
            S1c ではトップ（app/(night)/layout.tsx）だけに置いていたのを、SV1a で全ページに。
            運営者情報／お問い合わせ／プライバシーポリシー／利用規約の行き先はまだ無いので <a> にせず文字だけ（「準備中」）。
            行き先ができたら <a> に替える。「無料」の語は書かない（legal-compliance 2026-09-25）。
            <main> の外の <footer> なので、支援技術には contentinfo（ページ情報の目印）として伝わる。 */}
        <footer className="w-full max-w-6xl mx-auto px-4 sm:px-6 pb-20 md:pb-5">
          <div className="mt-8 border-t border-border pt-4">
            <p className="text-small text-muted">
              InvestSim ／ 運営者情報 ／ お問い合わせ ／ プライバシーポリシー ／ 利用規約（いずれも準備中）
            </p>
          </div>
        </footer>
      </body>
    </html>
  )
}
