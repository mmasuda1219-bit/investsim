/**
 * トップページのルートグループのレイアウト（S1a・2026-09-25 新設、SV1a・2026-09-25 で縮小）。
 *
 * いま残している仕事は1つだけ: 背景のにじみ2つをトップにだけ敷くこと。
 *   - `(night)` はフォルダ名の括弧＝ルートグループで、URL には現れない（route-groups.md）。
 *     app/layout.tsx が上にあるので、これはネストした layout（root layout の二重化ではない）。
 *   - にじみ（DESIGN §5-1・§4-2 R5: 1画面2つまで・中心 .22 まで・注記の下に敷かない）。
 *     ページの上端にだけ置き、右端は枠の内側に収める（右・下にはみ出すと横スクロールが出る。上・左の負の位置は
 *     スクロール範囲に入らない）。`isolate` で重なり順の文脈を作り、`-z-10` の子が地の塗りより上・文字より下に描かれるようにする。
 *     `overflow: hidden` で切らないのは、祖先に付けると右列の sticky が効かなくなるため。
 *   - page.tsx は 'use client' なので、飾りの層を page の外に置く器としてこの layout を残す。
 *
 * SV1a で外したもの（DECISIONS.md 2026-09-24 の「移行の方針」を終えた）:
 *   - `data-theme="night"` の範囲印と、地を `--bg` の 100vmax の box-shadow で塗る仕掛け。
 *     `:root` が暗い地に一本化されたので、<body> の bg-background がそのまま地になる。
 *   - `viewport.themeColor` の上書き（app/layout.tsx の root が同じ '#0A0C10' を出す）。
 *   - フッターの枠（R10「全ページ共通」なので app/layout.tsx へ移した）。
 * 'use client' は付けない（Server Component のまま。付ける理由が無い）。
 */
export default function NightLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative isolate">
      {/* にじみ（背景のぼんやりした光）。青緑 .22 と藍 #818CF8 .16 の2つだけ（R5）。押せない・読まれない */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 -left-20 -z-10 h-[340px] w-[420px] rounded-full bg-[radial-gradient(closest-side,rgb(45_212_191_/_.22),transparent)] md:left-10 md:h-[460px] md:w-[600px] lg:-top-[220px] lg:left-[120px] lg:h-[560px] lg:w-[760px]"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute right-0 -z-10 hidden rounded-full bg-[radial-gradient(closest-side,rgb(129_140_248_/_.16),transparent)] lg:-top-[240px] lg:block lg:h-[480px] lg:w-[560px]"
      />
      {children}
    </div>
  )
}
