import { redirect } from 'next/navigation'
import { SHOW_INVESTOR_MODELS } from '@/lib/features'

// /simulate は名人（投資家モデル）のロジックで過去データに条件を当てる補助機能で、
// ページ内に名人の選択（バフェット等）と「著名投資家のロジックで…自動売買」の文言を持つ。
// 名人を画面から外している間（DECISIONS.md 2026-09-24 決定(2)・lib/features.ts）は、
// ナビに無くても URL で到達できる穴になるので、ページごと /learn へ送る（legal-compliance 2026-09-28 論点4:
// 文言だけ直す＝名人 UI が残る／名前だけ消す＝出所を伏せる（原則9・R8 の真逆）ので、転送が安全側）。
// 307（一時的な転送）にしているのは、定数を true に戻せばそのまま復活するため。
// page.tsx は 'use client' なので、転送はこのサーバー側の layout で行う。
export default function SimulateLayout({ children }: { children: React.ReactNode }) {
  if (!SHOW_INVESTOR_MODELS) redirect('/learn')
  return children
}
