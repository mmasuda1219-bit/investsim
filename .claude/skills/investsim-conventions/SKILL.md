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
2026-09-29 の S1「3段の道」で、サイトは**3つの画面**（書く→くらべる→読み返す）になった
（2026-08-23 の4段「見る→まねる→やる→振り返る」から変更。COMPANY.md 原則12）。
並びは難易度ではなく**1件の記録が育つ順**（書いたその日 → 書いた直後 → 20営業日ほど後）
なので、順序を入れ替えない。呼び名と説明文の正は `components/SiteNav.tsx`（`NAV` が唯一の出所。
href・label・順序は `scripts/check-features.ts`・`check-night-theme.ts` が固定）。

| 段階 | パス | 位置づけ |
|---|---|---|
| トップ | `/` | LP。匿名訪問者にAI推論を走らせない（AI費用は自己負担のため）。主ボタンは `/trade` 固定 |
| **01 書く** | `/trade` | **心臓**。買う理由を書いて残す。**理由の記入を必須にする**（任意にしない） |
| 02 くらべる | `/learn` | いまは条件を決めて過去に当てる画面（プレビュー(純計算)→AIレポートの2段）。自分のメモとAIのメモを並べる中身は S3 |
| 03 読み返す | `/review` | 書いた理由と、その後の株価を並べる。金額サマリより先に判断の記録を出す |
| 03 の1件 | `/review/[recordId]` | 「1件のふりかえり」（S3a 2026-09-30）。`recordId` は買いの `Trade.id`（uuid）。AI なし・SQL なし。バッジとフッターの「判定しません」を常時。`app/review/backfill` は固定の区切りなので優先される。sitemap に載せない |
| 段外 | `/watch` | AIの判断と根拠を読む。**ログイン不要**。ナビの段には置かず、02 の中と全ページ共通フッターの常設リンク（`app/layout.tsx`・無条件）から到達。noindex にしない・`app/sitemap.ts` に残す（`scripts/check-watch-reachable.ts`） |
| 銘柄詳細 | `/stocks/[symbol]` | |
| 認証 | `/auth/login`, `/auth/callback` | |

ナビから外したが残しているもの: `/simulate`（複数銘柄運用の受け皿が `/learn` に
無い。実データで動作）。旧パスの 308 リダイレクトは `next.config.ts` が正。

**削除済み**: `/screener`（2026-09-01。全行がモックデータ読みで原則9違反だった。
実データ版の自由条件スクリーニングは別スライスで作る）。

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
