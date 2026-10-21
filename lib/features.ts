/** 投資家モデル（名人）を画面に出すか。2026-09-24 オーナー決定②「いったん無いバージョンで作り直したい。ただしいつでも復活できる形で」。
 *  true に戻せば /watch の名人欄・/stocks/[symbol] の投資家パネル・/learn の投資家モデルタブが元の位置に戻り、
 *  検査スクリプト（check-signals-undecidable.ts / check-analyze-s1.ts / check-features.ts）も同じ定数を読むので期待値が一緒に戻る。
 *  ルールブック本体（lib/investors/rulebooks/）・表示部品（components/investors/）・判定API（/api/signals）は手つかずで残っている。
 *  型を boolean と明示しているのは、リテラル型 false のままだと `SHOW_INVESTOR_MODELS && (...)` の内側を
 *  道具（型検査・lint）が「絶対に通らない枝」と見なしうるため。復活は右辺を true にするだけ。 */
export const SHOW_INVESTOR_MODELS: boolean = false

/** /watch（AIが仮想資金で売買した判断を読む画面）を公開するか。2026-10-09 オーナー指示「いったん全面的に隠す」。
 *  true に戻せば入口（app/layout.tsx のフッター・app/(night)/page.tsx・app/review/page.tsx・app/review/[recordId]/page.tsx）・
 *  sitemap（app/sitemap.ts）・画面（app/watch/page.tsx）が同時に戻る。検査（scripts/check-watch-reachable.ts・check-entry.ts）も
 *  同じ定数を読むので期待値が一緒に戻る。画面の中身 app/watch/client.tsx・部品 components/watch/・API /api/ai-session は手つかず。
 *
 *  法的な線（監督指針 VII-3-1(2)②・MC 2026-10-07 原文確認）: 「会員登録等を行わないと投資情報等を購入・利用できない
 *  （単発での購入・利用を受け付けない）ような場合には登録が必要となる」。したがってこの定数は
 *  **公開（誰でも読める）か、全面非表示（投資情報を一切出さない）かの二択**であり、その中間＝「ログインした人にだけ見せる」
 *  形を作らない。この定数の右辺や、この定数と組み合わせる条件に session / user / cookies / headers / auth を入れない。
 *  型を boolean と明示する理由は SHOW_INVESTOR_MODELS と同じ。復活は右辺を true にするだけ。 */
export const SHOW_AI_WATCH: boolean = false

/** /study「学ぶ」（ファーストリテイリング1社・手入力の実データ・添削）を出すか。2026-10-09 S-A で隠しページ /lab/9983 として作り、
 *  2026-10-19 オーナー決定（S-L1a・DECISIONS 同日）で住所を /study に移して**公開**した。定数名は当時のまま（改名は別スライス・NEXT-STEPS.md）。
 *
 *  公開に変えたので、隠していた3つの仕掛けを外した:
 *   - app/study/page.tsx の `metadata.robots` を書かない（＝既定の index, follow。noindex を外した）
 *   - app/sitemap.ts の PUBLIC_PATHS にこの定数と連動で /study を載せた
 *   - 入口はナビ（components/SiteNav.tsx の NAV・4段の1段目。S-L1b）。それ以外から /study へリンクしない
 *  **全面非表示に戻すときは3点セット**（2026-10-20 レビュー W2。この定数だけ倒すと、ナビの1段目が 404 を指したまま
 *  全ページに残る＝利用者が必ず踏む壊れた入口になる。`NAV` は /study を無条件に載せているため）:
 *   ① この定数を false にする（app/study/page.tsx が notFound() で 404・app/sitemap.ts からも消える）
 *   ② components/SiteNav.tsx の `NAV` から1段目（学ぶ・/study）を外す（3段に戻す）
 *   ③ 検査の期待値を3段に戻す: scripts/check-features.ts と check-theme.ts の `NAV_FIXED`、
 *      check-lab-9983.ts (e) の `ALLOWED_LINKERS`・「NAV の1段目」・(g) の `SHOW_LAB_9983 === true`
 *  ①だけやると check-features.ts の「SHOW_LAB_9983 と NAV の /study が一致」が落ちて気づける。
 *
 *  **継承する不変条件**（SHOW_AI_WATCH と同じ。監督指針 VII-3-1(2)②「会員登録等を行わないと投資情報等を購入・利用できない
 *  （単発での購入・利用を受け付けない）ような場合には登録が必要となる」）: この定数は**公開（誰でも読める）か、全面非表示かの二択**で、
 *  その中間＝「ログインした人にだけ見せる」形を作らない。**この定数の右辺や、この定数と組み合わせる条件に
 *  session / user / cookies / headers / auth を入れない**。
 *  型を boolean と明示する理由は SHOW_INVESTOR_MODELS と同じ。検査: scripts/check-lab-9983.ts (e)(g)・check-features.ts。 */
export const SHOW_LAB_9983: boolean = true

/** /study の添削 §3「計算の確かめと、確認したいこと」に AI（Anthropic API）を使うか。S-B で使う。いまは経路そのものが無い。
 *  /privacy と /terms を公開する前に true にしない（個人情報保護法28条・DECISIONS 2026-10-09 の不変条件。これは絶対）。
 *  画面を公開した（SHOW_LAB_9983 = true・2026-10-19）ことはこの線を動かさない。true でも ANTHROPIC_API_KEY と
 *  /privacy・/terms の実在が揃わなければ 503 にする（S-B の guard）。 */
export const LAB_CRITIQUE_AI: boolean = false

/** /study の符号（前期比のプラス・マイナス、棒・点の塗り）に色を付けるか。
 *  2026-10-09 オーナーの2度目の要望により /study（旧 /lab/9983）でのみ色を使う（プラス --success／マイナス --danger）。false にすれば無彩色に戻る。
 *  色は足すだけで、位置（ゼロ線の上下）・形（中空と塗り）・符号（U+2212）・語（マイナス）の手がかりは外さない（色が見分けにくい方のため）。
 *  --danger を「取り消せない操作」以外に使うのはこのページだけの例外（DESIGN.md §4 P8 の例外。他の画面には広げない）。
 *  色を出す口は lib/lab/display.ts の signStyle（class）と signColor（SVG の塗り）の2か所だけ。components/lab/** には --success／--danger を書かない。 */
export const LAB_SIGN_COLOR: boolean = true
