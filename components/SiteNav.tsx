'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { StockSearch } from './StockSearch'
import { AuthMenu } from './AuthMenu'

/**
 * 4段（学ぶ→くらべる→書く→振り返り＝**1つの判断を作る順**: 題材を読む → 見くらべる → 自分で書く →
 * 20営業日ほど後に読み返す）。並びは難易度ではなく判断を作る順なので、順序を入れ替えないこと。
 * 心臓は `/trade`（COMPANY.md 原則12・2026-10-19 オーナー決定。2026-09-29 の3段「書く→くらべる→読み返す」から変更。
 * 「心臓は `/trade`」は 2026-09-11 から維持）。
 * **段のラベルに番号を付けない**（2026-10-19 に全廃。順番は並び順と呼び名の語そのもので示す。DESIGN.md §6-7）。
 * `/watch`（AIの判断）は段に置かず、「くらべる」の中と全ページ共通フッターの常設リンク（app/layout.tsx）から到達させる
 * （公開か全面非表示かの二択・ログイン必須にしない法務の不変条件・DECISIONS.md 2026-09-29／2026-10-09。
 * 検査は scripts/check-watch-reachable.ts）。
 * hint（説明文）に「名人」の語を出さない（DECISIONS 2026-09-24 決定(2)。名人を隠している間、無いものを約束しない）。
 *
 * **この `NAV` が呼び名（label）・行き先（href）・順序の唯一の出所**。label・href・順序は
 * scripts/check-features.ts・check-theme.ts が固定している。
 * 他の画面から呼び名や説明文を参照するときは、**添字（NAV[0] など）ではなく下の labelOf()・hintOf() で路から引く**
 * （添字で読むと並びを変えた日に文が黙って嘘になる。2026-10-19 に3段→4段で実際に起きかけた）。
 */
export const NAV = [
  { href: '/study',  label: '学ぶ',     hint: '1社の決算を題材に、見る・つなげる・書く・添削の練習をする' },
  // hint は「いまある機能」を書く（S1 レビュー W2）。この文はホームの一覧に本文として出るので、
  // S3 で作る「自分のメモとAIのメモを並べる」を先に約束しない（DECISIONS.md 2026-09-29 決定(3)）。
  { href: '/learn',  label: 'くらべる', hint: '条件を決めて過去のデータに当て、AIの分析を読む' },
  { href: '/trade',  label: '書く',     hint: 'なぜ買うのか・どうなったらやめるのかを書く' },
  { href: '/review', label: '振り返り', hint: '書いた理由と、その後の株価を並べる' },
] as const

type NavHref = (typeof NAV)[number]['href']

/** 路から段の呼び名を引く。見つからなければ投げる（綴り間違いを黙って空文字にしない） */
export function labelOf(href: NavHref): string {
  const e = NAV.find(n => n.href === href)
  if (!e) throw new Error(`labelOf: ${href} は NAV にありません`)
  return e.label
}

/** 路から段の説明文を引く。見つからなければ投げる */
export function hintOf(href: NavHref): string {
  const e = NAV.find(n => n.href === href)
  if (!e) throw new Error(`hintOf: ${href} は NAV にありません`)
  return e.hint
}

/** 現在地の判定。'/' は全パスの接頭辞になってしまうので startsWith を使わない。 */
function isActive(path: string, href: string) {
  return path === href || path.startsWith(href + '/')
}

export function SiteNav() {
  const path = usePathname()
  // 見た目の土台は :root 一本（DESIGN.md §9）。S1a のあいだ `/` にいるときだけ data-theme="night" を付けて
  // ロゴを出し分けていた分岐は SV1a（2026-09-25）で撤去済み。L1（2026-10-12）で地を明るい #F6F8FB に戻したので、
  // 全ページで元のロゴ（public/logo.svg / logo-mark.svg）に戻した。暗い地用の *-night.svg は削除せず残す。

  // 先頭（scrollY 0）にいるかどうか。帯の境目は線ではなく影で作り、先頭では影を消す（L2・2026-10-14）
  const [scrolled, setScrolled] = useState(false)
  // スティッキーバーは「本当に浮いているもの」なので影を持ってよい（design-taste-frontend の規則。inspect.mjs も overlay として数える）
  const HEADER_SHADOW = 'shadow-[0_1px_3px_-1px_rgb(0_0_0_/_.12)]' // taste-skill-ignore: sticky bar
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 0)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <>
      {/* bg-panel（= --card・白）の帯。地は <body> の bg-background（globals.css の --bg）。
          L2（2026-10-14・DECISIONS.md 同日 決定(2)③⑤）: 1px の下線とすりガラス（背景のぼかし）を落とした。
          帯はスティッキーバー＝本当に浮いているものなので、境目は影で作る（design-taste-frontend の規則内。
          「影は本当に浮いているもの＝メニュー・ダイアログ・スティッキーバーだけ」）。先頭にいるときは影なし、
          スクロールされているときだけ控えめな1枚（0 1px 3px -1px 黒 12%）。背景のぼかしは --card が不透明な白なので
          もともと効いておらず、外しても見た目は変わらない。 */}
      <header className={`sticky top-0 z-40 bg-panel transition-shadow duration-150 ${scrolled ? HEADER_SHADOW : ''}`}>
        <div className="max-w-screen-2xl mx-auto px-4 py-2.5 flex items-center gap-4">
          {/* ロゴ（2026-09-11 オーナー提供のデザインをベクター化した public/logo.svg が元）。
              スマホ幅はマークだけにする。ヘッダには検索とログインも並ぶので、文字まで入れると
              390px で横にはみ出す（2bd216a と同種の事故）。
              明るい地では元ファイルの文字（#0D1725・地の上 16.92）がそのまま読める。 */}
          <Link href="/" className="shrink-0 flex items-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.svg" alt="InvestSim" width={143} height={28} className="hidden sm:block h-7 w-auto" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.svg" alt="InvestSim" width={25} height={28} className="sm:hidden h-7 w-auto" />
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
  // 下部ナビは常に内容の上に浮いている（fixed）ので、境目は線ではなく上向きの控えめな影で作る（L2・2026-10-14。ヘッダーと同じ規則）
  const BOTTOM_SHADOW = 'shadow-[0_-1px_3px_-1px_rgb(0_0_0_/_.12)]' // taste-skill-ignore: fixed bar
  return (
    <nav
      aria-label="メインナビゲーション"
      className={`md:hidden fixed bottom-0 inset-x-0 z-40 grid grid-cols-4 bg-panel ${BOTTOM_SHADOW} pb-[env(safe-area-inset-bottom)]`}
    >
      {NAV.map(({ href, label, hint }) => {
        const active = isActive(path, href)
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            // gap は置かない（段の番号を全廃して並ぶのは呼び名1つだけ。sr-only の説明文は position:absolute で
            // flex の流れから外れるので、gap-0.5 は何にも効いていなかった＝2026-10-20 レビュー S6）
            className={`flex flex-col items-center justify-center h-14 text-xs leading-tight transition-colors ${
              // 現在地は --brand（旧 emerald は 2026-09-11 以前のブランド色の残り。DESIGN.md §10 P1）
              active ? 'text-brand font-semibold' : 'text-muted'
            }`}
          >
            {/* 段の番号（{i + 1}）は 2026-10-19 に全廃した（DESIGN.md §6-7・§10-00。ホームが L2 で番号を
                落としていて規則が割れていたのを、4段にするこの機会に全画面でそろえた）。
                4列なので呼び名だけを置く（最長「くらべる」4文字。390px で折り返さないことを実測） */}
            <span>{label}</span>
            <span className="sr-only">{hint}</span>
          </Link>
        )
      })}
    </nav>
  )
}
