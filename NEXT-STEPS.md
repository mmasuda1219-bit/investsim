# 次にやること（UX改善ロードマップ）

> 作成: 2026-09-03 / 起点: オーナーの改善要望6件
> 目的: 次のセッションで、この1ファイルだけ読めばゼロから再開できるようにする。
> 役割分担: **DECISIONS.md**=決定の理由 / **PROGRESS.md**=日次ログ / **本ファイル**=順序つきの残作業と再開ポイント。
> 進んだら各ステップの `[ ]` を `[x]` にし、分かったことを追記すること。

---

## 0. オーナーが挙げた改善したい点（原文の要約）

1. サイトのデザインの再構築。堅苦しく、見るだけで重荷になる。
2. 分析結果・判断材料・教訓の説明が難しく、理解に時間がかかる。
3. PCでは正しく出るが、スマホだとログインが見切れるなど不完全。
4. 公開サイト https://investsim-nine.vercel.app/ に、その都度の変更を反映してほしい。
5. URLに vercel が入っているので名前を変えたい。
6. タブのアイコンがVercelのままなので、替え方を知りたい。

---

## 1. 調査で分かった事実（2026-09-03 時点・証拠つき）

### 【最重要】公開サイトは約1か月前のままで、止まっている

| 項目 | 実測 |
|---|---|
| `origin/main` の最終コミット | `e1482ce` **2026-08-03** |
| ローカル `learning-4-stages` | origin/main より **19コミット先行** |
| さらに未コミットの変更 | 変更12ファイル＋新規14個（past-trade / universe / trade / 認証まわり など） |
| 本番HTMLのCDN経過時間 | `Age: 2604786` 秒 ≒ **30日** |

つまり **8月にやった作業（学習の4段階への再編、スマホ崩れ修正、アカウント化、AI日次上限）は1つも公開されていない。**
本番のHTMLを実際に取得して確認した内容:

- タイトルが旧文言 `InvestSim — AI自動売買・著名投資家シミュレーター`（ローカルは `投資判断の練習場` に改称済み）
- ナビが旧構成の9本（投資家シミュレーション／AI TRADER／分析／マーケット／スクリーナー／バックテスト／ラボ／AIレポート／ポートフォリオ）。4段階（見る→まねる→やる→振り返る）も下部ナビも入っていない
- ヘッダ右側が `shrink-0` の旧実装。**要望3「スマホでログインが見切れる」の直接の原因**で、修正コミット `2bd216a`（ログインボタンで出た横スクロールを直す）はローカルにあるだけで未デプロイ

→ **要望3と4は同じ原因。まずデプロイを通すことが、他のすべての前提になる。**

### アイコンは、実は既に自作のものが配信されている

- 本番の `<head>` に `<link rel="icon" href="/icon.svg?...">` が出ており、実際に取得すると **緑グラデーションのISモノグラム**が返る（Vercelのロゴではない）。コミット `2d0cb38`「サイトアイコンをISモノグラムに変更」が反映済み。
- ただし **`/favicon.ico` は 404**。`favicon.ico` を要求する場所（ブラウザのタブ復元、ブックマーク、検索結果、Windowsのピン留め等）ではフォールバックが効かず、以前のキャッシュや汎用アイコンが出続けることがある。
- → 見えている「Vercelのアイコン」は、ブラウザのfaviconキャッシュか `/favicon.ico` 不在によるもの、という見立て。手当ては後述 Step 4。

### デプロイすると本番が壊れうる（先に手当てが要る）

本番Supabaseに適用済みのマイグレーションは **0001 と 0002 だけ**。ローカルには 0007 まである。

| ファイル | 状態 |
|---|---|
| 0001_ai_sessions / 0002_universe_fundamentals | 本番適用済み |
| 0003_knowledge_items / 0004_ai_usage_counters / 0005_user_owned_data / 0006_execute_trade | **コミット済みだが本番未適用** |
| 0007_past_trades | **未コミット・未適用** |

→ 何もせず push すると、テーブルの無い状態でアカウント機能・AI上限・売買が動くことになる。**Step 1（DB適用）を飛ばさないこと。**

### 「堅苦しい・重い」の正体（デザイン）

- 本文がほぼ `text-xs`（12px）で、`text-[11px]` `text-[10px]` も多用。例: `app/review/page.tsx` は見出し以外ほぼ全部が11〜12px。
- 本文の淡色 `--muted: #6b7280` が背景 `--bg: #030712` の上。**小さすぎる字＋低コントラスト＋高密度**の3点セットで、読む前に疲れる状態になっている。
- 情報量の偏り: `app/learn/page.tsx` が **1307行**、`app/report/page.tsx` が 865行。1画面に機能を積みすぎている。
- → 「デザインの作り直し」は、色を変える話ではなく **文字サイズ・コントラスト・余白・1画面あたりの情報量**の問題。

---

## 2. やる順序（この順に進める）

順序の考え方: **①まず公開サイトを今の姿にする → ②実機で本当の残りバグを数え直す → ③安く効く土台（名前・アイコン・文字）→ ④中身の言い換え → ⑤画面の作り直し**。
逆順にすると、直したはずのものが公開されず、直っていないものを二度直すことになる。

---

### Step 1 — 本番DBにマイグレーション 0003〜0006 を適用する 【オーナー手動・所要10分】

- [ ] Supabase の SQL Editor で、順番に実行する:
  - [ ] `supabase/migrations/0003_knowledge_items.sql`
  - [ ] `supabase/migrations/0004_ai_usage_counters.sql`
  - [ ] `supabase/migrations/0005_user_owned_data.sql`
  - [ ] `supabase/migrations/0006_execute_trade.sql`
- [ ] 本番の環境変数に `ADMIN_USER_IDS` など `.env.example` の新規キーが入っているかVercelで確認
- **なぜ最初か**: これが無いまま Step 2 を実行すると本番が落ちる。
- **注**: 0007 は未コミットのスライスに属するので、ここではまだ適用しない（Step 2b で扱う）。

### Step 2 — 溜まっている19コミットを本番へ出す 【所要30分・人間ゲート②あり】

**2026-09-05 に事前検証済み:**
- HEAD (`542cff2`) 単体で `tsc --noEmit` 緑・`npm run build` 緑（clean な worktree に `npm ci` して検証。作業ツリー込みのビルドとは別に確認した）
- ビルド結果に `/watch` `/learn` `/trade` `/review` が出て `/screener` `/analyze` は消えている＝4段階の再編が確かに入っている
- `main` (`e1482ce`) は HEAD の祖先 ＝ **早送りのみ**。競合もマージコミットも出ない
- ⚠ この機は Node がツールシェルの PATH に無い。npm/npx の前に `$env:PATH = "C:\Program Files\nodejs;$env:PATH"` が要る。git は Bash ツール側にしか無い

- [x] `npx tsc --noEmit` と `npm run build` が緑であることを確認
- [ ] `learning-4-stages` を `main` へマージし、`git push origin main`
- [ ] Vercel の自動デプロイ完了を確認（Deployments が Ready）
- [ ] 本番で目視: タイトルが「投資判断の練習場」／ナビが4段階／下部ナビが出る／横スクロールが消えた
- **ここで要望3と4が大きく前進する。要望1・2の評価はこの後にやる**（1か月前の画面を見て設計しても無駄になるため）。

### Step 2b — 未コミットの作業をどうするか決める 【判断が要る】

- [ ] 未コミットの26ファイル（`app/api/portfolio/past-trade/`, `app/api/universe/`, `app/review/backfill/`, `components/ReasonFields.tsx`, `lib/trade/`, `scripts/check-*.ts`, `data/universe.json`, `0007_past_trades.sql` ほか）が何のスライスか棚卸しする
- [ ] 出せる状態なら → 0007 を適用 → コミット → push → デプロイ
- [ ] まだなら → Step 2 と分けて後続にする
- **なぜ分けるか**: 19コミットの出荷と未完成スライスを混ぜると、本番で問題が出たとき原因の切り分けができなくなる。

### Step 3 — 実機（スマホ）で点検し直し、残っているバグだけを数える 【所要30分】

- [ ] オーナーが自分のスマホで全ページを開き、崩れている箇所を**具体的に**列挙（画面名＋症状）
- [ ] Step 2 で直っていたものは消し、本当に残っているものだけを本ファイルに追記
- **なぜここか**: 要望3の指摘は1か月前の本番を見てのもの。今のコードでは既に直っている可能性が高く、直っていない分だけを対象にしないと工数が無駄になる。

### Step 4 — 名前（URL）とアイコンを確定させる 【オーナー手動＋実装少し・所要1時間】

要望5・6。デザイン作業より先にやる。理由は、URLが変わると metadataBase・OG画像・認証のリダイレクト先が全部連鎖して直しになるため、**後回しにするほど手戻りが増える**から。

- [ ] **名前を決める**（例: `investsim.app` の独自ドメイン購入 or Vercelプロジェクト名の変更で `investsim.vercel.app` 系に）
  - 独自ドメイン: 年1,000〜3,000円程度。`vercel` の文字が完全に消える。**推奨**
  - プロジェクト名変更: 無料だが `.vercel.app` は残る
- [ ] Vercel ダッシュボードで設定（Settings → Domains、または Settings → General → Project Name）
- [ ] **URL変更で一緒に直すもの（漏らすと壊れる）**:
  - [ ] `app/layout.tsx` の `metadataBase: new URL('https://investsim-nine.vercel.app')`
  - [ ] GitHub Actions の secret `PROD_URL`（`auto-tick.yml` / `learn.yml` / `refresh-fundamentals.yml` の3本が参照）
  - [ ] Supabase → Authentication → URL Configuration の Site URL / Redirect URLs
  - [ ] Google OAuth の承認済みリダイレクトURI
  - [ ] `DECISIONS.md` 内の本番URL記載
- [ ] **アイコン**: `app/favicon.ico` を追加する（Next.js 16 のファイル規約。`favicon.ico` は `app/` 直下のみ有効。既存の `app/icon.svg` / `app/apple-icon.png` はそのまま残す）
- [ ] デプロイ後、シークレットウィンドウで開いてタブのアイコンを確認（通常ウィンドウは古いfaviconを長く保持するので判定に使わない）

### Step 5 — 読みやすさの土台を全ページ一括で入れる 【所要半日〜1日】

要望1・2の**土台**。個別画面の作り直しより先に、全ページに効く共通ルールを決める。

- [ ] designer に「本文タイプスケール＋コントラスト基準」を設計させる。決めること:
  - 本文の最小サイズ（現在12px → 14〜15pxへ引き上げる方向）
  - 淡色テキストの下限コントラスト（`--muted #6b7280` の見直し）
  - 行間・段落間・カード内余白の基準値
  - 数字（株価・損益）と文章のサイズ関係
- [ ] `app/globals.css` のトークンに反映し、builder が全ページの `text-xs` / `text-[11px]` / `text-[10px]` を新スケールへ機械的に置換
- [ ] スマホ実機で再確認（Step 3 のチェックリストを流用）
- **効果**: 「見るだけで重荷」の相当部分は、色ではなくこの3点（字の大きさ・濃さ・余白）で解消する見込み。

### Step 6 — 説明の言い換え（判断材料・分析結果・教訓） 【所要1〜2日】

要望2の**本体**。COMPANY.md 原則11「ゴールは人間の投資スキル向上」に直結する、価値が一番高い工程。

- [ ] 対象を1画面ずつ潰す。優先順: `/review`（振り返る）→ `/watch`（見る）→ `/learn`（まねる）
- [ ] strategist に「専門用語なしで、何を根拠に何を判断したかを言い切る」文言を書かせる
- [ ] 各説明に「一言でいうと」の1行サマリを先に置き、詳細は折りたたむ（結論→根拠の順）
- [ ] 用語集ページ、または用語のその場ツールチップを検討
- **なぜ Step 5 の後か**: 同じ文章でも、字が小さく詰まっていると難しく見える。土台を整えてから読み直すと、本当に言葉が難しい箇所だけが残る。

### Step 7 — 画面ごとのデザイン再構築 【所要数日・スライスに分割】

要望1の**本体**。一番高くつくので最後。

- [ ] `/learn`（1307行）を分解する計画を architect に立てさせる。1画面1目的へ
- [ ] `/report`（865行）と `/learn` の重複を整理（`next.config.ts` で既に `/report → /learn` へ308しているのに実体が両方ある）
- [ ] トップページ（`app/page.tsx`）を「何ができるサイトか」が3秒で分かる形へ
- [ ] 1スライスずつ出荷し、そのつどデプロイして実機確認

### Step 8 — 「その都度反映」を運用ルールにする 【所要30分】

要望4の再発防止。今回の1か月分の滞留は、ルールが無かったことが原因。

- [ ] ルールを決めて `DECISIONS.md` にADRとして記録。案:
  - **1スライス＝1デプロイ**。reviewer通過＋オーナー承認（人間ゲート②）の直後に必ず `push origin main` まで実行する
  - DBマイグレーションを含むスライスは、**先にSupabaseへ適用してから** push する
  - デプロイ後は本番URLを開いて目視確認するまでが「出荷完了」
- [ ] `PROGRESS.md` の日次エントリに「本番反映: 済/未」の欄を足す

---

## 2.5 Step 5-6 の実行計画（2026-09-08 に確定）

Step 1・2・2b は完了済み（公開・動作確認まで）。オーナーから追加のフィードバックが出たため、Step 5-6 を具体化した。

### オーナーの追加フィードバック（2026-09-08）

1. 入門編としてページが**堅苦しく分かりにくい**。もっと分かりやすくしてほしい
2. **怪しまれずに好印象を持たせられる**デザインにしたい
3. **視線誘導をロジックで組み立てて**ほしい（1番目にここ、2番目にここ）
4. スクリーニング結果の**銘柄情報が少なすぎる**
5. **「1分の1成立」が何のことか分からない**

### 調査で判明した事実

- **「N/M件成立」の正体**: そのプリセットが持つファンダ条件の個数のうち、実測で満たした個数。クイック3種は**条件が1つだけ**なので常に `1/1`＝緑バッジで「満点」に見える。投資家モデル3種は3条件で `3/3`。**1条件と3条件が同じ緑で同格に見えている**
- **より重い問題（原則9）**: 画面は「このプリセットの実際の条件」として `conditionNotes` を全文出しているが、`lib/screen/rank.ts` は `fundamentalFilters` **しか**評価していない（63-64行にその旨のコメントあり）。**5条件と読めるのに3条件でしか選別していない**
- **候補1件に会社名が無い**（ティッカーのみ）。各条件の実測値と合否は `gate.evaluations` に**既に入っているのに画面が使っていない**
- **`InvestorModelPicker`**（philosophy・approximationNotes を丁寧に表示する既存部品）が、**銘柄指定ありのパネルにしかマウントされていない**。スクリーニング画面に投資家の考え方が1文字も出ていない
- **視線の順序が反転**: 1番目に来るべき「条件」が10件の候補の後（最下部）、6番目でよい「データ取得日」が行の右上（一等地）
- **サイトが自分の主張を自分で否定**: `/review` は「見るべきは儲けた額ではなく判断の中身」と書きながら、損益を `text-2xl`＝ページ内最大の文字で表示している
- **免責が `text-[11px] text-slate-500`**＝投資詐欺サイトの視覚信号（免責を小さく薄く下に置く）と一致。信頼を作る文章が最も読めない書式になっている
- **「堅苦しい」の1位は字の小ささではなく内部用語**（「キャッシュ済みユニバース」「鮮度切れ」「ゲート」「Opus」「最大DD」）。専門用語で煙幕を張るのは情報商材の常套手段なので、善意の内部語が「わざと難しくしている」と読まれる
- 実測: `--muted #6b7280` on `--panel #111827` = **3.67:1**（AA基準4.5:1 未満）／`--border` on `--panel` = **1.21:1**（輪郭が見えない）／`<main>` に `max-w` 無し

### オーナーのLPデザイン（Claude Design 製）

- URL: https://claude.ai/code/artifact/55b984d4-54f9-472c-8dc2-aedd72823ede （タイトル「ui-ux-pro-max LP修正依頼」）
- **展開済みのHTMLを `design/lp-v1.html` にコミットしてある**（8.7MBのバンドルから `__bundler/template` を取り出してJSONデコードしたもの。再取得する場合は Artifact read → 382行目を `JSON.parse`）
- **設計値がdesigner部門の推奨と独立に一致した**: 本文16px・行間1.9・本文幅520px・見出し52px
- **配色**: 背景 `#0F1113` / 面 `#171A1D` / **アクセント `#E8734A`（テラコッタ）** / 濃 `#D77757` / 成功 `#6FCF9B` / 本文 白70% / 補足 白45%
- **ブランド色が emerald green → orange に変わる。**これは「怪しまれない」に直接効く（緑＋上向き矢印は投資詐欺サイトの視覚言語の第2位）
- 構成: 「投資をはじめて1年目の人へ」→「お金を使わずに、投資の『考え方』を身につける。」→ アプリ画面 → よくある壁 → やることは3つ → 理由が読めること → 5人の答えは割れる → 料金 → FAQ → 最終CTA → 免責
- 第一声が `PERSONA.md` の主ペルソナP1（個別株1年生）と完全に一致している

### オーナーの決定（2026-09-08）

| 論点 | 決定 |
|---|---|
| トップの見出し | **LPデザインを採用**（Claude Design で制作済み） |
| 条件が1つのプリセット | **今は触らない**。見た目（緑バッジで満点に見える）だけ直す |
| 着手順 | **全ページの土台から** |
| LPの料金セクション | **今回は外す**。決済が未実装のまま料金表を出すと景表法・特商法の問題になりうる。決済ができてから戻す |

### スライス（この順に出す）

- [ ] **S1 土台** … `app/globals.css` のトークン差し替え（上記配色＋コントラスト4.5:1以上）、`<main>` に `max-w-6xl`、日本語フォント（Noto Sans JP）追加、`text-[10px]`/`text-[11px]` 全廃・本文を14〜16pxへ、`/review` の損益と見出しの主従逆転を是正、免責を読めるサイズに。**emerald→orange の全置換はS2で行う**
- [ ] **S2 トップページのLP化** … `design/lp-v1.html` をメインサイトに組み込む（オーナー要望「うまくメインのサイトに組み込んでほしい」）。料金セクションは外す。emerald→accent の置換もここで
- [ ] **S3 内部用語の言い換え** … 「キャッシュ済みユニバースを評価中」→「保存済みのデータに条件を当てはめています」等。designer が置換表を作成済み
- [ ] **S4 `/learn` スクリーニング結果の作り直し** … 条件を結果の**上**へ／会社名を出す／条件チップ（実測値＋合否）／N件成立バッジを廃し状態を言葉で／**判定した条件と判定していない条件を分けて表示**（原則9の是正）／データ取得日を一等地から降ろす
- [ ] **S5 投資家の考え方の露出** … `InvestorModelPicker` 相当をスクリーニング画面にも出す。「信念→数字」の翻訳表。`approximationNotes` を1行要約＋展開で

### 2026-09-09 の進捗

- [x] **S1 土台** … コミット `c4ab9d4`（ライト基調への転換も同コミット。オーナーが実画面を見て「暗い」と指摘したため、当初のダーク前提を撤回してライトへ）
- [x] **`/watch` の骨組み** … 判断を主役に・なぜその銘柄かを4段で明示・結論→理由→根拠の3層・運営者UIを一般から分離。`components/watch/TickSummary.tsx` `DecisionCard.tsx`、`lib/ai-trader/universe.ts` 新設
- [ ] **`/watch` の根拠の視覚化** … designer が設計中。テクニカルは注釈つきチャート、銘柄ごとの取引は未使用の `components/AITradeChart.tsx` を活用、ファンダは数値タイル、ニュースはリンク。**`AIDecision` に `fundamentalsData?` と `newsArticles?` を足す改修が要る**（今は文章要約と見出しだけ保存していて、生数値とURLを捨てている）。過去の判断は新フィールドが無いので「当時は保存していない」と正直に出す（原則9）
- オーナーの参照画像: 日経平均と外国人売買を重ねた二軸グラフに「買越／売越」の注釈と矢印。**二軸は dataviz 規則で禁止**なので同じ「連動が見える」効果を二軸なしで出す設計を指示済み

### 2026-09-10 の進捗

- [x] **`/watch` の根拠の視覚化 S0+S1**（データ構造変更なし・過去の判断すべてに効く）… 根拠マップ（3入力→1結論の縦フロー）／ファンダのタイル4枚＋52週メーター＋全項目表（旧文字列の厳密パースで復元・13キー許可リストは書き込み側と一致を確認）／ニュースの「読んだ見出し→AIの読み」並置／銘柄タブ＋取引チャート（未使用だった `AITradeChart` を再配色して配線）＋往復テーブル（未決済を必ず出す）
- **決定（反転可能）**: 買い/売りを色で運ばない。同じページの「利益＝緑」と混ざり「AIが買った＝良いこと」と誤読させるため（原則11）。`AITradeChart.tsx` の `MARKER_COLOR` 1箇所で戻せる
- **dataviz 検証（MC が実行）**: MA20/MA50 の順序ランプ ALL PASS。損益の緑/赤は 2型色覚で ΔE 6.9（6-8 帯）→ ✓/✗＋符号付き数値の併用が必須。設計・実装とも満たしている
- **designer の3訂正**: `technicals` はAIの作文（機械信号ではない）／`techDetail` は死にコード／判断時刻は `memory.ts` の `DecisionRecord` に残っている（二重保存の片方）
- **builder の停止対策が確立**: 「1ファイルだけ読み、1つだけ書き、報告」の単位なら止まらない（6回中4回停止 → 以後ゼロ）。今後の builder 指示はこの単位で出す
- [ ] **S2 判断チャート＋信号チップ＋帯**（`AIDecision` に `decidedAt` `techSignals` `technicalsAt` `fundamentalsData` `newsArticles` を追加。二軸の代替＝時間軸共有の上下パネルを縦の帯が貫く。旧判断は `allDecisions` から時刻復元、復元不可なら縦線を描かない）
- [ ] **S3 ニュースの元記事リンク** … **legal-compliance を先に通す**（外部記事の見出し転載範囲／ニュース＋AI解釈＋売買判断の並置が助言と評価されうるか／リンク先の免責）
- [ ] **S4 根拠ごとの支持/反対/中立を AI に自己申告させる**（`evidenceStance`）… **strategist を先に通す**（プロンプト変更・`DECISION_MAX_TOKENS=2500` の余裕）。寄与%の捏造をせずに発散図を出せるようになる

### 2026-09-11 の進捗（3時間の自律作業・続き）

- **9/10 夜の停止**: 6部署を並行起動した直後に API の利用上限（429・2:10am リセット）で5部署が停止。builder の残骸は健全だった（tsc 0・テスト PASS）。**教訓: 同時起動は3部署まで**。以後そう運用
- [x] **根拠マップの行を図と札に**（オーナー指摘「文章の羅列が見にくい」）… `reading-highlight.ts`（AIの文を1文字も変えずに数値だけ札に・連結一致テスト）／`ReadingText.tsx`／ファンダ行はタイル＋52週メーターを最初から表示＋取得件数の横棒／NavBar の390px横はみ出し修正／chart API を 6mo に（MA50 が全幅で描ける）。**AIの文は表に分解しない**（3指標に評価1つの文を割ると主張が変わる＝原則9）
- [x] **戦略部門の S4 設計を受領**（`evidenceStance`: 根拠ごとに support/oppose/neutral を AI に自己申告させる。`unused` は AI に聞かずサーバー側の事実で判定。理由文は付けない＝トークンと助言性のため）。**副産物の重要な発見**: `engine.ts:435-436` は AI の返事の閉じフェンス ``` が無いと**判断を丸ごと0件にして黙って捨てる**。`DECISION_MAX_TOKENS=2500` は9銘柄でギリギリ・13銘柄では確実に不足。9/9 の「8銘柄中4銘柄しか判断が無い」と一致する可能性 → **S4-0（usage ログ＋打ち切り耐性パース）を S4 本体より先に**
- [x] **AIに渡していたファンダ数値の単位誤り＝確定**（data-engineer 調査＋MC 実測）:
  - Yahoo の `debtToEquity` は**%表記**（AAPL 78.4＝0.78倍）。`engine.ts:307` は倍率 `x` で保存 → AI は「D/E49倍で高レバレッジ」と誤読して判断していた（INTC の判断文で確認）。GOOGL 保存値 18.86 vs 実際 0.1886＝**有効数字4桁で100倍**
  - **`/api/signals/[symbol]` の投資家モデル5人が同じ原因で壊れている**: ダリオ（`>2.0` で売り）は全銘柄に売り、バフェット/グレアム/リンチの低負債条件は永久に不成立。`/stocks/[symbol]` に表示中の**既存バグ**
  - `.T` の時価総額・FCF に `$` 固定（トヨタ 35.9兆円が `$35892B`）
  - **PBR が取れていない**（3銘柄とも `pb: undefined`。summaryDetail から消えた疑い → `defaultKeyStatistics.priceToBook`）
  - ROE・売上成長・配当利回りは小数で正しい（`×100` は正しかった）
  - **採用 C2'**: 正準単位は「Yahoo原値＝%」のまま（`lib/backtest/fundamental.ts:76` の既存規約と一致）。誤読している消費側（`engine.ts` の書式・`signals/route.ts`）だけ直す。書式 v2 は `D/E=78.4%`・通貨は `quote.currency`・末尾 `| fmt=2` で機械判別。**過去の判断文字列は改竄しない**（AI への入力ログ）。表示側で v1 を検出し「当時AIには 49.00倍 と渡していた（単位の誤り）」と注記
  - **却下 C1（プロバイダ層で /100 に正規化）**: 単位は綺麗になるが `universe_fundamentals` キャッシュ（%で保存済み）の無効化・再取得が要り、スクリーニングが再取得まで空になる＝**オーナー判断が要るので後回し**。`investor-presets.ts:70` の `200→2.0` も同時変更が必要
  - ◀ builder が実装中（①types コメント → ②signals 変換 → ③engine 書式v2 → ④PBR フォールバック → ⑤⑥ parse/表示は reviewer 完了後）
- 保存容量（data-engineer）: 本番 API 応答 343KB（上限 4.5MB）。S2 で足す `newsArticles` は**AIに渡した3件だけ**保存＋取得件数を数値で。リッチ項目は直近24件に限定（`/watch` は最新＋12件しか描かない）。`learning.allDecisions` には足さない（+1MB）。**`GET /api/ai-session` が全項目を返す設計は要約に変えるべき**（一覧＝要約／`[id]`＝詳細／decisions はカーソル）— 次スライス候補

### 2026-09-11 午前の続き（reviewer → 修正 → S4-0）

- [x] **reviewer（別の目）**: critical 3・warning 8・suggestion 8。→ `16e5e74` で critical 2＋warning 7＋suggestion 4 を修正（C1 偽の株価で描く経路・C3 買い増し時の損益捏造と虚偽の「売り記録なし」・W1〜W3/W5〜W8・S1/S2/S4/S5/S6）。C2（単位）は `7b1e011`
- [x] **W4 照合（MC）**: 本番の判断264件に mock の固定値と一致するものは **0件**。テストが mock の値を例に使っていただけ
- [x] **S4-0**（`16e5e74`）: `lib/ai-trader/decision-parse.ts` `extractDecisionArray` で打ち切られた返事から完成分だけ救出＋usage/stop_reason を毎回ログ。**`DECISION_MAX_TOKENS=2500` の見直しは、このログが数tick貯まってから**（実測なしに触らない）
- [x] スクリーンショット（qa が停止前に 21枚保存 → MC が目視）: 1280/390/768 とも崩れなし。取引チャートの凡例が選択銘柄に追従することを Playwright で再確認（スクショの CVX/XOM 不一致は dev の再コンパイル中の一瞬）
- ⚠ **利用上限で3回停止**（9/10 夜 5部署、9/11 朝 qa＋builder 2本。fable は「session limit・11:10am リセット」）。今後の運用: **同時起動は2〜3部署**、builder には「1ファイル読み・1つ書き・報告」の単位で出す。止まった builder の残骸は毎回健全だった（tsc で確認してから引き継ぐ）

### 2026-09-11 午後（オーナー指摘「文章が難しい」／ロゴ採用）

- [x] **用語に初心者向けの意味を添える**（`5adc7de` ＋ 地の文への拡張）: AIの文は書き換えない（入力ログ・原則9）。`lib/ai-trader/glossary.ts` に指標14・テクニカル信号13・地の文の語23（本番の判断文842本で説明の無い語を数えて多い順: テクニカル・反発・移動平均・割高・レンジ・過熱・シグナル・レバレッジ・利確 など）。PC はホバー、スマホでも読めるよう文の下の折りたたみ「この文に出てきた用語」。`scripts/check-glossary.ts` が字数・禁止語（おすすめ・買い時 等）・本番の実例を検査
- [x] 数値の札の枠線と左右余白が日本語の文を分断していた → 太字＋点線の下線に
- [x] サイト自身の硬い文言6か所を平易に（「データ元から値が得られず N/A」→「数字が手に入りませんでした」など）
- [x] **ロゴ**（`5adc7de`）: オーナー提供の ChatGPT 生成 PNG を画素実測でベクター化（マークは座標から、文字は Poppins SemiBold と判定して輪郭化、i の点は元デザインどおり縦棒と同じ太さ）。ヘッダー（スマホはマークのみ）・ログイン画面・`app/icon.svg`（白の角丸タイル）・`app/favicon.ico`（**9/03 からの 404 を解消**＝要望6の残り）・`apple-icon.png`・`opengraph-image.png`（明るい地）。作業ファイルは scratchpad/logo（元画像・計測・生成スクリプト）
- **戦略部門は今日も10分無応答で停止**（用語説明の依頼）。MC が執筆。builder/strategist/qa の停止は今日だけで4回 → 小さく刻んでも止まる日がある。内容作成は MC が直接やる方が速い場面がある

### 2026-09-11 夕方（デザイン定義書 v1）

- [x] **`DESIGN.md` を新規作成**（見た目の唯一の基準）: 目的の一文・誰のためか・利用者のゴール・やらないこと／「分かりやすく洗練」の分解／4段階の役割と主ボタン／原則10（PayPay 公開情報から7つ転用＋独自3つ）／トークン（全色のコントラスト比を実測）／部品18種／言葉のルール／数値基準／移行チェックリスト（P0〜P2・ファイル:行つき）／未決13件。オーナーが見る用のページ版: https://claude.ai/code/artifact/01101492-4c89-4f16-88dd-b54cae4e6899 （元ファイルは scratchpad。原本は `DESIGN.md`）
- [x] オーナー決定3点: ブランド色＝ロゴの紺青 `#1A4787`／主役＝4段階の流れ・心臓は `/trade`（`COMPANY.md` 原則12を書き換え）／目的の一文＝「実データと仮想資金で、自分の投資判断を言葉にし、あとから答え合わせできるようになる練習場。」（法務の代案を退けて原文維持＝弁護士確認事項）
- [x] 別の目のレビュー: designer（Tailwind v4 の `@theme inline` 問題・問いは `lib/trade/reason.ts` が正・紺青の用途の一本化・金額はドル建て 等）と legal-compliance（画面間は銘柄だけ引き継ぐ・「リスクゼロ」禁止・全株価に時点表示 等）を反映済み。`DECISIONS.md` に記録
- [x] **同日夜・オーナー指摘「AI が作ったと分かる」→ 囲いと構成を A＋C に決定、未来感は「分析の過程の再生」で**（DECISIONS 同日）。動く見本を本物の第72回で作りオーナー承認。`DESIGN.md` §2 禁止の形・§6-6・§6-19・§10 P1.5 を追加
- [x] **同日夜・実装開始（オーナー「進めて」＝人間ゲート①）**: ①土台（`b1d95c5`）・②読めない所（`3988c8d`）をコミット。オーナー目視 OK 済み。③3a トップ＋/review の囲い撤去（A/C の見本。囲い 20→2、reviewer 指摘3件修正済み。PC 幅で灰の地が端まで届かない不具合を box-shadow 方式で修正。2026-09-12 オーナーが変更前後の比較 https://claude.ai/code/artifact/cdfb4721-5baa-413a-9a81-e88b5a358d0b を見て「**今のままが見やすい**」＝承認。トップの見出しは 24px のまま据え置き）。④4a tick 過程の記録（`lib/ai-trader/tick-record.ts` 新設・`engine.ts`、reviewer「出荷可」・小修正中・**未コミット**）。本番の次 tick から `ticks[]` が貯まり始める
- [x] **2026-09-12 公開**（オーナー承認「出す」＝人間ゲート②）: `e84d26a..38bef85` の5コミット（定義書・切り分け1/2/3a/4a）を main へ早送り push。DB 変更なし。本番で確認: `/ /watch /learn /trade /review /stocks/AAPL /simulate /favicon.ico` すべて200、`/api/ai-session` 200（372KB）、`/api/stocks/ZZZZ` 502（偽の株価を返さない）、トップの HTML に新しいクラス（`rounded-card` 等）。**過程の記録（ticks）は次の平日 tick（9/14 月・米国時間）から本番に入り始める** → 月曜以降に `/api/ai-session` の `ticks[0]` が埋まっているか確認すること
- [ ] **オーナー決定（9/12）: モーション（過程の再生）は「今ある記録で今すぐ作る」**。architect 計画（9/12）: **3b-1**（/watch 上半分の囲い撤去・`client.tsx` 1〜585行・DecisionCard は analyze/DetailsSection の読み込みをやめカード内で開閉・FundamentalsFigure のタイル→表・SiteNav の「● 運用中」撤去・`app/watch/layout.tsx` 削除）と **⑤-1**（`lib/ai-trader/replay-model.ts` 純関数＋`scripts/check-replay-model.ts`。回は ticks を正、無ければ allDecisions の同時刻群。各値に record/recomputed/none。株価は chart API を判断時刻から3か月に切り、判断日の足は判断価格で置換）を**並行で着手済み**（9/12: 3b-1 は reviewer「出荷可」＋小修正まで済み・**コミット `5a0c849`（未公開。⑤-2 と一緒に公開する予定）**／⑤-1 実装完了・検査136件 PASS・reviewer「W1 判断時点の保有を売買から逆算・W2 渡した銘柄数は記録なし・W3 9/14 以降の検査条件」を修正中。どちらも未コミット） → **⑤-2**（9/13: ⑤-1 はコミット `d45290a`（検査166件）。⑤-2 は designer 仕様どおり実装済み・**未コミット**（`components/watch/replay/` 4部品＋`lib/ai-trader/ai-config.ts`、TickSummary 削除、Playwright 60項目 PASS・再生 14.3秒／3倍 4.9秒）。reviewer は Fable の利用枠切れで停止 → Opus で再実行も開始直後に2回停止（10分無応答）→ 9/14 に Sonnet で「A 正しさ」「B 規則とわかりやすさ」の2本に小分けして再実行。**A は「正しさの観点で出荷可」**（記録なしの値の表示なし・engine の定数は値不変・クライアント安全・587行以降不変。warning: 再生中に reduce-motion が途中でオンになっても止まらない／suggestion: 足の取得に AbortController）。**B は開始直後に停止したため MC が実施**: 「記録なし」の重複（段1: 298/314/332、段3: 461/468 の行ごと、段5: 549 と 588 の同じ長文＋モデル/終わり方/トークン/所要時間の4行）、チャートの売買の印と端の名前に白縁取りなし（`ReplayChart.tsx` 226-238）、点の明滅は再生中だけで問題なし、再生中の写真のナビ写り込みは replay 部品に sticky/fixed が無く `scrollIntoView({block:'nearest'})` だけなので**撮影の写り込み（実害なし）**。以上を Opus の builder が修正済み（9/14）: 「記録なし」の出現 16→11（1280・390 とも）、390 の高さ 11402→11233px、再生中に reduce へ切替で 172ms（390）／265ms（1280）で完成状態に、足の取得に AbortController、チャート文字4つに白縁取り、`shoot-replay.mjs` 60項目 PASS のまま、tsc 0・build 成功。追加修正（段5の静止状態の空白・見出しの印との重複）も済み、**⑤-2 をコミット `7c7e65c`（未公開）**。続けて **3b-2（/watch 下半分の囲い撤去・中央760pxの1列・成績タイル→表・いまの相場の帯）は 9/14 実装完了・未コミット**（囲い 31→11、uppercase 9→0、3幅で横はみ出し0、再生の60項目 PASS のまま。Sonnet の reviewer が確認中）。**🔴 変更前からの不具合を発見（9/14 MC 確認）: 名人のシグナル（`components/MasterSignals.tsx`）が5人とも「判定なし」になる**。`/api/signals/AAPL`・`/CVX` は本番・開発版とも 200 で5人分の判定（buffett/soros/lynch/graham/dalio の `action`・`strength`・`reasons`）を返しているのに、本番（変更前のコード `38bef85`）の /watch でも「判定なし」が5回表示される＝部品が応答を読めていない。**原因（reviewer 特定）: `components/MasterSignals.tsx:40` が `setSignals(d)` で応答全体を入れ、102行で `signals[m.id]` をトップレベルで引いている（正しくは `d.signals`）** → **9/14 修正済み**（`d.signals` を読む。AAPL・CVX とも「判定なし」5→0、API の action と画面の札が 5/5 一致）。3b-2 の reviewer 判定は「出荷可」、warning のアルファの負号も U+2212 に修正済み（「−$15127」を画面で確認）。**コミット `6216ed2`（3b-2＋シグナル修正。未公開）**。次: /watch の変更前後の比較写真 → オーナーの承認 → 公開（`38bef85..6216ed2` の5コミット）。**3c（/learn＋analyze/*）の architect 計画も 9/14 に完成し、オーナーが「この計画で進める」と承認（人間ゲート①）→ 3c-1 を Opus の builder に依頼中**: 3c-1 設定（page.tsx 620〜973行＋AnalyzeBanner・ModeScopeBar・ConditionSummaryBar・ReaderProfilePanel・InvestorModelPicker・ProConditionPicker）→ 3c-2 結果（975〜1306行＋MetricStrip・InsightNote・DetailsSection）→ 3c-3 ExecutionPlanCard。`hidden` の3か所（入力を保つ仕掛け）・ラジオの name/onChange・`resetDownstream`・export・文言は変えない。`scripts/check-analyze-{s1,s3,s4,pro,sc}.ts` を緑に。**AI レポート生成は Opus の費用がかかり、呼び出し先にログイン確認は無い → 3c の検証では押さない**。ただし MC 確認（9/14）: `app/api/report/generate/route.ts` 60〜82行で AI を呼ぶ**直前**に `consumeAiQuota`（サイト全体 1日50回・IPごと 1日5回、環境変数で変更可）を消費し、カウンタが読めなければ 503 で止める（fail-closed）。1回約 $0.15 なので**1日の支出の天井は約 $7.5**。無認証は意図的な設計（コード内コメントに理由あり）で、新しい不具合ではない。**builder が見つけた残り（範囲外・未着手）**: `components/watch/TradeLog.tsx` の符号が `n>0?'+':n<0?'-':''`（負が ASCII ハイフン・ゼロに±なし）／運用成績の表の「最大ドローダウン -2.7%」「シャープレシオ -0.14」も ASCII ハイフン → §5-2 の一括統一（P1）で直す／名人の区画の銘柄チップが `useState(initialSymbol)` で最初の値しか読まず、チャートの銘柄を選び直しても追いかけない（常に AAPL で始まる。変更前から）→ 小さな別スライス。3b-2 が済んだら、3b-1・⑤-1・⑤-2・3b-2 をまとめてオーナー確認→公開。**9/14 オーナーが開発版で再生画面を確認し「説明はわかりやすくていいと思うよ」＝説明の量はこのまま**（「段ごとに1行＋詳細は押したときだけ」の削減はしない）。DECISIONS.md の ⑤-2 エントリにも、builder の作業が終わったら1行追記する。修正前後の写真は scratchpad の `shots/replay-before/`・`shots/replay/`。「説明を段ごとに1行＋詳細は押したときだけ」の大きな削減はオーナーの返事待ち。**本番の ticks は 9/14 朝の時点で0件**（tickCount 74・最終 9/11 21:55Z）。自動 tick は平日 UTC 14:37／17:23／19:48（日本時間 23:37／02:23／04:48、`.github/workflows/auto-tick.yml`）なので、9/14 23:37 JST 以降に `/api/ai-session` の `ticks[0]` を確認すること。**MC の目視で「記録なしの説明が段ごとに複数行・段5で重複・スマホで縦に約5画面・チャートの『買 194.91』が線に重なる」**。オーナーに http://localhost:3000/watch で実物を見てもらい「このままでいい／説明が多い」の返事待ち。レビュー指摘とオーナーの返事をまとめて1回で直してからコミット）（`components/watch/replay/*`、TickSummary を置き換え）→ **3b-2**（`client.tsx` 587行以降・TradeLog・MasterSignals・MarketOverview）の順。4b（読み出し API）は ticks 12件で圧縮後150KB超なら着手。**3b-1 レビューで後回しにしたもの**: `components/watch/EvidenceMap.tsx:282` 結論行の札が自前の `border rounded-lg`（8px は §5-4 に無い値。§6-5 は rounded-full・枠なし）→ ⑤-2 か 3c で直す／「根拠を開く」等の文字ボタンのクラス列が3か所に重複（DecisionCard・FundamentalsFigure・client.tsx）→ 3d で `components/ui/TextButton` に抽出
- [ ] **残り**: 3b /watch（囲い約35・ピル15・数字タイル8→表）→ 3c /learn＋analyze/*（約40）→ 3d Band/Row 抽出＋地の敷き方を layout へ → 4b 読み出し API（`/api/ai-session/[id]/ticks`、一覧の要約化＝343KB 問題も同時）→ ⑤ /watch の再生部品（4a の記録が数 tick 貯まってから。見本: https://claude.ai/code/artifact/a554ecc6-8b8c-42d6-bf7a-ee4639af40a6 ）。P0 の免責共通部品化・トップ文言（法務）は別スライス
- [ ] ~~**次の一手: `DESIGN.md` §10 の P0 から builder が1項目ずつ**。~~最初は「トークンを `@theme inline` に登録し、効いていない hover（59か所の疑い）を実機で確認」が効果大（全画面の土台）。計画承認（人間ゲート①）を取ってから
- [ ] 🔴 **legal-compliance 指摘・MC 未検証**: 株価の取得失敗で架空値に切り替わる箇所（`engine.ts` 224・252-254・797・889・906、`app/stocks/[symbol]/page.tsx:23`、`app/api/signals/[symbol]/route.ts:15-17`、`lib/simulation.ts:100・110`）。下の積み残し4（`allowMock`）と同根の可能性。見出しに「実データ」を掲げる前に解消が要る → architect で調査
- [ ] データ提供元の利用規約（Yahoo 商用利用禁止／Twelve Data 再配布契約／J-Quants 私的利用のみ）→ 有料化の前に弁護士確認

### オーナーの判断待ち（2026-09-11 時点）

1. ~~公開してよいか~~ → **2026-09-11 公開済み**（オーナー承認。`b8e53cc..e84d26a` の9コミット＝ライト基調・「見る」の作り直し・根拠の図・単位修正・レビュー修正・打ち切り救出・ロゴ・用語の意味。早送り・DB変更なし）。本番で確認: 主要8ページ200／favicon.ico ほかアイコン類200（9/03 からの 404 解消）／`/api/stocks/ZZZZ` 502・`chart/ZZZZ` 500（偽の株価を返さない）／投資家モデルが「負債資本比率 0.78は健全」と倍率で読む／`/watch` 1280px でロゴ全体・390px でマークのみ・横はみ出し0・コンソールエラー0
2. ~~**ブランド色**~~ → **2026-09-11 決定: ロゴの紺青 `#1A4787`**（`DESIGN.md` §5-1。実装は §10 の移行で。ログインボタンのオレンジもそこで直る）
3. **記録ファイルの保存**: `NEXT-STEPS.md` `DECISIONS.md` `HISTORY.md` `COMPANY.md` に MC の記録と音声秘書セッションの記録が同居。まとめて保存してよいか
4. 単位の規約を全体で倍率に統一するか（C1・スクリーニングが再取得まで空になる）
5. **事業の芯（`marketing/CORE.md`・2026-09-11 起草）の5つの決定**: 北極星を「自分で決めた降りる条件を守れた割合」にするか／最初の5人の集め方／アクセス解析の導入（＋プライバシーポリシー）／「なぜ作ったか」のオーナー自身の体験／MARKETING.md の改訂。**出発点の実測: 本番の登録2（運営側とみられる）・売買記録1・過去取引0・アクセス解析なし＝実利用者ゼロ・計測ゼロ**。成果を掲げられるのは測った後

### 積み残し（記録のみ・優先順）

1. **S2 注釈つきテクニカル図**（オーナーの参照画像の代替）: `AIDecision` に `decidedAt` `techSignals` `technicalsAt` `fundamentalsData` `newsArticles`（AIに渡した3件のみ＋取得件数）を追加。時間軸共有の上下パネルを縦の帯が貫く。旧判断は `memory.ts` の `DecisionRecord` から時刻を復元（symbol+action+price+reasoning 完全一致・1件のときだけ）。**リッチ項目は直近24件に限定**（data-engineer）。designer 仕様は 9/09 の設計に全部ある
2. **S3 ニュースの元記事リンク**: legal-compliance が2回とも利用上限で着手前に停止。**先に法務を通す**（見出し転載の範囲・並置の助言性・リンク先の免責）
3. **S4-1〜3 `evidenceStance`**: strategist 設計済み（3値・理由文なし・`unused` は AI に聞かずサーバーの事実で）。S4-0 のログで打ち切り率を見てから
4. ~~**engine.ts:239-241 の `allowMock` 既定**~~ → **2026-09-17 の architect 調査で決着。行番号は当時のもので、現在生きているのは `engine.ts` 987・1156・1174 の3つだけ**（305・339-341 はスライス A で修正済み）。全9か所を5スライスで塞ぐ計画に統合＝`DECISIONS.md` 2026-09-17。engine の3つは**スライス3**
5. **engine.ts:630,670 が円建て価格を USD 現金から引く**（.T 銘柄）→ architect。W7 は表示を揃えただけで根本は未修正
6. **`generateFullLearning`（engine.ts:586 付近）にも S4-0 と同じ打ち切り全滅の弱点**
7. **`leadingUniqueRun` の近似**（tick 境界を銘柄の重複で推定）→ S2 の `decidedAt` で解消
8. **`GET /api/ai-session` が全項目（343KB）を返す** → 一覧は要約・`[id]` は詳細・decisions はカーソル（data-engineer 案）
9. **C1 単位の全体統一**（プロバイダ層で /100・`investor-presets.ts:70` 200→2.0・`universe_fundamentals` の再取得）→ **オーナー判断**（スクリーニングが再取得まで空になる）
10. `TradingChart.tsx` / `ReferencePanel.tsx` は参照ゼロ → 2ファイルまとめて削除候補。**`TradingChart.tsx` は `app/api/chart/route.ts` の唯一の呼び出し元で、その route の `high/low ?? 0` はフィルタが無く「ヒゲが 0 まで伸びる偽の足」を描きうる**（2026-09-17 architect）→ 2ファイルまとめて**スライス5**で削除（直すのではなく消す）。~~`ReferencePanel.tsx` はその範囲外~~ → **訂正（2026-09-17 architect）: `ReferencePanel.tsx:3` が `import type { Trade } from './TradingChart'` で型を読んでいるので、TradingChart だけ消すと型エラーになる。3ファイル一緒に消す**（ReferencePanel を使っている所は無い。TradeLog.tsx のコメントに名前が出るだけ）
11. `learning.fundamentalInsights` に「D/E が高くても…」等、単位バグ期の教訓が混ざっている可能性 → scout が目視して注記（自動削除しない）
12. `FundamentalsFigure` の未使用 `full` variant（原則8）
13. **502 の不統一**: `app/api/ai-session/[id]/chart/[symbol]/route.ts:61` は `allowMock:false` の失敗で 500 を返す。2026-09-17 に `/api/stocks/` `/api/signals/` を 502（上流のデータ源が返せなかった）へ揃えたので、ここだけ残っている。原則9違反ではない（`allowMock:false` は済み）ので急がない → スライス5で一緒に
14. **エラー文に生の英語が出る2か所**: `components/MasterSignals.tsx:56-58` が画面に「HTTP 502 — …」と出す／`components/InvestorPanel.tsx:94` が「データ取得エラー: {生の英語}」と出す。**後者は 2026-09-17 の変更で `error` が長いチェーン文（3プロバイダの失敗理由の連結）になったため目立ちやすくなった** → スライス2で `MasterSignals` を触るときに一緒に
15. **「知らない銘柄」と「データ源の障害」を言い分けられる**: `app/stocks/[symbol]/page.tsx:80-82` は両方を並べた文言。`/trade`（`app/trade/page.tsx:283`）は `findStock` の結果で「一覧にありません」と言い分けている。同じサーバーコンポーネント内で `findStock(symbol)` を呼べば同じ分岐が作れる
16. **`tsx` が devDependencies に無い**（`package.json:29-39`）。検査の実行手順は `npx tsx` だが未インストールで、npx キャッシュ頼み。キャッシュが消えるとネット取得が要る → `tsx` を devDependencies に足し `"check": "tsx scripts/..."` を scripts に置くと再現性が上がる
17. **約定価格は描画時点の値で固定される**（`app/stocks/[symbol]/page.tsx:47-48`）。`RealtimeQuote` は `/api/stocks/[symbol]` を再取得して表示を更新するが、`TradeButton price={quote.price}` はサーバー描画時の値のまま。2026-09-17 のスライス1で「架空」は塞がったが「古い」は残る。原則9の外だが、売買記録の正確さには効く
18. 🔴 **財務が「一部だけ」取れたときの偽の様子見が残る**（2026-09-17 スライス2 reviewer W1・**原則9の残りの穴**）: `app/api/signals/[symbol]/route.ts:50` の `hasFundamentals` は「19項目のうち1つでも値があるか」なので、`marketCap` と `week52High` だけ取れた場合（yahoo2 で `financialData` モジュールが無い銘柄＝ETF 等。`lib/market/providers/yahoo2.ts:258-260` は undefined を落として返す）は4人のモデルが走り、`buffett.ts:59`／`graham.ts:72`／`dalio.ts:75`／`lynch.ts:32,71` が「○○基準を満たす指標が不足」の hold を返す＝画面は「◇ 様子見」。**架空の数値は作られないが「本物に見える判断」が残る**。変更前からの挙動でスライス2で悪化はしていないが、`DESIGN.md:628`「見出しに『実データ』を掲げる前に解消」の対象。**直し方**: 名人ごとに「判定に使う項目」を持たせ（例 buffett=`pe,pb,roe,debtToEquity,earningsGrowth`）、その名人の項目が1つも無いときに `undecidable` に入れる。`lynch.ts:32` の「PEG比率のデータなし」のようにモデル自身が「データ無し」を理由文に混ぜている箇所も同時に整理。**`scripts/check-signals-undecidable.ts` に既知の穴として assert 済み**＝スライス5で意図的に赤にして直す
19. **空の財務結果がサーバー内で30分キャッシュされる**（同 reviewer W2）: `lib/market/providers/yahoo2.ts:221-222,258-262` は**空 `{}` の結果もそのまま30分キャッシュ**し（`readCache` が `{}` を真として返す）、`lib/market/index.ts:119` はそれを見て yahoodirect（通常 429）へ落ちる。つまり yahoo2 が一度「成功したが空」を返した銘柄は、CDN とは無関係に**同じサーバーが最大30分「判定できません」を返し続ける**。`yahoodirect.ts:162` の `next: { revalidate: 3600 }` でも1時間残りうる。**直し方**: `yahoo2.ts:261` を `if (Object.keys(data).length > 0) writeCache(key, data)` に
20. **名人が何を材料にするかの二重管理**（同 reviewer S3）: `route.ts:28` の `FUNDAMENTALS_INVESTOR_IDS` と各モデルの引数が別々に真実を持ち、検査は正規表現で `analyze({ fundamentals }: AnalysisInput)` の形を読んでいる。18 の修正で名人ごとの必要項目が要るので、そのとき `types/index.ts:77-85` の `InvestorLogic` に `inputs` を1つ足して `investors` から導出すれば、この集合も正規表現検査も不要になる
21. **`InvestorPanel.tsx:57-70` の取得に `alive` ガードが無い**（同 reviewer S6・変更前から）: 銘柄を素早く切り替えると古い応答が勝ち、見出しの銘柄と判定が食い違う。`:61` は `encodeURIComponent` も無い。どちらも `MasterSignals.tsx:81,83,90` には入っている
22. **hold の札の文言が食い違う**（同 reviewer S7・変更前から）: `InvestorPanel.tsx:16`「＝ 保有」／`MasterSignals.tsx:25`「◇ 様子見」。**「保有」は何も持っていない利用者に「持て」と読める**ので誤解を招く → 「◇ 様子見」に統一
23. **検査の約11件が「ソースの文面一致」**（同 reviewer S1）: `scripts/check-signals-undecidable.ts:131-136,219-232`。無害な書き換えで赤になる一方、動作の保証にはならない。内訳は静的13＋振る舞い28＋画面11＝52 で**振る舞い28件は本物**。文面一致は「文面の検査」と明記するか3〜4件に絞る
24. 🔴🔴 **既存セッションの `benchmarkStart` が架空のまま、これから先も効き続ける**（2026-09-17 スライス3 reviewer W2・**スライスB と同種＝書き換えず注記**）: `benchmarkStart` は `engine.ts:986-993` の `startSession` で一度決まるだけで**再取得の経路が無い**（`:1035` の正規化も `undefined→null` のみ）。スライス3より前に乱数の SPY で始まったセッションは、**今後の全 tick で「実データの SPY − 乱数の起点」を `benchmarkPct` として計算**し、`app/watch/client.tsx:921-950` の「SPYリターン」と `components/EquityChart.tsx:59-73` の SPY 線に出し続ける。**ローカルの `data/sessions.json` は2件とも真っ黒**（2026-05-28 開始・`benchmarkStart` 567.8 と 568.37。mock の SPY 種値は `providers/mock.ts:104` の 568.4・sigma 0.010＝帯 565.56〜571.24 のど真ん中）。**本物の SPY は 2026-09-17 実測で 754.05** なので、この起点のままだと「S&P500 は +32% 上昇」という比較が出続ける。**本番（Supabase）は未確認**＝MC が本番読み取りを試みたが自動モードの制限で拒否された（オーナーの許可が要る）。**直し方**: `changeBasis`（`engine.ts:218-220,:1028`）と同じ型で `benchmarkBasis?: 'real-v1'` を `startSession` で付け、印の無いセッションでは `client.tsx:950` と `EquityChart` の SPY 線に「この比較の起点は実データと確認できません」の注記を出す。**値による判別（568 前後）は実際の SPY がその帯に入り得るので使わない**
25. **「評価額の株価取得に失敗N銘柄」の note が利用者に届かない**（同 reviewer W3）: note の生成と置き場（`engine.ts:1209-1210` → `ticks[].stages` の trade 段）は正しく `replay-model.ts:1044-1052` の `stageMs()` が `rec(s.ms, s.note)` で拾うところまで合っているが、**段7「売買」は `trades.length > 0` のときしか replay に積まれず**（約定0件の回＝大半で消える）、積まれても `ReplayStages.tsx:724-745,782-783` の `Trades` 部品と見出しは `st.ms.value` だけを描き `st.ms.note` を一度も出さない。加えて `TICK_RECORD_LIMIT = 12` に対し `equityHistory` は 5000 点なので、**13 tick 後には「取得単価で代用した点」を見分ける手段が無くなる**。**直し方**: `equityHistory` の点に任意項目 `valuationFallbacks?: number` を足し、資産曲線でその点に印を付ける。段7の表示条件を `trades.length > 0 || note あり` に広げる。※オーナーは 2026-09-17 に「/watch の成績の横に『うち N 銘柄は取得単価で計算』と1行添える」を承認済み（判断②）＝この項目と同じ話
26. **SPY が一時的に取れないと、そのセッションは一生ベンチマーク無し**（同 reviewer S3）: `engine.ts:986-993`。原則9 上は正しい挙動だが、画面は「N/A」とだけ出て理由が無い（`client.tsx:950`）。「最初に取れた tick の値を起点にして印と時刻を残す」か「N/A の理由を表示する」かを architect で決める
27. **分析対象が0銘柄でも Claude を呼ぶ**（同 reviewer S4・builder も独立に指摘）: `engine.ts:1103,:536-` に `stockData.length === 0` の早期 return が無い。実データ全滅の回でも AI 呼び出し1回ぶんの費用がかかり、返事は必ず「判断0件」。**費用より、最大40秒の枠（cron 50秒）を無意味に使うほうが痛い**。`decisions: []` と note「分析対象0件のため AI を呼ばず」を返す1分岐で足りる
28. **`buildStockContext` が quote 失敗時も `fetchNews` を並列で投げる**（同 reviewer S5）: `engine.ts:340-345` の `Promise.all`。全滅時に無駄な Yahoo 呼び出しが保有銘柄数ぶん出る。データの正しさには影響なし。`allSettled` の後で news を取るか、quote を先に await するかの2択
29. 🔴 **`/simulate` にも「財務が取れないと4人が様子見と嘘をつく」穴がある**（2026-09-17 スライス4 reviewer W2・**18 と同じ穴の別の入口**）: `/api/signals` はスライス2で `Object.values(f).some(v => v != null)` の門を付けたが、`lib/simulation.ts` には無い。`buffett.ts:12`（graham/dalio/lynch も `:12`）は `!fundamentals` しか見ず `{}` を素通りし、スコア0で hold を返す。`fundamentalsMap[sym]` は `Object.fromEntries` で全銘柄に必ず入るので「財務データを取得中です」の分岐は `/simulate` から到達不能。結果、**Yahoo の財務モジュールだけ落ちている日は、バフェット/リンチ/グレアム/ダリオの `/simulate` が「最終資産＝初期資本・取引0件・勝率0%」を戦略の判断として表示**し、`app/simulate/page.tsx:320` は「このユニバースでは買いシグナルが発生しませんでした」と言う（スライス4より前は模擬財務で架空の買いが出ていたので改善ではある）。**直し方（18 と一緒に）**: 財務が全項目 null の銘柄を数えて `SimResult` に載せ、`page.tsx:320` を「財務データを取得できず判定できなかった銘柄が N 件」に切り替える。財務系4人で全銘柄が null なら「財務データを取得できませんでした」で止める
30. **`/simulate` の検査が文字列一致だけで、`runSimulation` を実際に呼んでいない**（同 reviewer S1）: `scripts/check-previous-close.ts:384-399`。スライス4の「通常時の結果が修正前と同一」「3銘柄だけ取れないと17銘柄で走る」の証拠（md5 一致・JSON 完全一致）は builder のセッション（scratchpad の `engine-compare.ts`）にしか無く、repo から再検証できない。**直し方**: `scripts/check-signals-undecidable.ts:15,93-96` の流儀（`Module._load` で `@/lib/market` を差し替え、本物の関数を呼ぶ）で `check-simulate-no-mock.ts` を作り、(a) 全滅→和文で throw (b) 20中3失敗→`stockResults.length === 17` と `excludedSymbols` 3件 (c) 決定的な日足→結果 JSON のスナップショット一致、を assert
31. **`/simulate` の日付の対応付けが「割合」で、日付で揃えていない**（同 reviewer S4・変更前から）: `lib/simulation.ts:153,192,223,248` の `cutoff = floor(symBars.length * pct)`。11本を超えたが参照銘柄より本数が少ない銘柄（取得元が途中までしか返さなかった日・上場直後）は、**実データだが別の日の価格で売買される**。`time` による対応付けに
32. **`/api/simulate` の想定外の例外が英語のまま画面の見出しに出る**（同 reviewer S5・builder 範囲外1と同件）: `app/api/simulate/route.ts:36` の catch はモデル内部の TypeError 等の英語もそのまま `error` に載せ、`page.tsx:107` がそれを見出しに出す。既定文 `'Simulation failed'` と `Unknown investor: …` も英語。route で和文の固定文にし、原文は `console.error` へ（スライス1 W1 と同じ流儀）。502 化も `/api/signals` に揃えて
33. **`/simulate` の結果表示が DESIGN 移行前のまま**（スライス4 builder 報告）: 損益・札の色が `text-green-700`・`bg-red-50` の直書き、`rounded-xl`、`MiniChart` が暗色テーマの固定色（`#94a3b8`・`#1e293b`）で `components/chartTheme.ts` を使っていない（DESIGN §6-14）。ナビ外の補助機能なので優先度は低い
34. **開発サーバーで `yahoo2.ts` のメモリキャッシュが効いていない可能性**（スライス4 builder 観測・確度低）: 2秒差の2回目も 4.7秒かかり結果が動いた（HISTORY は5分キャッシュのはず）。Turbopack のモジュール分離か、yahoo2 が失敗して無キャッシュの yahoodirect に落ちたか。本番挙動は未確認 → data-engineer の調査候補
35. **決算データの空の結果が1時間残る**（2026-09-17 architect・範囲外で発見）: `lib/market/providers/yahoo2.ts:481` の `getEarnings` は、2つの取得が両方失敗した空の結果を1時間キャッシュし、earnings の route でも CDN に1時間保存される。画面は「取得できませんでした」と正直に出すので、害は古い表示が残ることだけ。積み残し19（空の財務の30分キャッシュ）と同じ形
36. **決算書の欠けた結果が24時間残る**（同上）: `yahoo2.ts:344-351` 付近で、3つの取得の一部が一時的に失敗しても、その欠けた結果を24時間キャッシュする
37. **銘柄検索とニュースの空の結果を10分覚える**（2026-09-18 ①の builder 報告）: `yahoo2.ts:285`（`yf2Search`）・`:313`（`yf2GetNews`）が空配列 `[]` を10分キャッシュし、「本当に0件」と「取りこぼし」が区別できない。重要度は低め。35・36 と一緒に「取れなかった結果を覚えない」の横展開として扱う
38. **一部だけ取れた財務も30分キャッシュされる**（2026-09-18 ① MC レビュー）: ①で「空は覚えない」にしたが、`marketCap` だけのような**一部だけの結果は覚える**（受け取る側 `index.ts:119` の条件と揃えた結果で、①より前から同じ挙動＝今回の変更で悪化はしていない）。ただし**積み残し18（財務が一部だけのとき4人が「様子見」と本物に見える判断を返す）と組み合わさると、その判定が30分続く**。18 を直すときに「一部だけの結果を覚えてよいか」も一緒に決めること
39. **セッション id が同じミリ秒で衝突しうる**（2026-09-18 ② builder 報告）: `lib/ai-trader/engine.ts` の `startSession` は id を `session_${Date.now()}` で作るので、同じミリ秒に2回呼ぶと同じ id になり、保存で前のセッションが上書きされる（検査で3回連続で呼んで実際に衝突した）。作成は運営者だけ（`app/api/ai-session/route.ts` の POST）なので実害は低いが、連打で起こりうる。`crypto.randomUUID()` の一部を足すなどで直せる
40. **SPY を1回の tick で2回問い合わせている**（同上）: `lib/ai-trader/universe.ts:18` の `UNIVERSE` に SPY が入っているため、候補の走査で1回、ベンチマークの比較点で1回取りに行く。取得元のキャッシュでほぼ実害は無い
41. **ファイル store が読み取り失敗を「記録なし」にする**（2026-09-18 軽い API の reviewer W1）: `lib/ai-trader/store.ts:14-23` の `loadFileStore` は `data/sessions.json` の読み取り失敗・JSON 破損を `catch { return new Map() }` で握りつぶすので、`listSessions()` は例外を投げずに `[]` を返す。すると `/api/ai-session/latest` は「記録なし（200）」を60秒キャッシュで返し、トップは「まだ記録がありません」と出す。**踏むのは Supabase の環境変数が無いとき（ローカル開発、または本番で環境変数が抜けたとき）だけ**で、通常の本番（Supabase 経路）は失敗を必ず throw する。直し方: 「ファイルが無い→空／ファイルはあるが読めない・壊れている→throw」に分ける
42. 🟡 **旧記録の「AI の返事が打ち切られ」が事実と違う回がある**（2026-09-18 ③ builder 調査・**オーナー判断待ち**）: 再生画面は `stopReason:'empty'` の回に「AI の返事が打ち切られ」と出すが、`engine.ts` の `askClaude` で `'empty'` になるのは (i) 返事から判断を1件も取り出せない（`raw.length === 0`）と (ii) 取り出したが分析対象に無い銘柄ばかりで0件（`returned === 0`）の2か所で、(i) の原因は「材料0件で呼んだ（AI は `[]` を返す）」「本当に上限で打ち切られた（max_tokens）」「書式崩れ・JSON でない返事」のどれもありうる。**画面の文が事実に合うのは max_tokens の打ち切りのときだけ**。③で今後の「材料0件」の回は `'skipped'` になり正しく出るが、**過去の記録は変わらない**。見分ける手掛かりは記録の中にある: `ai.decisionsExpected === 0` なら材料0件で呼んだ回、段 'ai' の note の `stop=max_tokens` なら本当の打ち切り、`stop=end_turn`／`stop=cli` なら打ち切りではない。直すなら段6の文をこの2つで分ける（**保存値は書き換えず、表示の文だけ変える**＝9/16 スライスB と同じ考え方）。本番で何件が該当するかは未確認（手元の `data/sessions.json` は 8/31 のもので ticks 無し）

### 🔴 調査が要る問題（2026-09-09〜10 に実データで発見）

- **✅ 2026-09-15 00:33 JST 確認: 本番に過程の記録（ticks）が入った**。GitHub Actions の auto-tick は 9/14 に3回とも success（19:34Z・20:57Z・22:44Z。予定時刻から数時間遅れて実行）。本番 `/api/ai-session`（1回だけ取得、426KB・2.3秒、`scratchpad/ai-session-0915.json` に保存）で tickCount 74→77、`ticks` 3件。各回の段の所要: 候補 0.8〜1.0秒・材料 0.3〜0.4秒・知識 0.1秒・**AI 21.9〜24.4秒**・売買 0.2秒。universe 40/40 取得。contexts に MA20・RSI の数値あり。→ 再生画面は 9/14 の回から「記録から」の数字で動く。
- **🔴 同じ記録で発見: AI の返事が3回とも上限で打ち切り**（`ai.stopReason: max_tokens`、出力 2,500/2,500 トークン、返事 3,568〜3,674 文字）。**判断の抜け: 7/9、6/8、8/8**。過去の「72回中42回が判断0件」の原因もこれとほぼ確定。単純に上限を上げると出力速度（約110トークン/秒）から 4,000 トークンで約36秒となり、AI の打ち切り 35秒・cron の 50秒枠にぶつかる → **architect 設計（9/15）: 推奨は S4-1＝(b) 数字の再掲を削る・字数の上限・1件1行の JSON（項目名は変えず過去記録と読み取りは互換）＋(a) `DECISION_MAX_TOKENS` 2,500→3,500・AI の打ち切り 35→40秒（cron 50秒枠: 前段約2秒＋AI 最大40秒＋失敗時の保存5秒＝47秒）**。原因: 1判断 約310〜385トークン、9銘柄で約2,800〜3,500必要。長い理由は字数の上限が無く「FCF・営業利益率」などを判断理由とファンダの文で二重に書き、さらに `engine.ts:677` が数値表を後ろに付けて三重。却下: (c) 2回に分けて並列（2つの AI が同じ現金で二重に買いうる・記録形式が変わる）、(d) 候補 4→3（8銘柄でも切れている・保有は減らせない）。(e) ストリーミング救出は ai.ms>33秒 か timeout が出たら次のスライス。変更: `engine.ts` 576〜594行（出力形式の指示）・482行の注釈、`ai-config.ts`、`ReplayStages.tsx:128`（timeout 表示から秒数を外す）、`scripts/check-decision-parse.ts`。**A の出荷後に着手**。合格条件: 本番の3回で `stopReason:end_turn`・`decisionsReturned==decisionsExpected`・`ms<33000`、`outputTokens÷decisionsReturned` を前後比較。費用 最大 約+0.75円/回。**9/15 オーナー承認（4点とも推奨案）: 数字の繰り返しを削ってよい／費用増（最大 約0.75円/回・月約50円）よい／「今すぐ判断」の待ちが最大40秒でよい／A の公開後に S4-1 を進める**。
- **A（前日比の修正）は 9/15〜16 に実装完了・未コミット**。実測: 新計算と quote の基準が **40/40 一致**（AAPL +1.75%・7203.T −0.20%・SPY +0.85%）、変化率は 38/40 が ±0.01pt 以内（差の2件は東証の取引時間中の数秒の値動き）。**上位4は新 COIN・9984.T・INTC・ADBE／旧 ORCL・NVDA・META・BAC で重なり0**（＝これまでの候補選びは誤った基準だった）。`check-*.ts` 29本 PASS（check-previous-close 78件・check-markets 80件）、tsc 0・build 成功。**reviewer「出荷可」**（warning: `engine.ts` 983・1152・1170 の allowMock 既定 true は今回の範囲外だが原則9の観点で次スライス候補／suggestion: yahoo2 の change と changePercent のフォールバックを揃える・DECISIONS の影響ファイルから ReplayStages を外す（訂正済み）・yahoo2 経路は静的検査のみ）。**→ 9/16 オーナー承認で A をコミット `9015cf1`・公開済み（GitHub commit status「Deployment has completed」01:03Z）。今夜の自動判断から正しい前日比で候補を選ぶ。** **S4-1（打ち切り対策）は 9/16 実装完了・未コミット**: `ai-config.ts` を 3,500トークン・40秒に（cron 50秒枠の内訳 2＋40＋5＝47秒を注釈に）、プロンプトの【返し方】に字数上限（reasoning 80字・fundSignal 60字・techSignal/newsInfluence 各50字）と「数値の再掲禁止」（ファンダと価格はコードが後ろに一覧を付けるため。techSignal だけ RSI か移動平均を1つ可）を追加、項目名・順序・判断基準は不変。`ReplayStages.tsx:130` の打ち切り表示から秒数を外す（過去の回は35秒時代）。`check-decision-parse` 14→24 PASS・`check-*.ts` 29本 PASS・tsc 0・build 成功。**見積り: 1判断 約310〜385→約238トークン（約3割減）、9銘柄で約2,150＝上限の6割・所要 約19〜22秒**。出力の実測はローカルに API キーが無く未実施 → **本番の次の3回で `stopReason:end_turn`・`decisionsReturned==decisionsExpected`・`ms<33,000` を確認**。**reviewer「出荷可」**（critical/warning 0。時間の内訳 47秒 < cron 50秒 < maxDuration 60秒、手動 tick も同枠、`auto.ts` のロック5分と無関係。`ReplayStages.tsx:635` の「今の設定」は定数参照で 128行の秒数除去と矛盾なし）。**suggestion 2件（次の engine 触りのスライスで対応）**: (1) `engine.ts:33,103` に 2026-07-30 当時の「35秒・合計45秒」の見積りが残り、40秒化後の 47秒と食い違って読める → 「現在の内訳は ai-config.ts 参照」と1行添える。(2) `engine.ts:680` の `technicals: r.techSignal ?? sd.technicals` は AI の一文が計算済みの指標文を丸ごと置き換える（既存挙動）。techSignal に50字上限を入れたことで、数値なしの一文が返ると画面から RSI・移動平均の実測値が消える場合が増えうる → fundamentals と同じ「AI の文 | 計算値」の併記に寄せるか検討（原則11）。→ **9/16 オーナー承認でコミット `e78859f`・公開済み（GitHub commit status「Deployment has completed」06:54Z）**。→ **B（過去記録の注記）は 9/16 実装完了・未コミット**（印の無い記録にだけ、段1の変化率の行の直後と判断カードの変化率の下に1行注記。0.00% には「取得できなかった可能性」も。保存値は書き換えない）。検査 112→（本番複製つき）120 PASS、本番複製は回35・印なし35＝全回に注記、画面は 1280/390 で注記8件・12px・横はみ出し0・console error 0。**reviewer「出荷可」**（warning: 印の照合が ±60秒の窓だけで、同じ銘柄が120秒以内に2回判断されると2つの回に一致しうる → 最も近い1件を選ぶ形に／suggestion: `DECIDED_AT_TOLERANCE_MS` のコメントが実値60秒と食い違う・段1の注記を「変化率が1つでも表示されている回」に限定）→ 3点を修正（印の照合を「最も近い回だけが採る」に、許容幅は実測（判断時刻のずれ2ms以内・同銘柄の最短間隔33秒）にもとづき60秒→5秒、数字が1つも出ていない回には注記を出さない）。検査 122件（本番複製つき130件）PASS、旧ロジックに戻すと新設2件が FAIL することも確認。**9/16 オーナー承認でコミット `3b736e4`・公開済み（GitHub commit status「Deployment has completed」07:55Z）**。**【修正前の基準値・2026-09-16 15:35Z に本番から1回取得】** tickCount 80・`ticks` 6件。9/15 の3回（18:26Z・20:17Z・22:26Z、いずれも修正公開前のコード `40dde63`）は**3回とも `stopReason: max_tokens`・出力 2,500/2,500**で、判断は **7/9・5/9・7/9** と欠けていた（所要 27.0〜28.3秒）。`changeBasis` はどの tick・判断にも無し＝全部が旧基準。候補は COIN・9984.T・ORCL・NFLX など。universe は 40/40 取得。保存先: `scratchpad/ai-session-0916.json`。**9/16 の auto-tick はまだ実行されていない**（GitHub Actions の定時実行は数時間ずれることがあり、9/14 は予定 14:37Z → 実際 19:34Z、9/15 は 18:26Z 開始）。**次の tick の後に本番へ1回だけアクセスして確認する項目**: ai.stopReason が end_turn か、decisionsReturned == decisionsExpected か、ai.ms < 33,000 か、outputTokens ÷ decisionsReturned が旧（約310〜385）からどれだけ減ったか、候補の顔ぶれ（新しい前日比で選ばれているか）、universe[].ok:false の出方、changeBasis:'prev-close-v1' が付いているか。**公開後の確認（1回だけ本番へ）**: 新しい候補の顔ぶれ、`ticks[].universe` の `ok:false` の出方、`changeBasis:'prev-close-v1'` の有無、`ai.stopReason`。**9/16 オーナー承認で /learn の3本（`401ec4a`・`ea6d409`・`6b218fd`）を公開**（比較ページ https://claude.ai/code/artifact/f3286a12-7133-4d0e-9fe0-af720895d8d1 ）。
- **A の申し送り（MC 判断・未着手）**: `engine.ts` 983（開始時の SPY）・1149（評価額）・1167（ベンチマーク）は `allowMock` 既定 true のまま／前日比が1銘柄も取れず保有も無い回は分析0件のまま AI を呼ぶ（費用だけかかる。飛ばすか要設計）／出来高はまだ `?? 0`・`|| 0`。
- **B（過去記録の注記）の材料**: `changeBasis` が無い記録は旧基準。quote で取れた回は正しく、予備経路に落ちた回は数日分でも後から区別できない。旧 `?? 0`・`|| 0` のため「0.00%」は実は取得失敗の可能性、旧 tick の `universe` は乱数だった可能性。注記の候補箇所は DecisionCard の「当日」の横・`ReplayStages.tsx:293`・335〜337（ProcessReplay 側で印を渡す変更が要る）。S4-0 の却下 (a)「実測なしに上限を上げない」は、実測がそろったので見直す。
- **⚠️ 前日比の修正（A）の builder は 9/14 に作業を進めた後で停止**（開始直後ではなかった。`lib/market/previous-close.ts`・`scripts/check-previous-close.ts` 新規、providers 3つ・`app/api/markets/route.ts`・`types/index.ts`・`engine.ts`・`tick-record.ts`・`lib/report/prompt.ts`・`DecisionCard.tsx`・`RealtimeQuote.tsx`・`app/trade/page.tsx` が変更済み・未コミット）。MC が一度「ファイルは変わっていない」と誤って伝えたが、すぐ訂正し「今の状態から続ける・上書きしない」で再開中。

- **🔴 2026-09-14 data-engineer 調査: 個別銘柄の前日比のずれは実在**。AAPL（9/11 引け後）の本当の前日比 +1.75%（326.57→332.27）に対し、`lib/market/providers/yahoodirect.ts:108-115`（基準 `chartPreviousClose`＝9/3 の終値）は +1.24%、`yahoo2.ts` の予備経路 108-118（7日前から取得）は +3.84%。`yahoo2` の本経路 `quote()` 145-155 は `regularMarketChangePercent` で正しいが、本番の Vercel では弾かれやすく予備経路に落ちた回が混ざると推測。`twelvedata.ts:91` は正しい。**影響**: 候補選び `engine.ts:296-313`（画面は「当日の変化率が大きい上位4」`ReplayStages.tsx:346`）、AI への前日比 `engine.ts:549`・`lib/report/prompt.ts:305`、記録 `engine.ts:672`（AIDecision.change）・301（TickRecord.universe）、画面 `DecisionCard.tsx:105-106`・`RealtimeQuote.tsx:43-55`・`app/trade/page.tsx:309-311`・`ReplayStages.tsx:293,335-337`。**原則9**: `engine.ts:296,343` は allowMock 既定 true で、取得元が全部失敗すると `mock.ts:272` の乱数の変化率で候補を選ぶ／`yahoodirect.ts:112-113`・`yahoo2.ts:115,118,150,151`・`twelvedata.ts:90-92`・`engine.ts:671-672` が 0 や価格で埋める。**計画**: A 取得の修正（`app/api/markets/route.ts` の `previousClose()` を `lib/market/previous-close.ts` の純関数に移し全経路で共用、yahoo2 本経路は `regularMarketChangePercent`→`regularMarketPreviousClose`→null、予備経路は14日取得、`types/index.ts:6` の change/changePercent を `number|null`、null は候補の順位から外す・AI に「前日比: 取得できず」・画面は「—」、`engine.ts:296,343` を allowMock:false、新しい AIDecision/TickRecord に `changeBasis` の印）→ B 過去記録の注記（書き換えず、印の無い記録に「計算の不具合で最大約5営業日分の変化の可能性」）。**9/14 オーナー承認（4点とも推奨案）: 候補は当日の値動き／過去の記録は書き換えず注記／全部失敗した回は偽の値を使わず候補を減らす／A→レビュー→B の計画で進める** → A を Opus の builder に依頼中（本番アクセス禁止・Yahoo は5回まで）。決定は DECISIONS.md 2026-09-14 に記載。同時に 3c-2（/learn 結果部分）は実装完了（Playwright 87 PASS・3c-1 の 110 PASS 再実行）、**reviewer「出荷可」**（warning: DECISIONS の rounded-full の説明を「成立/参加条件なし/不成立の3状態で同じ札の形」に訂正／`scripts/verify-learn-3c1.mjs` がエラー検出に旧クラス `div.bg-red-50` を使っていて、3c-2 でエラー表示が `role="alert"`＋`bg-danger-tint` になったため今後エラー経路では「時間切れ」で FAIL する → **積み残し: 3c-1 検証スクリプトのロケータを `[role="alert"]` に更新**。suggestion: 結果の見出し `text-xl`→`text-body font-semibold` の階層を designer が最終確認／詳細の帯どうしの間隔 `space-y-6`（24px、§6-6 は 8px）の扱いを 3d で決める）。3c-2 は DECISIONS の訂正後にコミット `ea6d409`。**3c-3（実測カード）も 9/15 実装完了**（Playwright 89 PASS・AI 生成 0回、reviewer 確認中・未コミット）→ **/learn の囲い撤去3本の実装がそろった**。3c-3 のレビュー後にコミット → /learn の変更前後の比較写真 → オーナー承認 → 公開（3c-1 `401ec4a`・3c-2 `ea6d409`・3c-3）。**3c-3 は reviewer「出荷可」**（suggestion: `components/analyze/ExecutionPlanCard.tsx:54` の `ruleDescription` に `font-medium`＝太さ500 が残る。MetricStrip には無い形）。**3d の積み残し**: /learn の表に残る `font-mono`・`font-medium`（§5-2 違反、MetricStrip・ExecutionPlanCard の実測表と往復一覧・`ExecutionPlanCard.tsx:54`・「実行した条件」）を一括で直す／画面検証スクリプトは `next dev` だと開発用ツールの影で「右端の色」が誤 FAIL するので、本番ビルドで測るか開発用ツールを隠す

- **🔴🔴🔴 2026-09-14 10:09 UTC〜 本番の全パスが 403「Vercel Security Checkpoint」（`X-Vercel-Mitigated: challenge`）**。/、/watch、/api/ai-session、/api/markets、/api/cron/tick すべて。ヘッドレス Edge は「ブラウザの確認に失敗しました コード 21」、別ネットワーク（WebFetch）からも 403。**公開自体は成功**（GitHub commit status: Vercel success「Deployment has completed」09:58:34Z、`6216ed2`）。経緯: 07:58Z は API 取得可、09:45Z ごろ Playwright で本番 /watch を開けた、09:52Z〜 MC が公開完了の確認で本番 /watch を15秒ごとに10分ポーリング → 10:09Z に 403。原因は未確定（MC のポーリングによる自動緩和／Attack Challenge Mode／Bot Protection のどれか）。**影響の懸念: GitHub Actions の auto-tick（次は 14:37Z＝23:37 JST、`curl -f`）が 403 で失敗すると ticks が記録されない**（直近の auto-tick は 9/11 まで全部 success）。**オーナーのいつものブラウザでは普通に開ける**（人の閲覧は可）。researcher 調査（Vercel 公式）: 症状は **Attack Challenge Mode（Firewall → Bot Management → Attack Mode）**が有効なときと一致。Attack Mode 中は Firewall のカスタム Bypass ルールより Attack Mode が優先され**効かない**（vercel/community Discussion #7221）。**Vercel Cron Jobs（vercel.json）は自アカウント内の内部リクエストとして素通し、GitHub Actions のような外部 cron は止められる**。Hobby は Custom Rules 3個まで。恒久策の候補: Attack Mode を使わず、守りたい画面パスだけに Challenge のカスタムルールを置き `/api/*` は対象外、または cron を Vercel Cron Jobs に移す（Hobby の cron 回数制限に注意・未確認）。**オーナー確認（9/14）: Attack Mode はオフ（Enable 表示）、Bot Protection は Off か Log、Firewall の Overview に DDoS／Mitigation の記録あり → 原因は Vercel の DDoS 自動緩和（System Mitigation）**。時刻からみて MC の本番への連続アクセス（09:45 の Playwright、09:52〜10:02 の15秒ごとのポーリング、10:09 以降の確認）が引き金になった可能性が高い。自動緩和は通常一定時間で解除される。**9/14 11:00Z ごろのオーナー確認でも Overview の Mitigation は「続いている（Active）」**、Pause のボタンは見当たらず。**今夜 14:37Z（23:37 JST）の auto-tick は 403 で失敗する可能性がある**（壊れるものは無く、ticks が1回分入らないだけ）。**取り戻し方: 緩和が解けた後、GitHub の Actions → auto-tick → 「Run workflow」（workflow_dispatch）で手動実行**（オーナーの操作。MC は gh が無く実行できない）。解けたかの確認は MC が本番へ**1回だけ**アクセスして行う（連続アクセス禁止）。**→ 9/14 11:42Z の1回のアクセスで `/api/ai-session` が HTTP 200・`X-Vercel-Mitigated` なし＝解除を確認**（作動 10:09Z ごろ〜解除 11:42Z までの間）。今夜 14:37Z の auto-tick は通常どおり動く見込み。14:37Z 以降に1回だけ `/api/ai-session` の `tickCount`（74 のまま？）と `ticks[0]` を確認すること。**以後 MC は本番へ連続アクセスしない**（公開完了は GitHub の commit status で確認）。**教訓: 本番へのポーリングは15秒間隔でも避ける。公開完了は GitHub の commit status（`api.github.com/repos/.../commits/<sha>/status`）で確かめる**

- **🔴🔴 2026-09-14 MC 発見・原則9違反（本番で表示中）: 「いまの相場」が架空の固定値**。本番の `GET /api/markets` が `S&P 500 5428 / NASDAQ 17397 / ダウ 39308 / VIX 18.5 / 10年債 4.28、change・changePercent すべて 0` を返しており、これは `app/api/markets/route.ts` 17〜21行に直書きされた値。同じ時刻に開発版（:3000）は本物（S&P 7,656.98 −1.17% 等）を返す＝**Vercel のサーバーからの指数の取得が失敗し、黙って固定値に切り替わっている**と推定。さらに `buffettIndicator`（value 192.5・marketCap 56200・gdp 29200・「著しく割高」）は本番・開発版とも同じ固定値。/watch の冒頭（「いまの相場」の帯）とトップに実データのように表示されている。**原因（route.ts を MC が読んで確認）**: `fetchIndex` は Yahoo の chart API を直接叩き、失敗すると `catch` で `FALLBACKS[symbol]` を**印なしで**返す（45行）。バフェット指標は `^W5000` の価格を「時価総額（十億ドル）」とみなし、GDP は `29200`（2024年）を直書き（55行）。`^W5000` の取得も失敗して固定値 56200 になるため、開発版でも常に 192.5%。**比較写真の「変更後」に本物の指数が写っているのは開発版で取得に成功しているだけで、公開しても本番は固定値のまま**。→ 直し方の候補: 取得失敗時は固定値を返さず「取得できませんでした」（DESIGN §6-12・原則9）、バフェット指標は出どころと時点を示すか、実データが無いなら出さない。「著しく割高」の文言は legal-compliance の指摘（RULES §4）もある。**→ 9/14 修正・公開済み（`40dde63`、GitHub commit status「Deployment has completed」11:17Z）。同日 3c-1（/learn 設定部分）もコミット `401ec4a`（未公開）、3c-2（結果部分）を builder に依頼、`lib/market/providers` の約5営業日ずれの疑いを data-engineer が調査中、HISTORY.md 第13章を追記**。**9/14 オーナー決定:「取れない時は『取得できず』と出す」**（固定値を削除し失敗は `ok:false`・null、成功分に時点、バフェット指標は本物の時価総額・GDP を取る仕組みが無いのでいったん表示をやめる。本番でも取れるようにする調査はその後）→ Opus の builder に依頼中（/learn の builder とビルドが衝突しないよう、tsc と `scripts/check-markets.ts` だけで検証。画面の確認とビルドは MC が後でまとめて。DECISIONS.md は MC が書く）。同じ日に比較ページ https://claude.ai/code/artifact/209b0ebb-d6b4-4c2d-90e4-45e7fc97eb96 を見たオーナーが /watch の変更を「今すぐ公開する」と承認（人間ゲート②）

- **日本株（`.T`）の時価総額・FCF に `$` を付けて保存している**（`engine.ts:308-309`）。Yahoo の値は円建てのはず。原則10（通貨は実単位）に触れる。過去の判断文字列に `$` 表記が残る
- **D/E が「49倍」と保存されている銘柄がある**。Yahoo の debtToEquity は%表記らしく、倍率としてそのまま保存している疑い。AI に渡していた数字の単位が誤っていた可能性 → data-engineer に確認
- **390px で NavBar の損益表示（`+$18,298.82 (+18.30%)`・`whitespace-nowrap`）がページ本体を 455px に広げている**。`2bd216a` と同種。`sm:` 以上でのみ表示か `overflow-x-auto` で1行で直る
- **chart API が `getHistory(symbol, '3mo')` のため MA50 は右端 ~13本分しか描けない**。`6mo` に広げれば解消
- `TradingChart.tsx` / `ReferencePanel.tsx` は使用ゼロ。削除するなら2ファイルまとめて別スライス

- **最新tick(#67)が、分析銘柄を選ぶところまで進んだのに AIの判断を1件も記録していない。** engine は「対象を選ぶ→保存→AIに問う」の順なので、AI呼び出しが空を返した回にこうなる。本番でも起きているか Vercel のログで確認が要る。ローカルは API キー無しで CLI フォールバックのため再現条件が違う
- `AIDecision` に時刻が無く tick 境界が記録されていない。`tickId` / `decidedAt` を持たせるスライスを検討
- **2026-09-11 本番API実測: 72回のうち42回は判断の記録が0件**（`equityHistory` と `tickCount` にだけ痕跡）。`askClaude` の API タイムアウトは捕まえておらず、`runTick` 全体が例外で止まって保存に届かない回もある（`engine.ts` 397-512・932。Explore 調査）→ architect
- **「AIの判断の過程を再生」（/watch・オーナー選択 2026-09-11）に足りない記録**: tick の開始時刻と各段の所要時間／候補40銘柄の変化率と順位／MA・RSI・MACD・BB の数値（`techDetail` は作っているのに捨てている `engine.ts:296`）／ニュース3〜5件目／モデル名・トークン数・stop_reason。今は再生の一部を「記録なし」「同じ取得元から再計算」と明記して見せるしかない → S2（`decidedAt` 追加）と同じスライスで記録を足すか検討
- 既存タブ（運用成績・売買履歴・保有銘柄）が日本株 `.T` にも `$` を付けている。新しい `DecisionCard` は円建てで正しい

### 積み残し・後で相談すること

- ~~**デザインの変更の相談**（オーナーが「あとでしたい」と明言・2026-09-08）~~ → 2026-09-11 `DESIGN.md` v1 として定義済み。残りは実装の移行（§10）
- LPデザイン内の古い記述: `/ai-session`（現在は `/watch`）、「Claude API」（内部の仕組み名は利用者に出さない）
- 「5人の有名投資家」は正しい（`lib/investors/` に buffett/dalio/graham/lynch/soros が実在）が、`/learn` のスクリーニングは3人だけ。表現を合わせる必要がある
- クイックプリセットの条件を1→2に増やす案（strategist 提案・オーナーは「今は触らない」）
- Step 3（スマホ実機点検）は未実施のまま。S1・S2 の後にまとめて行うのが効率的
- **【保留・2026-09-17 オーナー判断「焦らず今はやらない」】Duolingo 風の日々の進歩の記録**。MC の案（未承認・設計未着手）: 数えるのは「考えた」回数（理由つき売買／理由つき見送り／答え合わせ）で**売買回数は数えない**（数えると売買のしすぎを育てる）／**週単位**で1日休んでも途切れない／炎・XP・順位表・紙吹雪なし（`DESIGN.md` §1-4「煽らない」）／自分の過去とだけ比べる／卒業を認める（`JOURNEY.md` S7）。最初の形は `/review` に「週ごとの記録の帯」1本。**再開の目安**: 実利用者が出て `marketing/CORE.md` 先行指標3（別の日に戻って2件目を記録した人の割合）を測れるようになったとき

---

## 3. 次のセッションでの再開手順

1. このファイルを読む
2. `git status` と `git log --oneline origin/main..HEAD` で、Step 2 が済んだかを確認
3. 未着手の最初のステップから始める
4. Step 1 と Step 4 の一部は**オーナーの手作業**なので、そこで止まっていたらオーナーに依頼する

**いまの最初の一手**: Step 1（Supabaseに 0003〜0006 を適用）。これはオーナーにしかできない。

---

## 4. 未確定・要判断の論点

- 新しいドメイン名をどうするか（独自ドメイン購入 or Vercelプロジェクト名変更）— Step 4 で決める
- 未コミット26ファイルのスライス単位 — Step 2b で棚卸しが必要
- Step 5 と Step 6 のどちらを先にするか — 現案は 5→6。オーナーが「言葉のほうが先」と判断するなら入れ替え可
- `/report` と `/learn` の重複をどう畳むか — Step 7 で決める
- 自動進捗記録の hook（`.claude/hooks/session-start.sh` / `session-stop.sh`）が **Windows PC では `jq` 不在のため一度も動いていない**（2026-09-09 判明）。直し方は2択: (a) jq 部分を Node に置き換える（音声秘書 `voice-summary.mjs` と同じやり方・推奨）、(b) オーナーが jq をインストールする。決まったら builder に渡す
- 音声秘書の声（2026-09-09 オーナー要望・2026-09-10 完了・出荷済み）: 標準音声 Haruka が機械的だったのを、無料でクレジットカード登録も不要な VOICEVOX（ローカル動作）へ更新済み。既定の声は青山龍星（オーナー指定）。エンジンが無い・失敗したときは Haruka に自動で戻る。詳細は DECISIONS.md「2026-09-10: 音声秘書の声を VOICEVOX へ」。reviewer 済み（critical 無し）。**残作業（2026-09-10 オーナー判断＝直さずこのまま使い始め、次回対応）**:
  - W1: 音声エンジンの自動起動に失敗すると、失敗したプロセス（約300MB）の後片付けがされず残ることがある（`startEngine` に kill 処理が無い）。あわせて「忙しいだけのエンジン」を1.5秒1回の判定で「死んでいる」と誤判定し二重起動する経路もある（判定をリトライ2〜3回に）
  - W2: `fetchWithTimeout`（`voice-summary.mjs`）が通信の「最初の返事」までしかタイムアウトを効かせておらず、まれに「返事の続き」で止まると無制限に待つ経路が理論上ある。`consume` 関数を渡して本文読み取りまで同じ signal で打ち切る形に直す
  - W3: 「次の指示で音声を止める」処理（`stopSpeaking`）が、PCのスリープ直後などPIDが使い回されるまれな状況で、別の無関係なプロセスを誤って止める可能性が理論上ある。殺す前に `tasklist` でイメージ名が `powershell.exe` か確認する
  - S1: 2026-09-10 の実機テストで「初回の合成が設定の20秒ではなく約120秒かかった」謎の遅延が1回だけ発生し原因未特定。`fetchWithTimeout` のタイマー発火時刻をログに1行足せば、再発時に原因を切り分けられる
  - 直すときは architect 不要（reviewer の指摘がそのまま仕様）、builder に上記4点を渡して reviewer で再確認するだけでよい
- コミット時の注意（2026-09-10 reviewer 指摘）: 作業ツリーに本スライス（音声秘書）と無関係な `/watch` 関連の変更（`components/AITradeChart.tsx` 等）が混在している。コミットする際は DECISIONS.md「影響ファイル」欄の7件だけをステージして分けること
