-- S1: 知識ストアの土台。
-- 2経路（取引クローズ時の教訓／取引と無関係な市場調査・勉強）が同じ場所に書き込み、
-- 判断・レポートから「どの知識を使ったか」をIDで参照できるようにするためのテーブル。
--
-- なぜKNOWLEDGE.mdだけでは不可能か: Vercelの実行環境はファイルシステムが読み取り専用で、
-- 本番からKNOWLEDGE.mdへ書き込めない。KNOWLEDGE.mdは引き続きscoutが育てる「編集層」とし、
-- scripts/sync-knowledge.ts でこのテーブル（runtime層）へ取り込む。
--
-- 実行方法: Supabase Dashboard → SQL Editor でこのファイルの内容を実行する。
create table if not exists public.knowledge_items (
  -- KNOWLEDGE.md由来は 'km_'+タイトルhash（タイトルが変わらない限り安定）。
  -- 自動蓄積分は 'ka_'+ULID風の一意値。帰属表示(どの知識を使ったか)の参照キーになるため、
  -- 位置ではなくIDで同一性を持たせることがこのテーブルの存在理由。
  id            text primary key,
  -- 'global' = サイト全体で共有（投資理論・指数理論・セクター勘所・市場調査）
  -- 'session' = そのセッション（投資家ペルソナ）が取引から得た教訓
  scope         text not null default 'global',
  session_id    text,
  -- theory|market|lesson|bias|strategy|causal|news_pattern
  kind          text not null,
  title         text not null,
  -- 1〜2文。プロンプト注入用。全文を入れると判断プロンプトが破裂するため必ず短く保つ。
  summary       text not null,
  -- 全文・参照用。UIの「詳細」やレポートの裏付けに使う。
  detail        text,
  -- URL / 'KNOWLEDGE.md' / 'trade:<id>' など、その知識の出所。
  source        text,
  tags          text[] not null default '{}',
  -- 帰属記録の集計。使われた知識ほど残す（S5の圧縮で退避判断に使う）。
  use_count     integer not null default 0,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists knowledge_items_scope_kind_idx
  on public.knowledge_items (scope, kind);
create index if not exists knowledge_items_session_idx
  on public.knowledge_items (session_id);
-- 圧縮・選抜で「よく使われる順／使われていない順」を引くため。
create index if not exists knowledge_items_use_count_idx
  on public.knowledge_items (use_count desc);

alter table public.knowledge_items enable row level security;
-- RLS有効・ポリシー無し = anonキーからは読み書き不可。
-- アクセスはserver-onlyのservice-roleクライアント（lib/supabase/admin.ts）経由のみ
-- （ai_sessions・universe_fundamentalsと同じ方針）。
