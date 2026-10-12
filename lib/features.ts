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

/** /lab/9983（「添削プロトタイプ」・ファーストリテイリング1社・手入力の実データ）を出すか。2026-10-09 S-A（DECISIONS 同日）。
 *  false の間は app/lab/9983/page.tsx が notFound() で 404。true にしても noindex・sitemap に載せない・どこからもリンクしない
 *  （URL を知っている人だけが開ける隠しページ）。SHOW_AI_WATCH と同じく、この定数の右辺や組み合わせる条件に
 *  session / user / cookies / headers / auth を入れない（「ログインした人にだけ見せる」形を作らない）。
 *  検査: scripts/check-lab-9983.ts・check-features.ts。復活は右辺を true にするだけ。 */
export const SHOW_LAB_9983: boolean = false

/** /lab/9983 の添削 §3「誤り・要確認」に AI（Anthropic API）を使うか。S-B で使う。S-A では経路そのものが無い。
 *  /privacy と /terms を公開する前に true にしない（個人情報保護法28条・DECISIONS 2026-10-09 の不変条件。これは絶対）。
 *  true でも ANTHROPIC_API_KEY と /privacy・/terms の実在が揃わなければ 503 にする（S-B の guard）。 */
export const LAB_CRITIQUE_AI: boolean = false

/** /lab/9983 の符号（前期比のプラス・マイナス、棒・点の塗り）に色を付けるか。
 *  2026-10-09 オーナーの2度目の要望により /lab/9983 でのみ色を使う（プラス --success／マイナス --danger）。false にすれば無彩色に戻る。
 *  色は足すだけで、位置（ゼロ線の上下）・形（中空と塗り）・符号（U+2212）・語（マイナス）の手がかりは外さない（色が見分けにくい方のため）。
 *  --danger を「取り消せない操作」以外に使うのはこのページだけの例外（DESIGN.md §4 P8 の例外。他の画面には広げない）。
 *  色を出す口は lib/lab/display.ts の signStyle（class）と signColor（SVG の塗り）の2か所だけ。components/lab/** には --success／--danger を書かない。 */
export const LAB_SIGN_COLOR: boolean = true
