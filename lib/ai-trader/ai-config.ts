// AI 呼び出しの設定値（純データ）。engine.ts と画面（/watch の「分析の過程の再生」）の両方がここを読む。
//
// engine.ts は child_process と server-only を読み込むためクライアント部品から実体 import できない。
// 画面が「今の設定は 35 秒で打ち切り・返事の上限 2,500 トークン」と書くとき、engine.ts の定数を
// 手で書き写すと将来ずれるので、値の置き場所をここに一本化する（engine.ts 側もここを参照する）。
// I/O・環境変数・副作用を持ち込まないこと（クライアント・サーバー・tsx のどこからでも安全に読める）。

/** Claude に判断を求めるときの打ち切り時間（ms）。根拠は engine.ts の callClaudeApi の注釈。 */
export const CLAUDE_TIMEOUT_MS = 35_000

/** 判断1回の返事の上限トークン数。根拠は engine.ts の注釈（絞りすぎると JSON が途中で切れる）。 */
export const DECISION_MAX_TOKENS = 2500
