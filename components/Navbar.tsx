import Link from 'next/link'
import { StockSearch } from './StockSearch'

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface/90 backdrop-blur-sm">
      <div className="mx-auto max-w-7xl px-4 py-3 flex items-center gap-4">
        <Link href="/ai-session" className="text-white font-black text-lg shrink-0 tracking-tight">
          AI <span className="text-cyan-400">TRADER</span>
        </Link>
        <StockSearch />
      </div>
    </header>
  )
}
