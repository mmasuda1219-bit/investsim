-- AIの判断を「1件1行・追記だけ」で保管する表（S0・2026-09-25）。
--
-- 背景: AIセッション（ai_sessions）は AISession を JSONB blob 丸ごと上書き保存する
--   （lib/ai-trader/store.ts の upsertSession）。判断は session.decisions（上限200・engine.ts）と
--   learning.allDecisions（上限1500・memory.ts）にしか無く、上限から溢れた判断は履歴にも残らず消えていた。
--   「まねる」のお手本を自サイトのAI判断から作る決定（DECISIONS.md 2026-09-24「サイトの目的を…」）の
--   材料そのものなので、二度と消えない置き場をここに作る。
--
-- 設計:
--   * 追記だけ。更新・削除の経路は作らない（lib/ai-trader/decision-store.ts は重複無視の挿入のみ）。
--   * id は decisionIdFor(symbol, decidedAt)（lib/ai-trader/tick-record.ts）と同じ '<symbol>@<decidedAt ISO>'。
--     AISession.ticks[].decisionIds と同じ鍵なので、tick の記録から判断へ辿れる。
--     同じ id の再挿入は on conflict (id) do nothing（何度流しても増えない）。
--   * blob（ai_sessions）はそのまま。/watch と /api/ai-session は今までどおり blob を読む。この表は「消えない控え」。
--   * RLS 有効・ポリシー無し = anon キーからは読み書き不可（0001_ai_sessions.sql と同じ方針）。
--     アクセスは server-only の service-role クライアント（lib/supabase/admin.ts）経由のみ。
--
-- 実行方法: Supabase Dashboard → SQL Editor でこのファイルの内容を実行する。
--   ※ 0008 を実行するまで GET /api/ai-decisions は 503（保管庫が未設定）を返す。Supabase が「表が無い」に返すコードは
--      42P01（PostgreSQL の undefined_table）か PGRST205（PostgREST 12.2 以降・スキーマキャッシュに無い表）の2通りで、
--      どちらも 503 に分ける（lib/ai-trader/decision-store.ts の MISSING_TABLE_CODES）。tick は控えを取らずに進む（tick 自体は落ちない）。
--   ※ 実行後に scripts/backfill-ai-decisions.ts（既定 dry-run・--write で書く）で現存分を救出する。

create table if not exists public.ai_decisions (
  id             text        primary key,   -- '<symbol>@<decided_at ISO>'（decisionIdFor と同じ規則）
  session_id     text        not null,      -- ai_sessions.id
  symbol         text        not null,
  name           text,                      -- 銘柄名。学習メモリ（DecisionRecord）だけに残っていた判断は null
  action         text        not null check (action in ('buy', 'sell', 'hold', 'watch')),
  price          numeric,
  change         numeric,                   -- 前日比（%）。前日の終値が決められなかった判断は null（0 で埋めない・原則9）
  reasoning      text,
  confidence     text,                      -- 'high' | 'medium' | 'low'
  technicals     text,
  fundamentals   text,
  news           text,                      -- AIが読んだ見出し。1行1本（改行区切り）
  knowledge_refs jsonb,                     -- AIが依拠したと申告した知識 [{ id, title }]。無ければ null
  tick_id        text,                      -- AISession.ticks[].id（2026-09-11 の 4a より前の判断には無い）
  decided_at     timestamptz not null,      -- AI の返事を受け取った時刻（AIDecision.decidedAt）
  inserted_at    timestamptz not null default now()
);

create index if not exists ai_decisions_decided_at_idx        on public.ai_decisions (decided_at desc);
create index if not exists ai_decisions_symbol_decided_at_idx on public.ai_decisions (symbol, decided_at desc);
create index if not exists ai_decisions_session_id_idx        on public.ai_decisions (session_id);

alter table public.ai_decisions enable row level security;
-- RLS有効・ポリシー無し = anonキーからは読み書き不可。
-- アクセスはserver-onlyのservice-roleクライアント（lib/supabase/admin.ts）経由のみ。
