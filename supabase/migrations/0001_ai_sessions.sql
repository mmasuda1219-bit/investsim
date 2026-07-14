-- AIセッション永続化テーブル（スライス1）。
-- 各AISessionをJSONB blobで保存（正規化しない・COMPANY.md原則8）。
-- 実行方法: Supabase Dashboard → SQL Editor でこのファイルの内容を実行する。
create table public.ai_sessions (
  id text primary key, data jsonb not null,
  started_at timestamptz not null, updated_at timestamptz not null default now()
);
create index ai_sessions_started_at_idx on public.ai_sessions (started_at desc);
alter table public.ai_sessions enable row level security;
-- RLS有効・ポリシー無し = anonキーからは読み書き不可。
-- アクセスはserver-onlyのservice-roleクライアント（lib/supabase/admin.ts）経由のみ。
