import type { Viewport } from 'next'

/**
 * 暗い見た目（案B「夜」）の範囲を作るルートグループのレイアウト（S1a・2026-09-25）。
 *
 * なぜルートグループか（DECISIONS.md 2026-09-24「画面を暗い地（#0A0C10）＋青緑（#2DD4BF）に転換」）:
 *   - 暗いトークンは globals.css の `[data-theme="night"]` に**範囲付き**で置き、`:root` は当面触らない。
 *     `:root` を先に差し替えると4段階のページが一斉に暗くなり、そこに残る明るい札がいっせいに光るため。
 *   - モバイルのアドレスバーの色（viewport.themeColor）は Server Component からしか書き出せない
 *     （node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-viewport.md
 *     「only supported in Server Components」）。トップページは 'use client' なので、
 *     このファイルを Server Component のまま保ち、ここで上書きする。**'use client' を付けないこと。**
 *   - `(night)` はフォルダ名の括弧＝ルートグループで、URL には現れない（route-groups.md）。
 *     app/layout.tsx が上にあるので、これはネストした layout（root layout の二重化ではない）。
 *
 * viewport は root → nested の順に浅くマージされ、同じキーは後の段が置き換える
 * （generate-metadata.md「Merging」）。width / initialScale / colorScheme は root のまま、themeColor だけ変わる。
 * colorScheme は root の 'light' のまま残す: `<meta name="color-scheme">` は :root の CSS
 * （globals.css `color-scheme: light`）より弱く、変えても効かない。:root を暗い地に一本化する
 * 最後のスライス（S7）で globals.css と一緒に切り替える。
 *
 * S1c（2026-09-25）で足したもの:
 *   - 背景のにじみ2つ（DESIGN §5-1・§4-2 R5: 1画面2つまで・中心 .22 まで・注記の下に敷かない）。
 *     ページの上端にだけ置き、右端は枠の内側に収める（右・下にはみ出すと横スクロールが出る。上・左の負の位置は
 *     スクロール範囲に入らない）。`isolate` で重なり順の文脈を作り、`-z-10` の子が地の塗りより上・文字より下に描かれるようにする。
 *     `overflow: hidden` で切らないのは、祖先に付けると右列の sticky が効かなくなるため。
 *   - フッターの枠（R10・legal-compliance 2026-09-25）。運営者情報／お問い合わせ／プライバシーポリシー／利用規約の
 *     行き先はまだ無いので <a> にせず文字だけ（「準備中」）。全ページ化は S7。「無料」の語は書かない
 */
export const viewport: Viewport = {
  themeColor: '#0A0C10',
}

export default function NightLayout({ children }: { children: React.ReactNode }) {
  return (
    // 地（--bg）はここで塗る。night の --surface / --card は半透明（白 7% / 3.5%）で、
    // 不透明な面は --bg だけ（DECISIONS 2026-09-24 不変条件「唯一の不透明な面」）。
    // 旧 app/page.tsx は自分で --surface を地として塗っていたが、night では半透明の --surface を
    // <body> の明るい地（:root の --bg）の上にかけるだけになり、画面が暗くならない。
    // 塗り方は旧 page.tsx と同じ「ぼかし 0・広がり 100vmax の box-shadow」:
    //   layout.tsx の <main> は max-w-6xl で中央に絞られ、この要素の背景色だけでは左右に明るい柱が残る。
    //   box-shadow はレイアウトにもスクロール範囲にも入らない「インクのはみ出し」なので、
    //   100vw と違って横スクロールが出ず、上はヘッダーの裏まで、下は画面の下端まで塗り続ける。
    // 文字色（color: var(--ink)）と color-scheme は globals.css の [data-theme="night"] 側で当てる
    // （<body> の color は :root の --ink で確定した値を継承してくるため、範囲の入口で当て直す必要がある）。
    <div data-theme="night" className="relative isolate bg-background shadow-[0_0_0_100vmax_var(--bg)]">
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
      {/* フッターの枠（R10）。中身が未整備でも枠は置く。行き先ができたら <a> に替える */}
      <footer className="mt-12 border-t border-border pt-4">
        <p className="text-small text-muted">
          InvestSim ／ 運営者情報 ／ お問い合わせ ／ プライバシーポリシー ／ 利用規約（いずれも準備中）
        </p>
      </footer>
    </div>
  )
}
