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
2026-10-19 のオーナー決定で、サイトは**4段**（学ぶ→くらべる→書く→振り返り）になった
（2026-09-29 の3段「書く→くらべる→読み返す」から変更。COMPANY.md 原則12）。
並びは難易度ではなく**1つの判断を作る順**（題材を読む → 見くらべる → 自分で書く → 20営業日ほど後に読み返す）
なので、順序を入れ替えない。**段のラベルに番号は付けない**（旧「01 書く」のような添字は全廃）。
呼び名と説明文の正は `components/SiteNav.tsx`（`NAV` が唯一の出所。
href・label・順序は `scripts/check-features.ts`・`check-theme.ts` が固定）。
ナビ本体を4段にするのは S-L1b（`/study` の公開＝S-L1a の次のスライス）。

| 段階 | パス | 位置づけ |
|---|---|---|
| トップ | `/` | LP。匿名訪問者にAI推論を走らせない（AI費用は自己負担のため）。主ボタンは `/trade` 固定 |
| 学ぶ | `/study` | 1社を固定した**練習用の題材**（S-A 2026-10-09 に隠しページ `/lab/9983` として作り、S-L1a 2026-10-19 に `/study` で公開。DECISIONS 両日）。ファーストリテイリング1社・**手入力の実データ**（数値は `lib/lab/9983.ts` の1か所だけ・全数値に出典 `Sourced<T>`）。いつ見るか → 見る → つなげる → 書く → 添削（7節固定・AI なし）→ 学ぶ。**特定銘柄の推奨ではない**ので、1社固定の断りを h1 の直下に無条件で出す。`SHOW_LAB_9983`（`lib/features.ts`・既定 true）が false なら `notFound()`＝**公開か全面非表示かの二択**（到達条件に session/auth を入れない）。公開なので noindex にしない・`app/sitemap.ts` に載せる。`/trade` へ銘柄を引き継がない（`?symbol=` を作らない）・`/stocks/` へ繋がない。§3 の AI は S-B（`LAB_CRITIQUE_AI`・`/privacy`・`/terms` の公開前に true にしない）。ファイルと定数の名は当時のまま（`lib/lab/**`・`components/lab/**`・`SHOW_LAB_9983`）。検査 `scripts/check-lab-9983.ts` |
| くらべる | `/learn` | いまは条件を決めて過去に当てる画面（プレビュー(純計算)→AIレポートの2段）。自分のメモとAIのメモを並べる中身は S3 |
| **書く** | `/trade` | **心臓**。買う理由を書いて残す。**理由の記入を必須にする**（任意にしない） |
| 振り返り | `/review` | 書いた理由と、その後の株価を並べる。金額サマリより先に判断の記録を出す。見出し・本文の動詞「読み返す」はそのまま残す（変えたのは段の呼び名だけ） |
| 振り返りの1件 | `/review/[recordId]` | 「1件のふりかえり」（S3a 2026-09-30）。`recordId` は買いの `Trade.id`（uuid）。AI なし・SQL なし。バッジとフッターの「判定しません」を常時。`app/review/backfill` は固定の区切りなので優先される。sitemap に載せない。S3c（2026-10-01）で「あなたが書いていないことの、出どころ」（発行会社の一次情報の一覧・要約なし・`lib/review/primary-sources/`・`0010_primary_sources.sql`）を §5 の下に足した |
| 段外 | `/watch` | AIの判断と根拠を読む。**ログイン不要**。ナビの段には置かず、「くらべる」の中と全ページ共通フッターの常設リンク（`app/layout.tsx`・無条件）から到達。noindex にしない・`app/sitemap.ts` に残す（`scripts/check-watch-reachable.ts`）。**2026-10-09 から `SHOW_AI_WATCH=false` でいったん全面非表示**（公開か全面非表示かの二択。ログイン必須にしない） |
| 銘柄詳細 | `/stocks/[symbol]` | |
| 認証 | `/auth/login`, `/auth/callback` | |

ナビから外したが残しているもの: `/simulate`（複数銘柄運用の受け皿が `/learn` に
無い。実データで動作）。旧パスの 308 リダイレクトは `next.config.ts` が正。
ただし `/lab/9983` → `/study` の 308 は**足さない**（2026-10-19 オーナー決定。
隠しページだったのでどこからもリンクしておらず、外から来る人がいない。`next.config.ts` は凍結のまま＝
`scripts/check-lab-9983.ts` (f) が HEAD と無変更であることを見る）。

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

## 環境変数（一次情報の取得口・S3c 2026-10-01）

`lib/review/primary-sources/` が読む。どちらも **未設定なら取りに行かず failed**（画面は節を出さないだけで壊れない）。値は `.env.local`（git 管理外）と Vercel の Environment Variables に置く。

| 変数 | 用途 | 未設定のとき |
|---|---|---|
| `SEC_CONTACT_EMAIL` | SEC EDGAR へ送る `User-Agent: investsim (<メール>)` の連絡先（SEC の公正利用の方針。鍵ではなく連絡先） | 米国株の一次情報は failed |
| `EDINET_API_KEY` | 金融庁 EDINET API v2 の鍵（無料登録）。ヘッダ `Ocp-Apim-Subscription-Key` を先に試し、通らなければクエリ `Subscription-Key`。**鍵の載る URL は画面に出さない** | 日本株の一次情報は failed |
