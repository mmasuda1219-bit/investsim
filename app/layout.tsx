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
const SITE_DESC =
  'AIと著名投資家と自分、どの判断が正しかったかを仮想資金で確かめる練習場。実データ・実通貨で記録し、実決済は一切行いません。'

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

// colorScheme はライト転換後も宣言し続ける必要がある。暗色時代の理由
// （iOS Safari が select / input[type=number] をライトで描画し、暗色UI上で
// 白背景・白文字になって読めなくなる）は解消した。だが今度は逆向きの事故が起きる:
// 端末がダークモードだと OS/ブラウザが select などのフォーム部品を勝手に暗色化し、
// 白いカード面に黒い入力欄だけが乗る。'light' を明示して端末設定に追随させない。
// themeColor はモバイルのアドレスバー色。ページの地（--bg）と揃える。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#FAF9F5',
  colorScheme: 'light',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      {/* ハードコードの色（bg-background / text-ink 等）は globals.css のトークンを
          上書きしてしまい、トークンを差し替えても画面に反映されなかった。
          トークン側のユーティリティに寄せてあるので、暗色→ライト基調の転換も
          globals.css の :root を差し替えるだけで追随する。 */}
      <body className="min-h-full flex flex-col bg-background text-ink">
        <SiteNav />
        {/* max-w が無いと大画面で本文が1行90文字まで伸びて読めない */}
        <main className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 py-5 pb-20 md:pb-5">
          {children}
        </main>
      </body>
    </html>
  )
}
