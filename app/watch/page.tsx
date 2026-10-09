import { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { SHOW_AI_WATCH } from '@/lib/features'
import { AISessionClient } from './client'

// 「AI自動売買」は実決済と誤読されうるため layout.tsx でサイト名から外した経緯が
// ある。S1「3段の道」（2026-09-29）でこのページはナビの段から外れたので、段の呼び名（旧「見る」）ではなく
// 中身の名前「AIの判断」にする。
//
// 2026-10-09 オーナー指示「いったん全面的に隠す」: lib/features.ts の SHOW_AI_WATCH が false の間は notFound() で 404 にする。
// 公開（未ログインで誰でも読める・noindex にしない・sitemap に載せる）か、全面非表示かの**二択**。
// 「ログインした人にだけ見せる」形は作らない（監督指針 VII-3-1(2)②。scripts/check-watch-reachable.ts が両方の規則を見る）。
// 中身 ./client.tsx は1行も変えていない。定数を true に戻せばそのまま復活する。
export const metadata: Metadata = SHOW_AI_WATCH ? { title: 'AIの判断 — InvestSim' } : {}

export default function WatchPage() {
  if (!SHOW_AI_WATCH) notFound()
  return (
    // 地は root の <body className="bg-background">（--bg・唯一の不透明な面）が塗る。
    // SV1b（2026-09-25）: 切り分け3a で入れた「--surface を 100vmax の影で画面の端まで塗る」仕掛けは撤去した。
    // --surface は半透明なので暗い地の上に広げると一段明るい膜になり、地が #0A0C10 でなくなっていた。
    // 見出し（AIの判断／h1）は client.tsx が持つ。以前はここ（サーバー側）と client.tsx の
    // 貼り付く帯の両方に見出しがあり、h1 が二重・貼り付く帯も二重だった（DESIGN.md §10 P2）。
    // 中央 760px への絞り込みも client.tsx の上半分が持つ（下半分＝運用の記録は 3b-2 で
    // 組み直すまで class は従来のまま。実幅は <main> の max-w-6xl と余白に従い狭くなる）。
    <div className="pt-1 pb-4 md:pb-5">
      <AISessionClient />
    </div>
  )
}
