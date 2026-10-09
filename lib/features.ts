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
