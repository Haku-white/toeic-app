-- 22章: AIチューター機能のレート制限用テーブル。
-- 会話履歴そのものは保存せず、ユーザー×日付ごとの質問回数だけを記録する。

create table tutor_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default (now() at time zone 'utc')::date,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);

alter table tutor_usage enable row level security;
-- ポリシーは意図的に作成しない: ask-tutor Edge Functionはservice_roleキーで
-- increment_tutor_usage() を呼び出すためRLSをバイパスする。authenticatedからの
-- 直接SELECT/INSERT/UPDATEは全て拒否される（22.4）。

-- チェックと加算を1ステートメントでアトミックに行う。ON CONFLICT ... WHERE句が
-- 偽（既に上限到達）の場合はUPDATEがスキップされRETURNINGが空になるため、
-- 同時リクエストが競合しても上限を超えて加算されない（22.3）。
--
-- security invoker: 呼び出し元(service_role)は元々RLSをバイパスする権限を持つため、
-- DEFINERで権限を昇格させる必要が無い（8.4②のfind_similar_*と同じ判断）。
create or replace function increment_tutor_usage(p_user_id uuid, p_max_daily integer)
returns table (allowed boolean, current_count integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into tutor_usage (user_id, usage_date, request_count)
  values (p_user_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, usage_date) do update
    set request_count = tutor_usage.request_count + 1,
        updated_at = now()
    where tutor_usage.request_count < p_max_daily
  returning request_count into v_count;

  if v_count is null then
    select request_count into v_count from tutor_usage
      where user_id = p_user_id and usage_date = (now() at time zone 'utc')::date;
    return query select false, v_count;
  else
    return query select true, v_count;
  end if;
end;
$$;

-- p_user_idを検証なしに受け取る関数のため、authenticated/anonに直接EXECUTEを許すと
-- 他人のuser_idを指定して1日30回の枠を勝手に消費させられてしまう（本人のトークン残数を
-- 奪う嫌がらせが可能になる）。20260808145101のALTER DEFAULT PRIVILEGESで新規関数にも
-- 自動的にEXECUTEが付与されるため、ここで明示的に剥奪しservice_role専用にする。
-- PUBLICからのREVOKEが必須: PostgreSQLは関数作成時にEXECUTEをPUBLIC（=全ロール共通の
-- 暗黙付与）にも自動的に与えるため、anon/authenticatedへの個別REVOKEだけでは
-- PUBLIC経由のEXECUTE権限が残ってしまう（実機psqlのinformation_schema.routine_privileges
-- で実際に確認して発覚）。
revoke execute on function increment_tutor_usage(uuid, integer) from public;
revoke execute on function increment_tutor_usage(uuid, integer) from anon, authenticated;
