-- 語源ベースのヒント（接頭辞・語幹・接尾辞の分解と意味）。任意項目のためnullable。
alter table vocab_words
  add column etymology_note text;
