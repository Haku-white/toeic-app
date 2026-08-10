-- 6.5改訂: hardは「思い出せたが確信度が低い」という評価であり誤りではないため、正答扱いに含める
-- （againのみ不正解、easy/goodは従来どおり正答）。総合問題(14.4)の4択正解がhardとして記録される
-- ため、この変更をしないと総合問題での正解が弱点分析ダッシュボードの語彙タグ正答率に反映されなかった。
-- 併せてtag_code列を追加する（16.2）。CREATE OR REPLACE VIEWは既存列の位置・名前を変更できないため
-- 新列は末尾に追加している。
create or replace view user_vocab_tag_stats
with (security_invoker = true)
as
select
  l.user_id,
  t.id as tag_id,
  t.name as tag_name,
  count(*) as total_reviews,
  count(*) filter (where l.rating in ('good', 'hard', 'easy')) as correct_reviews,
  round(
    count(*) filter (where l.rating in ('good', 'hard', 'easy'))::numeric / count(*),
    3
  ) as accuracy_rate,
  max(l.reviewed_at) as last_reviewed_at,
  t.code as tag_code
from vocab_review_logs l
join vocab_word_tags wt on wt.vocab_word_id = l.vocab_word_id
join vocab_tags t on t.id = wt.tag_id
group by l.user_id, t.id, t.name, t.code;
