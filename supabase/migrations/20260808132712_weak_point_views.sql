-- security_invoker = true が必須: 付けないとビュー所有者(RLSをバイパスするmigration実行ロール)の
-- 権限で評価され、認証済みユーザーなら誰でも他人のuser_grammar_attempts/vocab_review_logsが
-- 見えてしまう。invoker=trueにすることで、基底テーブルのRLSが「クエリを発行した本人」の
-- auth.uid()で正しく評価されるようになる。
create view user_grammar_category_stats
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
  max(a.answered_at) as last_attempted_at
from user_grammar_attempts a
join grammar_questions q on q.id = a.question_id
join grammar_categories c on c.id = q.category_id
group by a.user_id, q.category_id, c.name_ja, c.parent_id;

create view user_vocab_tag_stats
with (security_invoker = true)
as
select
  l.user_id,
  t.id as tag_id,
  t.name as tag_name,
  count(*) as total_reviews,
  count(*) filter (where l.rating in ('good', 'easy')) as correct_reviews,
  round(
    count(*) filter (where l.rating in ('good', 'easy'))::numeric / count(*),
    3
  ) as accuracy_rate,
  max(l.reviewed_at) as last_reviewed_at
from vocab_review_logs l
join vocab_word_tags wt on wt.vocab_word_id = l.vocab_word_id
join vocab_tags t on t.id = wt.tag_id
group by l.user_id, t.id, t.name;
