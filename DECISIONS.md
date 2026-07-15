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

## 2026-07-11: AI呼び出しをサブスク(CLI)優先に変更・APIはPDFレポート専用に限定
- 背景: 2026-07-07の「ANTHROPIC_API_KEYがあればAPI、なければCLI」ハイブリッド設計だと、キーを設定した瞬間に全AI呼び出し（頻度の高いtick分析・仮想取引・学習）が従量課金APIに流れる。オーナー方針は「普段の分析と仮想取引は本人のClaude Codeサブスク(ローカルCLI)で回し、APIは将来のPDFレポート出力など限定用途のみ」
- 決定: `callClaude(prompt, channel: 'cli' | 'api' = 'cli')` に経路引数を追加。既存の `askClaude`（分析・売買判断）と `generateFullLearning`（学習）は引数なし＝CLI固定。API経路は将来のレポート機能が `channel:'api'` を明示指定した時のみ使う。キー有無での自動分岐は廃止
- 理由: tickは高頻度でAPI課金が嵩む。サブスクは定額なので普段使いはCLIが合理的。将来サイトを販売・公開する際も、レポート機能側でAPIを指定＋`ANTHROPIC_API_KEY`設定するだけで切替可能（コード変更不要・[[project-ai-billing-preference]]の意図に合致）
- 補足: 現状PDFレポート機能は未実装。本変更は経路の器を用意しただけで、早すぎる抽象化を避け実装はレポート機能着手時に行う（原則8）。`.env.example`のANTHROPIC_API_KEY説明も「レポート専用・通常運用は未設定でOK」に更新
- 影響ファイル: `lib/ai-trader/engine.ts`, `.env.example`

## 2026-07-11(2): 方針転換 — 全AIをAPI経路に（公開サイトで動かすため）
- 背景: 同日の上記「CLI優先」決定を、オーナーが再検討して撤回。目的は「ローカルではなく実際に公開されているサイト（Vercel）でAIを動かすこと」。ローカルCLIはVercel等サーバーレスでは動かない（claudeバイナリが無い）ため、公開サイトで動かすにはAPIが必須
- 決定: `callClaude(prompt)` を「ANTHROPIC_API_KEYがあればAPI、なければCLIフォールバック」に戻す（channel引数を廃止）。全AI（tick分析・仮想取引・学習）が対象。PDF限定という区別も撤回＝全般的にAPI
- 課金: APIはオーナー自身のAnthropicアカウントで購入したAPIクレジットで課金される（Claude Codeサブスクとは別系統。サブスクのトークンはAPIでは使えない）。Vercelに`ANTHROPIC_API_KEY`を設定すれば公開サイトで動く。モデルは`AI_MODEL`（デフォルト`claude-sonnet-4-6`＝API有効・$3/$15 per 1M）。consoleでスペンドリミット設定推奨
- 補足: ローカル開発はキー未設定ならCLIで従来通り動く（無料）。[[project-ai-billing-preference]]の記憶も本方針に更新
- 影響ファイル: `lib/ai-trader/engine.ts`, `.env.example`

## 2026-07-14: AIセッション永続化をローカルJSONからSupabase JSONB blobへ移行（スライス1）
- 背景: Vercelサーバーレスはファイル書込不可で、tickを跨ぐ学習メモリ（原則11の学習ループ）が本番で消失していた
- 決定: ai_sessions(id, data jsonb, started_at, updated_at) に各セッションをblob保存。読み書きはserver-onlyのservice-roleクライアント(lib/supabase/admin.ts)＋lib/ai-trader/store.ts経由。getSession/listSessionsはasync化（await追加はRoute 3箇所）。グローバルMapキャッシュは撤去、キー未設定ローカルはファイルstoreフォールバック。RLS有効・ポリシー無しでanonキーから遮断。セッションは当面全体共有（user_id無し、認可は次スライス）
- 理由: 正規化テーブル案は早すぎる抽象化（原則8）。blobなら既存AISession型と1:1でnormalizeLearningMemoryもそのまま効く。競合はlast-write-wins許容
- 影響: lib/supabase/admin.ts(新), lib/ai-trader/store.ts(新), scripts/seed-sessions.ts(新), lib/ai-trader/engine.ts, app/api/ai-session/route.ts, app/api/ai-session/[id]/route.ts, app/api/ai-session/[id]/chart/[symbol]/route.ts, .env.example

## 2026-07-14: レポート機能スライス1 — /report を2段API＋Opus固定ストリーミングで新設
- 背景: 銘柄×ユーザー理論のバックテストと根拠・引用元つき未来予想をワンプッシュで出す新機能。Opus生成遅延がVercel 60秒制限と衝突
- 決定: prepare(Haiku解釈+実データバックテスト+学習メモリ収集)とgenerate(claude-opus-4-8固定・1回・ストリーミング・maxDuration=300)に分離。lib/backtestを共有拡張(rsi/macd/bb追加・ma_cross不変)。engine.tsのtick経路は不変。解釈失敗はエラーで止めサイレント既定値化しない(原則9)。AI呼び出しはHaiku1+Opus1(約$0.1-0.2/回)。保存なし(将来Supabase)
- 影響: app/report/page.tsx, app/api/report/{prepare,generate}/route.ts, lib/report/{types,interpret,prompt,claude}.ts, lib/backtest/{types,rules}.ts, components/SiteNav.tsx, .env.example

## 2026-07-15: YahooのVercel恒常429対策 — Twelve DataをUS株の第一フェイルオーバーに追加
- 背景: Yahoo Finance DirectがVercelのegress IPを恒常的にHTTP 429でブロックし、/report（allowMock:falseの実データ必須パス）が実データを取得できなかった（実測0/3成功）。market-data-conventionsの規約どおり別プロバイダへのフェイルオーバーが必要
- 決定: getQuote/getHistoryのチェーンを Yahoo → Twelve Data → (allowMock ? Mock : throw) に変更。allowMock:falseパスは Yahoo→Twelve Data→throw でMockには決して落ちない（原則9）。TWELVE_DATA_API_KEY未設定時はTwelve Data段をスキップし従来どおりYahoo→Mock（後方互換・動的import）。プロバイダは無料枠(8/分・800/日)節約のためrevalidate:300キャッシュ＋429は最大2回の短リトライ(計~1.2s)後にthrow（無限リトライ禁止・tick共有のため）
- スコープ: 今回はUS株のみ（オーナー選択）。日本株(.T)はTwelve Data無料枠非対応のためプロバイダ内で即throwしAPI枠を消費しない（従来どおりYahoo→Mock・フェイルオーバーは別スライス）。getFundamentalsも対象外（無料枠のファンダは限定的・従来どおりYahoo→失敗時は空{}）
- 副次効果: tick（selectCandidates等）もgetQuote/getHistory共有経由で自動的に実データフェイルオーバーの恩恵を受ける。tickが40銘柄で8/分を超過し得るがtickはMock許可で失敗吸収するため許容。tick用キャッシュ最適化は別スライス
- 影響ファイル: lib/market/providers/twelvedata.ts（仕様準拠に全面書換・旧実装はJP→ADR変換とmockファンダを含み未参照だった）, lib/market/index.ts, .env.example

## 2026-07-15: /reportの理論解釈をチェック制約→全8ルールカタログ推論へ／技術ルール4種追加
- 背景: 「ボリンジャー上抜けで買い」と書きつつMACDだけチェックした等で、interpret.tsの旧`allowed`制約（req.indicatorsのみに解釈を限定）が「合致ルール無し」で422ハード失敗していた（オーナー報告バグ）。真因は「チェックした指標だけから選ぶ」制約
- 決定: interpretTheoryを全ルールカタログ（8種）からの推論に変更。チェックボックス(req.indicators)は検証・制限に使わず、プロンプトへ渡す任意の優先ヒントに格下げ（未選択でも解釈可・ヒントと食い違うルールも選べる）。各ルールの日本語典型表現＋few-shot 2例をプロンプトに埋め込み推察力を上げた。原則9は「選んだルール＋解釈根拠noteを必ず返す」ことと、技術トリガーが本当に読めない時のみ投げる親切な422（対応ルール一覧＋入力案内を同梱）で両立。複数条件は主要1ルールを選び拾えなかった条件をnoteに明記（AND/ORは別スライス）
- 技術ルール追加（追加のみ・既存ma_cross/rsi_reversal/macd_cross/bb_break不変）: ma_cross_dual（短期MA×長期MAのGC/DC・long上限100）, hl_break（Donchianブレイク・当日バーを除いた前日までのN日高値/安値でルックアヘッド回避）, stoch_cross（%K×%D＋30/70ゾーンフィルタ）, roc_signal（ROC 0ライン跨ぎ）。指標計算はlib/technicalsにcalcStochastic/calcROC/calcDonchianを既存スタイルで追加
- INTERPRET_MODELを`process.env.REPORT_INTERPRET_MODEL || 'claude-haiku-4-5'`に変更（env切替可・既定Haiku据え置き）。prepareは空indicators配列でも400にせずヒントなし＝完全おまかせで通す（後方互換）
- 非破壊確認: /lab(app/api/lab, app/lab)・tick経路(lib/ai-trader/*)・既存4ルールのシグナル挙動は不変。describeConditionはexhaustive switch(never代入)で将来の追加漏れをコンパイルエラー化
- 検証: scripts/check-rules.ts（合成バーで8評価器を検証・全PASS。特にhl_breakのルックアヘッド境界＝当日高値12に阻害されず前日まで高値10の上抜けでbuy発火を確認）。npx tsc --noEmit 緑
- 影響ファイル: lib/report/interpret.ts, lib/report/types.ts, lib/report/prompt.ts, lib/report/claude.ts, lib/technicals.ts, lib/backtest/types.ts, lib/backtest/rules.ts, lib/backtest/run.ts, app/api/report/prepare/route.ts, app/report/page.tsx, scripts/check-rules.ts(新), .env.example
