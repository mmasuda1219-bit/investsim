# InvestSim 進捗ログ（秘書部門管理）

> 目的: 「毎日の進歩」と「次の一手」を残し、翌日ゼロから続きを再開できるようにする。
> 役割分担: **DECISIONS.md**=非自明な設計判断の理由 / **自動メモリ**=セッションを跨ぐ恒久事実 / **本ファイル**=日次の作業ログと再開ポイント。
> 書式: 新しい日付を上に追記（逆時系列）。1日1エントリ。記入は秘書部門（`.claude/agents/secretary.md`）が担当。

---

## テンプレート（コピーして使う）

```
## YYYY-MM-DD

- **今日のゴール**: （1文）
- **やったこと**: （出荷・コミット・決定を箇条書き。DECISIONS/コミットへの参照可）
- **現在の状態**: （どのスライスのどこまで完了しているか）
- **次の一手**: （明日まず着手すること。具体的に）
- **未解決・ブロッカー**: （あれば。人間ゲート待ち・要調査など）
```

---

## 2026-07-30

- **今日のゴール**: 本番スクリーニングの500エラーを解消し、オーナー方針転換（課金延期・初心者向け分析優先）をもとに次スライス計画を承認される。
- **やったこと**:
  - 本番 POST /api/analyze/screen（quick/安定重視）の500エラーを解消・実データ確認完了。
    - 原因特定：本番 Supabase に universe_fundamentals テーブル未作成＋service_role キー無かった。対処：(1)オーナーがマイグレーション0002実行、(2)service_role キーを .env.local に追記、(3)MCがシード実行。
    - シードハマり：Node 20では WebSocket support エラー→`nvm use 22` で解決（コード変更なし）。
    - 結果：seed-fundamentals.ts **105銘柄すべて保存・エラー0**。本番テーブル105行確認。本番API HTTP 200で実データランキング返却・meta=80評価/25除外(正直fail-closed)。Vercel本番も同一Supabase参照確認。
  - **オーナー方針転換承認**:
    - 課金制度の導入をシステム/UI完成後に延期。
    - 第一優先を「初心者〜一般個人投資家向けの、一流でパーソナライズされた分析（他社スクリーニングに勝つ差別化）」に設定。
    - S5b/S6を一旦保留。その代わり新スライス S1（読者プロファイル3-4問＋意味づけ強制）を先行実装→S2/S3/S4/S5と繋ぐ。
  - **調査フェーズ完了**:
    - scout による競合調査（Simply Wall St/Seeking Alpha/Finviz/moomoo/Motley Fool/楽天/マネックス/みんかぶ）→投資simが勝てる差別化上位5特定。
    - KNOWLEDGE.md に「一流の初心者向け分析の型」4エントリ蓄積＋改善案7件（出典付き）。
  - **戦略的発見**: 日本の初心者向けなら日本株が構造整合。investsim最大弱点「過去ファンダ取得不可」は日本株なら J-Quants(有料)で5-10年財務取得可→解決。ただし US先行→日本株第2弾で合意。
  - **strategist 設計→オーナー承認**:
    - 芯=「合成スコアでなく、信念→実指標→意味づけ→読者プロファイル適合の説明できる写像」。
    - パーソナライズ=初心者向け3-4問（投資期間/リスク耐性/スタイル志向 income-growth-value/（任意）資金性格）。
    - レンズは見せ方（順序/語り口/意味づけ/適合判定）のみ変え、数値・ゲート・バックテストは不変（原則9）。
    - DCF/内在価値は評価器不在ゆえ作らない（原則9）。
  - **人間ゲート①承認**: S1（読者プロファイル3-4問＋意味づけ強制）から着手＋US先行をオーナー承認。
  - **S1実装をbuilder(Fable)に発注中**: 新規ファイル lib/report/profile.ts＋prompt.ts（任意 profile 引数＋意味づけ強制常時）＋generate/route.ts（body.profile 検証）＋analyze/page.tsx（3-4問UI）＋types.ts＋DECISIONS 記入予定。prepare/ゲート/バックテストは無改修。
- **現在の状態**: S1（読者プロファイル）実装中（Fable），US先行。本番スクリーニング前段修復済み（105行シード・実データランキング稼働）。残スライス S2(テーゼ化)/S3(レーダー・割安ゲージ)/S4(用語ツールチップ)/S5(学習アンチパターン)。保留中: S5b/S6、課金制度。
- **次の一手**: (1)S1実装完了待ち（Fable）。(2)S1 reviewer→人間ゲート②出荷前承認。(3)並行してオーナーが refresh-fundamentals/auto-tick workflow_dispatch で初回疎通確認（保留中）。
- **未解決・ブロッカー**: (1)S1実装進捗(Fable monitor・標的日 TBD)。(2)refresh-fundamentals/auto-tick workflow_dispatch 疎通（オーナー手動、並行可）。data/sessions.json は自動tick副産物でコミット除外継続。

---

## 2026-07-25

- **今日のゴール**: S5c-2「ユニバース・ファンダの鮮度top-up cron」を出荷する。
- **やったこと**:
  - S5c-2出荷完了。コミット `0202a8c`（4ファイル=lib/screen/refresh.ts, app/api/cron/refresh-fundamentals/route.ts, .github/workflows/refresh-fundamentals.yml, scripts/check-screen-refresh.ts）。
    - ユニバース・ファンダの鮮度top-up cron：S5c-1（初期キャッシュ）後の universe_fundamentals テーブルを日次更新。オーナー承認済み。
    - 内容：refresh-fundamentals cronエンドポイント（Bearer CRON_SECRET・maxDuration 60・tickパターン踏襲）、lib/screen/refresh.ts（refreshStaleFundamentals=listStaleTargets(6)で古い順に小バッチ→逐次1.5s spacing→getFundamentals→upsertCached・TIME_BUDGET 50s打ち切り・no_data/例外は既存キャッシュ温存でskip・依存注入でネット無しスモーク可）、専用GitHub Actions workflow（US平日13-21時UTC毎時・分:15固定でauto-tick(:37/:23/:48)と衝突回避・既存Secrets PROD_URL/CRON_SECRET流用・約54件/日で104銘柄を約2日一巡）。
    - テスト：tsc 緑、スモーク＋回帰PASS、reviewer critical/warning ゼロ。
  - **B/C/D 全コミット完了**:
    - B. auto-tick 504 ホットフィックス（本番恒常504障害の修正）→ コミット `efb32c9`。
      - 原因：@anthropic-ai/sdk既定（timeout 10分/retry 2）がVercel 60秒killを誘発。
      - 修正：callClaudeApi に timeout 20s/maxRetries 1、app/api/cron/tick/route.ts に withDeadline（残余バジェット応答・実エラー素通し・締切後完走はログのみ）。
      - 既知の限界（真のキャンセルでない・過少報告側に倒れる）は DECISIONS.md 明記。
      - reviewer 指摘修正（未実装ペルソナの拒否=原則9、withDeadlineのonLateSettleログ）は committed 確認済み。
    - C. 投資家ペルソナ機能スライス1（配管＋バフェット）→ コミット `05a78ed`（並行セッション実施）。
      - personas.ts(新) + engine.ts 中核 + app/ai-session/* + types/index.ts。
      - engine.ts では B/C が不可分混在のため同一コミット入り。
    - D. 新部署5つ（オーナー追加）→ コミット `3c4d2fc`。
      - COMPANY.md + .claude/agents/{qa,designer,data-engineer,strategist,scout}.md + KNOWLEDGE.md + DECISIONS 2件。
  - **git インデックス破損と復旧**:
    - 作業中、並行セッション git 操作＋iCloud 上 repo の組み合わせで一時的に .git/index.lock(stale) が残存。全ファイルが削除ステージ＋未追跡表示（インデックス空状態）。
    - 非破壊の `git reset --mixed` でインデックスを HEAD に復旧。ファイル・コミット一切失わず。
    - 教訓：同時に git 操作するセッションは1つに絞る（メモリ project-git-icloud-concurrency-hazard 記録）。
  - **push/デプロイ完了**:
    - 最終 HEAD `efb32c9` の tsc 緑を確認。
    - fast-forward (19コミット) で `git push origin main` 実行。origin/main 同期。
    - Vercel 自動デプロイがトリガー。
  - data/sessions.json は自動tick副産物のためコミット除外（未ステージ）継続。
- **現在の状態**: S1/S4/S2/S3/S5c-1/S5a/S5c-2（本体）＋C（投資家ペルソナスライス1）＋D（新部署5つ）＋B（auto-tick 504修正）がすべてコミット＋push/デプロイ完了。本番環境は origin/main に同期。S5b（TOP行→prepare本配線）・S6（勝率データ）が残スライス。
- **次の一手**: (1)オーナーがデプロイ後のauto-tickをGitHub Actions workflow_dispatchで手動発火→504解消(緑)を確認する。(2)refresh-fundamentals.yml初回workflow_dispatch疎通確認をオーナーが実施。(3)Supabaseマイグレーション0002とseed-fundamentals実行をオーナーが実施→screening実データ化。(4)上記確認後S5b着手。
- **未解決・ブロッカー**: (1)auto-tick workflow_dispatch 手動発火＋504解消(緑)確認（オーナー手動・本番検証必須）。(2)refresh-fundamentals.yml 初回workflow_dispatch 疎通確認（オーナー手動）。(3)Supabaseマイグレーション0002 + seed-fundamentals 実行→screening実データ化（オーナー手動・約3分・約104行確認）。これら3つがS5b着手の前提条件。

---

## 2026-07-22

- **今日のゴール**: S2「/analyze プロモード集約」「S3「/analyze 投資家モデル連動」「S5a「screen API＋ランキング＋no-symbol UI」をすべて出荷する。
- **やったこと**:
  - S2出荷完了。コミット `6342712`。
    - プロモード有効化：disabledだったプロモードを有効化。分析タイプ軸（ファンダ/テクニカル/ハイブリッド）で条件ピッカーを出し分け。components/analyze/ProConditionPicker.tsx（/reportから複製）新規作成。
    - ボタン分割：プレビュー→/api/report/prepare、AIレポート→/api/report/generate の2ボタン。lab-backtestは無改修。
    - ファンダ型のベースラインはユーザー選択（MA200/MA50/ゴールデンクロス。買い持ちは評価器不在ゆえ非提示＝原則9）。
    - 透明性カード改修：lib/report/transparency.ts をderivedGateも反映するよう小改修。
    - reviewer対応：モード切替中のfetch競合をrequestIdガード（resetDownstreamでインクリメント・await後とonChunk内で不一致なら破棄）で修正。
    - suggestion対応：ProConditionPickerのnum()無言フォールバックをparsePeriodで{error}返す方式に統一。
    - テスト：tsc緑、scripts/check-analyze-pro.ts（新5アサーション含む）全PASS、回帰でcheck-analyze-s1/s4・check-report-r1もPASS。
    - 保護対象8ファイル無差分確認。
  - S3出荷完了。コミット `f0e9b51`。
    - 投資家モデル新設：lib/backtest/investor-presets.ts に3モデル（バフェット/グレアム/リンチ）を定義。各モデルは言語化された投資理論(philosophy)を土台に、実在ファンダ(roe/debtToEquity/pe/pb/currentRatio/earningsGrowth/revenueGrowth)＋実在決算派生(fcfPositiveYears/epsCagr3y/equityRatio/revenueCagr3y)＋テクニカル8種へ写像。
    - 透明性確保：信念と実装のギャップ（バフェット一生保有→200日MA代理・グレアムPER×PBR/リンチPEG→個別指標で近似）をapproximationNotesに正直注記。投資家名はAIプロンプトに非注入で断定を構造的に排除（原則9）。
    - UI実装：components/analyze/InvestorModelPicker.tsx新設。investorモード有効化。prepare/generate 2段はS2再利用。lab-backtest無改修。
    - テスト：tsc緑（暖機後・iCloud I/Oで初回9分半だが正常）、scripts/check-analyze-s3.ts全PASS、回帰(s1/s4/pro・report-r1)全PASS。保護対象8ファイル無差分確認。
    - reviewer(Fable) critical/warningゼロ・「原則9まわり非常に丁寧」。suggestion(types.tsのlongPeriodコメント陳腐化)は修正済み。
  - S5c-1出荷完了。コミット `8b21333`。
    - ユニバース・ファンダのキャッシュ土台(Supabase)。背景: ライブ104銘柄走査は本番60秒制約で不可（Yahoo恒常429→Twelve Data≈8req/分で約13分）→事前計算キャッシュ前提に。オーナー承認済み。
    - 内容: universe_fundamentals テーブル（マイグレーション記録 supabase/migrations/0002）、lib/screen/cache.ts（store.tsパターン=Supabase service-role正・ローカルJSONフォールバック、getCached/listCached/upsertCached/listStaleTargets）、lib/screen/types.ts(CachedFundamentalRow)、scripts/seed-fundamentals.ts（オーナーがローカルで約3分実行・no_dataスキップ・架空補完なし）。レビュー対応でservice-role判定を lib/supabase/env.ts に一本化し二重管理解消（admin.tsは純粋抽出で挙動不変）。
    - テスト: tsc緑、scripts/check-screen-cache.ts 13項目PASS、保護対象無差分。
    - reviewer critical/warningゼロ(解消後)。
    - **オーナーの手動作業（未完・継続）**: (1)Supabase SQL Editorで supabase/migrations/0002_universe_fundamentals.sql を実行、(2)ローカルで npx tsx scripts/seed-fundamentals.ts を実行(約3分)、(3)universe_fundamentals に約104行入ったか確認。これが済むまでS5のスクリーニングは実データで動かない。
  - S5a出荷完了。コミット `2584202`。
    - /analyze の「銘柄指定なし」scope有効化。quick/investorプリセットをキャッシュ済みユニバース(universe_fundamentals)に適用し適合度ランキングTOP10表示。
    - ランキングは架空スコアなし＝evaluateFundamentalGate通過数(第1キー)→先頭fundamentalFilter指標の辞書式(gte/gt降順・lte/lt昇順が第2キー。stable=marketCap降順/graham=pe昇順等が自動導出)。
    - 欠/古/no_dataはfail-closed除外し「N件評価/古M件・欠K件除外」を正直表示。
    - screenはキャッシュ読みのみでライブ取得なし(本番60秒厳守)、空キャッシュでも200で0件応答。
    - TOP行クリックで銘柄を単一銘柄フローへ渡す最小導線。
    - pro×no-symbolは非対応(400+UI表示)。
    - 新規ファイル: lib/screen/rank.ts, app/api/analyze/screen/route.ts, scripts/check-screen-rank.ts。
    - テスト: tsc緑、check-screen-rank 25項目PASS、回帰(analyze-s1/s4/pro/s3・screen-cache・report-r1)全PASS、保護対象無差分確認。
    - reviewer(Fable) critical/warningゼロ・suggestionのみ(対応不要)。
- **現在の状態**: S1/S4/S2/S3/S5c-1/S5a出荷済み。S5c-2（refresh-fundamentals cron＋専用GitHub Actionsワークフロー）をbuilderが実装中。その後S5b（TOP行→prepare本配線）、最後にS6（勝率データ）。data/sessions.json は自動tick副産物のためコミット除外（未ステージ）継続。
- **次の一手**: (1)S5c-2の実装継続、(2)その完了後にS5b着手。
- **未解決・ブロッカー**: S5の実データ動作確認はオーナーのシード実行待ち（Supabase SQL Editor→seed-fundamentals.ts→約104行確認）。

---

## 2026-07-21

- **今日のゴール**: S4「/analyze 透明性カード＋リーガルトーン制御」を出荷する。
- **やったこと**:
  - S4実装・テスト・出荷完了。コミット `e4ddd6e`。
  - S4内容: (1)透明性カード=lib/report/transparency.ts の新規純関数 buildTransparencyCard で、PreparedBundleの実測ファンダ値＋テクニカルルール説明＋5年バックテスト実測から「なぜこの銘柄か」を生成。no_data/未実行は捏造せず正直表示、「現在値の静的判定（過去に遡及しない）」の恒久注記を必須化（原則9）。app/analyze/page.tsxにカード描画＋恒久ディスクレーマ常時表示。(2)リーガルトーン=lib/report/prompt.ts の buildReportPrompt を「投資助言でなくプロの分析プロセスの再現」に再フレーム＋断定回避・免責を追記。9セクション見出し・順序・maxTokens=4500は不変。
  - テスト: tsc --noEmit 緑、scripts/check-analyze-s4.ts 12項目全PASS、回帰でcheck-analyze-s1(27)・check-report-r1(26)もPASS。
  - reviewer(Fable) critical/warning ゼロ・suggestion のみ（誤字修正済み）。
  - スライス優先順序: オーナー指示で S4 を S2 より優先して先行実施。
- **現在の状態**: S4 出荷済み。data/sessions.json は自動tick副産物のためコミット除外（未ステージ）継続。
- **次の一手**: S2（プロモード集約=既存/reportの条件ピッカーを/analyzeプロモードに取り込み、分析タイプ軸ファンダ/テクニカル/ハイブリッドで出し分け）の計画をarchitectが作成中。計画をオーナーに提示し人間ゲート①（計画承認）を待つ。
- **未解決・ブロッカー**: なし。backlog(reviewer suggestion)は Markdown描画の/reportとの共通化、getNeedsPresetCondition の Readonly/mutate禁止ガード。

---

## 2026-07-20

- **今日のゴール**: 「ラボ×AIレポート統合」S1（クイックモード=ニーズ軸プリセット背骨）を出荷する。
- **やったこと**:
  - S1実装・テスト・出荷完了。コミット `429b466`（/analyze 統合入口）・`0c6a44d`（秘書部門＋組織変更）。
  - S1内容: /analyze 新入口でクイックモード（ニーズ軸3プリセット）のみ end-to-end 配線。プリセット選択→/api/lab/backtest で数字プレビュー→同一CompositeConditionを既存/api/report/prepare→generate へ渡し専門レポート表示。プロ/投資家モード・銘柄指定なしはプレースホルダ（disabled）。新データ源・新API ゼロ。
  - テスト: tsc --noEmit 緑、scripts/check-analyze-s1.ts 28項目全PASS、reviewer(Fable) critical/warning ゼロ・suggestion のみ。
  - 運用変更: builder/reviewer の担当を Fable に確定。architect=Opus/researcher=Opus。
- **現在の状態**: /analyze S1 出荷済み。data/sessions.json は自動tick副産物のためコミット除外（未ステージ）のまま。
- **次の一手**: S2 着手または S4（ニーズ軸透明性カード＋リーガルトーン強化）の前倒しをMCがオーナーへ確認し、判定結果に基づきスライス実装を次のセッションで開始。
- **未解決・ブロッカー**: S2 vs S4 優先順序がオーナー確認待ち。Markdown描画共通化・getNeedsPresetCondition のReadonly/mutate禁止ガード は backlog(reviewer suggestion)。
