-- 弱点分析ダッシュボードから該当カテゴリのドリル(/grammar/:categoryCode)へ直接遷移できるよう、
-- category_code をビューに追加する。CREATE OR REPLACE VIEWは既存列の位置・名前を変更できないため、
-- 新しい列は末尾に追加する。security_invoker=true は再指定が必須（付けないと所有者権限で評価され
-- RLSがバイパスされてしまう。11.1/11.4参照）。
create or replace view user_grammar_category_stats
with (security_invoker = true)
as
select
  a.user_id,
  q.category_id,
  c.name_ja as category_name,
  c.parent_id,
  count(*) as total_attempts,
  count(*) filter (where a.is_correct) as correct_attempts,
  round(count(*) filter (where a.is_correct)::numeric / count(*), 3) as accuracy_rate,
  max(a.answered_at) as last_attempted_at,
  c.code as category_code
from user_grammar_attempts a
join grammar_questions q on q.id = a.question_id
join grammar_categories c on c.id = q.category_id
group by a.user_id, q.category_id, c.name_ja, c.parent_id, c.code;
