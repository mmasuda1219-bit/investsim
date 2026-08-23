import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
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

// colorScheme を宣言しないと iOS Safari が select / input[type=number] を
// ライトで描画し、暗色UI上で白背景・白文字になって読めなくなる。
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#030712',
  colorScheme: 'dark',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-gray-950 text-white">
        <SiteNav />
        <main className="flex-1 px-4 sm:px-6 py-5 pb-20 md:pb-5">{children}</main>
      </body>
    </html>
  )
}
