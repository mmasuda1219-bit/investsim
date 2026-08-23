'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { StockSearch } from './StockSearch'
import { AuthMenu } from './AuthMenu'

/**
 * 学習の4段階。並び順そのものが情報（見る→まねる→やる→振り返る＝難易度の昇順）
 * なので、順序を入れ替えないこと。COMPANY.md 原則11「ゴールは人間の投資スキル向上」
 * に対応する導線で、利用者は上から順に降りてくる。
 */
export const NAV = [
  { href: '/watch',  label: '見る',     hint: 'AIと名人の判断を読む' },
  { href: '/learn',  label: 'まねる',   hint: '名人の条件を過去に当てる' },
  { href: '/trade',  label: 'やる',     hint: '自分で判断して売買する' },
  { href: '/review', label: '振り返る', hint: '判断の質の変化を見る' },
] as const

/** 現在地の判定。'/' は全パスの接頭辞になってしまうので startsWith を使わない。 */
function isActive(path: string, href: string) {
  return path === href || path.startsWith(href + '/')
}

export function SiteNav() {
  const path = usePathname()

  return (
    <>
      <header className="sticky top-0 z-40 border-b border-gray-800 bg-gray-900/90 backdrop-blur">
        <div className="max-w-screen-2xl mx-auto px-4 py-2.5 flex items-center gap-4">
          <Link href="/" className="font-black text-lg tracking-tight shrink-0">
            <span className="text-emerald-400">Invest</span>Sim
          </Link>

          {/* スマホでは下部ナビに任せるので隠す */}
          <nav className="hidden md:flex items-center gap-0.5">
            {NAV.map(({ href, label, hint }) => {
              const active = isActive(path, href)
              return (
                <Link
                  key={href}
                  href={href}
                  title={hint}
                  aria-current={active ? 'page' : undefined}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-gray-800 text-white'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-gray-800/50'
                  }`}
                >
                  {label}
                  {href === '/watch' && (
                    <span className="ml-1 text-emerald-400 text-[10px]" aria-label="運用中">●</span>
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

      <BottomNav path={path} />
    </>
  )
}

/**
 * スマホ用の下部ナビ。主機能の往復が多く片手操作になるため、上部タブではなく
 * 親指の届く位置に置く。アイコンのみは初心者に通じないのでラベルは必須。
 * スクロールで隠さない（監視中にナビが消えるのは不安を生む）。
 */
function BottomNav({ path }: { path: string }) {
  return (
    <nav
      aria-label="メインナビゲーション"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-4 border-t border-gray-800 bg-gray-900/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      {NAV.map(({ href, label, hint }, i) => {
        const active = isActive(path, href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 h-14 text-[11px] transition-colors ${
              active ? 'text-emerald-400 font-semibold' : 'text-gray-500'
            }`}
          >
            <span aria-hidden className="text-[10px] tabular-nums opacity-70">{i + 1}</span>
            <span>{label}</span>
            <span className="sr-only">{hint}</span>
          </Link>
        )
      })}
    </nav>
  )
}
