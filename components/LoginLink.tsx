'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { loginHref } from '@/lib/auth/next-path'

// 「いま見ているページに戻ってこられる」ログインリンク。
//
// ログインの入口はヘッダ・/trade・/review・売買モーダルに散っている。どこも
// «現在地を next に載せる» という同じ処理が要るので、各所で usePathname を
// 書く代わりにこの部品にまとめる（見た目は呼び出し側の className に従う）。
export function LoginLink({
  className,
  children = 'ログイン',
}: {
  className?: string
  children?: React.ReactNode
}) {
  const pathname = usePathname()
  return (
    <Link href={loginHref(pathname)} className={className}>
      {children}
    </Link>
  )
}
