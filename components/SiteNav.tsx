'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { StockSearch } from './StockSearch'
import { AuthMenu } from './AuthMenu'

const NAV = [
  { href: '/',            label: '投資家シミュレーション' },
  { href: '/ai-session',  label: 'AI TRADER' },
  { href: '/markets',     label: 'マーケット' },
  { href: '/screener',    label: 'スクリーナー' },
  { href: '/simulate',    label: 'バックテスト' },
  { href: '/portfolio',   label: 'ポートフォリオ' },
]

export function SiteNav() {
  const path = usePathname()

  return (
    <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-900/90 backdrop-blur">
      <div className="max-w-screen-2xl mx-auto px-4 py-2.5 flex items-center gap-4">
        <Link href="/" className="font-black text-lg tracking-tight shrink-0">
          <span className="text-emerald-400">Invest</span>Sim
        </Link>

        <nav className="flex items-center gap-0.5 overflow-x-auto">
          {NAV.map(({ href, label }) => {
            const active = href === '/' ? path === '/' : path.startsWith(href)
            return (
              <Link
                key={href}
                href={href}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                  active
                    ? 'bg-gray-800 text-white'
                    : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                }`}
              >
                {label}
                {href === '/ai-session' && (
                  <span className="ml-1 text-emerald-400 text-[10px]">●</span>
                )}
              </Link>
            )
          })}
        </nav>

        <div className="ml-auto flex items-center gap-2 shrink-0">
          <StockSearch />
          <AuthMenu />
        </div>
      </div>
    </header>
  )
}
