-- S5c-1: ユニバース・ファンダメンタルのキャッシュ土台。
-- US_UNIVERSE（約104銘柄）の現在値ファンダを事前計算してキャッシュする（本番60秒制約対策）。
-- 実行方法: Supabase Dashboard → SQL Editor でこのファイルの内容を実行する。
create table if not exists public.universe_fundamentals (
  symbol      text primary key,
  metrics     jsonb not null,
  source      text not null,
  fetched_at  timestamptz not null default now()
);
create index if not exists universe_fundamentals_fetched_at_idx
  on public.universe_fundamentals (fetched_at asc);
alter table public.universe_fundamentals enable row level security;
-- RLS有効・ポリシー無し = anonキーからは読み書き不可。
-- アクセスはserver-onlyのservice-roleクライアント（lib/supabase/admin.ts）経由のみ
-- （ai_sessionsと同じ方針）。
