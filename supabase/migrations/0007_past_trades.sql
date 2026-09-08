-- 過去の取引を «あとから» 記録できるようにする（JOURNEY.md 断絶3への対応・案C）。
--
-- 背景: 「振り返る」の突き合わせは «買い→売りの往復» が閉じてはじめて材料になる
--   （lib/review/judgement.ts）。ところが初日の利用者ができるのは「買う」だけなので、
--   往復が閉じるまで画面に見せるものがほぼ無く、統計語に至るには往復3件＝数週間〜数ヶ月。
--   一方で主ペルソナ P1（PERSONA.md）は «すでに実口座で売買していて含み損を抱えた人» で、
--   来た時点で振り返る材料（過去の取引）を本人が持っている。それを登録できるようにすれば
--   初日から往復が揃う。＝ time-to-value の直接の解。
--
-- 設計上いちばん大事な点: **過去の取引は練習場の売買ではない。**
--   練習場の売買（execute_trade）は仮想の現金 $100,000 を増減させる。
--   過去の取引は «実際に本人がやったことの記録» なので、現金・持ち株を動かしてはいけない。
--   動かすと、
--     (a) 仮想残高が実在しない取引で減り、練習場の収支が意味を失う
--     (b) 過去の日付なのに «今の残高» で足りるかを判定することになり筋が通らない
--     (c) 大きな過去取引が insufficient_cash で弾かれる
--   ので、現金・持ち株には触れずに trades へ1行だけ足す専用の関数を用意する。
--
-- そのため2種類を «見分けられる» 必要がある。見分けが付かないと、
--   「儲けた額」の集計に実取引が混ざり、どれが練習でどれが実際の記録か本人にも分からない。
--   ＝ 原則9（実データとそうでないものを混ぜない）と同じ精神。
--   既存行はすべて練習場の売買なので default 'practice' で辻褄が合う。
--
-- 実行方法: Supabase Dashboard → SQL Editor でこのファイルの内容を実行する。
--   ※ 0004_ai_usage_counters.sql が未実行なら、そちらも合わせて実行すること。

-- ── 練習場の売買か、過去の記録か ──────────────────────────────
alter table public.trades
  add column if not exists source text not null default 'practice';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'trades_source_check'
  ) then
    alter table public.trades
      add constraint trades_source_check check (source in ('practice', 'past'));
  end if;
end $$;

-- 「振り返る」で練習分だけ・記録分だけを引くことがあるので、並びに source を足す。
create index if not exists trades_user_source_executed_idx
  on public.trades (user_id, source, executed_at desc);

/**
 * 過去にやった取引を1件記録する。**現金・持ち株には一切触れない。**
 *
 * p_executed_at は本人が入力した過去の日時。未来は受け付けない
 * （「過去の取引の記録」という前提が崩れ、練習場の売買と区別が付かなくなるため）。
 *
 * 戻り値: ok / error_code / trade_id
 *   error_code … 'bad_input' | 'future_date'（ok時はnull）
 */
create or replace function public.record_past_trade(
  p_user_id     uuid,
  p_symbol      text,
  p_name        text,
  p_action      text,
  p_shares      numeric,
  p_price       numeric,
  p_reason      text,
  p_executed_at timestamptz
)
returns table (ok boolean, error_code text, trade_id uuid)
language plpgsql
as $$
declare
  v_trade_id uuid;
begin
  if p_action not in ('buy', 'sell')
     or p_shares is null or p_shares <= 0
     or p_price  is null or p_price  <= 0
     or p_symbol is null or p_symbol = ''
     or p_executed_at is null then
    return query select false, 'bad_input'::text, null::uuid;
    return;
  end if;

  -- 端末の時計ずれを吸収するため少しだけ猶予を持たせる。
  if p_executed_at > now() + interval '1 day' then
    return query select false, 'future_date'::text, null::uuid;
    return;
  end if;

  insert into public.trades (user_id, executed_at, symbol, name, action, shares, price, reason, source)
  values (p_user_id, p_executed_at, p_symbol, p_name, p_action, p_shares, p_price,
          nullif(btrim(coalesce(p_reason, '')), ''), 'past')
  returning id into v_trade_id;

  return query select true, null::text, v_trade_id;
end;
$$;

/**
 * 記録した過去の取引を1件消す。**練習場の売買は消せない**（source='past' のみ対象）。
 * 入力し間違いを直せるようにするための口。練習場の履歴は「振り返る」の材料なので
 * 1件ずつ消せるようにはしない（消すならリセット）。
 */
create or replace function public.delete_past_trade(p_user_id uuid, p_trade_id uuid)
returns boolean
language plpgsql
as $$
declare
  v_deleted integer;
begin
  delete from public.trades
   where id = p_trade_id and user_id = p_user_id and source = 'past';
  get diagnostics v_deleted = row_count;
  return v_deleted > 0;
end;
$$;

/**
 * ポートフォリオを初期状態に戻す。
 *
 * 変更点(0007): **過去の取引の記録は消さない。** リセットは «練習場をやり直す» 操作であって、
 * 本人が入力した実際の取引の記録まで消してしまうと、取り返しがつかないうえに
 * 「振り返る」の材料そのものを失う。消えるのは練習場の売買だけ。
 */
create or replace function public.reset_portfolio(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.trades where user_id = p_user_id and source = 'practice';
  insert into public.portfolios (user_id, cash, positions)
  values (p_user_id, 100000, '[]'::jsonb)
  on conflict (user_id) do update
    set cash = 100000, positions = '[]'::jsonb, updated_at = now();
end;
$$;
