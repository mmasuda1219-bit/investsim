-- 利用者ごとのデータ（持ち主つき）。アカウント化の第1段。
--
-- 背景: これまで «利用者のデータ» はどこにも持ち主が無かった。
--   - 売買記録・持ち株・現金 … ブラウザの localStorage（lib/portfolio.ts）。
--     別のPCで開くと空、履歴を消すと全消え、アカウントとは無関係。
--   - AIセッション … public.ai_sessions は (id, data) だけで持ち主の欄が無い。
--     GET /api/ai-session が全員分を返し、新規訪問者は一覧の先頭（＝他人のセッション）を
--     自分のものとして割り当てられていた。
--   ログイン機能（Google OAuth）は既にあるが、ログインしても何も紐づかない状態だった。
--
-- 決定（オーナー確認済み・2026-09-03）: 「見るのは自由・保存はログイン」。
--   「見る」「まねる」は未ログインでも使える。「やる」「振り返る」＝記録が残る操作は
--   ログインを要求し、データは必ず auth.users の誰かに属する。
--
-- 形の決定:
--   - trades は «1行1取引» の表にする。売買記録は増え続けるので、1つのJSONに全部入れると
--     1回の売買のたびに過去全件を書き直すことになり、同時操作で片方が消える（lost update）。
--     追記だけで済む行のほうが、単純でもある（原則8「早すぎる抽象化は禁止」に反しない）。
--   - 現金と持ち株は portfolios の «1行» にまとめる。この2つは1回の売買で必ず一緒に変わるので、
--     1行のUPDATEで不可分に更新できる形が正しい。持ち株は件数が小さく常に全体を読むためjsonb。
--
-- アクセス制御は 0001_ai_sessions.sql と同じ方針:
--   RLS有効・ポリシー無し ＝ anonキーからは読み書き不可。
--   サーバー側の service-role クライアント（lib/supabase/admin.ts）経由でのみ触る。
--   「自分のデータだけ見える」の判定はAPIルート側で行う（クライアントに直接DBを触らせない。
--   触らせると、残高やポジションを利用者が自由に書き換えられてしまう）。
--
-- 実行方法: Supabase Dashboard → SQL Editor でこのファイルの内容を実行する。

-- ── 現金と持ち株（利用者ごとに1行）────────────────────────────
create table if not exists public.portfolios (
  -- auth.users を正とする。アカウントが消えたらデータも消える（プライバシー）。
  user_id    uuid        primary key references auth.users(id) on delete cascade,
  -- 金額は numeric。浮動小数だと積み重ねで誤差が出る（原則10: 通貨は実単位）。
  cash       numeric     not null default 100000,
  -- lib/portfolio.ts の Position[] をそのまま保持: [{symbol, name, shares, avgCost}]
  -- 1回の売買で cash と必ず一緒に変わるため、同じ行に置いて不可分に更新する。
  positions  jsonb       not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ── 売買記録（1行1取引・追記のみ）──────────────────────────────
create table if not exists public.trades (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users(id) on delete cascade,
  executed_at timestamptz not null default now(),
  symbol      text        not null,
  name        text        not null,
  action      text        not null check (action in ('buy', 'sell')),
  -- 株数は小数を許す（85.40株のような按分保有が実在する）。
  shares      numeric     not null check (shares > 0),
  price       numeric     not null check (price > 0),
  -- なぜそう判断したか。「やる」では必須にしているが、DBでは not null にしない
  -- （将来ここを通さない入口＝配当再投資などが増えたときに形式が壊れるため。
  --   «理由を必ず書かせる» のはUIとAPIの責務で、既にそちらで担保している）。
  reason      text
);

-- 「振り返る」は自分の取引を新しい順に読む。その並びをそのままインデックスにする。
create index if not exists trades_user_executed_idx
  on public.trades (user_id, executed_at desc);

-- ── AIセッションに持ち主を足す ────────────────────────────────
-- 既存行には持ち主がいないので nullable。null = 「誰のものでもない旧データ」。
-- 一覧を持ち主で絞る変更は次の段（アプリ側）で行う。ここでは欄を足すだけ。
alter table public.ai_sessions
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists ai_sessions_user_idx on public.ai_sessions (user_id);

-- ── アクセス制御（0001と同じ: RLS有効・ポリシー無し）──────────
alter table public.portfolios enable row level security;
alter table public.trades     enable row level security;
