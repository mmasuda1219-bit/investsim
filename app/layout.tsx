import type { Metadata } from 'next'
import { GeistSans } from 'geist/font/sans'
import { GeistMono } from 'geist/font/mono'
import './globals.css'
import { SiteNav } from '@/components/SiteNav'

export const metadata: Metadata = {
  title: 'InvestSim — AI自動売買・著名投資家シミュレーター',
  description: 'Claude AIが自律的に株式市場を分析し仮想売買。著名投資家の投資ロジックシミュレーション。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-gray-950 text-white">
        <SiteNav />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  )
}
