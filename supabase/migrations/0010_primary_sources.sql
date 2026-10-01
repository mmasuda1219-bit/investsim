-- 「あなたが書いていないことの、出どころ」（/review/[recordId]・S3c・2026-10-01・DECISIONS 2026-09-30 3本目の追記）。
--
-- ※ このファイルは 0008（ai_decisions）・0009（review_insights・S3b・未作成）と **独立** している。
--    0009 を実行していなくても、このファイル単独で実行できる。順番の依存は無い。
--
-- 2つの表:
--   1. review_primary_sources … 1件の記録（買いの Trade.id）につき、発行会社の一次情報の一覧を **開いた最初の1回だけ解決して凍結** する。
--      status: ok（1件以上）／empty（該当なし・取得はできた）／failed（取得できなかった。鍵が無い・表が無いときは保存しない＝
--      次に開いたときに再試行できる。失敗を empty に化けさせない）。items は PrimarySourceItem[] の JSON（見出し・日付・URL だけ。要約の欄は無い）。
--   2. primary_source_cache … 取得元の生データの控え。SEC の submissions は CIK ごと（key = CIK 10桁）、SEC の ticker→CIK 表は
--      key = 'company_tickers'、EDINET の日次一覧は日付ごと（key = YYYY-MM-DD）。同じものを何度も取りに行かない。
--      失敗も payload に { failed: true } で残すが、読む側（lib/review/primary-sources/store.ts）が 24 時間で捨てて再試行する。
--
-- RLS 有効・ポリシー無し = anon キーからは読み書き不可（0001〜0008 と同じ方針）。
-- アクセスは server-only の service-role クライアント（lib/supabase/admin.ts）経由のみ。本人確認は API ルート側が行う。
--
-- 実行方法: Supabase Dashboard → SQL Editor でこのファイルの内容を実行する。
--   ※ 未実行でも画面は壊れない（表が無いと API は status 'failed' を返し、画面は節ごと出さない）。

create table if not exists public.review_primary_sources (
  user_id        uuid        not null,
  record_id      uuid        not null,                 -- 買いの Trade.id（trades.id）
  status         text        not null check (status in ('ok', 'empty', 'failed')),
  items          jsonb       not null default '[]'::jsonb,  -- PrimarySourceItem[]（lib/review/primary-sources/types.ts）
  truncated      int         not null default 0,      -- 上限 20 件で切った件数
  fetched_at     timestamptz not null,
  window_from    date        not null,                -- 買った日の 30 暦日前
  window_to      date        not null,                -- 買った日の 30 暦日後（未来側は解決した日で打ち切り）
  browse_all_url text,                                -- 全件ページ（表示用ホストのみ）。無ければ null
  primary key (user_id, record_id)
);

alter table public.review_primary_sources enable row level security;

create table if not exists public.primary_source_cache (
  source     text        not null,                    -- 'sec' | 'edinet'
  key        text        not null,                    -- sec: 'company_tickers' | CIK 10桁 | submissions の分割ファイル名 ／ edinet: YYYY-MM-DD
  payload    jsonb       not null,
  fetched_at timestamptz not null,
  primary key (source, key)
);

alter table public.primary_source_cache enable row level security;
-- RLS有効・ポリシー無し = anonキーからは読み書き不可。
-- アクセスはserver-onlyのservice-roleクライアント（lib/supabase/admin.ts）経由のみ。
