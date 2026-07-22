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

## 2026-07-22

- **今日のゴール**: S2「/analyze プロモード集約」を出荷する。
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
- **現在の状態**: S1/S4/S2出荷済み。次はS3（投資家モデル連動＝lib/backtest/investor-presets.ts新設・著名投資家をCompositeConditionに写像・investorモード有効化）の計画をarchitectが作成中で人間ゲート①待ちへ。data/sessions.json は自動tick副産物のためコミット除外（未ステージ）継続。
- **次の一手**: S3の計画をオーナーに提示し人間ゲート①（計画承認）を待つ。
- **未解決・ブロッカー**: なし。backlog（reviewer継続指摘）: 条件ピッカーの/reportとの抽出共通化（S2で複製した2コピー目・DECISIONSで次スライス予約済み）、Markdown描画共通化、getNeedsPresetConditionのReadonlyガード。

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
