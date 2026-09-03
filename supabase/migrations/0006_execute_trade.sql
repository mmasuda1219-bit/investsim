-- 売買の実行を «サーバー側の1手» にする。アカウント化の第2段。
--
-- 背景: 売買のルール判定（残高が足りるか・持ち株が足りるか・平均取得単価の再計算）は
--   これまで lib/portfolio.ts のブラウザ内で行われていた。DBに移すにあたり判定も
--   サーバーへ移す（オーナー決定・2026-09-03）。ブラウザ側で計算した«結果»を受け取る
--   作りにすると、送信内容を書き換えるだけで残高を好きな数字にできてしまい、
--   「自分の判断の質を振り返る」という製品の芯（原則11）が意味を失うため。
--
-- なぜAPIルートのTypeScriptではなくSQL関数か: 1回の売買は
--   「現金を減らす」「持ち株を更新する」「取引を1行記録する」の3つが «全部成立するか
--   全部起きないか» でなければならない。アプリ側で3手に分けると、
--   (a) 途中で失敗すると現金だけ減って記録が残らない、
--   (b) 二重クリックで残高チェックを2回とも通過して残高がマイナスになる（TOCTOU）。
--   関数内は単一トランザクションなので、行ロック（for update）と合わせて両方を防げる。
--   AI日次上限の bump_ai_usage と同じ考え方。
--
-- 実行方法: Supabase Dashboard → SQL Editor でこのファイルの内容を実行する。

/**
 * 1回の売買を実行する。成立すれば現金・持ち株・取引記録を不可分に更新する。
 *
 * 戻り値:
 *   ok         … 成立したか
 *   error_code … 'insufficient_cash' | 'insufficient_shares' | 'bad_input'（ok時はnull）
 *   cash       … 実行後の現金（失敗時は現在値）
 *   positions  … 実行後の持ち株（失敗時は現在値）
 *   trade_id   … 記録した取引のid（失敗時はnull）
 *
 * 持ち株の形は lib/portfolio.ts の Position[] のまま:
 *   [{"symbol":"AAPL","name":"Apple Inc.","shares":10,"avgCost":100}]
 */
create or replace function public.execute_trade(
  p_user_id uuid,
  p_symbol  text,
  p_name    text,
  p_action  text,
  p_shares  numeric,
  p_price   numeric,
  p_reason  text
)
returns table (ok boolean, error_code text, cash numeric, positions jsonb, trade_id uuid)
language plpgsql
as $$
declare
  v_cash      numeric;
  v_positions jsonb;
  v_total     numeric;
  v_idx       integer;
  v_elem      jsonb;
  v_shares    numeric;
  v_avg       numeric;
  v_trade_id  uuid;
begin
  if p_action not in ('buy', 'sell')
     or p_shares is null or p_shares <= 0
     or p_price  is null or p_price  <= 0
     or p_symbol is null or p_symbol = '' then
    return query select false, 'bad_input'::text, 0::numeric, '[]'::jsonb, null::uuid;
    return;
  end if;

  -- 初回はここで作る。作成と取得を分けると、同時実行で二重作成になる。
  insert into public.portfolios (user_id) values (p_user_id)
  on conflict (user_id) do nothing;

  -- 行ロック。これ以降この利用者の売買は直列化され、残高チェックと更新の間に
  -- 別の売買が割り込めなくなる（二重クリック対策）。
  select p.cash, p.positions into v_cash, v_positions
    from public.portfolios p
   where p.user_id = p_user_id
     for update;

  v_total := p_shares * p_price;

  -- 対象銘柄の現在の持ち株を探す（jsonb配列の何番目か）。
  select (t.idx - 1), t.elem into v_idx, v_elem
    from jsonb_array_elements(v_positions) with ordinality as t(elem, idx)
   where t.elem->>'symbol' = p_symbol
   limit 1;

  if p_action = 'buy' then
    if v_cash < v_total then
      return query select false, 'insufficient_cash'::text, v_cash, v_positions, null::uuid;
      return;
    end if;
    v_cash := v_cash - v_total;

    if v_elem is null then
      v_positions := v_positions || jsonb_build_array(jsonb_build_object(
        'symbol', p_symbol, 'name', p_name, 'shares', p_shares, 'avgCost', p_price));
    else
      -- 加重平均で取得単価を引き直す（lib/portfolio.ts の既存計算と同じ）。
      v_shares := (v_elem->>'shares')::numeric + p_shares;
      v_avg    := ((v_elem->>'avgCost')::numeric * (v_elem->>'shares')::numeric
                   + p_price * p_shares) / v_shares;
      v_positions := jsonb_set(v_positions, array[v_idx::text],
        jsonb_build_object('symbol', p_symbol, 'name', v_elem->>'name',
                           'shares', v_shares, 'avgCost', v_avg));
    end if;

  else -- sell
    if v_elem is null or (v_elem->>'shares')::numeric < p_shares then
      return query select false, 'insufficient_shares'::text, v_cash, v_positions, null::uuid;
      return;
    end if;
    v_cash   := v_cash + v_total;
    v_shares := (v_elem->>'shares')::numeric - p_shares;

    if v_shares = 0 then
      -- 全部売ったら持ち株から取り除く（jsonb - integer は配列のn番目を削除）。
      v_positions := v_positions - v_idx;
    else
      -- 売っても平均取得単価は変えない（実現損益は取引記録から計算する）。
      v_positions := jsonb_set(v_positions, array[v_idx::text],
        jsonb_build_object('symbol', p_symbol, 'name', v_elem->>'name',
                           'shares', v_shares, 'avgCost', (v_elem->>'avgCost')::numeric));
    end if;
  end if;

  update public.portfolios
     set cash = v_cash, positions = v_positions, updated_at = now()
   where user_id = p_user_id;

  insert into public.trades (user_id, symbol, name, action, shares, price, reason)
  values (p_user_id, p_symbol, p_name, p_action, p_shares, p_price,
          nullif(btrim(coalesce(p_reason, '')), ''))
  returning id into v_trade_id;

  return query select true, null::text, v_cash, v_positions, v_trade_id;
end;
$$;

/**
 * ポートフォリオを初期状態に戻す。取引記録も消す。
 * 「振り返る」のリセットボタンから呼ぶ。現金・持ち株・記録を不可分に戻す。
 */
create or replace function public.reset_portfolio(p_user_id uuid)
returns void
language plpgsql
as $$
begin
  delete from public.trades where user_id = p_user_id;
  insert into public.portfolios (user_id, cash, positions)
  values (p_user_id, 100000, '[]'::jsonb)
  on conflict (user_id) do update
    set cash = 100000, positions = '[]'::jsonb, updated_at = now();
end;
$$;
