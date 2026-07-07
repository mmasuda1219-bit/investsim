import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import './globals.css'
import { SiteNav } from '@/components/SiteNav'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'InvestSim — AI自動売買・著名投資家シミュレーター',
  description: 'Claude AIが自律的に株式市場を分析し仮想売買。著名投資家の投資ロジックシミュレーション。',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col bg-gray-950 text-white">
        <SiteNav />
        <main className="flex-1">{children}</main>
      </body>
    </html>
  )
}
