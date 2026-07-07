# InvestSim 決定ログ（ADR-lite）

非自明な設計判断・修正はここに1エントリずつ追記する。フォーマットは `.claude/skills/decision-log/SKILL.md` を参照。

## 2026-07-05: AI開発カンパニー体制（部署・スキル）の導入
- 背景: investsimの開発をMC（親セッション）が方向性推定→部署振り分けする体制にし、他プロジェクト（Instagram DM SaaS向けの`ai-dev-company.md`）と混在させないようにする必要があった
- 決定: `COMPANY.md` にinvestsim専用の原則・部署定義・運用ループを新設し、`.claude/agents/`に architect/builder/reviewer/researcher の4部署、`.claude/skills/`に4スキルを作成。MCはサブエージェント化せず親セッションの役割とした
- 理由: Claude Codeのサブエージェントは現状ネストして他のサブエージェントを呼び出せないため、orchestrator=親セッションという原設計（`ai-dev-company.md`）を踏襲。人間ゲート（計画承認・出荷前承認）は自動化せず維持
- 影響ファイル: `COMPANY.md`, `CLAUDE.md`, `DECISIONS.md`, `.claude/agents/architect.md`, `.claude/agents/builder.md`, `.claude/agents/reviewer.md`, `.claude/agents/researcher.md`, `.claude/skills/decision-log/SKILL.md`, `.claude/skills/review-checklist/SKILL.md`, `.claude/skills/investsim-conventions/SKILL.md`, `.claude/skills/market-data-conventions/SKILL.md`

## 2026-07-06: ホームページを静的デモから実データ駆動のリアルタイムAI投資家表示へ転換
- 背景: `app/page.tsx` が2020〜2024年の固定デモ売買データ（バフェット×AAPLのみ）をハードコード表示しており、原則9・11（実データ必須・学習ループがゴール）に反していた
- 決定: `app/page.tsx` のハードコードDEMO_TRADESを廃止し、既存の `/ai-session` (AISessionClient / lib/ai-trader/engine.ts / lib/ai-trader/memory.ts / lib/investors/) を再利用したライブ判断表示に置き換える。初回訪問時のUXは「共有・自動更新のライブセッション」を既定表示とし、毎アクセスでのClaude API呼び出しは避けキャッシュされた最新判断を表示、明示的な「今すぐ再計算」操作でのみ新規呼び出しを行う。`lib/investors/` の入力インターフェースがリアルタイム1時点データと非互換な場合はアダプタ層で吸収し、investors側の設計変更は最小限に留める。`/simulate` は補助機能のまま維持
- 理由: 二重実装を避けコストを抑えつつ、原則（実データ必須・仮想資金・学習ループ・リアルタイム優先）を満たすため。architect部署の方針検討に基づく
- 影響ファイル（予定）: `app/page.tsx`, `app/ai-session/client.tsx`, `lib/ai-trader/engine.ts`, `lib/investors/*`, `components/SiteNav.tsx`

## 2026-07-06: ホームページ実装スライスの動作検証（実サーバーで確認）
- 背景: iCloud Drive上でI/Oが遅く目視確認が困難だったが、原則「動くものが正義」に従い実サーバーで検証した
- 決定: `app/page.tsx` の書き換えを出荷可能と判断
- 検証結果:
  - `npm run dev` 起動成功（Ready 4.4分 — iCloud上では正常範囲）
  - `GET /` → HTTP 200（初回コンパイル836秒、以降キャッシュ）
  - `GET /api/signals/AAPL` → HTTP 200、実データ返却を確認（AAPL実PER 33.2/ROE 160%等、5投資家が各々独立判定）。モックではなく実Yahoo Financeデータ
  - AIエンジンのClaude呼び出し方式を確認: `lib/ai-trader/engine.ts` は `spawn('claude', ['--print', '--model', 'claude-sonnet-4-6'])` でローカルのclaude CLIを使う（APIキー不要）。`echo | claude --print --model claude-sonnet-4-6` で応答・exit 0を確認、モデルIDは有効なので変更しない（原則8）
- 未解決: `.env` ファイルが存在せず、Supabase認証（`NEXT_PUBLIC_SUPABASE_*`）・Twelve Data・J-Quantsのキーは未設定。Yahoo Finance直取得が効くため中核シミュレーションには影響しないが、認証機能は未検証

## 2026-07-07: デプロイ対応 — Claude呼び出しをローカルCLI/APIキーのハイブリッド化
- 背景: `lib/ai-trader/engine.ts` の `callClaude()` が `spawn('claude', ...)` でローカルのclaude CLIに依存しており、Vercel等のサーバーレス環境では`claude`バイナリが無く中核のAI売買が動かない
- 決定: `callClaude()` を分岐化。`ANTHROPIC_API_KEY` があれば `@anthropic-ai/sdk`（インストール済み）でAnthropic APIを呼ぶ（本番・チャージ制課金）、なければ従来通りローカルCLIにフォールバック（開発中・サブスク利用で無料）。モデルは環境変数 `AI_MODEL` で上書き可、デフォルト `claude-sonnet-4-6`
- 理由: ローカル開発の無料性を保ちつつVercelでも動くようにするため。オーナーの要望「サブスクは温存し、サイト専用のチャージ制課金にしたい」に合致（Claude CodeサブスクとAnthropic APIは別課金系統で、APIキー利用はサブスクに影響しない）
- 補足: `.env.example` を新設し必要な環境変数（ANTHROPIC_API_KEY, AI_MODEL, NEXT_PUBLIC_SUPABASE_*, TWELVE_DATA_API_KEY, JQUANTS_API_KEY）を文書化。`.gitignore` は `.env*` を除外済みで秘密情報はコミットされない
- 影響ファイル: `lib/ai-trader/engine.ts`, `.env.example`（新規）

## 2026-07-07: GitHub公開 + Vercel本番デプロイ + Supabase認証の接続
- 背景: ローカルのみで動いていたinvestsimを、GitHubで版管理しVercelで公開する必要があった
- 決定:
  - GitHubに **Private** リポジトリ `mmasuda1219-bit/investsim` を新規作成し全成果をpush。`.gitignore` に `!.env.example` を追加し文書用のみコミット可能にした（実`.env`は`.env*`で除外継続）。git identityは `masudamarco` / `marco1219yoo@gmail.com`
  - Vercelで本番デプロイ。本番URL **https://investsim-nine.vercel.app**（Next.js 16.2.6、標準ビルドで通過・33秒）
  - Supabase認証を接続。無料枠2プロジェクト制限のため既存プロジェクト `ndrstuepugzgiwycsyrf` を転用（investsimはDBテーブル未使用＝`.from()`ゼロ・認証のみのため既存データと非衝突）。新方式キー **Publishable key**（`sb_publishable_...`＝旧anon後継）を `NEXT_PUBLIC_SUPABASE_ANON_KEY` に設定。`@supabase/supabase-js` 2.107.0 は新方式キー対応済み
- 状態: Vercel環境変数に `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` を production/development に設定（previewはCLIの非対話制約でスキップ）。ローカルは `.env.local` に同値
- 未解決:
  - **Google OAuth未設定**: `app/auth/login/page.tsx` は `signInWithOAuth({provider:'google'})` を使うが、SupabaseのGoogleプロバイダ有効化＋Google CloudのOAuthクライアント＋リダイレクトURL(`/auth/callback`)登録が未完でログインは未動作
  - **ANTHROPIC_API_KEY未設定**: 本番でAI売買判断（Claude呼び出し）は未稼働。Yahoo Finance系（市場データ・シグナル）は稼働中
- 影響ファイル: `.gitignore`, `.env.local`（新規・非コミット）

## 2026-07-07: ファンダメンタルズ取得失敗時のモックフォールバックを廃止
- 背景: J-Quants（上位プラン必要）とYahoo直取得（fetch失敗時）がモックの架空PER/ROEにフォールバックしており、AI投資家がニセ指標で売買判断する恐れがあった（原則9違反）
- 決定: 両プロバイダとも失敗時は空オブジェクト `{}` を返し「データなし」として扱わせる。Yahoo側は `console.warn` で取得失敗を記録
- 理由: 架空値での判断は実データ原則に反する。「データなし」なら投資家モデルは該当指標をスキップでき、判断の質が偽装されない
- 影響ファイル: `lib/market/providers/jquants.ts`, `lib/market/providers/yahoodirect.ts`

## 2026-07-08: Next.js 16破壊的変更対応（params/searchParams）+ フォントセルフホスト化 + Node 22固定
- 背景: `app/stocks/[symbol]/page.tsx` がNext.js 16でPromise化された `params`/`searchParams` に同期アクセスし銘柄詳細ページ全体がクラッシュ。また `next/font/google` のビルド時フォント取得がETIMEDOUTでローカルビルドを不安定にし、`yahoo-finance2` v3がNode >= 22要求なのにローカルはNode 20だった
- 決定: (1) `params`/`searchParams` を `await` する正しい書き方に修正（APIルートは対応済みだったためこの1ファイルのみ）。(2) フォントを公式 `geist` パッケージ（セルフホスト）に置換しビルド時の外部フェッチを排除。(3) `package.json` に `engines: node >=22`、`.nvmrc`（22）を追加し `@types/node` を ^22 に更新、ローカルはnvmでNode 22.23.1に切替
- 理由: (1)は実行時バグの最小修正。(2)は代替案「ローカルビルドを諦めVercelのみで検証」よりも検証可能性を優先。(3)は主データ源yahoo-finance2の動作保証環境に合わせ、Vercel/ローカルのNodeバージョン不定を解消するため
- 検証: `tsc --noEmit` エラー0 / `eslint` エラー0 / `next build` EXIT=0（全21ルート生成、ETIMEDOUT再発なし）
- 影響ファイル: `app/stocks/[symbol]/page.tsx`, `app/layout.tsx`, `package.json`, `package-lock.json`, `.nvmrc`（新規）
