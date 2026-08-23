# InvestSim 決定ログ（ADR-lite）

非自明な設計判断・修正はここに1エントリずつ追記する。フォーマットは `.claude/skills/decision-log/SKILL.md` を参照。

## 2026-07-24: AIセッションへの投資家人格注入（配管＋バフェット1人の縦切り）
- 背景: 中核機能 `/ai-session` が単一の汎用ファンドマネージャープロンプトで判断しており、KNOWLEDGE.mdに蓄えた5投資家哲学が活かされていなかった（scout調査で判明）。`lib/investors/` の5モデルはルールベースの `analyze()` で `/simulate`・`/analyze` 専用、AIセッションからは切り離されていた
- 決定: 人格テキストは `lib/investors` のルール式analyze()と分離し新設 `lib/ai-trader/personas.ts` に置く。人格は `startSession` で `AISession.persona` に固定し、既にセッション単位の `learning` をそのまま per-persona学習として使う（memory.ts不改変）。まずバフェット＋汎用デフォルトでend-to-end、残り4人は後続スライスのテキスト追加のみ。人格が差し替えるのは判断基準1〜3のみで、リスク管理ルール（1銘柄15-20%・最大5銘柄・現金20%維持）とJSON出力契約は不変。項番衝突を避けるため `buildCriteriaBlock` で一貫採番
- 理由: memory構造を触らず原則11(学習ループ)を保護／JSON契約とリスク管理を不変にし回帰を防ぐ／信念と実装のギャップ(内在価値・PEG・堀スコアを `fmtFundamentals` が出さない)は捏造せず人格テキストに正直注記(原則9)。代替案「lib/investorsにpersonaPrompt追加」は/simulateのルール式と癒着するため却下
- 影響ファイル: types/index.ts, lib/ai-trader/personas.ts(新), lib/ai-trader/engine.ts, app/api/ai-session/route.ts, app/ai-session/client.tsx

## 2026-07-24: 知識開拓部門（scout）を追加
- 背景: オーナー要望で「投資の知識やYouTube・ニュースを開拓し、蓄えた知識をもとにサイト向上を目指す」専門家が欲しかった。researcher（API/技術仕様の調査）とも strategist（投資家モデル設計）とも守備範囲が違う
- 決定: `.claude/agents/scout.md` を追加。WebSearch/WebFetchで投資知識を開拓・蒸留し、`KNOWLEDGE.md`（新設）にのみ蓄積、そこからサイト改善案を出す。secretaryが `PROGRESS.md` を専有するのと同じ「1部署=1ドキュメント専有」パターンを踏襲。実装はbuilder、モデル設計はstrategist、方針はarchitect/MCへ委譲
- 理由: 知識蓄積の置き場を単一ファイルに固定して運用を単純化し、原則8（実装はbuilderに集約）を崩さないため。出典URL必須・未確認情報は蓄積しないルールで実データ方針（原則9）と整合。モデルは投資知識の質判断を優先しopus
- 影響ファイル: `COMPANY.md`, `DECISIONS.md`, `.claude/agents/scout.md`, `KNOWLEDGE.md`

## 2026-07-24: 部署を4つ追加（qa / designer / data-engineer / strategist）
- 背景: オーナー要望で会社体制を拡張。テスト実行・UX/可視化・データパイプライン・AI戦略/プロンプトの各領域を専門部署として切り出したかった
- 決定: `.claude/agents/` に qa/designer/data-engineer/strategist を追加し、`COMPANY.md` の部署表・スキル対応を更新。原則8（実装はbuilderに集約）を守るため、新4部署は設計・助言・検証に徹し、実際のコード/データ書き込みはbuilderに委譲する。qaのみ検証実行のためBashを持つが、テストコードの記述はbuilderに渡す
- 理由: builder集約原則を崩さずに専門性を足すため、新部署は読み取り中心（qaは読み取り＋Bash）とした。モデルはqa=sonnet、他3部署=opus（設計判断の質を優先）
- 影響ファイル: `COMPANY.md`, `DECISIONS.md`, `.claude/agents/qa.md`, `.claude/agents/designer.md`, `.claude/agents/data-engineer.md`, `.claude/agents/strategist.md`

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

## 2026-07-15: Yahoo恒常429を yahoo-finance2 ライブラリ主プロバイダ化で解決
- 背景: オーナー報告「データ提供元(Yahoo)が混雑しています(レート制限)」。調査でquery1/query2の生fetchが全リクエストHTTP 429（curlでUA有無・Cookie付与・両ホストいずれも429を再現）。原因はYahooがpublic chart/quoteホストをcookie+crumbセッションでハードゲート化したこと。手書きfetch(providers/yahoodirect)はcrumbを持たず恒常429
- 決定: 既にインストール済みの `yahoo-finance2` v3（cookie/crumbセッションを自動確立・再利用）をラップした新プロバイダ `lib/market/providers/yahoo2.ts` を第一実データ源にする。実証: 同ライブラリでAAPL(quote 326.31/chart 281本)・7203.T(JP chart 275本 JPY)・fundamentals(pe/roe)・search 全取得成功。生fetchでは全て429
- フェイルオーバー刷新（getQuote/getHistory）: yahoo2 → yahoodirect(生fetch・通常は429即失敗の保険) → Twelve Data(US・キー有時) → mock。allowMock:falseは実データ尽きたらthrow（原則9・/reportやバックテストにモック現在値/株価を混ぜない）。getFundamentalsは yahoo2→yahoodirect→mock、searchは yahoo2+yahoodirect+mockカタログをマージ
- 実装詳細: モジュールスコープでYahooFinanceインスタンスを1個メモ化しcrumb/cookieをtick(engine.ts)の多数並列呼び出し間で再利用。小さいTTLキャッシュ（quote20s/history300s/fundamentals30分/search10分・最大500件LRU的破棄）で重複呼び出しを畳みレート負荷を軽減。periodトークン→period1日付+intervalへ変換（1y=370日分の日足等、warm-up余裕を確保）
- 非破壊: 既存のPeriod型・呼び出し側(engine.ts/simulate/signals/chart/report)は不変。app/api/chart/route.tsは元からyahoo-finance2直用だったため方式は前例踏襲
- 未検証(環境要因): dev/本番でのライブE2Eは、作業時点でiCloudのnode_modulesファイル読込がETIMEDOUT多発（既知のiCloud I/O制約）で `next dev` が起動できず未実施。コード側の型チェックは tsc --noEmit exit 0。実データ取得可否はライブラリ単体で実証済み。本番(Vercel)ではVercel IPに対するYahooの挙動を要再確認（Twelve Dataキー投入が保険）
- 影響ファイル: lib/market/providers/yahoo2.ts(新), lib/market/index.ts

## 2026-07-15: Yahoo 429 追加堅牢化 — quoteをchart metaから導出＋/report 422メッセージ是正
- 背景: yahoo2主プロバイダ化後も「Yahoo混雑・1〜2分待て」が出続けるとの報告。原因2点: (1)本番VercelはYahooがv7 quote(crumb必須)を特に強くIP 429し、yahoo2のquote()も弾かれ得る (2)全プロバイダ失敗時にindex.tsが投げる結合メッセージに"HTTP 429"(yahoodirect由来)が混ざり、prepareのclassifyDataErrorが誤って「Yahoo混雑・待て」に分類していた
- 決定: (1) yf2GetQuoteで client.quote() 失敗時に、より弾かれにくいv8 chart()の meta（regularMarketPrice/chartPreviousClose/volume/longName/currency/regularMarketTime）から StockQuote を導出するフォールバックを追加。US(AAPL $327.94)・JP(7203.T ¥2875.5)で実データ導出を実証。(2) classifyDataErrorに「全提供元枯渇(unavailable for)」分岐を新設し、待てば直る誤誘導をやめ、Vercel等ではYahooのIP制限が原因でTWELVE_DATA_API_KEY設定が有効、と実態に即した案内に是正。従来の生"HTTP 429"分岐も文言修正
- yf2GetFundamentalsはundefined値を除去して返し、index.tsの「空なら次プロバイダへ」判定が正しく効くよう修正
- 環境別の解決策: ローカル開発=yahoo2で解決(サーバ再起動要)。本番Vercel=YahooがIP遮断するためTWELVE_DATA_API_KEY(無料)設定が確実。原則9は維持(実データ尽きたらthrow・モック株価を混ぜない)
- 影響ファイル: lib/market/providers/yahoo2.ts, app/api/report/prepare/route.ts

## 2026-07-16: /report再設計R1 — 構造化条件ピッカー・5y統一・AIトレーダー実績統合（情報量/正確性優先）
- 背景: 自由記述theoryTextのHaiku解釈は誤解釈・422の温床で、オーナー方針も「レポートの情報量と正確性を最優先（デザイン非優先）」に確定。PDF出力はオーナー判断で優先降格（後続スライスへ）
- 決定: prepareの入力を `{symbol, condition: CompositeCondition, initialCapital?}` に刷新（theoryText/indicators廃止）。CompositeCondition＝テクニカル1ルール（既存8種・期間clamp）＋ファンダANDゲート（10指標×gt/lt/gte/lte・現在値による静的フィルタで過去5年に遡及しない旨をUI/プロンプト双方に明記）。ゲートno_dataはfail-closed（不成立扱い・ただし「判定不能」と区別表示）、矛盾条件はエラーにせず単に評価。ゲートpass時のみ5yバックテスト、fail時はスキップし不成立理由を実測値つきでbundleへ（レポートは不成立分析として生成可能）
- Haiku解釈（lib/report/interpret.ts）は経路から除外・ファイル残置（Legacy型で温存）。バリデーションは純関数化（lib/report/validate.ts・未知metric/indicator/operatorは400・数値範囲はclamp）
- 5y統一: Period型に'5y'追加、yahoo2(days:1835/1d)・yahoodirect(range:5y/1d)・twelvedata(outputsize:1300)の3プロバイダにマップ追加。runBacktestをperiod引数化（既定'1y'で/lab互換維持）。実測: AAPL 5y=1262本・31取引・数ms
- AIトレーダー実績統合: lib/report/evidence.ts新設。全セッション（listSessions・読み取りのみ）から対象銘柄のclosedTrades（entry/exit・pnlPct・保有時間・理由）・直近decisions・銘柄言及lessonsを構造化したAiTraderEvidenceをbundleへ。従来のbuildLearningContext（全銘柄横断）も併用
- prompt強化（オーナー最優先）: metrics全項目＋取引一覧最大20件（往復損益%つき）＋バイ&ホールド実測比較＋ファンダ全指標実測値＋ゲート判定（実測vs閾値）＋テクニカル実数値（MA20/50・RSI・MACD線/シグナル/ヒスト・BB上中下）＋AI実績。見出しは現行7＋「AIトレーダーの実績」の計8。厳守指示「全主張に数値根拠・データに無いことを断定しない・ファンダ静的評価と未来予想非予言の明記」。max_tokens 3500→4500
- chartData（5年OHLC＋エクイティカーブ＋約定マーカー）はbundleと別にレスポンスへ（Opusに渡さない・トークン節約）。getFundamentalsにallowMockオプション追加（ゲート判定にモック値を混ぜない・実データ不可時は{}=no_data、原則9）
- 同梱出荷: yahoo2主経路フェイルオーバー（既差分）・SiteNavに/report追加＋/lab行削除（app/lab本体未出荷で404のため・オーナー承認済み）
- 検証: scripts/check-report-r1.ts新設（ゲートpass/fail/no_data/矛盾・単位変換・バリデーション・1250本評価15ms）全PASS、scripts/check-rules.ts回帰PASS、tsc --noEmit緑、実API E2E（AAPL 5y実データ+実ファンダ18指標）成功。Opus呼び出しE2Eは未実施（計画どおり）
- 影響ファイル: lib/backtest/{types,run,fundamental(新)}.ts, lib/report/{types,prompt,validate(新),evidence(新),interpret}.ts, lib/market/{index,providers/yahoo2,providers/yahoodirect,providers/twelvedata}.ts, app/api/report/{prepare,generate}/route.ts, app/report/page.tsx, components/SiteNav.tsx, scripts/check-report-r1.ts(新)

## 2026-07-16: 決算書ファンダ深化（/report R2）— データソースと派生指標ゲートの分離
- 背景: オーナー要件「損益計算書等の決算数値を複数期でレポート根拠・スクリーニングに使いたい」。
- 決定: MVPは yahoo2 の fundamentalsTimeSeries を **type:'annual' 指定**で使い（US+JP・キー/依存ゼロ・年次4-5期）、決算3表を取得。派生指標（売上CAGR/YoY・営業/純利益率のトレンド上昇期数・EPS CAGR・FCFマージン/黒字年数・利益の質=営業CF÷純利益・ROE・自己資本比率・純有利子負債/EBITDA）を純関数(lib/statements/derived)で計算。スクリーニングは既存10指標ゲートを不変のまま、別系統 DerivedFilter + evaluateDerivedGate を **fundamentalGate.passed && derivedGate.passed** でAND合成。Opusプロンプトに「## 決算書分析（複数期推移）」を追加（8→9見出し・複数期の傾きと一貫性を数値根拠で評価）。取得層はソース中立の StatementsData で受け、EDGAR(US)/J-Quants(JP)は後続スライスに温存。
- 理由: 4-5期で3年CAGR/トレンドが計算可能・yahoo-finance2はVercel実証済み・最小の縦切り（原則2）。**type:'annual' が必須**（デフォルトは四半期'3M'を返し、トヨタ売上が四半期12.6兆で年次50兆に化ける＝原則9違反になる。実測でAAPL 416B/トヨタ50.7兆の年次抽出を確認）。欠損・計算不能は no_data として fail-closed かつ判定不能を区別表示。決算は24hキャッシュ（実データのキャッシュは原則9に反しない）。
- 検証: scripts/check-statements.ts（computeDerived/ゲート/単位変換/バリデーションの31アサート全PASS）、実データ年次抽出プローブ（AAPL/トヨタ）成功、tsc --noEmit緑。
- 影響ファイル: lib/statements/{types,derived}.ts(新), lib/market/{index,providers/yahoo2}.ts, lib/backtest/{types,fundamental}.ts, lib/report/{types,prompt,validate}.ts, app/api/report/prepare/route.ts, app/report/page.tsx, scripts/check-statements.ts(新)

## 2026-07-16: 米国株フォーカス — ニュース/マクロ加味＋リンク引用（/report R3）＋US100銘柄ユニバース
- 背景: オーナー方針転換「米国株に集中」。要望=①引用元をリンクで②ニュース・政治経済(マクロ)を加味した判断③過去は当時のマクロ状況を加味④未来予想は現在の状況を加味。加えて有名米国株を約100銘柄に拡充。
- 決定: (news) yahoo2.yf2GetNews(search)で銘柄の現在ニュース(title/publisher/link/日時)取得→lib/market.getNews。(macro) lib/report/macro.tsで^GSPC/^IXIC/^VIX/^TNX/DX-Y.NYB/CL=Fの現在値＋5年前をgetHistory(allowMock:false)で取得(追加キー不要・実データ実証済)。(citations) PreparedBundle.sourcesをSourceRef[]{id,label,url?,usedFor}に構造化しURLはアプリ提供、Opusには[n]番号のみ扱わせURL捏造を封じる。プロンプトにニュース/マクロ/[n]引用ルールを追加、過去の個別ニュースは取得不可のため創作禁止(当時のマクロ推移で代替)。page.tsxにMarkdownリンク描画＋クリック可能な参照リンク/ニュース/マクロ表示。lib/market/us-universe.ts(約104銘柄・symbol/name/sector・実データはyahoo2)を新設し/reportにdatalistクイック選択。
- 理由: 全てVercel実証済みのyahoo-finance2で賄え追加キーゼロ。過去個別ニュースは無料・クラウドIPで安定取得不可(NewsAPI本番不可/GDELTノイズ)→誠実に範囲外にしマクロで代替(原則12=過去は補助)。ユニバースはニセ財務を作らず実データ前提の厳選リスト(原則9)。
- 検証: 実データプローブ(AAPLニュース6件・マクロ6銘柄5年分/^TNX 1.32→4.58%等)成功、tsc緑、禁止ファイル(tick/news.ts含む)不変。日本株マクロ・過去個別ニュース・FRED(CPI/失業率)は次スライス。
- 影響ファイル: lib/market/us-universe.ts(新), lib/report/macro.ts(新), lib/market/{index,providers/yahoo2}.ts, lib/report/{types,prompt}.ts, app/api/report/prepare/route.ts, app/report/page.tsx

## 2026-07-16: /report 画面グラフ＋PDF出力（ブラウザ印刷方式）
- 背景: オーナー要望「レポート内にreferenceが見えるように」「PDFで出す機能（グラフ・分かりやすさ重視）」「言語は当面日本語（英語は後で）」。
- 決定: (chart) 依存ゼロのSVG LineChartコンポーネントを app/report/page.tsx に新設。結果パネルへ価格チャート（5年・売買マーカー緑買い/赤売り）＋エクイティカーブ（仮想資金の資産推移）を chartData から描画（既存レスポンスのbars/trades/equityCurveを利用・Opusには渡さない）。(pdf) 「📄 PDFで保存」ボタン（report && phase==='done'時・window.print()）＋インライン@media print CSS。#report-page配下を白背景・濃色文字へ強制（SVG strokeは属性なので色が残る）、nav/.no-print非表示、@page margin。ヘッダ・入力欄に no-print 付与。
- 理由: @react-pdf/rendererは日本語フォント埋め込みがサーバーレスで最大リスク→ブラウザ印刷→PDF保存方式を採用（追加依存ゼロ・日本語ネイティブ・後の英語化も容易）。引用元パネル自体はR3で既にデプロイ済み。
- 検証: tsc --noEmit緑、本番デプロイ後 /report=200・初期HTMLに@media print/report-page/no-print反映を確認（PDFボタン・チャートは結果確定後の動的描画）。
- 影響ファイル: app/report/page.tsx（+80/-3）。コミット dc17ab7。

## 2026-07-16: 自律学習ループ第1スライス — サーバー側自動tick（cron＋日次上限＋リースロック）
- 背景: 学習ループ（原則11）はブラウザを開いている間のクライアント側ポーリングでしか進まず、閉じると止まっていた。Vercel Hobbyのネイティブcronは日次1回・分未満スケジュール不可で高頻度tickに不適。サーバー起点の自動tick経路が欠落しており、二重発火（cronと手動の同時実行でlast-write-wins巻き戻り）・多重cronでの過剰実行のリスクもあった
- 決定:
  - GitHub Actions schedule 3本（平日UTC・:00回避）＋workflow_dispatchで `CRON_SECRET` Bearer保護の `POST/GET /api/cron/tick` を叩く。cronは `listAutoTickTargets(3)`（auto.enabled かつ 当日count<3 を lastTickAt 昇順）を経過時間バジェット240s付きで逐次runAutoTick、超過分は `time_budget` で残し次回cronが古い順に前進
  - 日次3回上限はNY市場日付基準の blob内カウンタ `AISession.auto{enabled,date,count}`。自動tickのみカウントし手動tickは非干渉（経路分離）。startSessionで初期OFF
  - 二重実行防止は `ai_sessions.lock_until timestamptz` のリーストークン方式。tryAcquireTickLockは取得したlock_until ISOをトークンとして返し（既ロック=null）、releaseTickLockは `.eq('lock_until', token)`（ファイル経路はファイル内容一致）で自分のリースだけ解放＝他者リースを消さない。カラム未追加は特別トークン 'degraded' で実行はするがロック無効、cronレスポンスに `lockDegraded:true` で可視化
  - 整合性: 日次上限の権威的チェックはロック取得後の読み直し（fresh）で行いTOCTOUを回避。count+1はrunTickの「前」に先行保存し、タイムアウト/失敗時も1回消費扱い＝過少実行側に倒す（実行済み未加算での上限超過を防止）
- 理由: GH Actionsは無料・分単位schedule可でHobby cron制約を回避。blobカウンタは既存AISession型と1:1で早すぎる抽象化を避ける（原則8）。runTick/callClaude本体は不変で学習ループ（原則11）を壊さない
- 検証: scripts/check-auto-tick.mjs（file-lockのトークン所有解放・上限後4回目拒否・TOCTOU再チェック・古い順target絞り込み・cron認可）全PASS、npx tsc --noEmit 緑
- 運用: Supabaseに `ALTER TABLE ai_sessions ADD COLUMN IF NOT EXISTS lock_until timestamptz;`、Vercel Env `CRON_SECRET`、GitHub Secrets `CRON_SECRET`/`PROD_URL` が必要
- 影響ファイル: lib/ai-trader/engine.ts, lib/ai-trader/store.ts, lib/ai-trader/auto.ts(新), app/api/cron/tick/route.ts(新), app/api/ai-session/[id]/route.ts, app/api/ai-session/[id]/tick/route.ts, app/ai-session/client.tsx, .github/workflows/auto-tick.yml(新), .gitignore

## 2026-07-17: 自動tickをVercel Hobbyの60秒上限に整合
- 背景: 自律学習ループの配管（GH Actions cron→/api/cron/tick）を本番で稼働開始（CRON_SECRET/PROD_URL登録・Supabase lock_until追加・再デプロイ・手動発火で200/{"processed":0}確認）。ただしroute.tsは maxDuration=300・1回3件・バジェット240s とVercel Pro前提の値で、実プランはHobby（関数上限60秒）。3件宣言しても2件目で切断される嘘の設定だった。
- 決定: app/api/cron/tick/route.ts を Hobby実態へ整合。maxDuration 300→60、listAutoTickTargets(3)→(1)、TIME_BUDGET_MS 240_000→50_000。1回のcronで1セッションを確実に完了し、複数セッションは1日3回のcronで lastTickAt 昇順に前進。
- 理由: ロックは5分TTLのリース＋count先行保存で「過少実行側に倒す」設計のため切断されても壊れないが、宣言値と実挙動の乖離を解消して明快にする（原則8）。個人利用で同時セッションは少数のため1件/回で実害なし。
- 検証: npx tsc --noEmit 緑。runTick/auto.ts本体は不変。
- 影響ファイル: app/api/cron/tick/route.ts。

## 2026-07-18: /report 改善は「根拠・教訓使用・理論一貫性の明示」を第1スライスにする
- 背景: オーナー7項目のうち「根拠が弱い」が最大の不満で、教訓の使用状況は原則9（偽装禁止）に直結する。
- 決定: 新データ源・新APIルート・決済を増やさず、既存の単一レポート経路のプロンプト＋UIパネルだけで完結する項目1+4+6を第1スライスに束ねる。PreparedBundle.learningUsage{hasData,usedLessons,scope,note}を追加し、プロンプトに根拠チェーン（事実→解釈→推論）と一貫性自己点検を必須化、UIに教訓使用状況パネル。投資家別(3)・銘柄未指定(5)は無料/課金フォーク(7)の後段に回す。
- 理由: end-to-endで最小・最低リスクかつ原則11（学習ループの可視化）に最も近い。実課金(Stripe)は今回スコープ外。learningUsageの母集団はlearningContextと一致させ「未使用の偽装表示」を構造的に防ぐ。
- 検証: npx tsc --noEmit 緑。スモークテスト（tsx・合成データはテスト用途のみ）23項目全PASS: summarizeDistilledLessonsとbuildLearningContextの母集団一致（slice上限10/6/6/5/5/4の超過分が両者から同様に除外されることを裏取り）、空メモリ/生取引のみ/insight類のみ（レビュー指摘の縁ケース — buildLearningContextと同一の入口ゲートclosedTrades/lessons/allDecisionsをヘルパに追加し、ゲート閉鎖時はhasData:false）でhasData=false、buildReportPromptが教訓あり/なし/undefined（旧bundle耐性 — learningUsageはoptional型）を正直に反映、9セクション構成据え置き、根拠チェーン必須化・一貫性チェック・教訓正直表示の指示文言をプロンプトに確認。maxTokens(4500)・セクション構成・generate経路は不変。根拠チェーン強化による出力肥大での末尾切れリスクは出荷前スモークで実レポートを確認する運用対応。
- 影響ファイル: lib/report/types.ts, app/api/report/prepare/route.ts, lib/report/prompt.ts, app/report/page.tsx, lib/ai-trader/memory.ts

## 2026-07-19: /lab 条件設定を3択排他モード化＋ニーズ軸プリセット（S1）
- 背景: 著名投資家モデル（柱1・排他選択）と初心者向けニーズ軸絞り込み（柱2）を /lab に組み込む依頼。過去ファンダは取得不可・Vercel 60秒/レート制限あり
- 決定: 未出荷の /lab を土台に、条件を「テクニカル/ニーズ軸プリセット/投資家モデル」の単一 mode 排他へ再構成。S1はニーズ軸3種（低リスク安定=大型marketCap≥1000億+MA20/50クロス、インカム=配当利回り≥3%+MA200、積極=中小型≤100億+Donchianブレイク20日）を既存 CompositeCondition+evaluateFundamentalGate+runBacktest に写像して実装（ニーズ軸はMA200のwarm-up確保のため5年日足・テクニカルモードは従来どおり1年）。ファンダは現在値の静的ゲート（過去非遡及・fail-closed）でありUIに明記。投資家モデルは disabled プレースホルダ（API側は501）。デイトレは日中足データ源なしで範囲外
- 理由: 新エンジン不要で最小の縦切り（原則2）。排他はUIグレーアウト＋API側モードガードの二重化（プリセット時はサーバーが条件導出しカスタム注入を400）。投資家モデル写像は将来 /report R4 と共有するため lib/backtest/investor-presets.ts に集約予定（S1では未実装・早すぎる抽象化回避）
- 検証: scripts/check-lab-presets.ts（tsx・合成バーはテスト用途のみ）43項目全PASS — プリセット3種が実在evaluator/実在FundamentalMetricのみ使用、needsへのcondition同梱・presetId配列/複数・未知ID/未知modeの400拒否、mode省略時は従来technical動作維持、ゲートfail（実測値つき）とno_data（fail-closed）でバックテスト不実行の前提成立。npx tsc --noEmit 緑
- 影響ファイル: app/lab/page.tsx, app/api/lab/backtest/route.ts, lib/backtest/{types,presets(新)}.ts, components/SiteNav.tsx, scripts/check-lab-presets.ts(新), DECISIONS.md

## 2026-07-20: /lab バックテストのエラー表示を「入力起因(422)」と「データ源障害(500)」で分離
- 背景: バックテスト失敗時に生のプロバイダ内部エラー（英語・"No data found, symbol may be delisted" 等）がそのままUIへ漏れ、原因が不明瞭だった。不正ティッカーもデータ源の一時障害も一律500で区別できなかった。
- 決定: runBacktest内で getHistory の fetch エラーを検査し、`/no data found|delisted|invalid symbol|not found/i` に一致する＝ティッカー入力起因なら BacktestDataError（422）へ変換して日本語フレンドリーメッセージ（正しいティッカー例つき）を返す。それ以外の想定外失敗は route.ts で500のまま扱うが、UIには「実データの取得に失敗（データ源が一時的に利用できない可能性）」の定型日本語のみを返し、生の内部エラーは `detail` フィールドとサーバーログ（console.error）へ逃がす。
- 理由: 不正ティッカーはユーザーが直せる入力エラー（422が適切）、データ源障害はリトライ案内が適切で、両者を区別することでUXと運用ログの両方が改善する。プロバイダ名・英語内部文字列をエンドユーザーに見せない。
- 検証: scripts/check-lab-presets.ts 43項目全PASS（回帰）、npx tsc --noEmit 緑。
- 影響ファイル: lib/backtest/run.ts, app/api/lab/backtest/route.ts

## 2026-07-20: /lab と /report を統合入口 /analyze に集約（S1＝クイックモードの背骨）
- 背景: 「ラボ（純計算バックテスト）」と「AIレポート」を単一ワークフローに束ね、投資家モデル選択も連動させたい。両者は既に同一 CompositeCondition を共有していた
- 決定: /lab・/report を消さず新入口 app/analyze/page.tsx で包む。S1はクイックモード（ニーズ軸プリセット）のみ end-to-end 配線＝lab で数字プレビュー→同一プリセット condition を既存 /api/report/prepare→generate へ渡し専門レポート化。新データ源・新APIルートゼロ。プロ/投資家/銘柄なしはプレースホルダ（/lab の investor 無効化と同手法）。過去ファンダ取得不可のため「過去成果」は現在ファンダゲート＋過去テクニカル実測の意味に固定しUI/プロンプトに明記（原則9）
- 理由: 2つは同一条件を食う2段パイプであり最小の縦切りで背骨が通る（原則2）。lab=無料の数字段/report=課金のAI段の役割分担でOpusトークン前にユーザー判断が可能。4択フラットでなくクイック/プロ2モードで初心者離脱を回避
- 検証: scripts/check-analyze-s1.ts（tsx）28項目全PASS — getNeedsPresetCondition がプリセットのCompositeConditionをそのまま返す（参照同一）、それが /api/report/prepare の parseCompositeCondition を未加工で通る（technical/fundamentalFilters/derivedFiltersとも変化なし）、クイック→レポート組み立てリクエストのsymbol正規化・initialCapitalが prepare の受け入れ条件を満たす、ANALYZE_MODE_TABS/ANALYZE_SCOPE_OPTIONSでプロ・投資家モデル・銘柄指定なしがdisabledのまま（未配線）であることを確認。npx tsc --noEmit 緑
- 影響ファイル: app/analyze/page.tsx(新), components/SiteNav.tsx, lib/backtest/presets.ts, scripts/check-analyze-s1.ts(新), DECISIONS.md

## 2026-07-21: /analyze プロモード有効化（S2）— 分析タイプ軸で条件ピッカー出し分け・prepareをプレビュー流用
- 背景: disabled だった /analyze プロモードを有効化し、/report のテクニカル＋ファンダ＋決算派生ピッカーを分析タイプ軸(ファンダ/テクニカル/ハイブリッド)で出し分けたい
- 決定: pro のプレビューは lab-backtest を使わず /api/report/prepare(非AI段)を流用（lab-backtest無改修）。ピッカーは /report から複製(抽出は次スライスに予約)。CompositeCondition.technical 必須のためファンダ型はベースライントリガー(買い持ち/MA200/MA50等・エンジンが実サポートする条件のみ)をユーザー選択で明示適用。透明性カードは derivedGate も反復するよう小改修し決算派生条件も反映
- 理由: prepare は任意 CompositeCondition のゲート＋5年バックテストを非AIで返すため最大再利用・新エンジンゼロ(原則2/8)。technicalモードは ma_cross 固定でカスタム条件を通せず prepare 流用が低サーフェス。複製は S1(MarkdownView)先例＋サーバー単一検証源(parseCompositeCondition)でドリフト無害。ベースライントリガーはユーザー選択＋UI明記で原則9の誤認回避
- 補足: 「買い持ち（常時保有）」はバックテストエンジン（lib/backtest/rules.ts）に評価器が存在しないため、ベースライントリガーの選択肢からは除外した（原則9: 未サポートの売買基準を別トリガーで偽装しない）。実際に採用したベースライントリガーは MA200クロス／MA50クロス／ゴールデンクロス(50×200)の3種で、いずれも既存 evaluateTechnical にそのまま写像できる実装済み条件のみ（scripts/check-analyze-pro.ts で合成バーによる実行検証済み）
- 検証: scripts/check-analyze-pro.ts（tsx・新規）全PASS — 分析タイプ軸(fundamental/technical/hybrid)がそれぞれ妥当な CompositeCondition を生成、ベースライントリガー3種が実在evaluatorへ例外なく写像、不正入力(非数値・短期MA≥長期MA・未知トリガーID)が{error}になる、透明性カード改修でderivedGateのpass/no_dataが正直に反映されることを確認。回帰: scripts/check-analyze-s1.ts（pro disabled期待値をS2の意図的な有効化に合わせて更新・28項目全PASS）、scripts/check-analyze-s4.ts（15項目全PASS）、scripts/check-report-r1.ts（全PASS）。npx tsc --noEmit 緑。保護対象ファイル（app/api/lab/backtest/route.ts, app/api/report/{prepare,generate}/route.ts, app/report/page.tsx, lib/backtest/run.ts, lib/backtest/types.ts, lib/report/claude.ts, lib/ai-trader/*）は無差分
- 影響ファイル: app/analyze/page.tsx, components/analyze/ProConditionPicker.tsx(新), lib/report/transparency.ts, scripts/check-analyze-pro.ts(新), scripts/check-analyze-s1.ts, DECISIONS.md

## 2026-07-22: /analyze S3 投資家モデル連動（言語化理論を土台にした近似スクリーニング）
- 背景: /analyze の investorモードが disabled プレースホルダのまま。著名投資家の投資哲学を検証に載せたい。オーナー要望で各モデルは投資家の言語化された理論・信念を土台とし、そこからファンダ/テクニカルの傾向を導く
- 決定: lib/backtest/investor-presets.ts（NeedsPreset同型の純データ・新設）に3モデル(バフェット/グレアム/リンチ)を philosophy(信念)＋実在FundamentalMetric＋実在DerivedMetric＋technical8種の近似写像として定義。/analyzeのinvestorモードをS2プロと同じprepare→generate 2段ボタンで有効化。/lab investor(501)・generateプロンプトは無改修。投資家名はAIに注入しない
- 理由: 新API・新データ源ゼロで最小の縦切り（原則2）。投資家名非注入で「本人が買う」断定を構造的に排除（原則9・S4トーン整合）。PEG/グレアムナンバー等の複合指標は発明せず個別実在指標のANDで近似しnotes/UIに明記。信念と実装のギャップ(例:一生保有はエンジン非対応→長期トレンド維持で代理)も正直注記
- 検証: scripts/check-analyze-s3.ts（tsx・新規）全PASS — 3モデルが実在FundamentalMetric/DerivedMetric/technical8種のみを使用し、technical必須・条件が有効・不正presetIdが弾かれることを確認。回帰: scripts/check-analyze-s1.ts（investor disabled期待値をS3の意図的な有効化に合わせて更新）、scripts/check-analyze-s4.ts、scripts/check-analyze-pro.ts、scripts/check-report-r1.ts 全PASS。npx tsc --noEmit 緑。保護対象ファイル（app/api/lab/backtest/route.ts, lib/backtest/presets.ts, lib/report/transparency.ts, app/api/report/{prepare,generate}/route.ts, lib/backtest/run.ts, lib/report/claude.ts, app/report/page.tsx, lib/ai-trader/*）は無差分
- 影響ファイル: lib/backtest/investor-presets.ts(新), components/analyze/InvestorModelPicker.tsx(新), app/analyze/page.tsx, lib/backtest/types.ts, scripts/check-analyze-s3.ts(新), DECISIONS.md

## 2026-07-22: S5c-1 ユニバース・ファンダのキャッシュ土台（Supabase universe_fundamentals）
- 背景: ライブ104銘柄走査は本番60秒制約で不可のため、事前計算キャッシュを土台にする（S5全体はキャッシュ前提）。その最初の縦切り。
- 決定: Supabase に universe_fundamentals テーブルを追加し、lib/screen/cache.ts をstore.tsパターン(service-role正・ローカルJSONフォールバック)で新設。初期充填は scripts/seed-fundamentals.ts をオーナーがローカル実行(居住IP=Yahoo健全・~3分)。no_data(`{}`)はスキップし架空データを入れない(原則9)。screen API・cron・UIは後続スライス。
- 理由: screenを軽量化して60sを死守する設計の土台。シード先行でcron単独初期充填(6日で非実用)問題を回避。
- 補足: scripts/seed-fundamentals.ts は lib/screen/cache.ts の upsertCached を直接呼ばず、Supabaseクライアントを自前生成して同一テーブル/列へ書き込む。`lib/supabase/admin.ts` は `import 'server-only'` を含み、tsx（プレーンNode実行）から読み込むと即座に例外を投げるため（scripts/seed-sessions.ts と同じ既存制約）。cache.ts自体はServer Component/APIルート（S5aで追加予定）からの利用を想定。
- 影響ファイル: supabase/migrations/0002_universe_fundamentals.sql(新), lib/screen/{types,cache}.ts(新), scripts/seed-fundamentals.ts(新), DECISIONS.md, .gitignore

## 2026-07-22: S5a screen API＋ランキング＋no-symbol UI（キャッシュ前提の適合度スクリーニング）
- 背景: /analyze の「銘柄指定なし」がS1以来ずっとdisabledのプレースホルダだった。S5c-1で用意したキャッシュ済みユニバース（universe_fundamentals）を初めて利用者に見せる縦切り。ライブ104銘柄走査は60秒制約で不可のため、キャッシュのみで完結させる。
- 決定: `lib/screen/rank.ts`（新・純関数）を追加し、`evaluateFundamentalGate` をキャッシュ行に適用してランキングする。第1キーは「AND条件のうち何件を実測で満たしたか（passedCount）」の辞書式降順。第2キーは条件の**先頭fundamentalFilter**の指標をそのまま使い、その演算子がgte/gtなら実測値の降順・lte/ltなら昇順にする（新しい重み付けを発明せず、条件式自体が既に表す「どちら向きが望ましいか」を使うだけ）。この規約は NEEDS_PRESETS の3種（stable=marketCap降順／income=dividendYield降順／aggressive=marketCap昇順）・INVESTOR_PRESETS の3種（buffett=roe降順／graham=pe昇順／lynch=earningsGrowth降順）の全プリセットで実際の意図と一致することを確認済み。欠キャッシュ・鮮度切れ（暫定14日閾値・S5c-2のcron導入時に見直し予定）・no_data（AND条件のいずれか1つでも実データ欠如）はfail-closedでランキングから除外し、架空値で穴埋めしない。同値はsymbolで決定的にタイブレークする（合成スコアなし）。`app/api/analyze/screen/route.ts`（新）はキャッシュ読み取りのみ（ライブgetFundamentals呼び出しゼロ）でTOP10を返し、mode='pro'（カスタム条件）は400で明示的に非対応とする。空/薄いキャッシュでも例外にせず「評価0件」を正直な200応答として返す。`app/analyze/page.tsx` は scope「銘柄指定なし」のdisabledを解除し、quick/investor選択時のみ機能する独立したスクリーニングパネル（結果クリックで銘柄を「銘柄指定あり」フローへ渡す最小導線）を追加した。プロ+銘柄指定なしの組み合わせは明示メッセージで非対応と案内する
- 理由: 新しい合成スコア・複合指標を発明せず（原則9）、既存のAND条件評価器をそのまま再利用して最小の縦切りで「賢く見える」ランキングを実現するため。第2キーを「先頭フィルタの向きをそのまま使う」という単純な規約にしたことで、プリセットごとの個別ルックアップテーブルが不要になり、rank.tsはCompositeConditionだけを見る汎用の純関数のまま保てる（早すぎる抽象化はしないが、既存の型を素直に使っただけで済んだ）
- 検証: `scripts/check-screen-rank.ts`（tsx・新規）全PASS — 第1キー(passedCount)優先の辞書式ソート、第2キーの方向がプリセット6種（stable/income/aggressive/buffett/graham/lynch）全てで意図と一致、鮮度切れ・no_dataの除外とmeta件数の正確性、同値タイブレーク、TOP N上限、空キャッシュでの0件応答を確認。回帰: `scripts/check-analyze-s1.ts`（no-symbol disabled期待値をS5aの意図的な有効化に合わせて更新）、`scripts/check-analyze-s4.ts`・`scripts/check-analyze-pro.ts`・`scripts/check-analyze-s3.ts`・`scripts/check-screen-cache.ts`・`scripts/check-report-r1.ts` 全PASS。`npx tsc --noEmit` 緑。保護対象ファイル（lib/screen/cache.ts, lib/backtest/fundamental.ts, lib/market/index.ts, app/api/report/*, app/api/lab/backtest/route.ts, lib/backtest/run.ts, lib/report/*, app/api/cron/*, lib/ai-trader/*, app/report/page.tsx）は無差分
- 影響ファイル: lib/screen/rank.ts(新), lib/screen/types.ts, app/api/analyze/screen/route.ts(新), scripts/check-screen-rank.ts(新), app/analyze/page.tsx, scripts/check-analyze-s1.ts, DECISIONS.md

## 2026-07-22: S5c-2 ユニバース・ファンダの鮮度top-up cron（分割巡回）
- 背景: S5aのscreen APIはキャッシュ（universe_fundamentals）を読むだけで、S5c-1の初期シード以降は鮮度が保たれない。全104銘柄をVercel Hobbyの60秒制約内で毎回一括更新するのは不可能なため、差分の鮮度維持だけを担うcronが必要だった。
- 決定: `lib/screen/refresh.ts`（新・純ロジック）を追加し、`listStaleTargets(REFRESH_BATCH=6)` で fetched_at 最古のN件だけを選び、逐次（`REFRESH_SPACING_MS=1500`の間隔）で `getFundamentals(symbol, {allowMock:false})` を叩いて `upsertCached` する。`TIME_BUDGET_MS=50_000` で必ず打ち切り（`truncated`フラグ）、no_data(`{}`)や取得例外は既存キャッシュを上書きせず`skipped`として計上する。fetcher/sleep/nowは依存注入可能にし、実ネットワーク・実待機なしでスモークできる設計にした。`app/api/cron/refresh-fundamentals/route.ts`（新）は`cron/tick/route.ts`と同じBearer `CRON_SECRET`検証・`runtime='nodejs'`・`maxDuration=60`のパターンを踏襲するが、universe_fundamentalsはtickのlock_until機構と別テーブルのため専用ロックは持たせず(upsertの冪等性で同時実行を吸収)。`.github/workflows/refresh-fundamentals.yml`（新）は`auto-tick.yml`と同型（Bearer curl・既存Secrets `PROD_URL`/`CRON_SECRET`を流用・`workflow_dispatch`あり）だが、スケジュールは分を`:15`に固定してauto-tickの`:37/:23/:48`と衝突しないようにし、US平日13-21時UTC(≒9-17時ET)に毎時発火（6件×9回/日＝約54件/日、104銘柄を約2日で一巡）。
- 理由: 初期充填済みキャッシュに対する「差分の鮮度維持」に限定することでスコープを最小化し（原則2・8）、tick経路（学習ループの中核・原則11）には一切触れずに独立して追加できる。バッチを小さく・逐次＋spacing・時間バジェット打ち切りの三重の保守性で、Vercel Hobbyの60秒制約とYahooのレート制限の両方を守る。no_dataでの上書き拒否は原則9（架空データで良いキャッシュを汚さない）の継続。
- 検証: `scripts/check-screen-refresh.ts`（tsx・新規、依存注入したスタブfetcherでSupabase/実ネットワーク不要）全PASS — 古い順選択(batch)、実データ更新時のsource/fetchedAt反映、対象外銘柄の非変更、no_data時のスキップ計上と既存キャッシュ温存、fetcher例外時のスキップ計上と後続銘柄への継続処理、時間バジェット超過時のtruncated、空キャッシュでの0件応答を確認。回帰: `scripts/check-screen-cache.ts`・`scripts/check-screen-rank.ts`・`scripts/check-analyze-s1.ts`・`scripts/check-analyze-s4.ts`・`scripts/check-analyze-pro.ts`・`scripts/check-analyze-s3.ts`・`scripts/check-report-r1.ts` 全PASS。`npx tsc --noEmit` 緑。保護対象ファイル（`app/api/cron/tick/route.ts`, `.github/workflows/auto-tick.yml`, `lib/ai-trader/*`, `lib/screen/cache.ts`, `lib/screen/rank.ts`, `app/api/analyze/screen/route.ts`, `lib/market/index.ts`, `lib/backtest/*`, `app/analyze/page.tsx`, `app/api/report/*`, `app/report/page.tsx`）は`git diff --stat`で無差分を確認。
- 影響ファイル: lib/screen/refresh.ts(新), app/api/cron/refresh-fundamentals/route.ts(新), .github/workflows/refresh-fundamentals.yml(新), scripts/check-screen-refresh.ts(新), DECISIONS.md

## 2026-07-24: HOTFIX 自動tickが本番で恒常的に504（Vercel関数タイムアウト）で失敗していた問題を修正
- 背景: オーナーがGitHub Actionsで`auto-tick`が連続して赤（"Internal server error. Correlation ID: ..."）になっていると報告。実際のワークフロー実行ログ（`gh run view --log-failed`）を確認したところ、対象セッションがある回はほぼ毎回「curlが60秒でVercelから504を受け取りexit 22」という一貫した失敗パターンだった（1回だけ別原因＝GitHub Actions自体のランナー確保失敗という無関係な一時障害も混在）
- 決定: 根本原因は`@anthropic-ai/sdk`の既定値（timeout=10分・maxRetries=2の自動バックオフ再試行）を`lib/ai-trader/engine.ts`のClaude API呼び出し（`callClaudeApi`）が上書きしていなかったこと。tickの`TIME_BUDGET_MS`は「次のセッションを開始するか」だけを見ており実行中の1呼び出しの長さ自体は無制限だったため、Claudeが少し遅延・429/5xxで自動リトライすると即座にVercelのmaxDuration(60s)でハードkillされ504になっていた。(1)`callClaudeApi`に明示的な`timeout: 20_000ms, maxRetries: 1`を設定（tick経路のみ・レポート生成等の他のClaude呼び出し経路には触れない）、(2)`app/api/cron/tick/route.ts`に汎用の`withDeadline()`ヘルパを追加し、`runAutoTick(t.id)`呼び出しを残余バジェットで打ち切って必ず時間内にJSON応答を返す防御層を追加（実際のエラーはtimeoutに揉み消さずrejectとして素通しし、既存の`reason:'error'`分類を壊さない）。runTick本体・auto.tsの日次上限/ロック設計・count先行保存（過少実行側に倒す方針）は無改修
- 理由: (1)が本丸の修正（Claude呼び出しを速く失敗させ次tickに委ねる）、(2)は根本原因の断定に残るわずかな不確実性（データプロバイダ側の想定外の遅延等）に対する低コストな安全網。両方とも「エラーは速やかに失敗として扱う」という既存のauto.ts設計思想（過少実行側に倒す・原則8）の延長で、新しい抽象化や依存は増やしていない
- 検証: `npx tsc --noEmit`緑。`withDeadline`のタイミング/エラー素通し挙動をスクラッチパッドの使い捨てユニット複製で確認（速い処理はそのまま値・遅い処理はtimeout値・実際のエラーはrejectとして素通し）。実運用側の確認はオーナーに依頼（下記手動手順）。既存の学習ループ（学習メモリ・日次上限・ロック機構）を壊していないことをコードレビューで確認（auto.ts/store.ts/memory.tsは無差分）
- オーナーへの手動確認手順: 次回のスケジュール実行（または`workflow_dispatch`での手動発火）で`auto-tick`が緑になることを確認する。万一まだ504が出る場合はVercelの当該Function実行ログ（Vercel Dashboard → investsim → Functions/Logs）で`[cron/tick]`のエラー内容を確認してほしい（本修正はClaude呼び出しの遅延を主因と特定したものだが、市場データ側のプロバイダ障害が別途重なる可能性は残る）
- 既知の限界（2026-07-25 reviewer指摘を受けて追記）: `withDeadline`は真のキャンセルではなく、学習ティック（tickCount%5==0でClaude呼び出しが2回）等でruntが残余バジェットを超えると、応答をtimeoutとして返した後も元の`runAutoTick`は裏で完走しうる。この場合「timeoutと報告したのに実際には売買・当日カウント消費が起きている」というズレが起こり得る（504自体は解消済み・データ破損ではない）。`lock_until`のリース機構と`count`先行保存により、このズレは二重実行側には倒れず「過少報告（実際は実行済みなのにtimeoutとして記録される）」側に留まる設計になっている。対応として`withDeadline`に`onLateSettle`コールバックを追加し、打ち切り後にpromiseが完走/失敗した場合は`[cron/tick] session %s completed AFTER deadline`（成功時）または対応する`console.error`（失敗時）でログに残すようにした。真のキャンセル（AbortController等でのClaude呼び出し中断）は別スライスとする
- 影響ファイル: lib/ai-trader/engine.ts, app/api/cron/tick/route.ts, DECISIONS.md

## 2026-07-25: 事業サイド部署の設立＋ローンチ商品のピボット決定
- 背景: オーナーが「来週末（2026-08-02頃）に一旦ビジネスとして世に出したい」。現行計画は「FB/IGで発信＋Fiverrでアプリ内AIレポート（特定銘柄の売買判断＋将来見通し）を情報商材として有償販売」。事業化に必要な役割が開発サイドしか無かった。
- 決定（体制）: 事業サイド部署4つを新設し COMPANY.md 部署表に登録した — cmo（マーケ統括）/ content-creator（SNS制作）/ monetization（収益化・価格）/ legal-compliance（法務・コンプラ）。customer-success はフェーズ2（ローンチ後）とし今回は作らない。cmo→content-creator/monetization→legal-compliance の順で回し、訴求・価格・オファーは公開前に必ず legal-compliance を通す運用にした。
- 決定（商品ピボット）: legal-compliance の洗い出しにより、現行の売り方は金商法の無登録「投資助言・代理業」に正面から触れるリスクが濃い（対価性は有償ゆえ消せず、`/report`の特定銘柄＋将来見通し＋Fiverrの個別提供が助言性・個別性を強める）と判断。対価性は消せないため、助言性・個別性を実質的に落とす方向へ商品の骨格を変更する。(a) 売り物の芯を「特定銘柄の答え（レポート）を売る」から「著名投資家の分析を実データで再現・体験させる InvestSim アプリ本体」に置き換え、本命をアプリ体験とする。(b) 販路の重心を自社LP＋FB/IG中心にし、Fiverrはサブ販路（作り替えた教育/実証コンテンツのみ）に降格。(c) 将来予測より過去実証・仮想資金シミュを前面、顧客ごとの個別最適化はしない（万人向け定型）、最終投資判断はユーザーに残す構造を守る。
- 理由: 「出すな」ではなく「形を変えれば来週末ローンチは可能」という法務の温度感に沿い、事業存続リスク（個人への刑事罰を含む）を先に潰すため。原則9（実データ）・原則10（仮想資金・実決済非連携）・原則11（学習ループ）と整合。
- 未確定（弁護士確認事項）: 作り替え後の版が金商法「投資助言」非該当と言い切れる境界、課金ゲート下のコンテンツが出版物適用除外に乗るか、Fiverr等海外PF経由でも日本法適用の前提、国外顧客時の現地規制（米国 Investment Advisers Act 等）、著名投資家名の使用範囲。詳細は legal-compliance の報告に列挙。
- builder向け必須実装（ローンチ前提・未着手）: 特商法表記ページ／恒久的な免責表示（現行 app/report/page.tsx の簡易免責では不十分）／利用規約への反映／実績表示の裏付け保存／断定・保証・個別推奨表現のガード強化（lib/report/prompt.ts の思想を強制制約に）。
- 影響ファイル: .claude/agents/{cmo,content-creator,monetization,legal-compliance}.md(新), COMPANY.md, DECISIONS.md

## 2026-07-30: 自動tickが「success なのに毎回失敗」していた問題を修正（7/24 HOTFIXの副作用）
- 背景: オーナーから「tickが続かない。原因はGitHubにあるのか」と報告。調査の結果、GitHub Actionsは無罪だった（1日3回きちんと発火し、7/27以降は全runがsuccess）。真相は「curlがHTTP 200を受け取るのでワークフローは緑になるが、レスポンス本文が毎回 `{"processed":1,"results":[{"id":"session_1784047411924","ran":false,"reason":"error"}]}`」という無音の失敗。`workflow_dispatch`で手動発火（run 30480131945）して再現し、Vercelランタイムログで実体を特定した: `[cron/tick] session ... failed: Error: Request timed out.`（`status: undefined` ＝ HTTPレスポンス到達前のクライアント側打ち切り。認証エラーでもクレジット切れでもなく、`ANTHROPIC_API_KEY`は設定済み・`claude-haiku-4-5`も有効なエイリアス）
- 決定: 2026-07-24 HOTFIXで入れた `timeout: 20_000, maxRetries: 1` が、504を消した代わりに自動tickを7/27以降ずっと100%失敗させていた。実測46秒の内訳が「データ取得6秒 + 20秒timeout + リトライ20秒timeout」で、**判断1回が20秒に収まらない**のが真因。(1)`maxRetries: 1 → 0`（2回目も同じ理由で落ちるだけで40秒を溶かすため）、(2)`CLAUDE_TIMEOUT_MS: 20s → 35s`（cron側の`TIME_BUDGET_MS=50秒`に「データ取得+後処理 約10秒 + 判断35秒」で収まる見積り）、(3)`callClaude`に`{maxTokens, timeoutMs}`を追加して呼び出し側ごとに使い分け（判断=2500トークン/35秒、学習=4096トークン/20秒）、(4)`selectCandidates(6) → (4)`。`withDeadline`・auto.tsの日次上限/ロック/count先行保存・runTickの構造は無改修
- 理由: 生成時間はほぼ出力トークン数に比例するので、効くのは「時間を増やす」より「出力を削る」。ただし`max_tokens`を一律に絞ると学習側（6配列×5件）のJSONが途中で切れ、閉じフェンスが消えて呼び出し側の正規表現が無マッチ＝**静かに空の判断/空の学習**になる（例外も出ない）ため、hot pathだけ絞って学習側は据え置いた。`maxRetries: 0`は「1日3回のcronが古い順に拾い直す」既存設計に委ねる判断で、過少実行側に倒す方針（原則8・auto.tsと同方針）の延長
- 併せて判明した構造的欠陥: `listAutoTickTargets(1)`は1件しか取らないため、先頭のセッションが失敗し続けると後続が永久に進まない（ヘッドオブラインブロッキング）。今回は対象セッションが1件のみで実害が出ていないが、複数セッション運用時は「失敗したセッションを後回しにする」順序制御が別途必要。今スライスでは触っていない
- 検証: `npx tsc --noEmit`緑。原因特定は`workflow_dispatch`での実再現＋Vercelランタイムログ（`vercel logs --json`）で確定させた（推測ではない）。**デプロイ後の実運用確認済み（2026-07-30）**: commit b0dae48 を本番反映後に手動発火し、セッションの`equityHistory`が `2026-07-17T15:21:51Z`（最後の成功）→ `2026-07-30T15:45:19Z` と**13日ぶりに前進**、`tickCount` 10、新規decisions（MSFT buy/AMD watch/INTC watch/META hold/XOM hold）を確認。Claude呼び出しの例外は消え、Vercelログにエラー0件。35秒は足りていた
- 残課題A（学習ループが一度も完走していない・原則11に直撃）: 検証時のレスポンスは`ran:false, reason:"timeout"`だったが、これは**誤報**でtick自体は完走・保存されていた（cron側のwithDeadlineが50秒で先に応答を返しただけ）。内訳は「tick本体が約29秒で`lastTickAt`到達 → `tickCount`10が`LEARN_EVERY_N_TICKS=5`の倍数なのでgenerateFullLearning（2回目のClaude呼び出し）が起動 → 50秒バジェット切れ」。`learning.lastLearnTickCount`が**tickCount=10に対して0のまま**＝学習は過去に一度も成功しておらず、蓄積がゼロ。tickの売買判断は動いても「反復して賢くなる」という最終目的が成立していない
- 残課題B（学習が失敗するとtick本体の保存も道連れになりうる）: runTickは学習ブロックの**後**に最終`upsertSession`を置いているため、学習が遅延・失敗すると売買結果の保存まで巻き込まれる構造。今回はたまたま保存が間に合った。対策案は(1)学習の前に一度保存して売買結果を確定させる、(2)学習をtickから外し専用cron（例:`/api/cron/learn`）に切り出して独自の60秒枠を与える、(3)学習プロンプト/出力の削減。(2)が本命だが別スライスとする
- オーナーへの確認手順: 次回スケジュール実行後に `gh run view <id> --log | grep processed` でレスポンス本文を見る。`"ran":true` なら完全解決。`"reason":"timeout"`なら上記の誤報パターンの可能性があるので、`/api/ai-session/<id>` の`lastTickAt`と`tickCount`が前進しているかで真偽を判定する（レスポンス本文だけを信じない）
- 別件（今回発見・未対応）: `/api/analyze/screen`が本番で500。`Could not find the table 'public.universe_fundamentals' in the schema cache` ＝ Supabaseにテーブル未作成。`PROGRESS.md:81`の「オーナーの手動作業（未完）」（`supabase/migrations/0002_universe_fundamentals.sql`の実行と`scripts/seed-fundamentals.ts`）がそのまま残っている。tickとは無関係のため本スライスでは触っていない
- 影響ファイル: lib/ai-trader/engine.ts, DECISIONS.md

## 2026-07-31: 学習をtickから切り出し専用cron（/api/cron/learn）へ分離
- 背景: 前エントリの残課題A/B。学習はtick内で2回目のClaude呼び出しになり、(a)売買判断の後にcron/tickの`TIME_BUDGET_MS`(50秒)を食い潰して応答が`reason:"timeout"`と誤報される、(b)`runTick`の最終`upsertSession`が学習ブロックの**後ろ**にあるため学習の遅延が売買結果の保存まで道連れにする、という2つの問題を起こしていた。実データ確認では`tickCount=10`に対し`lessons=0`/`fundamentalInsights=0`/`lastLearnTickCount=0`で学習の蓄積がゼロ。なお`shouldLearnNow`は`closedTrades>0`を要求するため、tick5の時点ではまだ対象外で、**学習が実際に起動できたのは今日のtick10が初めて**であり、それがバジェット切れで落ちていた（「何度も失敗し続けていた」わけではない）
- 決定: `runTick`から学習ブロックを削除し、`lib/ai-trader/learn.ts`（新・`auto.ts`と対称）に`runLearnTick`/`listLearnTargets`を置いて`/api/cron/learn`（新）から叩く。`.github/workflows/learn.yml`（新）で1日1回・米国引け後（`5 21 * * 1-5`）に発火。学習のClaude timeoutは専用60秒枠を単独で使えるようになったため`CLAUDE_LEARN_TIMEOUT_MS` 20秒→40秒（20秒では生成が終わらず空振りしていた）。`LEARN_EVERY_N_TICKS=5`は廃止（`shouldLearnNow`の`tickCount > lastLearnTickCount`が自然な間引きになり、頻度制御はcronスケジュールへ移る）
- 最重要の設計急所（ロックの共有）: `upsertSession`は`ai_sessions`の**同一行をセッション全体でlast-write-wins置換**する。学習cronが「読み込み → Claudeで数十秒 → 全体を書き戻し」する間にtickが走ると、**tickが実行した売買結果を学習側の古いスナップショットで上書きして消す**。そのため学習cronはtickと同じ`tryAcquireTickLock`を取得し、ロック取得後にセッションを読み直す（TOCTOU回避・`runAutoTick`と同じ順序）。「学習は別処理だからロック不要」は誤りで、書き込み先が同じ行である以上必須。`refresh-fundamentals`が専用ロックを持たなくてよいのは別テーブル（`universe_fundamentals`）だからで、事情が異なる
- 理由: tickを「売買判断1回だけ」に保てば約29秒で完結し、50秒バジェットに余裕ができて誤報も同時に解消する。学習を独立させることで、学習が遅延・失敗しても売買結果の保存に影響しなくなる（残課題Bの解消）。新しい抽象化は増やさず`auto.ts`/`cron/tick`の既存パターンを踏襲した
- 生成が空だった場合は`lastLearnTickCount`を進めず次回cronで再挑戦する（tick内にあった頃と同じ意味論を維持）
- リスク: (1)ロック競合で学習が飢える→cron時刻を`:05`にし、auto-tickの`:37/:23/:48`・refresh-fundamentalsの`:15`と重ならないようにした。(2)Vercelにハードkillされると`finally`が走らずロックがTTL(5分)まで残りtickをブロックしうる→時刻分離で緩和。(3)学習頻度の制御がコードからymlへ移り可視性が下がる→両方にコメントで明示
- 検証: `npx tsc --noEmit`緑。**デプロイ後の実運用確認済み（2026-07-31）**: commit 3e51960 反映後に`workflow_dispatch`で発火し `{"learned":true,"lockDegraded":false}`。`/api/ai-session/<id>`で`lastLearnTickCount` 0→14、`lessons`/`fundamentalInsights`/`newsInsights`/`causalChains`/`tradingBiases`/`strategyNotes`が各5件（計30件）生成され永続化されたことを確認。40秒枠で完走した。同時に`tickCount`が10→14に増えており、前エントリのtick修正もスケジュール実行で継続動作している
- 生成内容から判明した設計上の示唆: 出力された教訓が「RSI>70+BB上限超えで即利確」「短期利確(3-6h)が有効」など**短期テクニカル寄りに強く偏った**。学習の入力が`closedTrades`（実際に手仕舞いした取引）しか無く、その2〜3件がいずれも短期決済だったため。中長期保有を志向するサイトでは、クローズ依存の学習は投資方針そのものを短期売買へ歪める。次スライスで「クローズしていなくても市場調査・予想から学ぶ」経路を追加する根拠になった
- 追記（本スライスで実装・本番未検証）: 上記の示唆を受けて`memory.ts`の`shouldLearnNow`を`closedTrades.length > 0 || allDecisions.length > 0`へ緩和し、`engine.ts`の`generateFullLearning`に保有中ポジション（含み損益・エントリー根拠）を学習材料として追加した。**上の「検証」項目にある「デプロイ後の実運用確認済み（2026-07-31）」は、この緩和・追加より前の旧`shouldLearnNow`（closedTrades必須）で行われた検証であり、この保有中ポジション材料化のロジックは含まない（本番未検証）**。次回の学習cron発火で`lessons`等の時間軸が中長期側へ広がるか、サンプル数が少ない教訓に注記が付くかを確認する
- 影響ファイル: lib/ai-trader/engine.ts, lib/ai-trader/memory.ts, lib/ai-trader/learn.ts(新), app/api/cron/learn/route.ts(新), .github/workflows/learn.yml(新), DECISIONS.md

## 2026-07-30: /analyze・/report S1 読者プロファイル（初心者向け一流分析ロードマップの第1スライス）
- 背景: strategist設計・オーナー承認済みの「初心者向け一流分析」ロードマップの先頭スライス。専門家向けの密度は維持したまま、初心者が読んでも「だから何」が伝わるレポートにしたい
- 決定: `lib/report/profile.ts`（新・presets.tsと同じ純データ＋純関数パターン）に`ReaderProfile`（投資期間/リスク許容度/スタイル志向＋任意の資金の性格）を定義し、`describeReaderProfile`（人間可読ブロック）・`buildEmphasisHints`（実在指標のみで書いた強調順序の指針）・`isReaderProfile`（ホワイトリスト検証）を実装。`lib/report/prompt.ts`の`buildReportPrompt`に**任意の第2引数**`profile?`を追加し、指定時のみ【マクロ・市場環境】直後・【引用元】直前に【読者プロファイル】節を挿入する。この節は「強調順序・語り口・意味づけのみ最適化。事実・数値・ゲート判定・シナリオは一切変えない。両面評価は必ず維持。不適合なら不適合と正直に述べる。個人への助言的断定はしない」という指示に限定し、9セクションの見出し・順序・ゲート値・数値表示は無改修。加えて「主要数値には“だから何”を1文添える」意味づけ強制の指示をprofile有無に関わらず厳守事項へ常時追加した（初心者以外にも品質底上げとして効く）。`app/api/report/generate/route.ts`は`body.profile`を`isReaderProfile`で検証し、不正/未知は400にせず黙ってprofileなし扱いにフォールバックする（安全側・後方互換）。`app/analyze/page.tsx`のconfigパネルに3+1問のラジオ群（「指定なし」既定）を追加し、`streamGeneratedReport`経由で`generate`にprofileを同梱。profileはbundle（prepare結果）を無効化しないため、profile変更時は`resetDownstream`を呼ばない
- 理由: 原則9の絶対線（過去データ・判定はレンズで変えない）を型・関数構造そのもので強制する設計にした（profileはPreparedBundleに足さず、prepareパイプラインには一切触れない）。`buildEmphasisHints`はFundamentalMetric/DerivedMetricの実在ラベルのみを参照し、新しい複合指標・スコアは発明していない（style=growthのPEG文脈は`pegRatio`という実在フィールドではなく、ゲート対象として管理されている`pe`をPEG的な文脈で語る指示に留めた — architect計画どおり、指標追加ではなく既存`pe`の語り口調整）
- 検証: `scripts/check-report-profile.ts`（tsx・新規）全PASS — isReaderProfileが不正/未知の値（未知enum・不正capacity・型違い）を弾き正当な値（capacity省略含む）を通すこと、describeReaderProfileがcapacity有無で行の出入りが正しいこと、buildEmphasisHintsが3スタイル×実在ラベル（dividendYield/fcfMargin/fcfPositiveYears/equityRatio/profitQuality、revenueCagr3y/epsCagr3y/earningsGrowth/pe、pe/pb/profitQuality/equityRatio/netDebtToEbitda）を含み「〜だけ見ろ」「リスクを省略する」的な内容変更の指示を含まないこと、条件付きヒント（弱気厚め/長期複利/強気上値）の発火条件、buildReportPromptがprofile指定時のみ【読者プロファイル】節を含みprofile無しでは含まないこと、意味づけ強制の指示がprofile有無に関わらず常に含まれること、9セクション見出し・順序がprofile有無で不変であることを確認。回帰: `scripts/check-report-r1.ts`・`check-analyze-s1.ts`・`check-analyze-s4.ts`・`check-analyze-pro.ts`・`check-analyze-s3.ts`・`check-screen-rank.ts` 全PASS。`npx tsc --noEmit`緑。保護対象ファイル（`app/api/report/prepare/route.ts`, `app/api/lab/backtest/route.ts`, `lib/backtest/run.ts`, `lib/backtest/{fundamental,presets,investor-presets}.ts`, `lib/report/transparency.ts`, `lib/report/claude.ts`, `lib/screen/*`, `lib/ai-trader/*`）は無差分
- 影響ファイル: lib/report/profile.ts(新), lib/report/prompt.ts, lib/report/types.ts, app/api/report/generate/route.ts, app/analyze/page.tsx, scripts/check-report-profile.ts(新), DECISIONS.md

## 2026-07-31: /report S2 投資テーゼ化（「未来予想」を良い会社の紹介からプロの投資テーゼへ格上げ）
- 背景: strategist設計・オーナー承認済みロードマップの第2スライス。既存の「未来予想」は3シナリオ構造こそ持っていたが、「なぜ市場がミスプライスしているか」というテーゼ視点・カタリスト・リスクの緩和材料・弱気耐性の判定が指示されておらず、良い会社の紹介に留まりがちだった
- 決定: `lib/report/prompt.ts`の`buildReportPrompt`内、9セクション中「未来予想」の指示文のみを強化する純プロンプト変更（新データ源・新API・新引数ゼロ）。追加した要求は4点: (1) 冒頭で市場コンセンサスとの差分（「市場は◯◯を懸念しすぎ／楽観しすぎている可能性がある」）を1〜2文・引用元[n]付きで、断定でなく「可能性がある」の程度で述べる（良い会社≠良い投資の視点を明記）。(2) 既存の強気/中立/弱気3シナリオそれぞれに、価格/指標水準の目安に加えて実現の鍵となる**カタリスト**（次の決算・新製品/新事業・マクロ転換・金利/為替等、実データまたは既知の一般情報の範囲）を必須化。(3) 主要リスクは必ず緩和材料・条件とペアで書く（リスクの列挙で終わらせない）。(4) セクション末尾に「弱気シナリオが実現しても現在の株価水準は正当化されうるか」という一言判定（安全域の言語化）を必須化。厳守事項にも「投資テーゼとしての未来予想」と「架空の確率・具体的な騰落率の禁止（例:「70%の確率で+20%」）」の2条を新設し、未来予想節本文と厳守事項の二重の歯止めにした。9セクションの見出し・順序・maxTokens(4500・generate route側)・根拠チェーン/一貫性チェック/教訓の正直表示/読者プロファイル(S1)の節・意味づけ強制は無改修
- 理由: シナリオ/テーゼは既存の実データ（現在値ファンダ・5年バックテスト実測・決算派生・学習メモリ・ニュース・マクロ）と引用[n]の上でのみ成立させ、架空の確率・具体的な騰落率（実バックテスト由来の勝率データが担当すべき領域）を作らせないことで原則9・リーガル整合（断定回避・免責）を保ったまま「密度を下げず助言的断定だけ避ける」という既存方針と両立させた。テーゼ差分・弱気耐性判定は「良い会社の紹介」で終わらせないための核であり、リスク＋緩和ペアの強制は誠実さ（ベア併記）の実装。既存の3シナリオ構造を壊さずカタリストを追加する最小差分にしたのは、S1の読者プロファイル節・根拠チェーンの事実→解釈→推論連鎖が既にこれらの新規結論にも自動的に適用される（厳守事項の「根拠チェーンの必須化」が全セクション共通のため）ことを確認した上での判断（原則2・8）
- 検証: `scripts/check-report-s2.ts`（tsx・新規）全PASS — テーゼ差分・可能性としての表現・良い会社≠良い投資の視点・テーゼ差分への引用元[n]要求、3シナリオ構造とカタリスト要求（実データ/既知の一般情報の範囲限定）と価格/指標水準の維持、リスク＋緩和材料ペアの要求（未来予想節・厳守事項の両方）、弱気耐性の一言判定と安全域の言語化要求、架空の確率・具体的な騰落率の禁止が未来予想節・厳守事項の2箇所にあり逆方向の指示が紛れ込んでいないこと、9セクション見出し・順序がprofile有無双方で不変、S1読者プロファイル節・意味づけ強制・根拠チェーン必須化・一貫性チェック・教訓の正直表示が温存、既存リーガルトーン（断定・助言表現の回避・投資助言でない旨の明記・予言ではない旨）が温存・強化されていることを確認。回帰: `scripts/check-report-r1.ts`・`check-report-profile.ts`・`check-analyze-s1.ts`・`check-analyze-s4.ts`・`check-analyze-pro.ts`・`check-analyze-s3.ts`・`check-screen-rank.ts` 全PASS。`npx tsc --noEmit`緑。`git diff lib/report/prompt.ts`で9セクション見出し・順序が不変で「未来予想」節本文と厳守事項2条の追加のみであることを目視確認。保護対象ファイル（`app/api/report/{prepare,generate}/route.ts`, `app/api/lab/backtest/route.ts`, `lib/backtest/*`, `lib/report/transparency.ts`, `lib/report/profile.ts`, `lib/report/claude.ts`, `lib/screen/*`, `lib/ai-trader/*`, `app/analyze/page.tsx`）は`git status --porcelain`で無差分を確認（lib/ai-trader/engine.tsの既存差分はセッション開始前からの未コミット別件で本スライス起因ではない）
- 影響ファイル: lib/report/prompt.ts, scripts/check-report-s2.ts(新), DECISIONS.md

## 2026-08-03: 知識ストアをAIの売買判断プロンプトへ配線（提示/引用の帰属記録つき）
- 背景: `lib/knowledge/`（store/types/マイグレーション0003/sync-knowledge.ts）は前セッションで作られたが `listKnowledge` の呼び出し元がゼロで、KNOWLEDGE.mdの投資理論がAIの判断に1文字も届いていなかった（原則2「最小の縦切り」違反の状態）。加えて2026-07-31の学習cron初稼働で生成された教訓が短期テクニカル一辺倒に偏った件（前エントリ参照）の構造的原因でもある — 原則を知らないAIは目先の成功パターンに引きずられるしかない
- 決定: `askClaude` に「kindクォータ＋ペルソナ親和＋銘柄関連＋useCountローテ」で選んだ最大6件・合計1000字の知識ブロックを注入し、AIが返した参照IDを注入集合で検証してから `recordKnowledgeUsage` で加算する。注入位置は【過去の経験・学習】の直後・【判断基準】の直前とし、「サンプル数の少ない直近教訓と原則が矛盾する場合は原則を優先せよ」の一文を添える（7/31の短期偏りへの構造的な効き所）。選抜は純関数 `lib/knowledge/select.ts` に隔離（I/O禁止・`lib/report/profile.ts` と同じパターン）。ロード失敗・空・2秒デッドライン超過はブロックごと省略する fail-open。`DECISION_MAX_TOKENS` と既存プロンプトブロックの文言・順序・`buildCriteriaBlock` は不変。学習側（`generateFullLearning`）への注入は次スライス
- 理由: (1) 知識注入は判断の補助であり、これを理由に売買ループを止めるのは原則11(学習ループ)/12(リアルタイム主)に反するため fail-closed を却下。ただし2026-07-30の「無音のハング→504」の再発を防ぐため必ず warn を1行出す。(2) `updatedAt`/`createdAt` を選抜基準に使わないのは、`sync-knowledge.ts` が全行を同一 `nowISO` で刻むため順序が実質ランダムで不安定になるから。(3) 帰属は「提示」(`AISession.knowledgeShown`)と「引用」(`AIDecision.knowledgeRefs`)を分離し `useCount` は引用のみ加算する — 提示を使用と偽らない（原則9）。(4) `useCount` 昇順をタイブレークに入れたのは、同じ6件ばかり使われて他の知識が死蔵されるのを防ぐため
- 副産物のバグ修正: `sync-knowledge.ts` が再実行のたび `useCount:0`/`lastUsedAt:null`/`createdAt:now` で上書きしており、KNOWLEDGE.md を更新して再同期するたび帰属統計が消えていた。既存行を読んで引き継ぐよう修正。あわせてサイト制作向けの知識（売買判断の原則ではないもの）に `meta` タグを付与し判断プロンプトから除外（行は削除しない — レポート側では今後使えるため）
- リスク: (1)hot pathへのI/O追加が「無音の504」を再来させる→`listKnowledge`/`recordKnowledgeUsage` 双方を2秒デッドラインで包み fail-open＋1行warn。ただし `Promise.race` は真のキャンセルではなく元のPromiseは走り続ける（既知の限界）。(2)相反する教義（ソロスの再帰性 vs バフェットの長期保有）とサイト制作系知識の混入で判断が希釈→`meta`除外・他投資家タグ最大1件・6件上限で緩和。ただし**このスライスが保証できるのは「注入された・引用された」までで、判断品質が実際に改善したかは実運用ログ待ち**（成果を先取りしない）。(3)AIが存在しないIDを返す/体裁で全件列挙→注入集合での検証フィルタ＋コード側でも `.slice(0, 2)`（プロンプト指示だけに委ねない）
- reviewer指摘の対応: 当初 `charLenForCount` は summary を180字にスライスして1000字判定していたが、実際にプロンプトへ出す `formatKnowledgeBlock` は元の長さのまま出力するため、180字超の summary が混じると**注入ブロックが自分で決めた1000字上限を静かに超過する**会計とレンダリングの二重定義になっていた。現状の実害はゼロ（唯一の書き込み経路 `sync-knowledge.ts` の `SUMMARY_MAX=180` が入口で保証）だが、これは `select.ts` 自身の防御ではなく外部モジュールの規律への依存であり、将来 `ka_` 接頭辞の自動蓄積経路が増えた時点で顕在化する。`charLenForCount` を実長（`title.length + summary.length`）で数えるよう単純化し `SUMMARY_CAP_FOR_COUNT` 定数を削除して、契約が `select.ts` 内で自己完結するようにした。`formatKnowledgeBlock` 側で切る案は、要約を途中で切ると意味が壊れスモークの「summaryを途中で切らない」アサーションとも衝突するため却下
- 見送った reviewer suggestion（次スライス以降）: (a)「知識ベース未接続」の文言がマイグレーション未実行・2秒デッドライン超過による一時的fail-open・選抜0件を区別できない（誤診断の余地。文言を弱め恒久的な未接続の案内は別条件に限定する）。(b)`inferKind` が「セクター別ファンダの勘所」のような実務知識を抽象的なマクロテーマ物と同じ `market` 種別に入れるため、quota1枠を奪い合う優先順位の偏り。(c)`isEligible` の `scope==='session'` 除外は `listKnowledge({scope:'global'})` により現状デッドコード（呼び出し側のクエリが変わった場合の防御として意図的に残す・変更不要）
- 検証: `npx tsc --noEmit` 緑（診断ゼロ行・exit 0）。`scripts/check-knowledge-inject.ts`（新規・純関数のみ・Claude API非呼出）全PASS — 6件/1000字の二重上限、`meta`除外、他投資家タグ1件以下、決定性（同一入力で2回とも同じ並び）、`useCount`を上げた項目が次回落選、kind不足時に枠を捨てて埋める（架空アイテムでパディングしない）、文字数超過時は下位から落としsummaryを途中で切らない、`formatKnowledgeBlock([])`が空文字、`.T`銘柄で`japan`浮上、`filterKnowledgeRefs`が非配列/非文字列/null/空文字/重複/注入集合外を全除去、`scope='session'`除外。回帰13本全PASS（`check-analyze-s1/s3/s4/pro`・`check-report-r1/s2/profile`・`check-screen-cache/rank/refresh`・`check-lab-presets`・`check-rules`・`check-statements`）。**本番未検証** — Supabaseのマイグレーション0003実行と `npx tsx scripts/sync-knowledge.ts` による同期はどちらもオーナーの手作業で、済むまで本番は知識ブロックなしで現行どおり動作し `/ai-session` に「知識ベース未接続」と正直表示する（2026-07-30に `universe_fundamentals` 未作成で `/api/analyze/screen` が500になった件の再発を構造的に防いでいる）
- 影響ファイル: lib/knowledge/select.ts(新), lib/ai-trader/engine.ts, app/ai-session/client.tsx, scripts/sync-knowledge.ts, scripts/check-knowledge-inject.ts(新), DECISIONS.md

## 2026-08-06: /analyze を「結論→執行→詳細」の3階層に再編（S-A/S-B1/S-B2）
- 背景: /analyze は設定UIと結果表示が同一平面に積み上がり、初心者が「で、結局どうなの」に到達するまでのスクロールが長かった。オーナー方針の第一優先「初心者〜一般個人投資家向けの一流でパーソナライズされた分析」に対し、情報の優先順位が画面に表現されていなかった
- 決定: 画面を Tier1「結論」／Tier2「執行」／Tier3「詳細」の3階層に再編する。**S-A**: SiteNav を AI TRADER / 分析 / ポートフォリオ の3本に削減（原則12=リアルタイム前向き視点が主、に沿って AI TRADER を先頭に）。**S-B1**: 結果確定後に設定エリアを1行サマリー帯（新規 ConditionSummaryBar）へ自動圧縮。ProConditionPicker をテクニカル系（左）/ファンダ・決算系（右）の2カラム化。読者プロファイル4問をアコーディオン化（新規 ReaderProfilePanel）。モード切替・対象範囲切替は hidden（display:none）方式で入力 state を保持する（切替で入力を失わせない）。**S-B2**: Tier1 を新規 MetricStrip に統合（5指標グリッド＋ゲート内訳＋「この数字の意味」注記＝新規 InsightNote）。ヘッダと恒久免責を新規 AnalyzeBanner に横並び集約。モードタブ＋対象範囲を新規 ModeScopeBar に統合。Tier3 詳細群（実行条件/ゲート詳細・透明性カード・教訓使用状況・引用元）を新規 DetailsSection（デフォルト閉アコーディオン）へ
- 不変条件: API呼び出し・ゲート判定・バックテスト計算は一切変更していない＝表示レイヤのみの再編。過去スライスの要素（恒久免責の常時表示・S1読者プロファイル→generateへの受け渡し・S4透明性カード・教訓使用状況・引用元・S5aスクリーニング結果）はすべて維持。**AIレポート本文だけは DetailsSection で畳まない**（生成直後は常に展開表示）を恒久ルールとする
- 却下した案とトレードオフ: Tier3 をデフォルト展開のままにする案（情報量は保てるが「結論に最短で到達する」という目的を達成できない）／詳細を別ページに分離する案（実データの透明性が画面から切れ、原則9の「正直に見せる」に反する）。アコーディオンで畳むことによる「情報が隠れる」リスクは、Tier1 に結論と免責を必ず出すことで受容する
- レビュー指摘の反映（2026-08-11・reviewer→builder修正）: (1) 参加条件が0件でも緑の「参加条件 成立」バッジが出ていた問題を中立表示「参加条件なし」に修正 — `FundamentalGateResult.passed` はフィルタ0件なら true という仕様（lib/backtest/fundamental.ts）に依存して「評価していないものを成立と表示」しており、原則9（正直な表示）に抵触していた。(2) 対象範囲トグルの切替で条件入力がアンマウントされて消えていた問題を hidden 方式に統一して解消（S-B1 の「切替で入力を失わない」保証と矛盾していた）。(3) 初期資金に 0 を入れるとサマリー帯は $0・実際の計算は 100,000 で走る「表示と実行の不一致」を、実行に使われた値（bundle.request.initialCapital → previewRes の値 → 同一正規化を通した入力値の優先順）を表示する方式に修正。(4) アコーディオン/タブに `aria-expanded`/`aria-controls`/`type="button"`/`role`/`aria-selected` を付与。(5) プレビューがゲート不成立のときは設定エリアを畳まない（条件を直す導線の確保）
- 保留した論点: ナビから外れた既存ルート（/lab・/report・/simulate）は削除もリダイレクトもせず当面残す（直リンク・ブックマークからは到達可能）。/analyze への統合が安定した段階でリダイレクト化を再検討する
- `export const ANALYZE_MODE_TABS` / `ANALYZE_SCOPE_OPTIONS` は scripts/check-analyze-s1.ts のスモークが import する既存の依存であり、page ファイルからの named export だが意図的に維持する（S1以降ずっと本番ビルドを通っている）
- 未着手: Tier2（執行計画カード=S-C／将来シナリオ図=S-D）。page.tsx に placeholder コメントのみ
- 検証: MC が tsc＋回帰スモークを実行中（iCloud I/O 制約により builder 側では実行しない運用）。結果はこのエントリに追記予定 — 緑を確認するまで検証済みとはしない
- 影響ファイル: components/SiteNav.tsx, app/analyze/page.tsx, components/analyze/ProConditionPicker.tsx, components/analyze/ConditionSummaryBar.tsx(新), components/analyze/ReaderProfilePanel.tsx(新), components/analyze/AnalyzeBanner.tsx(新), components/analyze/ModeScopeBar.tsx(新), components/analyze/MetricStrip.tsx(新), components/analyze/InsightNote.tsx(新), components/analyze/DetailsSection.tsx(新), DECISIONS.md

## 2026-08-11: 進捗記録の自動化（Stop/SessionStart hook＋秘書部門の自動起動）
- 背景: オーナー指示「毎回の操作で秘書にどこまでいってるかを記録させて、次の作業をスムーズに始められるようにする。命令しなくても自動で」。従来は締めにMCが手動で secretary を呼ぶ運用で、実際 2026-08-03〜08-06 の作業は `PROGRESS.md` に記録されないまま中断し、再開時に未コミット2系統の棚卸しからやり直す羽目になっていた。Claude Codeの仕様上、イベント起点の自動実行は記憶やCLAUDE.mdの指示では発火せず **hook でしか実現できない**
- 決定: `.claude/settings.json`（新規）にhookを2本置く2段構え。**(1) Stop hook**（`asyncRewake: true`＝バックグラウンド実行で応答を待たせない）が毎ターン `.claude/hooks/session-stop.sh` を走らせ、`.claude/SESSION_STATE.md` に「ブランチ／HEAD／直近コミット5件／未コミット変更の全リスト／PROGRESS.mdが宣言した前回の次の一手」を機械的に上書きする（AIを呼ばないのでトークン消費ゼロ・待ち時間ほぼゼロ）。**(2) 日次の正式記録**は、`^## <今日の日付>` が `PROGRESS.md` に無く、かつ実作業があった場合のみ exit 2 で親セッションを起こし secretary の呼び出しを促す。**(3) SessionStart hook** が `SESSION_STATE.md` とPROGRESS.md最新エントリを `additionalContext` で注入し、再開時に状況を聞き直さなくてよくする。オーナーが選んだ案（毎ターン秘書を呼ぶ案・コミット時だけ記録する案は却下）
- 理由: (a)「毎ターン秘書(haiku)を呼ぶ」案は、毎回のトークン消費と数十秒の待ちに加え `PROGRESS.md` が1日数十エントリに膨張して日次ログとしての可読性を失うため却下。機械的事実（git状態）はAI不要で正確に取れるので、AIを使う所を「意味づけが要る日次1件」だけに絞った。(b)「実作業があったか」の判定は、セッション開始時に取った `git status --porcelain` ＋ `HEAD` の指紋（shasum）と現在値の比較。Edit/Write hookでの回数カウントではBash経由の変更を取りこぼすため指紋方式を選んだ。この方式はコミットしても（HEADが変わるので）検知できる。(c)促しの繰り返し防止は二重＝「今日の日付エントリが `PROGRESS.md` に入れば条件が自然に偽になる」＋「1セッション1回のsentinelファイル」。秘書の記録が何らかの理由で失敗しても毎ターン起こし続けることはない
- リスク: (1) iCloud上のリポジトリで毎ターンgitを叩くため index.lock 競合の恐れ→ 全git呼び出しを `--no-optional-locks` に統一（自動メモリ「iCloud×並行gitのindex破損」への対応）。(2) hookはClaude Codeの内部仕様（`asyncRewake`・`hookSpecificOutput.additionalContext`）に依存し、将来のバージョンで挙動が変わりうる→ 失敗しても壊れるのは記録だけで、プロダクトのコード・データには一切触れない設計にした。(3) `.claude/settings.json` はセッション開始時点で存在しなかったため、**このセッションではhookが読み込まれない可能性がある**（設定ウォッチャの制約）。オーナーが `/hooks` を一度開くか再起動すれば有効化される
- 検証: 4シナリオをstdinパイプで実行し全て期待どおり — [促す] 未記録の日＋作業ツリー変化ありで exit 2 ＋ secretary 呼び出し指示を出力、[黙る] 同一セッション2回目（sentinel）、[黙る] 変化なしのセッション、[黙る] 今日ぶんが記録済み（実作業あり）。`.claude/SESSION_STATE.md` の生成内容を目視確認。`jq -e` で settings.json のスキーマ検証も通過（exit 0）。プロダクトのコードには無変更
- レビュー指摘の反映（2026-08-14・reviewer→MC修正）: **critical 1件**: 促しメッセージを stdout に書いていた。Claude Codeが exit 2 でモデルへ渡すのは stderr であり、「セッションは起きるが理由が空＝secretary呼び出し指示が届かない」という**このスライスの主目的が沈黙失敗する**経路だった。8/11の検証（stdinパイプで4シナリオ）はシェル単体の検証に過ぎず、Claude Codeが実際にどちらのチャネルを読むかを確かめていなかったのが穴。実装差でどちらでも届くよう stderr と stdout の両方へ出力する形に修正。**warning 3件**: (1)`jq` 不在時に全セッションが `baseline-unknown`/`nudged-unknown` を共有し「1セッション1回」の促し制限が「7日に1回」へ無言縮退する→冒頭に `command -v jq` ガードを置き、フォールバックSIDを `unknown-$PPID` に。(2)timeout 20/30秒はiCloudのI/O実態に対し楽観的（**本セッション中に、tscと並行したgit呼び出しが実際に120秒で返らず指摘の正しさが実証された**）→ Stop 120秒・SessionStart 60秒へ引き上げ。(3)stdin由来の `session_id` を無害化せずファイルパスに使っており `/` や `..` を含む値で `.claude/.state/` の外へ書ける→ `${SID//[^a-zA-Z0-9_-]/_}` でサニタイズ（bash 3.2 で動作確認、`../../evil` → `______evil` となり `.state` 内に留まることと、`.claude/` 直下・リポジトリ直上に脱出しないことを確認）。**suggestion 3件**: SESSION_STATE.md を `.tmp`＋`mv` でアトミック書き込みに、最新エントリ抽出を区切り線前提から見出しの出現回数方式に、促し文面の「変更が発生」を「作業ツリーまたはHEADに変化を検知」へ（指紋変化には他ツール由来の変化も含まれるため・原則9）
- 実環境での発火確認（2026-08-14）: hook が実際に動いていることを確認した — SessionStart hook による `baseline-<実session_id>` の生成と、Stop hook による `SESSION_STATE.md` の毎ターン更新（更新時刻が実時刻に追随）。**ただし「exit 2 の促しが親セッションに実際に届くか」はこの時点で未確認**（baseline取得後に作業ツリーが変化していない間は仕様どおり黙るため、条件が揃っていなかった）。緑と断定せず、条件が揃った実セッションで届くことを確認するまでは未検証として扱う
- 影響ファイル: .claude/settings.json(新), .claude/hooks/session-stop.sh(新), .claude/hooks/session-start.sh(新), .gitignore, COMPANY.md, DECISIONS.md
