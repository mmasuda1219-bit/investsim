import { Metadata } from 'next'
import { AISessionClient } from './client'

// 「AI自動売買」は実決済と誤読されうるため layout.tsx でサイト名から外した経緯が
// ある。このページのタイトルだけ旧名のまま残っていたので4段階の呼び名に揃える。
export const metadata: Metadata = { title: '見る — InvestSim' }

export default function WatchPage() {
  return (
    // 地（--surface）を画面の端まで敷く（app/page.tsx と同じ手書き・切り分け3a）。
    // 同色・広がり 100vmax・ぼかし 0 の box-shadow は「インクのはみ出し」でレイアウトにも
    // スクロール範囲にも入らないため、100vw と違って横スクロールが出ない。上はヘッダー
    // （sticky・不透明）が上に描かれて隠れる。
    // 見出し（01 見る／h1）は client.tsx が持つ。以前はここ（サーバー側）と client.tsx の
    // 貼り付く帯の両方に見出しがあり、h1 が二重・貼り付く帯も二重だった（DESIGN.md §10 P2）。
    // 中央 760px への絞り込みも client.tsx の上半分が持つ（下半分＝運用の記録は 3b-2 で
    // 組み直すまで class は従来のまま。実幅は <main> の max-w-6xl と余白に従い狭くなる）。
    // 地を layout 側に持たせるのは切り分け3d（共通化）で行う。
    <div className="bg-surface shadow-[0_0_0_100vmax_var(--surface)] pt-1 pb-4 md:pb-5">
      <AISessionClient />
    </div>
  )
}
