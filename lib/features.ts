/** 投資家モデル（名人）を画面に出すか。2026-09-24 オーナー決定②「いったん無いバージョンで作り直したい。ただしいつでも復活できる形で」。
 *  true に戻せば /watch の名人欄・/stocks/[symbol] の投資家パネル・/learn の投資家モデルタブが元の位置に戻り、
 *  検査スクリプト（check-signals-undecidable.ts / check-analyze-s1.ts / check-features.ts）も同じ定数を読むので期待値が一緒に戻る。
 *  ルールブック本体（lib/investors/rulebooks/）・表示部品（components/investors/）・判定API（/api/signals）は手つかずで残っている。
 *  型を boolean と明示しているのは、リテラル型 false のままだと `SHOW_INVESTOR_MODELS && (...)` の内側を
 *  道具（型検査・lint）が「絶対に通らない枝」と見なしうるため。復活は右辺を true にするだけ。 */
export const SHOW_INVESTOR_MODELS: boolean = false
