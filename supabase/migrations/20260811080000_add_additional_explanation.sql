-- 11章: 間違いが多い問題への自動解説追加。既存のexplanation/etymology_noteは一切変更せず、
-- 補足の追加解説を保持する新規nullable列を追加する（etymology_note追加時と同じ方針）。
alter table grammar_questions
  add column additional_explanation text;

alter table vocab_words
  add column additional_explanation text;

-- 11.1/11.2: 「間違いが多い」判定用の集計ビュー。既存のuser_grammar_category_stats/
-- user_vocab_tag_statsはuser_id単位の集計だが、こちらはquestion_id/vocab_word_id単位で
-- ユーザー横断集計する（どのユーザーが苦手かではなく、どの問題/単語が苦手を生みやすいかを見る）。
-- security_invoker = true が必須（既存ビューと同じ理由: 付けないとビュー所有者の権限で評価され、
-- 認証済みユーザーなら誰でも全ユーザーのuser_grammar_attempts/vocab_review_logsを横断集計できて
-- しまう）。service_roleで動く本機能のスクリプトはRLSをバイパスするため、意図どおり全ユーザー
-- 横断の集計を取得できる。
create view grammar_question_accuracy_stats
with (security_invoker = true)
as
select
  question_id,
  count(*) as attempt_count,
  count(*) filter (where is_correct) as correct_count,
  round(count(*) filter (where is_correct)::numeric / count(*), 3) as accuracy_rate
from user_grammar_attempts
group by question_id;

create view vocab_word_again_stats
with (security_invoker = true)
as
select
  vocab_word_id,
  count(*) as review_count,
  count(*) filter (where rating = 'again') as again_count,
  round(count(*) filter (where rating = 'again')::numeric / count(*), 3) as again_rate
from vocab_review_logs
group by vocab_word_id;

-- 11.2: 既存のgeneration_batch_items / review_batch.tsのneeds_reviewフローをそのまま
-- 再利用するため、content_type enumに2値追加する（既存の'vocab'/'grammar'の意味は変えない）。
alter type content_type add value 'grammar_explanation';
alter type content_type add value 'vocab_explanation';
