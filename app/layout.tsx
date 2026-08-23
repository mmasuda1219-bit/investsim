import type { Metadata, Viewport } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import { SiteNav } from '@/components/SiteNav'

export const metadata: Metadata = {
  title: 'InvestSim — AI自動売買・著名投資家シミュレーター',
  description: 'Claude AIが自律的に株式市場を分析し仮想売買。著名投資家の投資ロジックシミュレーション。',
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
        <main className="flex-1 px-4 sm:px-6 py-5">{children}</main>
      </body>
    </html>
  )
}
