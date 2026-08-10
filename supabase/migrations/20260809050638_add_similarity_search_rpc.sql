-- 8.4②の近似重複検出をSupabaseクライアント(RPC)経由で呼べるようにする。
-- PostgRESTのクエリビルダはsimilarity()のような任意の関数呼び出しを直接表現できないため、
-- Postgres関数として公開しsupabase.rpc(...)から呼ぶ。
--
-- search_path = public とする理由: pg_trgmのsimilarity()/%演算子はpublicスキーマに
-- インストールされており、search_path=''だと解決できない(operatorのスキーマ修飾は
-- OPERATOR(public.%)という冗長な記法が必要になる)。ここはSECURITY DEFINERではなく
-- SECURITY INVOKER(呼び出し元自身の権限で読み取るだけで権限昇格が無い)であるため、
-- handle_new_user(10.2)のようなsearch_pathハイジャック対策の必要性は低いと判断した。
-- EXECUTE権限は20260808145101_grant_default_privileges.sqlのALTER DEFAULT PRIVILEGESにより
-- 新規関数へ自動的に付与されるため、ここで個別にGRANTする必要はない。

create or replace function public.find_similar_grammar_questions(
  query_text text,
  similarity_threshold float default 0.6,
  match_limit int default 5
)
returns table (id uuid, question_text text, similarity real)
language sql
security invoker
set search_path = public
stable
as $$
  select q.id, q.question_text, similarity(q.question_text, query_text) as similarity
  from grammar_questions q
  where q.question_text % query_text
    and similarity(q.question_text, query_text) >= similarity_threshold
  order by similarity desc
  limit match_limit;
$$;

create or replace function public.find_similar_vocab_words(
  query_word text,
  similarity_threshold float default 0.6,
  match_limit int default 5
)
returns table (id uuid, word text, similarity real)
language sql
security invoker
set search_path = public
stable
as $$
  select w.id, w.word, similarity(w.word, query_word) as similarity
  from vocab_words w
  where w.word % query_word
    and similarity(w.word, query_word) >= similarity_threshold
  order by similarity desc
  limit match_limit;
$$;
