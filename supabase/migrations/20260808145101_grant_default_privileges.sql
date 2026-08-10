-- anon/authenticated/service_role には基本的なテーブル権限(GRANT)が付与されていなかった。
-- RLSポリシー(7章)は「行」を絞り込むだけで、その手前の「テーブルへのアクセス自体を許可する」
-- GRANTがなければPostgRESTからのアクセスは permission denied になる。
-- 実際に書き込みを許可するかどうかは引き続きRLSポリシーが決める(ポリシーが無いテーブル・
-- コマンドは、GRANTがあってもRLSにより全面拒否されるため、8.2のgeneration_batches /
-- generation_batch_itemsや、7章でSELECT以外のポリシーを定義していないコンテンツテーブルの
-- 安全性は変わらない)。

grant usage on schema public to anon, authenticated, service_role;

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;

grant usage, select on all sequences in schema public
  to anon, authenticated, service_role;

grant execute on all functions in schema public
  to anon, authenticated, service_role;

-- 今後追加するテーブル・シーケンス・関数にも自動的に同じ権限を適用する
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant usage, select on sequences to anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  grant execute on routines to anon, authenticated, service_role;
