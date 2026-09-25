'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { StockSearch } from './StockSearch'
import { AuthMenu } from './AuthMenu'

/**
 * 学習の4段階。並び順そのものが情報（見る→まねる→やる→振り返る＝難易度の昇順）
 * なので、順序を入れ替えないこと。COMPANY.md 原則11「ゴールは人間の投資スキル向上」
 * に対応する導線で、利用者は上から順に降りてくる。
 * hint（説明文）は 2026-09-25 S1b で「名人」の語を外した（DECISIONS 2026-09-24 決定(2)。名人を隠している間、
 * 無いものを約束しない）。label・href・順序はここでも不変。
 */
export const NAV = [
  { href: '/watch',  label: '見る',     hint: 'AIの判断と、その根拠を読む' },
  { href: '/learn',  label: 'まねる',   hint: '条件を決めて、過去のデータに当てる' },
  { href: '/trade',  label: 'やる',     hint: '自分で判断して売買する' },
  { href: '/review', label: '振り返る', hint: '書いた理由と、その後の株価を並べる' },
] as const

/** 現在地の判定。'/' は全パスの接頭辞になってしまうので startsWith を使わない。 */
function isActive(path: string, href: string) {
  return path === href || path.startsWith(href + '/')
}

export function SiteNav() {
  const path = usePathname()
  // 暗い見た目（案B「夜」・DECISIONS 2026-09-24）は S1a（2026-09-25）でトップページだけに当てている。
  // ヘッダーと下部ナビは app/(night)/layout.tsx の外（app/layout.tsx 直下）にあるので、同じ範囲印
  // data-theme="night" を `/` にいるときだけ自分に付ける。他のページは明るいまま。
  // :root を暗い地に一本化する最後のスライス（S7）で、この分岐とロゴの出し分けは消える。
  const night = path === '/'
  const theme = night ? 'night' : undefined

  return (
    <>
      {/* bg-panel（= --card）は明るい地では不透明な白なので backdrop-blur は効いていなかった。
          night では --card が白 3.5% の半透明になり、初めてぼかしが効く（下を通る内容がにじんで
          透けるガラスの帯）。地は app/(night)/layout.tsx が --bg で塗る。 */}
      <header data-theme={theme} className="sticky top-0 z-40 border-b border-border bg-panel backdrop-blur">
        <div className="max-w-screen-2xl mx-auto px-4 py-2.5 flex items-center gap-4">
          {/* ロゴ（2026-09-11 オーナー提供のデザインをベクター化した public/logo.svg）。
              スマホ幅はマークだけにする。ヘッダには検索とログインも並ぶので、文字まで入れると
              390px で横にはみ出す（2bd216a と同種の事故）。
              暗い地では文字（#0D1725）と濃紺の始点が沈むので、`/` では色だけ差し替えた *-night.svg を
              使う。元ファイルは上書きしない（ログイン画面が明るい地で同じファイルを使う）。 */}
          <Link href="/" className="shrink-0 flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={night ? '/logo-night.svg' : '/logo.svg'} alt="InvestSim" width={143} height={28} className="hidden sm:block h-7 w-auto" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={night ? '/logo-mark-night.svg' : '/logo-mark.svg'} alt="InvestSim" width={25} height={28} className="sm:hidden h-7 w-auto" />
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
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${
                    active
                      ? 'bg-surface text-ink'
                      : 'text-muted hover:text-ink-2 hover:bg-surface'
                  }`}
                >
                  {/* 「● 運用中」の常時点灯は撤去（DESIGN.md §6-7: 状態表示は実際にその
                      状態のときだけ出す。自動tickは1日3回までで、常に運用中ではない）。 */}
                  {label}
                </Link>
              )
            })}
          </nav>

          {/* shrink-0 だと検索ボックス（max-w-lg=512px）が縮まず、ログインボタンが
              加わったスマホ幅で右にはみ出して全ページに横スクロールが出る。
              グループ側を縮められるようにし、検索ボックスに幅を譲らせる。
              ログインボタン側は AuthMenu が shrink-0 で自分の幅を守る。 */}
          <div className="ml-auto flex min-w-0 flex-1 items-center justify-end gap-2">
            <StockSearch />
            <AuthMenu />
          </div>
        </div>
      </header>

      <BottomNav path={path} theme={theme} />
    </>
  )
}

/**
 * スマホ用の下部ナビ。主機能の往復が多く片手操作になるため、上部タブではなく
 * 親指の届く位置に置く。アイコンのみは初心者に通じないのでラベルは必須。
 * スクロールで隠さない（監視中にナビが消えるのは不安を生む）。
 */
function BottomNav({ path, theme }: { path: string; theme?: 'night' }) {
  return (
    <nav
      data-theme={theme}
      aria-label="メインナビゲーション"
      className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-4 border-t border-border bg-panel backdrop-blur pb-[env(safe-area-inset-bottom)]"
    >
      {NAV.map(({ href, label, hint }, i) => {
        const active = isActive(path, href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={`flex flex-col items-center justify-center gap-0.5 h-14 text-xs leading-tight transition-colors ${
              // 現在地は --brand（旧 emerald は 2026-09-11 以前のブランド色の残り。DESIGN.md §10 P1）
              active ? 'text-brand font-semibold' : 'text-muted'
            }`}
          >
            <span aria-hidden className="text-xs tabular-nums opacity-70">{i + 1}</span>
            <span>{label}</span>
            <span className="sr-only">{hint}</span>
          </Link>
        )
      })}
    </nav>
  )
}
