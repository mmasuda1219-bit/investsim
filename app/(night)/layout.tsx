// ホームの h1・h2 だけに使う和文明朝（2026-10-25 Steep 版・DECISIONS.md 同日）。セルフホスト・unicode-range で使った字の分だけ通信する。
// 読み込みはこの1行だけ（app/layout.tsx には足さない＝他の画面は明朝を読まない）。書体名は 'Noto Serif JP Variable'（components/entry/home.module.css の --font-display）
import '@fontsource-variable/noto-serif-jp'

/**
 * トップページのルートグループのレイアウト（S1a・2026-09-25 新設、SV1a・2026-09-25 で縮小、L2・2026-10-14 でにじみを撤去）。
 *
 *   - `(night)` はフォルダ名の括弧＝ルートグループで、URL には現れない（route-groups.md）。
 *     app/layout.tsx が上にあるので、これはネストした layout（root layout の二重化ではない）。
 *     名前は暗い地（2026-09-24〜10-12）の名残。L1（2026-10-12）で地を明るい #F6F8FB に戻したが、フォルダ名を
 *     変えると import 先と検査（check-entry.ts・check-theme.ts・check-headings.ts）が一斉に動くので据え置き。
 *   - L2（DECISIONS.md 2026-10-14 決定(2)④）: 背景のにじみ（radial-gradient の2つ）を撤去した。
 *     `design-taste-frontend` のハウスルール「グラデーションを使わない」（inspect.mjs が FAIL にする）をホームに当てる。
 *     明るい #2DD4BF が文字以外で生きていた場所はここだったが、ホームの地は <body> の bg-background だけになる。
 *   - page.tsx は 'use client' なので、Server Component の器としてこの layout を残す（将来、地の塗りを page の外に置く
 *     必要が出たときの置き場。いまは children をそのまま返す）。
 *
 * SV1a で外したもの（DECISIONS.md 2026-09-24 の「移行の方針」を終えた）:
 *   - `data-theme="night"` の範囲印と、地を `--bg` の 100vmax の box-shadow で塗る仕掛け。
 *   - `viewport.themeColor` の上書き（app/layout.tsx の root が同じ値を出す）。
 *   - フッターの枠（R10「全ページ共通」なので app/layout.tsx へ移した）。
 * 'use client' は付けない（Server Component のまま。付ける理由が無い）。
 */
export default function NightLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
