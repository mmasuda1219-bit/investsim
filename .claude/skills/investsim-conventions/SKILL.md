---
name: investsim-conventions
description: investsimのプロジェクト規約（ディレクトリ構成・投資家モデルパターン・マーケットプロバイダパターン）。architect/builderが実装前に参照する。
---

# investsim-conventions

## 技術スタック
- Next.js / React / TypeScript
- Tailwind CSS
- Anthropic SDK（Claude連携）
- Supabase（認証・DB）
- lightweight-charts（チャート表示）
- yahoo-finance2（相場データ）

## ページ構成
| ページ | パス | 位置づけ |
|---|---|---|
| トップ | `/` | リアルタイムAI判断表示が理想（過去データのハードコード表示は避ける） |
| マーケット一覧 | `/markets` | |
| スクリーナー | `/screener` | |
| ポートフォリオ | `/portfolio` | |
| バックテスト | `/simulate` | 補助機能。中核ではない |
| 銘柄詳細 | `/stocks/[symbol]` | |
| AIセッション | `/ai-session` | **中核機能**。リアルタイムデータ+Claude AIで自律売買 |
| 認証 | `/auth/login`, `/auth/callback` | |

## 投資家モデル
バフェット / ソロス / リンチ / グレアム / ダリオ。各々 `lib/investors/` に実装。新しい投資家モデルを追加する際もこのディレクトリパターンに従う。

## AI自動売買エンジン
`lib/ai-trader/engine.ts` が中心。
- Yahoo Financeからリアルタイム株価取得
- ボラティリティ上位銘柄を自動スクリーニング
- Claude AIがテクニカル・ファンダメンタル・ニュースを総合判断
- 売買履歴から教訓を蓄積する学習メモリ: `lib/ai-trader/memory.ts`
- SPYベンチマーク比較、シャープレシオ・最大ドローダウン計算

新機能・修正を行うときは、この学習ループ（学習メモリへの蓄積・参照）を壊さないこと。
