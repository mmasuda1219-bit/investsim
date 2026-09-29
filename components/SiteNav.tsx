'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { StockSearch } from './StockSearch'
import { AuthMenu } from './AuthMenu'

/**
 * 3つの画面（書く→くらべる→読み返す＝**1件の記録が育つ順**: 書いたその日 → 書いた直後 → 20営業日ほど後）。
 * 並びは難易度ではなく記録が育つ順なので、順序を入れ替えないこと。心臓は `/trade`（COMPANY.md 原則12・
 * 2026-09-29 オーナー決定。4段「見る→まねる→やる→振り返る」から変更）。
 * `/watch`（AIの判断）は段に置かず、02 の中と全ページ共通フッターの常設リンク（app/layout.tsx）から到達させる
 * （未ログイン閲覧を維持する法務の不変条件・DECISIONS.md 2026-09-29。検査は scripts/check-watch-reachable.ts）。
 * hint（説明文）に「名人」の語を出さない（DECISIONS 2026-09-24 決定(2)。名人を隠している間、無いものを約束しない）。
 * label・href・順序は scripts/check-features.ts・check-night-theme.ts が固定している。
 */
export const NAV = [
  { href: '/trade',  label: '書く',     hint: 'なぜ買うのか・どうなったらやめるのかを書く' },
  // hint は「いまある機能」を書く（S1 レビュー W2）。この文はホームの3つの一覧に本文として出るので、
  // S3 で作る「自分のメモとAIのメモを並べる」を先に約束しない（DECISIONS.md 2026-09-29 決定(3)）。
  { href: '/learn',  label: 'くらべる', hint: '条件を決めて過去のデータに当て、AIの分析を読む' },
  { href: '/review', label: '読み返す', hint: '書いた理由と、その後の株価を並べる' },
] as const

/** 現在地の判定。'/' は全パスの接頭辞になってしまうので startsWith を使わない。 */
function isActive(path: string, href: string) {
  return path === href || path.startsWith(href + '/')
}

export function SiteNav() {
  const path = usePathname()
  // 暗い見た目（案B「夜」・DECISIONS 2026-09-24）は SV1a（2026-09-25）で :root に一本化した。
  // S1a のあいだ `/` にいるときだけ data-theme="night" を付けてロゴを出し分けていた分岐は撤去し、
  // 全ページで暗い枠・暗い地用のロゴ（public/logo-night.svg / logo-mark-night.svg）を使う。

  return (
    <>
      {/* bg-panel（= --card）は白 3.5% の半透明なので backdrop-blur が効く（下を通る内容がにじんで
          透けるガラスの帯）。地は <body> の bg-background（globals.css の --bg）。 */}
      <header className="sticky top-0 z-40 border-b border-border bg-panel backdrop-blur">
        <div className="max-w-screen-2xl mx-auto px-4 py-2.5 flex items-center gap-4">
          {/* ロゴ（2026-09-11 オーナー提供のデザインをベクター化した public/logo.svg が元）。
              スマホ幅はマークだけにする。ヘッダには検索とログインも並ぶので、文字まで入れると
              390px で横にはみ出す（2bd216a と同種の事故）。
              暗い地では元ファイルの文字（#0D1725）と濃紺の始点が沈むので、色だけ差し替えた *-night.svg を使う。
              元ファイル（logo.svg / logo-mark.svg）は上書きしない（幾何の正として残す。撤去は別スライス）。 */}
          <Link href="/" className="shrink-0 flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-night.svg" alt="InvestSim" width={143} height={28} className="hidden sm:block h-7 w-auto" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark-night.svg" alt="InvestSim" width={25} height={28} className="sm:hidden h-7 w-auto" />
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
      className="md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-3 border-t border-border bg-panel backdrop-blur pb-[env(safe-area-inset-bottom)]"
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
