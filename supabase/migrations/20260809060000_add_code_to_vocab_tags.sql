-- 16.2: grammar_categories.codeと同じ方針でvocab_tagsにもURL用英語スラッグ列を追加する。
-- 開放集合（Gemini生成パイプラインが新規タグを都度作成しうる）のため、当面はnullableのまま運用する。
alter table vocab_tags add column code text unique;

-- 既存タグへの手動割り当て（16.3のVOCAB_TAG_CODESと対応させる）。
-- ローカルのseed.sqlタグ・既に実生成されたイディオムタグが対象。該当行が無ければno-op（クラウド等）。
update vocab_tags set code = 'business' where name = 'ビジネス';
update vocab_tags set code = 'daily_conversation' where name = '日常会話';
update vocab_tags set code = 'part7' where name = 'Part7頻出';
update vocab_tags set code = 'idiom' where name = 'イディオム';
