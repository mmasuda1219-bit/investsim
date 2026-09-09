import { Metadata } from 'next'
import { AISessionClient } from './client'

// 「AI自動売買」は実決済と誤読されうるため layout.tsx でサイト名から外した経緯が
// ある。このページのタイトルだけ旧名のまま残っていたので4段階の呼び名に揃える。
export const metadata: Metadata = { title: '見る — InvestSim' }

export default function WatchPage() {
  return (
    <div className="space-y-4">
      {/* 段階ラベルと見出しは SiteNav の定義をそのまま使う。/trade・/review と
          同じ書式に揃えていないと、4段階のどこにいるのかが画面から読み取れない。
          クライアント側は復元中にスピナーだけを出すため、ここ（サーバー側）に
          置いて復元を待たずに現在地が見えるようにする。 */}
      <header>
        <p className="text-xs font-semibold tracking-[0.18em] text-emerald-700 uppercase">01 見る</p>
        <h1 className="text-2xl font-bold text-ink mt-1">AIと名人の判断を読む</h1>
      </header>
      <AISessionClient />
    </div>
  )
}
