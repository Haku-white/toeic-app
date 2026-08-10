insert into grammar_categories (code, name_ja, sort_order) values
  ('tense',              '時制',              1),
  ('voice',              '態(能動・受動)',   2),
  ('subjunctive',        '仮定法',            3),
  ('relative_clause',    '関係詞',            4),
  ('infinitive_gerund',  '不定詞・動名詞',     5),
  ('preposition',        '前置詞',            6),
  ('conjunction',        '接続詞',            7),
  ('comparison',         '比較',              8),
  ('part_of_speech',     '品詞',              9);

-- ─────────────────────────────────────────────────────────────
-- 以下はローカル開発用のモック語彙データ（Gemini APIバッチ生成パイプライン
-- (8章)が未実装のため、語彙SRS画面の動作確認用に手動投入した仮データ）。
-- batch_id が NULL の vocab_words は「バッチ生成由来ではない」ことを示す。
-- クラウド環境へは意図的に反映していない（db push --include-seedしない）。
-- ─────────────────────────────────────────────────────────────

insert into vocab_tags (name, code) values
  ('ビジネス', 'business'), ('日常会話', 'daily_conversation'), ('Part7頻出', 'part7')
on conflict (name) do nothing;

insert into vocab_words (word, part_of_speech, meaning_ja, example_sentence_en, example_sentence_ja, toeic_band, frequency_rank, etymology_note) values
  ('negotiate', 'verb', '交渉する', 'We need to negotiate the contract terms before the deadline.', '契約条件について期限までに交渉する必要がある。', 730, 10, 'neg-(否定)+otium(暇、ラテン語)→「暇ではない」→商談で忙しく動き回る様子から「交渉する」へ'),
  ('reimburse', 'verb', '払い戻す', 'The company will reimburse your travel expenses within a week.', '会社は1週間以内に旅費を払い戻します。', 730, 20, 're-(再び)+im-(中に)+bursa(財布、ラテン語)→「財布の中に戻す」'),
  ('itinerary', 'noun', '旅程表', 'Please review the itinerary before we depart tomorrow.', '明日出発する前に旅程表を確認してください。', 730, 30, 'iter(道、ラテン語)+-ary(〜に関するもの)→「道のりに関する記録」'),
  ('subsidiary', 'noun', '子会社', 'Our subsidiary in Osaka handles all domestic shipments.', '大阪の子会社が国内配送を全て担当している。', 860, 40, 'sub-(下に)+sedere(座る、ラテン語)+-ary→「下に控えるもの」→補助的な存在'),
  ('inventory', 'noun', '在庫', 'We ran out of inventory before the holiday season started.', '休暇シーズンが始まる前に在庫が尽きてしまった。', 730, 50, 'in-(中に)+venire(来る、ラテン語)+-ory→「中に入ってきたものの目録」'),
  ('commute', 'verb', '通勤する', 'Many employees commute over an hour to reach the office.', '多くの社員がオフィスまで1時間以上かけて通勤している。', 600, 60, 'com-(共に)+mutare(変える、ラテン語)→「場所を入れ替える」→行き来する'),
  ('renowned', 'adjective', '有名な', 'The renowned architect designed the new headquarters building.', 'その有名な建築家が新本社ビルを設計した。', 860, 70, 're-(再び)+nomen(名前、ラテン語)→「繰り返し名前が挙がる」→有名な'),
  ('deduct', 'verb', '控除する', 'The accountant will deduct taxes directly from your paycheck.', '会計士が給与から直接税金を控除します。', 730, 80, 'de-(下に)+ducere(導く、ラテン語)→「引き下げる」→控除する'),
  ('warranty', 'noun', '保証', 'This appliance comes with a two-year warranty.', 'この家電製品には2年間の保証が付いている。', 600, 90, 'war-(守る、ゲルマン祖語)+-ty(名詞化)→「守ることの証」→保証'),
  ('postpone', 'verb', '延期する', 'The meeting has been postponed until next Thursday.', '会議は来週木曜日まで延期された。', 600, 100, 'post-(後に)+ponere(置く、ラテン語)→「後に置く」→延期する'),
  ('commuter', 'noun', '通勤者', 'The new train line was built to serve commuters downtown.', '新しい鉄道路線は都心の通勤者のために建設された。', 600, 110, 'commute(行き来する)+-er(〜する人)→「行き来する人」'),
  ('proficient', 'adjective', '熟練した', 'She is proficient in both spoken and written Japanese.', '彼女は日本語の会話と読み書きの両方に熟練している。', 860, 120, 'pro-(前に)+facere(作る、ラテン語)→「前へ進んで為せる」→熟達した')
on conflict (word, part_of_speech) do nothing;

insert into vocab_word_tags (vocab_word_id, tag_id)
select w.id, t.id from vocab_words w join vocab_tags t on
  (w.word = 'negotiate' and t.name = 'ビジネス') or
  (w.word = 'reimburse' and t.name = 'ビジネス') or
  (w.word = 'itinerary' and t.name = 'Part7頻出') or
  (w.word = 'subsidiary' and t.name = 'ビジネス') or
  (w.word = 'inventory' and t.name = 'ビジネス') or
  (w.word = 'commute' and t.name = '日常会話') or
  (w.word = 'renowned' and t.name = 'Part7頻出') or
  (w.word = 'deduct' and t.name = 'ビジネス') or
  (w.word = 'warranty' and t.name = 'Part7頻出') or
  (w.word = 'postpone' and t.name = 'ビジネス') or
  (w.word = 'commuter' and t.name = '日常会話') or
  (w.word = 'proficient' and t.name = 'Part7頻出')
on conflict (vocab_word_id, tag_id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- 以下はローカル開発用のモック文法問題データ（Gemini APIバッチ生成パイプライン
-- (8章)が未実装のため、文法ドリル画面の動作確認用に手動投入した仮データ）。
-- 9カテゴリそれぞれに3問ずつ、計27問。batch_id は NULL（バッチ生成由来ではない）。
-- クラウド環境へは意図的に反映していない（db push --include-seedしない）。
-- ─────────────────────────────────────────────────────────────

insert into grammar_questions (category_id, question_text, choices, correct_index, explanation, difficulty)
select c.id, q.question_text, q.choices::jsonb, q.correct_index, q.explanation, q.difficulty
from (values
  ('tense', 'The company ___ its annual report by the end of this month.', '["will have submitted","submits","submitted","submitting"]', 0, '「by the end of this month」のような未来の期限を表す表現があるときは未来完了形(will have + 過去分詞)を使う。', 3),
  ('tense', 'She ___ for the company for over ten years before she was promoted.', '["works","had worked","will work","working"]', 1, '過去のある時点(昇進した時)よりも前から続いていた動作は過去完了形(had + 過去分詞)で表す。', 3),
  ('tense', 'The new policy ___ effect next Monday.', '["took","takes","will take","has taken"]', 2, '「next Monday」という未来を示す語句があるため未来形(will + 動詞原形)を使う。', 2),

  ('voice', 'The proposal ___ by the board of directors last week.', '["approved","was approved","approves","has approve"]', 1, '主語(the proposal)が「承認される」側なので受動態(be + 過去分詞)を使う。', 2),
  ('voice', 'All employees ___ to attend the safety training session.', '["require","are required","requiring","has required"]', 1, '従業員は「要求される」側なので受動態を使う。', 2),
  ('voice', 'The new factory ___ next year.', '["will complete","will be completed","completes","completing"]', 1, '工場は「完成させられる」対象であり、動作主体ではないため受動態にする。', 3),

  ('subjunctive', 'If I ___ more time, I would finish the project today.', '["have","had","will have","having"]', 1, '現在の事実に反する仮定は仮定法過去(If + 主語 + 過去形)を使う。', 3),
  ('subjunctive', 'If the meeting ___ postponed, we would have missed the deadline.', '["is","was","had been","were"]', 2, '過去の事実に反する仮定は仮定法過去完了(If + had + 過去分詞)を使う。', 4),
  ('subjunctive', 'I wish I ___ about the schedule change earlier.', '["know","knew","had known","will know"]', 2, '過去について「〜していればよかった」という後悔はwish + had + 過去分詞で表す。', 3),

  ('relative_clause', 'The manager ___ office is on the third floor will lead the meeting.', '["who","whose","which","whom"]', 1, '後ろに名詞(office)が続き所有関係を示すのでwhoseを使う。', 3),
  ('relative_clause', 'This is the department ___ handles customer complaints.', '["who","whom","which","whose"]', 2, '先行詞the departmentは物なのでwhichを使う(whoは人が先行詞のとき)。', 2),
  ('relative_clause', 'The client, ___ we met yesterday, has confirmed the contract.', '["who","whom","whose","which"]', 1, '関係詞節内でmetの目的語になっているため目的格whomを使う。', 3),

  ('infinitive_gerund', 'The company decided ___ the new product line next quarter.', '["launching","to launch","launch","launched"]', 1, 'decideは目的語にto不定詞をとる動詞。', 2),
  ('infinitive_gerund', 'We look forward to ___ from you soon.', '["hear","hearing","heard","to hear"]', 1, 'look forward toのtoは前置詞なので後ろは動名詞(-ing)になる。', 2),
  ('infinitive_gerund', '___ a good presentation requires careful preparation.', '["Give","To give","Giving","Gave"]', 2, '文の主語になる場合は動名詞(Giving)を使う。', 2),

  ('preposition', 'The conference will be held ___ March 15th.', '["in","on","at","for"]', 1, '特定の日付(March 15th)にはonを使う。', 1),
  ('preposition', 'The document was placed ___ the desk.', '["on","in","into","among"]', 0, '接触している「上に」はonを使う。', 1),
  ('preposition', 'The negotiations lasted ___ three hours.', '["during","for","since","by"]', 1, '「〜の間」という期間の長さを表すときはforを使う(duringは特定の期間名詞の前)。', 2),

  ('conjunction', '___ the rain, the event proceeded as planned.', '["Although","Despite","Because","Unless"]', 1, '後ろが名詞句(the rain)なので前置詞的接続語Despiteを使う(Althoughは節が続く)。', 2),
  ('conjunction', 'You must submit the form ___ you want a refund.', '["if","unless","although","despite"]', 0, '「〜したいなら」という条件を表すのでifを使う。', 1),
  ('conjunction', 'The store remained open ___ it was a holiday.', '["despite","even though","because of","unless"]', 1, '後ろが節(it was a holiday)なのでeven though(〜だけれども)を使う。', 2),

  ('comparison', 'This model is much ___ than the previous version.', '["efficient","more efficient","most efficient","efficiently"]', 1, 'muchで強調された比較級が続くのでmore efficientを使う。', 2),
  ('comparison', 'Of all the candidates, she is ___ qualified.', '["more","most","the most","much"]', 2, '「of all the candidates」という範囲指定があるので最上級the mostを使う。', 2),
  ('comparison', 'The new office is ___ as spacious as the old one.', '["so","as","more","most"]', 1, 'as 形容詞 as の原級比較構文。', 1),

  ('part_of_speech', 'The manager gave a ___ explanation of the new policy.', '["clear","clearly","clarity","clarify"]', 0, '名詞explanationを修飾するので形容詞clearを使う。', 1),
  ('part_of_speech', 'The team completed the project ___.', '["success","successful","successfully","succeed"]', 2, '動詞completedを修飾するので副詞successfullyを使う。', 1),
  ('part_of_speech', 'Employee ___ is essential for maintaining productivity.', '["motivate","motivating","motivation","motivated"]', 2, '文の主語になる位置なので名詞motivationを使う。', 2)
) as q(category_code, question_text, choices, correct_index, explanation, difficulty)
join grammar_categories c on c.code = q.category_code;
