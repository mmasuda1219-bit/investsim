-- AI呼び出しの日次上限カウンタ。
--
-- 背景: /api/report/generate（Opus 4.8）と /api/ai-session/[id]/tick（手動tick）は
-- 認証も回数制限もカウンタも無く、誰でも何回でもAIを回せる状態だった。AI費用は
-- オーナーの自己負担で、過去に本番の残高切れでAIが実停止した実績がある。
--
-- 設計の要点は2段構え:
--   1. 全体上限 … サイト全体で1日N回まで。これが「お金の上限」そのもの（絶対の保証）
--   2. 個別上限 … IP（レポート）/ セッション（tick）ごと。1人が全体枠を食い潰さないため
-- IPヘッダは偽装されうるので、本当の防波堤は全体上限のほう。
--
-- なぜRPC（関数）が要るか: 「読んで→判定して→書く」を分けると、同時アクセス時に
-- 両方が上限直前の値を読んで両方通る（TOCTOU）。関数内は単一トランザクションなので、
-- 増分と判定を不可分にできる。lib/ai-trader/auto.ts の日次上限と同じ思想を、
-- セッション単位ではなくサイト全体に広げたもの。
--
-- 実行方法: Supabase Dashboard → SQL Editor でこのファイルの内容を実行する。
-- ⚠ 実行するまで本番の /api/report/generate と手動tick は503で止まる（fail-closed）。
--    お金のガードなので、壊れたら通すのではなく止める側に倒している。

create table if not exists public.ai_usage_counters (
  -- 'report:global' / 'report:ip:<ip>' / 'tick:global' / 'tick:session:<id>' など。
  -- 用途:スコープ の形で、1テーブルに全種類の枠を同居させる。
  bucket     text        not null,
  -- NY市場日付（YYYY-MM-DD）。取引日の境界でリセットする。lib/ai-trader/auto.ts の
  -- nyDate() と同じ基準にして、自動tickの日次上限と «同じ1日» を指すようにする。
  day        date        not null,
  count      integer     not null default 0,
  updated_at timestamptz not null default now(),
  primary key (bucket, day)
);

-- 古い行の掃除用（運用で不要になったら消す）。読み取りは常に (bucket, day) の主キー経由。
create index if not exists ai_usage_counters_day_idx on public.ai_usage_counters (day);

/**
 * 全体枠と個別枠を «同時に» 1つずつ消費する。どちらか一方でも上限なら、何も消費せずに拒否する。
 *
 * 戻り値:
 *   allowed      … 実行してよいか
 *   denied_by    … 'global' | 'scoped' | 'config'（拒否理由。allowed時はnull）
 *   global_count … 消費後の全体カウント（拒否時は現在値）
 *   scoped_count … 消費後の個別カウント（拒否時は現在値）
 *
 * 整合性の要点:
 *   - ON CONFLICT ... DO UPDATE ... WHERE count < 上限 とすることで、上限に達している行は
 *     «更新されない»。更新されなければRETURNINGが何も返さず、変数はnullになる。これで
 *     「増やしてから戻す」ではなく「上限なら最初から増えない」を1文で実現している。
 *   - 触る順序を必ず global → scoped に固定してデッドロックを避ける。
 *   - scoped側が上限だったときは、同一トランザクション内でglobal側の+1を巻き戻す。
 *     拒否したのに全体枠だけ減る、という取りこぼしを防ぐため。
 */
create or replace function public.bump_ai_usage(
  p_day           date,
  p_global_bucket text,
  p_global_limit  integer,
  p_scoped_bucket text,
  p_scoped_limit  integer
)
returns table (allowed boolean, denied_by text, global_count integer, scoped_count integer)
language plpgsql
as $$
declare
  g integer;
  s integer;
begin
  -- 上限0以下は「設定ミスで全開放」を避けるため、通さずに止める（fail-closed）。
  if p_global_limit is null or p_scoped_limit is null
     or p_global_limit <= 0 or p_scoped_limit <= 0 then
    return query select false, 'config'::text, 0, 0;
    return;
  end if;

  insert into public.ai_usage_counters as c (bucket, day, count)
  values (p_global_bucket, p_day, 1)
  on conflict (bucket, day) do update
    set count = c.count + 1, updated_at = now()
    where c.count < p_global_limit
  returning c.count into g;

  if g is null then
    return query
      select false, 'global'::text,
             coalesce((select count from public.ai_usage_counters
                        where bucket = p_global_bucket and day = p_day), 0),
             coalesce((select count from public.ai_usage_counters
                        where bucket = p_scoped_bucket and day = p_day), 0);
    return;
  end if;

  insert into public.ai_usage_counters as c (bucket, day, count)
  values (p_scoped_bucket, p_day, 1)
  on conflict (bucket, day) do update
    set count = c.count + 1, updated_at = now()
    where c.count < p_scoped_limit
  returning c.count into s;

  if s is null then
    -- 個別枠が上限。global側の+1を巻き戻してから拒否する。
    update public.ai_usage_counters
       set count = count - 1, updated_at = now()
     where bucket = p_global_bucket and day = p_day;
    return query
      select false, 'scoped'::text, g - 1,
             coalesce((select count from public.ai_usage_counters
                        where bucket = p_scoped_bucket and day = p_day), 0);
    return;
  end if;

  return query select true, null::text, g, s;
end;
$$;

-- service-roleキーからのみ触る（RLSはservice-roleをバイパスする）。
-- anonキーで直接カウンタを触られると上限が意味を失うため、RLSは有効のままにし、
-- ポリシーは一切作らない＝anon/authenticatedからは読み書きできない。
alter table public.ai_usage_counters enable row level security;
