# TOEIC学習アプリ 設計ドキュメント

このファイルはプロジェクトの設計決定事項を記録する。機能追加・仕様変更のたびに追記していく運用とする。

---

## 更新履歴

- 2026-08-08: 初版作成。ディレクトリ構成・DBスキーマ（FSRS版）・ER図・RLSポリシーを確定。
- 2026-08-08: Gemini APIバッチ生成パイプライン（プロンプトテンプレート・自動検証・人力レビュー・本番反映フロー）を確定。
- 2026-08-08: フロントエンド設計（技術スタック・認証方式・ルーティング・FSRS統合方針）を確定。
- 2026-08-13: モバイル表示（390×844、iPhone 12/13相当）の確認を実施。主要9画面（Home/VocabReview/GrammarDrill/WeakPoints/VocabTagList/MixedDrill/Login/GrammarCategories/AuthCallback）を、各画面の主要な状態（未回答/回答済み、空状態/データありなど）まで含めて確認したが、崩れは1件も見つからず修正不要だった。特に懸念していた`VocabReview`の4択評価ボタン（`grid-cols-4`固定）と、`WeakPoints`の`StatRow`（ラベル+バッジを左・ゲージ+正答率+件数を右に配置する`justify-between`レイアウト、最長のカテゴリ名「不定詞・動名詞」でも確認）はいずれも折り返し・はみ出し無く収まった。単一カラム・`flex`/`gap`ベースの余白設計（固定px幅を極力使わない）が功を奏している。
- 2026-08-13: キーボード操作の完結性を見直し、GrammarDrill/MixedDrill/VocabReviewの3画面で見つかった断絶を修正。
  - **セッション完了画面でEnterキーが効かなくなっていた不具合**（3画面共通）: 各画面のグローバルkeydownハンドラは「現在の設問/カード」が`undefined`（配列範囲外）だと即returnする作りだったため、セッション完了画面（＝設問/カードが尽きた状態）ではEnterが一切反応しなくなっていた。`isSessionComplete`を明示的に判定し、その場合はEnterで主要リンクへ`navigate()`するよう修正（GrammarDrillは「カテゴリ一覧に戻る」、MixedDrillは「ホームに戻る」、VocabReviewは`backLabel`＝文脈に応じて「ホームに戻る」または「弱点分析ダッシュボードに戻る」）。各完了画面に「Enter: ◯◯に戻る」のヒント文言も追加。
  - **VocabReviewの「答えを見る」にキーボード操作が無かった不具合**: 依頼内容には無かったが、一連の流れをキーボードのみで通しで確認する過程で発見。答えを見る前はEnterキーで反応しないため、キーボードのみのユーザーがここで詰まっていた。Enterで`handleReveal()`を実行するよう追加し、下部ヒントも状態に応じて「Enter: 答えを見る」⇔「1〜4: 評価」を出し分けるようにした。評価後の自動遷移（`useMutation`の`onSuccess`で`advance()`）は既存実装のとおり正しく機能していることを確認済み（変更なし）。
  - **AskTutorPanel（もっと詳しく聞く）とのEnterキー競合**: パネルの`<textarea>`にフォーカスがある状態でEnterを押すと、改行が入るのと同時に親画面のグローバルkeydownハンドラにもイベントが伝播し、意図せず「次の問題へ」が発火してしまう不具合を確認。修正: textareaにEnter(Shiftなし)＝質問送信・Shift+Enter＝改行という専用ハンドラを追加し、パネルのルート要素（閉じたボタン状態・展開後のコンテナ双方）に`onKeyDown={(e) => e.stopPropagation()}`を付与して、パネル内でのキー入力が親のwindowリスナーに一切伝播しないようにした。調査の過程で、依頼内容を超えてもう1つの実害を発見: VocabReviewは評価ボタンが表示されている間（＝パネルも同時に表示されうる間）1〜4キーが生きているため、質問文に数字を含めて入力すると（例:「なぜ2ではダメ？」）誤って評価が送信されてしまう状態だった。stopPropagationの対象をEnterに限定せずキー入力全般にしたことで、この経路もあわせて解消した。
  - **動作確認（依頼の4番）**: ブラウザ拡張が本セッションでは接続できず、実ブラウザでのライブ確認は実施できなかった（正直に申告）。代わりに、実際のDOM keydownイベント・実際のルーター遷移を伴う自動テストで同等のキーボードのみフロー（問題を見る→回答→Enterで次へ→…→セッション完了→Enterで遷移、VocabReviewは答えを見る→評価→自動遷移→セッション完了→Enterで遷移）を新規に追加して検証した。
  - テスト: `npm test`（195件全て成功、187件から+8件——GrammarDrill/MixedDrillに各1件、VocabReviewに3件、AskTutorPanelに4件追加の計8件）・`npm run lint`（0件）・`npm run typecheck`（0件）。
- 2026-08-11: AskTutorPanelの改善2件。まず動作確認の過程で、直前のEnterキー競合修正が未コミットのままだったため`dist/`が古いビルドのままで、本番ビルド(`npm run build`)では旧不具合が再現する状態だったことが判明（デプロイ設定は無く`npm run preview`でのローカル配信のみのプロジェクトのため、再ビルドのみで解消）。その上で以下を追加実装。
  - **「もっと詳しく聞く」ボタンへのキーボードショートカット割り当て**: パネルが閉じている間だけ`"?"`キーでパネルを開けるようにし（開いた後は`useEffect`でリスナーを外し、質問文に`?`を打てるようにする）、閉じたボタンのラベル横に`?`のヒントを表示（`CHOICE_LABELS`/`RATING_KEY_HINTS`と同じ、キーヒントをボタン横に添えるパターンを踏襲）。開いた瞬間に`textarea`へ自動フォーカスする。
  - **定型質問のスニペットボタン**: テキストエリア上部に、クリックで質問文を差し込める定型文ボタンを追加（「なぜこの答えが正しいのですか?」「もっと詳しく教えてください」は常設、「他の選択肢ではなぜダメなのですか?」は`choices`が渡されている設問（GrammarDrill/MixedDrill）でのみ表示——VocabReview（選択肢の概念が無い）では出さない）。
  - **質問入力中のショートカットヒント切り替え**: `AskTutorPanel`に`onFocusChange`コールバックを追加し、テキストエリアの`onFocus`/`onBlur`で親に通知。GrammarDrill/MixedDrill/VocabReviewはこれを`isAskingTutor`状態として受け取り、画面下部のヒント文言を「1〜4: 選択 / Enter: 次へ」等から「Enter: 質問を送信 / Shift+Enter: 改行」に切り替える。状態のリセットは明示的なリセット処理を持たず、テキストエリアのフォーカスが外れる（＝ボタンクリックで次へ進む際は自然にblurする）ことに委ねている——`currentIndex`変化時に`setIsAskingTutor(false)`する案は`eslint-plugin-react-hooks`の`set-state-in-effect`に抵触するため採用しなかった。
  - テスト: `npm test`（204件全て成功、195件から+9件——AskTutorPanelに6件、GrammarDrill/MixedDrill/VocabReviewに各1件追加の計9件）・`npm run lint`（0件）・`npm run typecheck`（0件）。
- 2026-08-11: `src/routes/WeakPoints.tsx`のゲージを弧状メーターからアナログ針式デザインに刷新。Claude Designで作成した「Weakness Dashboard Gauges」1a案をベースに実装し、目盛り（minor/major 2段階）・ラベル（0/50/100の3点のみ）・針・中心の丸を追加した。
  - **検討したが不採用にした案**: 1a案が持つ3階調配色（green/amber/red、正答率に応じて段階的に色分けする案）は不採用とし、既存方針どおり2階調（correct/incorrect）の配色を踏襲した。理由はコンポーネント直上のコメントに記録済み——`StatRow`のバッジ色ロジックと一貫させ、紫（弱点分析ダッシュボードの他要素で使用）と評価色を混同させないため（20章参照、紫回避の方針自体は既存）。
  - 対象ファイルは`src/routes/WeakPoints.tsx`のみ（`src/routes/WeakPoints.test.tsx`は変更なしで全て既存のまま成功）。
  - テスト: `npm test`（WeakPoints関連8件を含め既存のまま全件成功）・`npm run lint`（0件）・`npm run typecheck`（0件）。
- 2026-08-11: AIチューターの1日あたり利用回数を30回→10回に変更し、AskTutorPanelを開いたままCtrl+Enterで次の問題に進められるようにした。
  - **利用回数上限の変更**: `supabase/functions/ask-tutor/index.ts`の`MAX_DAILY_REQUESTS`を`30`から`10`に変更。**クラウドへの再デプロイ（`supabase functions deploy ask-tutor`）は未実施**——外部APIキーが絡む操作としてCLAUDE.mdの確認事項に該当するため、コード変更のみ行いユーザーの許可待ちとした。ローカルの`supabase functions serve`を使う場合は次回起動時から反映される。
  - **Ctrl+Enter(Mac互換でCmd+Enterも)で次の問題へ**: `AskTutorPanel`の`handleTextareaKeyDown`と、ルート要素の`onKeyDown`（`handleRootKeyDown`に切り出し）の両方で、`Enter`かつ`ctrlKey`/`metaKey`のときだけ質問送信・stopPropagationの対象から除外し、親画面のグローバルkeydownハンドラ（GrammarDrill/MixedDrillの「Enterで次へ」）まで素通りさせるようにした。textarea側は`preventDefault()`のみ行い（改行が入らないようにする）送信はしない。GrammarDrill/MixedDrillの質問入力中ヒントに「Ctrl+Enter: 次へ」を追加し、テキストエリアのplaceholderにも明記した。VocabReviewは回答後の「次へ」がEnterキーではなく1〜4キーでの評価に紐づく設計（25章）のため、この変更の対象外とした。
  - テスト: `npm test`（207件全て成功、204件から+3件——AskTutorPanelに1件、GrammarDrill/MixedDrillに各1件追加の計3件）・`npm run lint`（0件）・`npm run typecheck`（0件）。`ask-tutor`はDeno Edge Function（Vitest対象外）のため定数変更のみで自動テストは無し。
- 2026-08-11: 自動問題生成（在庫閾値ベースの自動補充、10章）を実装。設計は実装前にDESIGN.md 10章として追記済み（本エントリは実装完了の記録）。
  - **実装前提の訂正が2点あった**: (1) 依頼は「Gemini呼び出しの503対策としてバッチ化する」という前提だったが、`GRAMMAR_JSON_SCHEMA`/`VOCAB_JSON_SCHEMA`・`generateGrammarBatch`/`generateVocabBatch`は元から1回の呼び出しで複数件（既存の一回限りバックフィルは文法15〜20件・語彙20件）を配列で生成する設計だった。今回のバッチ化対応は新規スキーマ変更ではなく、新設オーケストレーターが不足数を既定8件のサブバッチに分割して要求する形に絞った（10.1参照）。(2) 依頼にあった「2026-08-12にラベルバグでバッチ全体10件がneeds_reviewに巻き込まれた事例」はコード上・DESIGN.md上に見つけられなかった。実際に見つかった実例は日付・内容とも異なる2件（`commitBatch.ts`のコメント参照）: 20260810のcategory_code大文字化/略称（`comparison`→`COMP`）事例と、2026-08-12の`commitBatch.ts`エラーメッセージが`[object Object]`になっていた事例。ユーザーの記憶と実際の記録の食い違いをそのまま報告する（10.10参照）。
  - **在庫チェック**（`inventoryCheck.ts`、新規）: `checkGrammarInventory`/`checkVocabInventory`。文法は9カテゴリごとの`grammar_questions`件数、語彙は`vocab_tags`（イディオム含む）ごとの`vocab_word_tags`件数を集計し、閾値（既定30件、目標40件——既存の一回限りバックフィルスクリプトの「各カテゴリ/タグ合計40問・既存語と合わせて30〜50問目安」を踏襲）未満のみ返す。codeが`vocabTagCodes.ts`の`VOCAB_TAG_CODES`に無いタグはスキップして警告ログを出す。
  - **バッチ出力のパース耐性強化**（`gemini.ts`拡張）: 新規`generateJsonArray()`を追加（既存`generateJson()`はシグネチャ・挙動とも変更なし、共通のリトライ・バックオフ部分を`callGeminiWithRetry`として抽出しただけ）。レスポンスの`candidates[0].finishReason`が`MAX_TOKENS`のとき`truncated: true`を返す（`@google/genai`の型定義上のフィールドをそのまま使い、文字列ヒューリスティックは使わない）。`JSON.parse`が失敗した場合は新規`extractCompleteArrayItems()`（深さ・文字列エスケープを追跡する軽量スキャナ、外部ライブラリ不使用）でトップレベル配列要素のうち完結しているものだけを部分救済し、末尾の不完全な要素のみ破棄する。`generateGrammarBatch`/`generateVocabBatch`はこの結果を使うよう切り替え（`GenerateGrammarBatchDeps`/`GenerateVocabBatchDeps`の`generateJson`フィールドを`generateJsonArray`に変更——呼び出し元7箇所（`backfill_grammar_categories.ts`/`backfill_vocab_tags.ts`/`backfill_idiom.ts`/`generate_grammar.ts`/`generate_vocab.ts`/テスト2ファイル）を追随修正）。切り詰め・部分救済が起きた場合は`generation_batches.notes`に件数を明記し、戻り値に`truncated`を追加。不完全な断片はneeds_reviewに保存しない（`raw_payload`は`jsonb not null`で保存先が無いため）——不足分は10.4のオーケストレーターが後続のサブバッチ生成でそのまま埋め合わせる設計とした。
  - **バッチ内自己重複チェック**（`validateBatch.ts`拡張）: DB全体との近似重複検出（既存）とは別に、同一バッチ内で生成された項目同士の重複を検出する`findInBatchGrammarDuplicates`/`findInBatchVocabDuplicates`を追加。文法は正規化後の`question_text`一致、語彙は既存の`wordPosKey`一致で判定し、後発の項目のみ`needs_review`にする（構造チェックより前に判定し、無駄なDB問い合わせ・Gemini呼び出しをスキップ）。あわせて`validateBatch.ts`の予期しないエラーのcatch節が素の`String(error)`を使っており`[object Object]`になりうる欠陥を発見・修正した（`commitBatch.ts`が既に採用している`error.message`優先抽出パターンに統一）。
  - **同時実行数制限とスロットリング**（`concurrencyPool.ts`、新規）: `createThrottledPool({concurrency, minIntervalMs})`。外部ライブラリ（p-limit等）は追加せず自前実装。既定値は同時実行数2・最小ディスパッチ間隔1500ms（根拠は10.8参照——既存の一回限りバックフィルは完全直列運用だったため、そこからの引き上げ幅を小さく抑えた）。
  - **段階的なバッチサイズ縮小**（`autoBackfill.ts`内`generateWithShrinkRetry`）: `gemini.ts`の5回リトライを使い切った末の429/5xx系エラー（`isRetryableError`を`gemini.ts`から公開エクスポートして再利用）のときのみ、バッチサイズを半分ずつ最大3段階（既定8→4→2）縮小して再試行する。それ以外の致命的エラーは即座に上位へ伝播させ実行全体を中断する（既存の一回限りバックフィルスクリプトと同じ方針）。縮小しても失敗した分は「今回諦めた件数」として結果に記録し、次回実行時（閾値未満のままなので）自動的に再検出される。
  - **オーケストレーション**（`autoBackfill.ts`、新規）: `runAutoBackfill(deps, options)`。在庫チェック結果から不足分の生成タスク（文法は既存15:15:10比率を踏襲し3:4:5の難易度に按分、語彙はタグ単位）を組み立て、`concurrencyPool`を通して「生成→検証→(auto_passedのみ)コミット」まで実行する。**既存の一回限りバックフィルスクリプトと異なり、needs_reviewが発生してもそのタスク・他のカテゴリ/タグの処理は中断しない**（`commitBatch`は`auto_passed`/`approved`のみを対象にする実装のため、needs_reviewが混在していても合格分だけ安全にコミットできることを利用した設計判断、10.4参照）。1回あたりの生成上限（既定100件、根拠は10.12参照）に達した時点で残りは「今回未着手」として記録し打ち切る。
  - **CLI**（`auto_backfill.ts`、新規）: `npm run backfill:auto -- [--dry-run] [--max-total] [--batch-size] [--concurrency] [--throttle-ms] [--grammar-threshold/target] [--vocab-threshold/target] [--model]`。在庫チェック結果・実行結果（タスクごとの生成/検証/コミット件数、needs_reviewが出たタスクのレビューコマンド、諦めた件数、上限超過でスキップしたラベル）を明示的に出力する（10.10のトレーサビリティ方針）。cron等の定期実行は今回スコープ外とし11章の未決事項に記録した。needs_reviewのエスカレート運用は既存方針（エージェントが一次判断、本当に曖昧なものだけユーザーへ）をそのまま踏襲し、新しい仕組みは実装していない。
  - **DESIGN.mdの実装追いつき状況**: 8章（Gemini APIパイプライン）が実装（13章のイディオム・16章のvocab_tags code分離・17章のリトライ戦略・19章のセルフチェック改訂を含む）から大きく取り残されていることを発見。今回のタスク範囲を超えるため全面書き直しはスコープ外とし、11章の未決事項に記録した（詳細は10章冒頭参照）。
  - テスト: `npm test`（246件全て成功、207件から+39件——`gemini.test.ts`に10件、`generateGrammar.test.ts`に1件、`generateVocab.test.ts`に1件、`validateBatch.test.ts`に3件、新規`inventoryCheck.test.ts`に5件、新規`concurrencyPool.test.ts`に4件、新規`autoBackfill.test.ts`に15件）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）。
- 2026-08-12: 間違いが多い問題への自動解説追加（11章）を実装。設計は実装前にDESIGN.md 11章として追記済み（本エントリは実装完了の記録）。**このエントリは今回実装した11章の範囲のみを対象とし、既存の8章の記載が実装から取り残されている問題（10章冒頭・11章の未決事項に既に記録済み）とは混同しない**。
  - **対象抽出ロジック**（`weaknessDetection.ts`、新規）: `findWeakGrammarQuestions`/`findWeakVocabWords`。文法は`user_grammar_attempts`を`question_id`単位で集計する新規ビュー`grammar_question_accuracy_stats`から正答率70%未満（5章・9.6のWeakPoints既存閾値と統一）かつ試行回数5回以上の問題を抽出。語彙は`vocab_review_logs`を`vocab_word_id`単位で集計する新規ビュー`vocab_word_again_stats`から`rating='again'`比率30%以上かつレビュー回数5回以上の単語を抽出。**30%の根拠**: FSRSの`again`は明確な想起失敗を表し、チューニングされたSRSデッキの定常状態のagain率はおよそ10〜20%程度に収まることが多いため、それより明確に高い30%を「継続的に思い出せていない語彙」だけに絞り込む保守的な初期値として設定した（11.1参照、`--vocab-min-again-rate`で上書き可能）。既に`additional_explanation`が設定済みの行は対象から除外する。
  - **DBスキーマ変更**（新規マイグレーション`20260811080000_add_additional_explanation.sql`、ローカルDBに適用済み・クラウド未反映）: `grammar_questions`・`vocab_words`それぞれに**nullableな`additional_explanation text`列を追加**（既存の`explanation`/`etymology_note`は無変更）。判定用に`grammar_question_accuracy_stats`/`vocab_word_again_stats`ビューを追加（既存の`user_grammar_category_stats`等と同じ`security_invoker=true`方針、ただし`user_id`単位ではなく`question_id`/`vocab_word_id`単位でユーザー横断集計する点が異なる、11.2参照）。既存の`generation_batch_items`/`review_batch.ts`のneeds_reviewフローを再利用するため`content_type` enumに`'grammar_explanation'`/`'vocab_explanation'`を追加（既存2値の意味は不変）。クラウドへの反映（`supabase db push`）はCLAUDE.mdの確認事項（クラウドDBへのマイグレーション反映）に該当するため本エントリの時点では未実施——ユーザーの明示的な指示を受けて後日反映済み（下記2026-08-12の別エントリ参照）。
  - **生成パイプラインの再利用・拡張**: 新規プロンプト`prompts/grammar_additional_explanation.md`/`prompts/vocab_additional_explanation.md`（対象項目リストをJSONで埋め込み、出力は`{target_id, additional_explanation}`の配列——`target_id`をレスポンスに含めさせ配列順序に依存せず対応付ける、8.4③の`solved_index`取り違えの教訓を踏襲）。新規`generateGrammarExplanations`/`generateVocabExplanations`（`generateExplanationEnhancement.ts`）が`generateJsonArray`経由で生成し`generation_batch_items`に保存。`validateBatch.ts`に`grammar_explanation`/`vocab_explanation`の新しい検証分岐を追加（構造チェック＋対象行の実在確認・未設定確認のみ、**セルフチェックは意図的に実装しない**——客観的に検証可能な判定軸が無いため、11.3参照）。`commitBatch.ts`に新規`commitGrammarExplanationItem`/`commitVocabExplanationItem`を追加（既存のINSERT系コミット関数と異なり、対象行への`UPDATE`）。`review_batch.ts`はcontent_type非依存の実装のため無変更で新content_type 2種にもそのまま使えた。
  - **バッチ化・503対策の流用**: `concurrencyPool.ts`（同時実行数2・間隔1500ms）をそのまま再利用。`autoBackfill.ts`の`generateWithShrinkRetry`/`ShrinkRetryOutcome`をexportし、判定ロジック（`isRetryableError`）・縮小幅（最大3段階、既定8→4→2）を共有する変種`generateExplanationsWithShrinkRetry`（`enhanceExplanations.ts`）を新設——既存版は「件数」を縮小するが、こちらは対象が既存の特定行のため「対象アイテムの配列」を半分に割って縮小する点が異なる。
  - **1回あたりの対象件数上限**: 既定**50件/回**。根拠: セルフチェックを行わない設計のため1項目あたりGemini呼び出しは高々1回（10章の自動問題生成は文法で最大2回/件）で済み、コスト効率が良い。バッチサイズ8件なら約7回の生成呼び出しで済む水準として、10章の100件より低いが弱点解消に実質的な効果が出る規模として50件を選んだ（11.6参照）。文法優先で予算を消費し残りを語彙に割り当てる（`--max-total`で上書き可能）。
  - **CLI**（`enhance_explanations.ts`、新規）: `npm run enhance:explanations -- [--dry-run] [--max-total] [--batch-size] [--concurrency] [--throttle-ms] [--grammar-min-attempts/max-accuracy] [--vocab-min-reviews/min-again-rate] [--model]`。cron等の定期実行は今回スコープ外とし、10章の自動問題生成と合わせて12章の未決事項に記録した。needs_reviewのエスカレート運用は既存方針（エージェントが一次判断、本当に曖昧なものだけユーザーへ）をそのまま踏襲。
  - **フロントエンド表示**: `src/lib/queries/grammar.ts`/`mixedDrill.ts`/`vocab.ts`に`additionalExplanation`フィールドを追加（`select('*')`のため取得側の変更は型定義とマッピングのみ）。GrammarDrill.tsx/MixedDrill.tsx/VocabReview.tsxで既存の解説ボックスの下に、`additionalExplanation`がある場合のみ「よくある間違いのポイント」ボックスを追加表示。既存デザイントークンをそのまま使い、WeakPointsの警告色（`incorrect`系、正答率70%未満の強調と同じ配色）を流用して`border-incorrect-200 bg-incorrect-50`＋`text-incorrect-700`のラベルとした（新しい配色トークンは導入していない）。
  - テスト: `npm test`（282件全て成功、246件から+36件——`schemas.test.ts`に4件、`structuralValidation.test.ts`に3件、`promptTemplates.test.ts`に2件、`validateBatch.test.ts`に5件、`commitBatch.test.ts`に2件、新規`weaknessDetection.test.ts`に4件、新規`generateExplanationEnhancement.test.ts`に3件、新規`enhanceExplanations.test.ts`に8件、`GrammarDrill.test.tsx`に1件、`MixedDrill.test.tsx`に2件、`VocabReview.test.tsx`に2件）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）。
- 2026-08-12: 上記の間違いが多い問題への自動解説追加（11章）のDBスキーマ変更を、クラウドSupabaseプロジェクト（`qpfmssdhbtlbudqburki`）に反映した（ユーザーからの明示的な指示を受けて実施、CLAUDE.mdの確認事項「クラウドSupabaseプロジェクトへのマイグレーション反映」に該当するため）。
  - **対象マイグレーション**: `supabase/migrations/20260811080000_add_additional_explanation.sql`の1本のみ。反映前に`supabase migration list`でローカル・クラウドの差分を確認し、このマイグレーションだけが未反映（他の16件は既に一致）であることを確認済み。
  - **後方互換性の事前確認**: 反映前にファイル内容を再確認し、(1) `grammar_questions`/`vocab_words`への`additional_explanation text`列追加（nullable、デフォルト値なし）、(2) `grammar_question_accuracy_stats`/`vocab_word_again_stats`ビューの新規作成、(3) `content_type` enumへの`'grammar_explanation'`/`'vocab_explanation'`追加、の3種のみで構成されており、既存列の削除・型変更・リネーム、既存enum値の削除、破壊的なDROP文は一切含まれないことを確認した。
  - **反映**: `npx supabase db push`を実行（2026-08-12、日本時間の実施時刻は記録簿としてはコミット時刻を参照）。`upToDate: false`から実行し、`20260811080000_add_additional_explanation.sql`の1件が適用されたことをCLIの出力で確認。
  - **反映後の確認**: `npx supabase migration list`でローカル・クラウドの17件全てが一致することを確認。`npx supabase db query --linked`で(1) `grammar_questions`/`vocab_words`両方に`additional_explanation`列が存在すること、(2) `content_type`のenum値が`vocab`/`grammar`/`grammar_explanation`/`vocab_explanation`の4つになっていること、(3) `grammar_question_accuracy_stats`/`vocab_word_again_stats`の両ビューに対する`select`が正常に実行できること（クラウド側にはまだ`user_grammar_attempts`/`vocab_review_logs`の実データが無いため結果は空だが、エラー無く実行できることを確認——クエリが失敗せず空集合が返る、という点が「正常にクエリできる」の確認内容）、(4) 両ビューに`security_invoker=true`オプションが正しく設定されていること（`pg_class`の`reloptions`を直接確認）、をそれぞれ確認した。
- 2026-08-12: 語彙生成の重複回避コンテキストを、対象タグの単語（直近50件）＋タグを問わずDB全体の単語（直近100件）の両方を見る形に拡張した（8.3参照）。
  - **経緯の確認**: 依頼は「DESIGN.md 16章の未決事項」を根拠にしていたが、実際のDESIGN.md（現在は§1〜§12の構成）に該当する未決事項は見つけられなかった。一方でコード（`generateVocab.ts`）を確認したところ、「タグ単位→DB全体」への変更自体は**既に2026-08-10のコミット（`bb1d458`）で実施・push済み**だったことが判明した（関数名も`getExistingWordsForTag`から`getExistingWords`へ改称済み）。ユーザーの記憶と実際の記録に食い違いがあったため、10章・11章での同種の食い違いと同様、ここに正直に記録する。
  - **それでも実際に検証してみて見つかった別の問題**: 依頼の3番「needs_review発生率が想定通り下がるか、小規模なテストバッチ生成で確認する」を実施したところ、既にDB全体を見ているにもかかわらずローカルDB（159件、うちイディオムの一括バックフィルが直近を占有）でビジネスタグの単語を5件生成し検証したところ、5件中4件が構造チェックの完全一致重複（`negotiate`/`implement`/`accommodate`/`preliminary`）でneeds_reviewになった。原因を調査したところ、これらの単語はDB全体で「作成日時が古い方から数えて上位45件以内」（＝直近100件のサンプルにも入らない）に位置しており、「対象タグが最初に登録された基本的な単語ほど、後から他タグへ大量投入されるほど相対的に古くなり、直近N件という窓から外れる」という、2026-08-10の修正だけでは解決しない別種の問題だと分かった。
  - **追加の修正**: `getSameTagExistingWords`（新規、`vocab_word_tags`経由で対象タグの単語を直近50件取得——`src/lib/queries/vocab.ts`の`getWordIdsForTag`と同じ2段階クエリパターン）を追加し、`getExistingWords`が`getDbWideExistingWords`（DB全体、直近100件・従来の30から拡大）と合わせて重複排除した結果を返すよう変更。文法側（`generateGrammar.ts`の`existingQuestionSamples`）はカテゴリごとに独立した出題ドメインでクロスカテゴリ重複が起きにくいため対象外とした（判断理由は8.3参照）。
  - **パフォーマンス**: `vocab_words`全件を毎回取得する設計にはしていない（依頼で懸念されていた点）。DB全体側・同一タグ側ともにLIMIT句（100件・50件）で頭打ちにしており、現状の規模（数百件）では追加のキャッシュ・専用インデックスは不要と判断した。将来的にテーブルが数万件規模まで育った場合は`vocab_words(created_at desc)`への索引追加（一行の後方互換マイグレーション）で対応できる設計とした（8.3参照）。
  - **効果測定**: ローカルDB（クラウドは触れていない）で、修正前後それぞれ実際にGemini APIを呼び出して5件のテストバッチを生成・検証した（既存の合意済みバッチ生成の延長として実施、コミットはせず検証のみ）。修正前: ビジネスタグ5件中4件がneeds_review（`negotiate`/`implement`/`accommodate`/`preliminary`）。同一タグサンプルのLIMITのみを30→100に広げた中間版でも改善せず（5件中4件のまま、`negotiate`/`obligation`/`facilitate`/`allocate`——いずれもDB全体で上位100件にも入らない古い単語だったため）。`getSameTagExistingWords`導入後: ビジネスタグ5件中0件・日常会話タグ5件中0件がneeds_review（いずれも構造チェックの完全一致重複は0件）。テスト用に生成した4バッチ（コミットはしていない）は検証後にローカルDBから削除済み。
  - テスト: `npm test`（283件全て成功、282件から+1件——`generateVocab.test.ts`に同一タグサンプルの回帰テストを追加）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）。
- 2026-08-12: CEFR-J Wordlistを用いた語彙選定候補の調査（21章）を実施。**調査・設計のみ、DB変更・データ投入は無し**。
  - `openlanguageprofiles/olp-en-cefrj`（CEFR-Jプロジェクト公認GitHubミラー）を実際に取得し、CSV構造（`headword,pos,CEFR,...`、A1〜B2の4レベル、7,798行・ユニーク見出し語6,867）とライセンス条件（引用すれば研究・商用利用無償、著作権はTUFS投野研究室）を確認。Octanove作成のC1/C2補完データ（別ライセンス、CC BY-SA 4.0）も確認した。
  - ローカルDBの既存語彙159語と実際に突き合わせ、53%（85語）がCEFR-Jと重複、47%（74語）はCEFR-Jに無い独自語（イディオム・句動詞・TOEICビジネス特有語）であることを確認。既存語のCEFRレベル分布はB1/B2が81%を占め、依頼にあった「B1〜B2が目安」という想定を実データで裏付けた。
  - 候補語数の規模感: B1〜B2に絞ったCEFR-J見出し語4,906語のうち、既存DBに無いものは4,843語。
  - 取り込み方針案（21.3）・未解決の論点（21.4、複数語フレーズの扱い・ビジネス文脈適合性フィルタ不在など）をDESIGN.mdに記録。実装は次セッションでの別途指示待ち。
- 2026-08-12: Supabase APIキー新方式（`sb_secret_`）への移行準備調査を実施（23章）。**コード変更・`.env`変更・新キー発行は一切無し、DESIGN.mdへの記録のみ**。
  - service_roleキーの参照箇所を全て洗い出し（`env.ts`/`supabaseAdmin.ts`/`ask-tutor`Edge Function/テストのモック文字列）、Supabase公式ドキュメントを確認した上で、新旧キーが同一のHTTPヘッダ経由で使われる設計のため、コード側の変更は想定より小さい（`.env`の値を差し替えるだけで変数名変更は不要）と判断した。
  - 移行手順案（23.3、新キー発行→ローカル動作確認→Edge Function実機確認→旧キー失効）とユーザー側作業（23.4）を記録。Edge Function内部の予約変数の扱い・SDKバージョン対応の2点は公式ドキュメントから完全には断定できず、未確認事項として23.5に明記した。
- 2026-08-12: 上記の`sb_secret_`移行の動作確認を実施（23.5更新）。ユーザーがSupabaseダッシュボードで新キーを発行し、ローカル`.env`の`SUPABASE_SERVICE_ROLE_KEY`を新キーに書き換え済みの状態を対象に検証した（**旧キーはまだ失効させていない、`.env`のこれ以上の書き換えも行っていない**）。
  - **`createSupabaseAdminClient()`**: 一時検証スクリプト（確認後に削除、コミットせず）でクラウドDB（`qpfmssdhbtlbudqburki`）のRLS deny-allテーブル（`generation_batch_items`=500件・`generation_batches`=33件）に対する実データ取得に成功し、新キーが引き続きservice_role権限（RLSバイパス）を持つことを直接証明した。`@supabase/supabase-js@^2.112.2`の新方式キー対応も確認できた。
  - **`ask-tutor` Edge Function**: 使い捨てテストユーザー（Admin API作成・確認後削除、22.5と同じ手順）で認証込みのエンドツーエンド確認を実施。HTTP 200・正常な回答、`tutor_usage`への行作成（service_role経由のRPC呼び出し成功）を確認した。ただしこの確認は**旧キーがまだ有効な状態**で行っているため、「新キーが使われている」のか「旧キーが裏で使われ続けている」のかを完全には区別できていない——旧キー失効の直前に同じ確認を再実施することを23.5に推奨事項として明記した。
  - **想定外の発見**: ローカル`.env`の`SUPABASE_URL`（`http://127.0.0.1:54321`）と、クラウド向けに新規発行された`SUPABASE_SERVICE_ROLE_KEY`の組み合わせが不一致になっており、ローカルSupabaseがこれをエラーにせず黙って空集合を返すことを確認した。`npm run backfill:auto -- --dry-run`等、`scripts/content-generation/`配下のCLIをこのままローカル向けに実行すると、気づかれないまま不正確な結果（例:「閾値未満のカテゴリ/タグはありません」という誤った安全宣言）を返すリスクがある。対応方針の選択肢を23.5に記録し、ユーザーの判断待ちとした。
  - テスト: `npm test`（283件、既存のモック文字列は実キーの影響を受けないことを確認、リグレッション無し）。`npm run lint`・`npm run typecheck`・`npm run typecheck:scripts`は今回コード変更が無いため未実施（DESIGN.mdのみの変更）。
  - **旧キーの失効はまだ行っていない**（ユーザーの明示的な指示を待つ、23.4参照）。
- 2026-08-12: 上記の想定外の発見（`.env`のURL/キー不一致）に対応し、`.env`運用を「常にクラウドを指す」方針に統一した（23.6）。
  - `.env`の`SUPABASE_URL`をクラウドプロジェクトURLに書き換え、`SUPABASE_SERVICE_ROLE_KEY`（既にクラウド向け）と揃えた。
  - `env.ts`の`loadEnv()`に接続先ログ・警告（`logConnectionTarget`）を追加。既知のクラウドURLと一致すれば通常ログ、ローカル/想定外URLなら`console.warn`で警告する。複数回呼ばれても1回だけ出力する。
  - ローカルでの動作確認は`.env`を書き換えず、コマンド実行時の一時的な環境変数上書きで行う運用とし、CLAUDE.mdに新設した「`.env`運用ルール」節に明記した（既存の`db reset`前バックアップ規約とも矛盾しないことを確認）。
  - テスト: `scripts/content-generation/env.test.ts`（新規6件）追加。`npm test`（289件、283件から+6件）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）全て通過。
- 2026-08-12: ドリル・SRSの出題ロジックを読み取り調査（実装変更なし）。VocabReviewはFSRSの`due_at`に基づき正解が続くほど出題頻度が下がる一方、GrammarDrill/MixedDrillは過去の正誤を出題選択に一切反映しない完全ランダム抽選であること、同一セッション内での誤答再出題は3画面とも無いこと、24章（当時の番号）の未決事項「出題順ロジック」の記載はstaleではなく現状のランダム実装を正確に表していることを確認した。DESIGN.mdとコードの間に矛盾は見つからなかった。
- 2026-08-12: Home画面をclaude.ai Design Canvasの1c案「ロッカースイッチ盤」に基づいてリデザインした（24章）。`src/routes/Home.tsx`を全面書き換え、既存の計器盤デザイントークン（`index.css`）にマッピングして実装。既存`Home.test.tsx`は無改修のまま全件通過。`npm test`（289件）・`npm run lint`（0件）・`npm run typecheck`（0件）全て通過。使い捨てテストユーザー（ローカルSupabase）でブラウザ実地確認済み、検証用スクリプト・テストユーザーは作業後に削除（コミット対象外）。旧「未決事項」章を24→27に繰り下げ。
- 2026-08-12: 旧`service_role`キー失効前の最終確認を実施（23.5追記、DB・`.env`・キー自体の変更は無し）。`.env`のクラウド統一状態を再確認（URL/キーとも一致）。`.env`クラウド統一（23.6・commit `8394feb`）後に`createSupabaseAdminClient`/`ask-tutor`の再確認が未実施だったため、一時検証スクリプト（作業後削除）で実施——オーバーライド無しの実際の`.env`のもとで`generation_batch_items=500`・`generation_batches=33`（初回確認と一致）、`ask-tutor`はHTTP 200で成功。**その過程でSupabase公式ドキュメント・GitHub issue `supabase/supabase#37648`を調査し、Edge Functionsの予約環境変数`SUPABASE_SERVICE_ROLE_KEY`はレガシーキー専用で新`sb_secret_`キーには自動更新されず、レガシーキーを無効化するとこの変数に依存するEdge Functionが動作しなくなるという実例報告を確認した**。`ask-tutor/index.ts`はこの予約変数を直接参照しているため、`.env`側の移行（23.6）とは無関係に旧キー失効の影響を受ける。**結論: 旧キーの失効は現時点で非推奨**。安全に失効させるには`ask-tutor/index.ts`の新キー対応実装・再デプロイ・再確認が別途必要（ユーザーの確認を要する変更のため未着手）。
- 2026-08-12: `ask-tutor/index.ts`を予約変数`SUPABASE_SERVICE_ROLE_KEY`依存から非予約名のカスタムシークレット`SB_SECRET_KEY`依存に変更し、クラウドへ再デプロイした（23.7、ユーザーの明示的な承認を得て実施）。当初提案していた「リクエストの`apikey`ヘッダーから鍵を取得する」方式は、フロントエンドが送る`apikey`がanon/publishableキーであり、`increment_tutor_usage`RPC（service_role専用にEXECUTE権限をREVOKE済み）の呼び出しが壊れることが実装前の調査で判明したため採用せず、ユーザーに確認の上で非予約名カスタムシークレット方式に変更した。`supabase secrets set`で`SB_SECRET_KEY`（新`sb_secret_`キーの値）を新規登録→`supabase functions deploy ask-tutor`で再デプロイ→使い捨てテストユーザーによるE2E確認（HTTP 200・`tutor_usage.request_count`が意図通り`1`に増加）まで実施し成功。ローカル開発用`supabase/functions/.env.example`・`.env`（gitignore対象）も同様に更新。**この変更により`ask-tutor`は旧キーに一切依存しなくなり、`scripts/content-generation`（23.6で移行済み）と合わせて、旧`service_role`キーを失効させても問題ないと判断した**（失効操作自体はユーザーがSupabaseダッシュボードで実施）。

## 1. 要件概要

- 目的: 文法・語彙強化、目標スコア900点
- 複数端末で同期（Supabase / Postgres）
- 問題データはGemini APIで事前バッチ生成しDBにストック。リアルタイム生成はしない
- MVP機能:
  1. 語彙SRS（間隔反復）
  2. 文法カテゴリ別ドリル
  3. 誤答を「文法カテゴリ×正答率」「語彙タグ×正答率」でタグ付けする弱点分析ダッシュボード
- フロントエンド: React Webアプリ（将来スマホ対応）

---

## 2. プロジェクト構成

現時点では `apps/web` 単一構成。pnpm workspacesへのモノレポ移行は、将来モバイル版（Expo/React Native）を追加するタイミングで検討する。

```
toeic-app/
├── src/
│   ├── features/
│   │   ├── auth/
│   │   ├── vocab-srs/          # ①語彙SRS（ts-fsrs連携）
│   │   ├── grammar-drill/      # ②文法ドリル
│   │   └── weak-points/        # ③弱点分析ダッシュボード
│   ├── components/
│   ├── lib/
│   │   ├── supabase.ts
│   │   └── fsrs.ts             # ts-fsrs初期化・パラメータ管理ラッパー
│   ├── hooks/
│   ├── routes/
│   └── App.tsx
├── scripts/
│   └── content-generation/     # Gemini APIバッチ生成（同一package.json内でtsx実行）
│       ├── generate_vocab.ts
│       ├── generate_grammar.ts
│       ├── prompts/
│       └── validators/
├── supabase/
│   ├── migrations/
│   ├── seed.sql                # grammar_categories初期データ
│   └── config.toml
├── index.html
├── package.json
└── vite.config.ts
```

**決定理由**: `content-generation`スクリプトはフロントと同一リポジトリだが、Gemini APIキーはこのスクリプト実行環境（CI/ローカル）にのみ持たせ、クライアントには一切露出させない。

---

## 3. SRSアルゴリズム: FSRS

- SM-2ではなくFSRS（`ts-fsrs`ライブラリ）を採用。予測精度が高く、実装コストもSM-2と大差ないため。
- **desired_retention: 0.92**（デフォルトの0.9より高め）。900点目標のため復習負荷増よりも定着率を優先する判断。
- ユーザーごとのFSRSパラメータ最適化は将来対応（`user_fsrs_parameters`テーブルを予め用意、MVPではデフォルト重みを使用）。

---

## 4. 文法カテゴリ（9分類、初期セット）

```
時制 / 態（能動・受動）/ 仮定法 / 関係詞 / 不定詞・動名詞 /
前置詞 / 接続詞 / 比較 / 品詞（語彙問題との境界整理用）
```

`grammar_categories.parent_id` で階層を持たせており、後からサブカテゴリへの細分化・カテゴリ統合が可能な設計（既存の問題・解答ログを壊さずに再カテゴライズできる）。

---

## 5. 弱点分析ダッシュボード

文法・語彙の両面が揃わないと弱点分析として片手落ちになるため、以下2軸を両方表示する。

- **文法カテゴリ別正答率**: `user_grammar_category_stats` ビュー
- **語彙タグ別正答率**: `user_vocab_tag_stats` ビュー（SRSレビューのgrade/ratingを正誤に変換して集計）

---

## 6. DBスキーマ（Supabase / Postgres）

### 6.1 プロフィール

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  target_score int not null default 900,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### 6.2 バッチ生成管理

```sql
create type content_type as enum ('vocab', 'grammar');

create table generation_batches (
  id uuid primary key default gen_random_uuid(),
  content_type content_type not null,
  model_name text not null,
  prompt_version text not null,
  requested_count int not null,
  generated_count int not null default 0,
  status text not null default 'pending',
  notes text,
  created_at timestamptz not null default now()
);
```

### 6.3 語彙SRS（FSRS）

`ts-fsrs`の`Card`/`ReviewLog`インターフェースにフィールド名を合わせている。

```sql
create table vocab_words (
  id uuid primary key default gen_random_uuid(),
  word text not null,
  part_of_speech text,
  meaning_ja text not null,
  example_sentence_en text not null,
  example_sentence_ja text,
  toeic_band int,
  frequency_rank int,
  batch_id uuid references generation_batches(id),
  created_at timestamptz not null default now(),
  unique (word, part_of_speech)
);

create table vocab_tags (
  id serial primary key,
  name text not null unique
);

create table vocab_word_tags (
  vocab_word_id uuid references vocab_words(id) on delete cascade,
  tag_id int references vocab_tags(id) on delete cascade,
  primary key (vocab_word_id, tag_id)
);

-- FSRSカード状態（ts-fsrs: New=0, Learning=1, Review=2, Relearning=3）
create type fsrs_state as enum ('new','learning','review','relearning');

create table user_vocab_progress (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  vocab_word_id uuid not null references vocab_words(id) on delete cascade,
  state fsrs_state not null default 'new',
  due_at timestamptz not null default now(),
  stability numeric(10,4) not null default 0,
  difficulty numeric(10,4) not null default 0,
  elapsed_days numeric(10,2) not null default 0,
  scheduled_days numeric(10,2) not null default 0,
  reps int not null default 0,
  lapses int not null default 0,
  last_review_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (user_id, vocab_word_id)
);
create index idx_user_vocab_progress_due on user_vocab_progress(user_id, due_at);

-- FSRS ReviewLog相当（Rating: Again/Hard/Good/Easy）
create type fsrs_rating as enum ('again','hard','good','easy');

create table vocab_review_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  vocab_word_id uuid not null references vocab_words(id) on delete cascade,
  rating fsrs_rating not null,
  state fsrs_state not null,
  due_at timestamptz not null,
  stability numeric(10,4) not null,
  difficulty numeric(10,4) not null,
  elapsed_days numeric(10,2),
  last_elapsed_days numeric(10,2),
  scheduled_days numeric(10,2),
  response_time_ms int,
  reviewed_at timestamptz not null default now()
);
create index idx_vocab_review_logs_user_time on vocab_review_logs(user_id, reviewed_at);

-- ユーザー個別のFSRSパラメータ（将来: 十分なレビュー数が貯まったユーザーから最適化）
create table user_fsrs_parameters (
  user_id uuid primary key references auth.users(id) on delete cascade,
  weights jsonb not null,
  desired_retention numeric(4,3) not null default 0.92,
  optimized_at timestamptz,
  updated_at timestamptz not null default now()
);
```

### 6.4 文法ドリル（階層対応）

```sql
create type toeic_part as enum ('part5','part6','part7','listening','general');

create table grammar_categories (
  id serial primary key,
  code text not null unique,
  name_ja text not null,
  parent_id int references grammar_categories(id),
  part toeic_part not null default 'part5',
  sort_order int not null default 0
);

create table grammar_questions (
  id uuid primary key default gen_random_uuid(),
  category_id int not null references grammar_categories(id),
  question_text text not null,
  choices jsonb not null,
  correct_index smallint not null,
  explanation text,
  difficulty smallint not null default 3,
  batch_id uuid references generation_batches(id),
  created_at timestamptz not null default now()
);
create index idx_grammar_questions_category on grammar_questions(category_id);

create table user_grammar_attempts (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  question_id uuid not null references grammar_questions(id) on delete cascade,
  selected_index smallint not null,
  is_correct boolean not null,
  response_time_ms int,
  answered_at timestamptz not null default now()
);
create index idx_user_grammar_attempts_user_time on user_grammar_attempts(user_id, answered_at);
create index idx_user_grammar_attempts_question on user_grammar_attempts(question_id);
```

**初期シードデータ**

```sql
insert into grammar_categories (code, name_ja, sort_order) values
  ('tense',              '時制',              1),
  ('voice',              '態（能動・受動）',   2),
  ('subjunctive',        '仮定法',            3),
  ('relative_clause',    '関係詞',            4),
  ('infinitive_gerund',  '不定詞・動名詞',     5),
  ('preposition',        '前置詞',            6),
  ('conjunction',        '接続詞',            7),
  ('comparison',         '比較',              8),
  ('part_of_speech',     '品詞',              9);
```

### 6.5 弱点分析ビュー（文法 + 語彙）

```sql
-- 文法カテゴリ別正答率
create view user_grammar_category_stats as
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

-- 語彙タグ別正答率
-- rating in ('good','easy') を正答、('again','hard') を誤答とみなして集計
create view user_vocab_tag_stats as
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
```

`parent_id`を含めているため、将来サブカテゴリを追加しても親カテゴリ単位のロールアップ集計（再帰CTE）に対応できる。

---

## 7. RLS（Row Level Security）ポリシー

### 方針

- ユーザー個人データ（`profiles`, `user_vocab_progress`, `vocab_review_logs`, `user_fsrs_parameters`, `user_grammar_attempts`）→ 本人（`auth.uid()`）のみ読み書き可
- コンテンツデータ（`vocab_words`, `vocab_tags`, `vocab_word_tags`, `grammar_categories`, `grammar_questions`, `generation_batches`）→ 認証済みユーザーはSELECTのみ。INSERT/UPDATE/DELETEはservice_role（バッチ生成スクリプト）のみ

### SQL

```sql
-- 全対象テーブルでRLSを有効化
alter table profiles enable row level security;
alter table user_vocab_progress enable row level security;
alter table vocab_review_logs enable row level security;
alter table user_fsrs_parameters enable row level security;
alter table user_grammar_attempts enable row level security;
alter table vocab_words enable row level security;
alter table vocab_tags enable row level security;
alter table vocab_word_tags enable row level security;
alter table grammar_categories enable row level security;
alter table grammar_questions enable row level security;
alter table generation_batches enable row level security;

-- ── ユーザー個人データ: 本人のみ読み書き可 ──────────────────

create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);
create policy "profiles_insert_own" on profiles
  for insert with check (auth.uid() = id);
create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "user_vocab_progress_select_own" on user_vocab_progress
  for select using (auth.uid() = user_id);
create policy "user_vocab_progress_insert_own" on user_vocab_progress
  for insert with check (auth.uid() = user_id);
create policy "user_vocab_progress_update_own" on user_vocab_progress
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "user_vocab_progress_delete_own" on user_vocab_progress
  for delete using (auth.uid() = user_id);

create policy "vocab_review_logs_select_own" on vocab_review_logs
  for select using (auth.uid() = user_id);
create policy "vocab_review_logs_insert_own" on vocab_review_logs
  for insert with check (auth.uid() = user_id);
-- レビュー履歴は追記のみ。update/deleteポリシーは意図的に作成しない。

create policy "user_fsrs_parameters_select_own" on user_fsrs_parameters
  for select using (auth.uid() = user_id);
create policy "user_fsrs_parameters_insert_own" on user_fsrs_parameters
  for insert with check (auth.uid() = user_id);
create policy "user_fsrs_parameters_update_own" on user_fsrs_parameters
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "user_grammar_attempts_select_own" on user_grammar_attempts
  for select using (auth.uid() = user_id);
create policy "user_grammar_attempts_insert_own" on user_grammar_attempts
  for insert with check (auth.uid() = user_id);
-- 解答履歴も追記のみ。update/deleteポリシーは意図的に作成しない。

-- ── コンテンツデータ: 認証済みユーザーはSELECTのみ ────────────
-- INSERT/UPDATE/DELETEポリシーは作成しない
-- （service_roleはRLSをバイパスするため、バッチ生成スクリプトはservice_roleキーで書き込む）

create policy "vocab_words_select_authenticated" on vocab_words
  for select using (auth.role() = 'authenticated');

create policy "vocab_tags_select_authenticated" on vocab_tags
  for select using (auth.role() = 'authenticated');

create policy "vocab_word_tags_select_authenticated" on vocab_word_tags
  for select using (auth.role() = 'authenticated');

create policy "grammar_categories_select_authenticated" on grammar_categories
  for select using (auth.role() = 'authenticated');

create policy "grammar_questions_select_authenticated" on grammar_questions
  for select using (auth.role() = 'authenticated');

-- generation_batchesはユーザーに見せる必要がないため、authenticatedへのSELECTも許可しない
-- （service_roleのみがアクセス。ポリシーを作らない = デフォルト拒否）
```

**補足**:
- `generation_batches`はSELECTポリシーを一切作らないことで、authenticatedロールからは完全に見えない状態にする（管理用データのため）。
- ビュー（`user_grammar_category_stats`, `user_vocab_tag_stats`）はベーステーブルのRLSを継承するため、追加のポリシーは不要（Postgresのview RLS挙動により、実行ユーザーの権限で元テーブルのポリシーが評価される）。

---

## 8. Gemini APIバッチ生成パイプライン

「生成 → 自動チェック → 必要なら人力レビュー → 本番反映」の4段階フローとする。`generation_batches`には集計情報のみ記録し、生成された問題そのもの（生JSON・検証結果）は新設の `generation_batch_items` にステージングする。`grammar_questions` / `vocab_words` への反映（コミット）は、承認済みアイテムのみを対象にservice_role経由で行う。

### 8.1 全体フロー

```mermaid
flowchart LR
    A["生成トリガー\ngenerate_grammar.ts / generate_vocab.ts"] --> B["Gemini API\n構造化JSON生成"]
    B --> C["generation_batch_items に1問ずつ保存\nstatus = pending_validation"]
    C --> D{"構造チェック\n(スキーマ / 選択肢重複 / DB類似重複)"}
    D -- NG --> H["status = needs_review"]
    D -- OK --> E["一意性セルフチェック\n(2回目のGemini呼び出し)"]
    E -- 不一致 or 曖昧あり --> H
    E -- 一致・曖昧なし --> F["status = auto_passed"]
    H --> G["人力レビュー\n(CLIスクリプト)"]
    G -- 承認 --> F
    G -- 却下 --> I["status = rejected"]
    F --> J["commit_batch.ts (service_role)"]
    J --> K[("grammar_questions /\nvocab_words へ反映")]
    J --> L["status = committed\ngeneration_batches の集計を更新"]
```

**設計判断**: 自動チェックを通過したアイテム（`auto_passed`）も人力レビューを経ずに直接コミット対象にする。理由は、文法問題は「一意性セルフチェック」で二重に正解を検証しているため誤り率が十分低いと見込めること、900点対策では出題量の確保も重要なため全問人力レビューはボトルネックになること。品質に懸念が出た場合は`auto_passed`も一律`needs_review`に回す運用に切り替えられるよう、判定ロジックは1箇所（`validate_batch.ts`）に集約する。

### 8.2 スキーマ拡張

```sql
-- generation_batches のステータスを厳密化 + 集計カラム追加
create type batch_status as enum (
  'pending', 'generating', 'validating', 'needs_review', 'completed', 'failed'
);

alter table generation_batches
  alter column status type batch_status using status::batch_status,
  alter column status set default 'pending',
  add column committed_count int not null default 0,
  add column needs_review_count int not null default 0,
  add column rejected_count int not null default 0;

-- 生成された1問ごとのステージングテーブル
create type item_status as enum (
  'pending_validation',
  'auto_passed',
  'needs_review',
  'approved',
  'rejected',
  'committed'
);

create table generation_batch_items (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references generation_batches(id) on delete cascade,
  raw_payload jsonb not null,              -- Geminiが返した生JSON(1問分)
  status item_status not null default 'pending_validation',
  validation_errors jsonb,                 -- 構造チェックで検出した問題点
  self_check_payload jsonb,                -- 一意性セルフチェック(2回目のLLM呼び出し)の結果
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_notes text,
  committed_id uuid,                       -- 反映先(grammar_questions.id / vocab_words.id)
  created_at timestamptz not null default now()
);
create index idx_generation_batch_items_batch on generation_batch_items(batch_id);
create index idx_generation_batch_items_status on generation_batch_items(status);

-- 近似重複検出用（DB内の既存問題・単語との類似度チェックに使用）
create extension if not exists pg_trgm;
create index idx_grammar_questions_text_trgm on grammar_questions using gin (question_text gin_trgm_ops);
create index idx_vocab_words_word_trgm on vocab_words using gin (word gin_trgm_ops);
```

**RLS**: `generation_batch_items`は管理用データのため、SELECTポリシーを含め一切ポリシーを作成しない（デフォルト拒否）。既存の`generation_batches`同様、service_roleのみがアクセスする。

```sql
alter table generation_batch_items enable row level security;
-- ポリシーを作成しない = authenticated/anonからは完全に不可視
```

### 8.3 プロンプトテンプレート

`scripts/content-generation/prompts/`配下にカテゴリ横断の共通テンプレートを1つずつ持ち、呼び出し時にプレースホルダーを埋め込む。テンプレート自体の改訂は`prompt_version`（例: `grammar_v1.1`）でトラッキングする。

#### 文法問題（`prompts/grammar.md`）

対象カテゴリは9分類（時制／態／仮定法／関係詞／不定詞・動名詞／前置詞／接続詞／比較／品詞）を`{{category_code}}` / `{{category_name_ja}}`として注入する。

```
あなたはTOEIC L&R対策教材の作成者です。
以下の条件でPart5（短文穴埋め）形式の文法問題を{{count}}問作成してください。

【出題カテゴリ】
{{category_name_ja}}（{{category_code}}）
※このカテゴリの文法知識のみが正解の決め手になるようにしてください。
　他の文法事項が同時に論点になる問題は避けてください。

【難易度】
5段階中 {{difficulty}}（1=易しい、5=難しい。TOEIC {{target_band}}点レベル目安）

【出題条件】
- ビジネスシーンを想定した自然な英文にする
- 空所は1箇所、選択肢は4つ、正解は必ず1つのみ
- 4つの選択肢は互いに異なる語句にする
- 正解以外の3択は文法的に明確に誤りであること（意味は通るが文法的に誤り、
  品詞違い、時制違いなど）。文脈次第で正解になり得る選択肢を含めない
- 文脈情報（時を表す副詞句など）を十分に与え、正解が一意に定まるようにする

【重複回避】
以下は既に出題済みの問題文サンプルです。構文・論点が類似する問題は作らないでください。
{{existing_question_samples}}

【出力形式】
説明文は一切付けず、以下のJSON Schemaに厳密に従うJSON配列のみを出力してください。
{{json_schema}}

explanationには、なぜ正解が正しく他の3択がそれぞれ何故誤りかを日本語で簡潔に記述してください。
```

出力JSON Schema（Gemini `responseSchema`にそのまま渡す）:

```json
{
  "type": "ARRAY",
  "items": {
    "type": "OBJECT",
    "properties": {
      "question_text":  { "type": "STRING" },
      "choices":        { "type": "ARRAY", "items": { "type": "STRING" }, "minItems": 4, "maxItems": 4 },
      "correct_index":  { "type": "INTEGER" },
      "explanation":    { "type": "STRING" },
      "difficulty":     { "type": "INTEGER" },
      "category_code":  { "type": "STRING" }
    },
    "required": ["question_text", "choices", "correct_index", "explanation", "difficulty", "category_code"],
    "propertyOrdering": ["question_text", "choices", "correct_index", "explanation", "difficulty", "category_code"]
  }
}
```

#### 語彙（`prompts/vocab.md`）

対象タグ（例: ビジネス／日常会話／Part7頻出）を`{{tag_name}}`として注入する。

```
あなたはTOEIC L&R対策教材の作成者です。
以下の条件で語彙学習用のカード情報を{{count}}件作成してください。

【テーマ】
{{tag_name}}

【難易度】
TOEIC {{target_band}}点レベルの頻出語彙を中心に選定してください。

【出力条件】
- 見出し語（word）は原形（動詞は原形、名詞は単数形）を基本とする
- meaning_jaは文脈に応じた最も一般的な訳語を1〜2個
- example_sentence_enはビジネスシーンを想定した自然な例文とし、
  必ずwordを文中でpart_of_speechの品詞として使用すること
- example_sentence_jaはexample_sentence_enの自然な日本語訳

【重複回避】
以下は登録済みの単語です。同一語は生成しないでください。
{{existing_words}}

【出力形式】
説明文は一切付けず、以下のJSON Schemaに厳密に従うJSON配列のみを出力してください。
{{json_schema}}
```

出力JSON Schema:

```json
{
  "type": "ARRAY",
  "items": {
    "type": "OBJECT",
    "properties": {
      "word":                 { "type": "STRING" },
      "part_of_speech":       { "type": "STRING" },
      "meaning_ja":           { "type": "STRING" },
      "example_sentence_en":  { "type": "STRING" },
      "example_sentence_ja":  { "type": "STRING" },
      "toeic_band":           { "type": "INTEGER" },
      "tags":                 { "type": "ARRAY", "items": { "type": "STRING" } }
    },
    "required": ["word", "part_of_speech", "meaning_ja", "example_sentence_en", "example_sentence_ja", "toeic_band", "tags"],
    "propertyOrdering": ["word", "part_of_speech", "meaning_ja", "example_sentence_en", "example_sentence_ja", "toeic_band", "tags"]
  }
}
```

`{{existing_question_samples}}`（文法）はDB上の同一カテゴリの直近N件（目安30件）を取得して埋め込む。

`{{existing_words}}`（語彙）は**対象タグの単語（直近50件）とタグを問わずDB全体の単語（直近100件）の両方**を取得し、重複排除して埋め込む（`generateVocab.ts`の`getExistingWords`＝`getSameTagExistingWords`＋`getDbWideExistingWords`のマージ）。

- **2026-08-10の修正（クロスタグ重複の解消）**: 当初は文法と同じく同一タグ限定（`getExistingWordsForTag`）だったが、既に別タグでコミット済みの単語をGeminiが再提案し無駄なneeds_reviewを発生させる不具合（ビジネス/日常会話/Part7頻出のバックフィルで`itinerary`等が繰り返し発生）が実データで見つかったため、DB全体を見る形（`getExistingWords`）に修正した。
- **2026-08-12の修正（タグ自身の基本語が古くなって外れる問題の解消）**: DB全体（直近100件、当初は30件）だけに広げた後も、ローカルDBで実際に検証バッチを生成したところneeds_reviewが5件中4件発生する事例が再現した。原因は「対象タグが最初に登録された基本的な単語（例: ビジネスタグのnegotiate/implement/accommodate等）」が、後から他タグへ大量投入されるほど相対的に古くなり、直近100件という窓からも外れてしまうこと（DB全体を見る2026-08-10の修正だけでは解決しない別種の問題）。対象タグ自身の単語を`getSameTagExistingWords`で別枠で必ず含めることで解消した（`vocab_word_tags`経由の2段階クエリ、`src/lib/queries/vocab.ts`の`getWordIdsForTag`と同じパターン）。修正後、同一条件（ビジネスタグ・5件生成）で検証したところneeds_reviewは0件になった（ローカルDBで実施、詳細は更新履歴参照）。
- 文法問題はカテゴリごとに独立した出題ドメインでありクロスカテゴリの重複はそもそも起きにくいため、文法側（`{{existing_question_samples}}`）は同一カテゴリ限定のままとした（両者で対称にする必要は無いという判断）。

いずれもプロンプト内の除外リストだけでは件数が増えるほど機能しなくなるため、8.4の近似重複検出をセーフティネットとして必ず併用する。

**パフォーマンスについて**: `getExistingWords`は`vocab_words`全件を毎回取得しているわけではなく、DB全体側は`order('created_at', {ascending: false}).limit(100)`、同一タグ側も`vocab_word_tags`で対象タグのIDに絞った上で`.limit(50)`と、いずれもLIMIT句で頭打ちにしている。バックフィル時点（数百〜低千件規模）はこれで実用上十分に高速であり、追加のキャッシュ層や専用インデックスは導入していない（2026-08-12判断）。`vocab_words.created_at`には現状専用インデックスが無いため、テーブルが数万件規模まで育った場合はソートコストが無視できなくなる可能性がある——その時点で`created_at`への索引追加（`create index on vocab_words(created_at desc)`のような一行の後方互換マイグレーション）で対応できる設計であり、現時点で先回りして対応する必要はないと判断した。

### 8.4 自動検証（バリデーション）

`generate_*.ts`が各アイテムを`generation_batch_items`に保存した直後、`validate_batch.ts`が以下を順に実行する。

**① 構造チェック（LLM呼び出しなし）**
- Zod等でJSON構造・型を再検証（Gemini側のresponseSchemaは強制力が弱いケースがあるため二重チェック）
- 文法問題: `choices`が4件・正規化（trim・大小文字統一）後も重複なし、`correct_index`が0〜3の範囲内、`explanation`が空でない
- 語彙: `word` + `part_of_speech`の組み合わせがDB内で未使用（`vocab_words`のunique制約と同条件を事前チェック）

**② 近似重複検出（DBクエリ、LLM呼び出しなし）**
```sql
-- 文法問題の例（vocab_wordsも同様にsimilarity検索）
select id, question_text, similarity(question_text, $1) as sim
from grammar_questions
where question_text % $1
order by sim desc
limit 5;
```
類似度が閾値（目安0.6）を超えるものが見つかった場合は`validation_errors`に記録し、`needs_review`に振り分ける。

**③ 一意性セルフチェック（2回目のGemini呼び出し）**
文法問題のみ対象。生成時とは独立に、正解を伏せた状態で同じ問題をGeminiに解かせ、自己採点との整合性を確認する。

```
以下の英文の空所に入る最も適切な語句を1つ選び、他の選択肢がなぜ不適切かも判定してください。

{{question_text}}
選択肢: {{choices}}

複数の選択肢が文法的・意味的に成立し得る場合は is_ambiguous を true にしてください。
```

出力JSON Schema:
```json
{
  "type": "OBJECT",
  "properties": {
    "solved_index":     { "type": "INTEGER" },
    "is_ambiguous":      { "type": "BOOLEAN" },
    "ambiguity_reason":  { "type": "STRING" },
    "confidence":        { "type": "NUMBER" }
  },
  "required": ["solved_index", "is_ambiguous", "confidence"]
}
```
判定ロジック: `solved_index === correct_index` かつ `is_ambiguous === false` かつ `confidence >= 0.8` → `auto_passed`。いずれか外れれば`needs_review`（`self_check_payload`に結果を保存し、レビュー時に参照）。

語彙は選択式問題ではないため一意性セルフチェックの対象外とし、代わりに①②のみで`auto_passed`とする（意味の正確性は人力レビューのサンプリングチェックに委ねる）。

### 8.5 人力レビュー

`needs_review`のアイテムのみが対象。専用UIは作らず、まずは軽量なCLIスクリプト（`review_batch.ts`）で運用する。

- `generation_batch_items`から`status = 'needs_review'`を一覧表示（`raw_payload` / `validation_errors` / `self_check_payload`を並べて表示）
- レビュー者が承認（`approved`）／却下（`rejected`）／その場で内容修正して承認、のいずれかを選択
- `reviewed_by`（`auth.uid()`相当の管理者ID）・`reviewed_at`・`review_notes`を記録

将来レビュー量が増えた場合は、`weak-points`ダッシュボードと同じReact基盤上に簡易レビュー画面を追加する想定（現時点ではCLIで十分）。

### 8.6 本番反映（コミット）

`commit_batch.ts`をservice_roleキーで実行し、`status in ('auto_passed', 'approved')`のアイテムのみを対象に処理する。

1. 文法問題: `category_code`から`grammar_categories.id`を解決し、`grammar_questions`にINSERT（`batch_id`を保持）
2. 語彙: `vocab_words`にINSERT（unique制約でレース時の重複はDB側で防止）。`tags`配列は`vocab_tags`を`upsert`し`vocab_word_tags`に紐付け
3. 成功したアイテムは`generation_batch_items.status = 'committed'`、`committed_id`に反映先IDを記録
4. `generation_batches`の`committed_count` / `needs_review_count` / `rejected_count`を更新し、全アイテムが`committed`または`rejected`になった時点で`status = 'completed'`に更新

クライアント（Reactアプリ）はこのフローに一切関与せず、`grammar_questions` / `vocab_words`への書き込み権限も持たない（7章のRLS方針どおり）。

---

## 9. フロントエンド設計

### 9.1 技術スタック

| 領域 | 選定 | 理由 |
|---|---|---|
| ビルド | Vite + React + TypeScript | 標準的で立ち上げが速い |
| ルーティング | React Router v7（data router） | 実績・ドキュメントが豊富。loaderでの認証ガードがシンプルに書ける。TanStack Routerの型安全性は魅力だが、MVPの規模では学習コスト対効果が見合わないため見送り |
| サーバー状態 | TanStack Query（React Query）+ `supabase-js` | Supabaseクエリを非同期関数としてラップし、キャッシュ・再検証・楽観的更新を統一的に扱える。複数端末同期の「他端末での更新をこの端末にも反映する」導線として`refetchOnWindowFocus`を活用 |
| ローカルUI状態 | Zustand | ドリルセッションの進行状態・モーダル開閉など、サーバー状態と分離すべき一時的な状態のみに限定して使用。Reduxほどの構成は不要 |
| スタイリング | Tailwind CSS | 弱点分析ダッシュボードのような数値・色分け表現をユーティリティクラスで素早く組める |
| フォーム | 素のcontrolled component | MVPの入力（解答選択・設定画面）は単純なため、react-hook-form等の導入は見送り |

### 9.2 認証

- Supabase Authを利用し、**メール+パスワード**と**Googleログイン（OAuth）**の2方式を提供する
  - メール+パスワード: オフラインでも迷わない基本手段として必須
  - Google OAuth: 導入コストが低く、初回登録の離脱率を下げるため追加
  - マジックリンクは将来検討（MVPでは見送り）
- セッションは`supabase-js`のデフォルト永続化（localStorage + 自動リフレッシュ）に任せる
- 複数タブ・複数端末間のログイン状態同期は`supabase.auth.onAuthStateChange`の購読で対応（トークン失効時に自動で`/login`へ）

### 9.3 ルーティング構成

```
/                       ダッシュボード（今日のSRS件数・直近正答率サマリ）
/login                  ログイン（メール+パスワード / Googleログイン）
/vocab/review           語彙SRSレビューセッション
/grammar                文法カテゴリ一覧（9カテゴリ）
/grammar/:categoryCode  カテゴリ別ドリル実行
/weak-points            弱点分析ダッシュボード（文法×語彙）
/settings               プロフィール設定（target_score等）
```

認証ガードはRouterの`loader`内でSupabaseセッションを確認し、未ログイン時は`/login`にリダイレクトする方式に統一する（コンポーネント側で毎回チェックしない）。

### 9.4 データフェッチ層の設計方針

- Supabaseクエリは`src/lib/queries/*.ts`に集約する（例: `getDueVocabCards(userId)`、`getGrammarQuestionsByCategory(categoryCode, count)`、`getWeakPointStats(userId)`）。コンポーネントから直接`supabase.from(...)`を呼ばない
- React Queryの`queryKey`規約を統一する（例: `['vocab-due', userId]`、`['grammar-stats', userId]`、`['vocab-tag-stats', userId]`）
- ミューテーション（SRSレビュー記録・文法解答記録）はSupabaseへのINSERT/UPSERT後、関連する`queryKey`を`invalidateQueries`する
- クライアントから直接書き込むテーブルは7章のRLS方針で許可された4つのみ（`user_vocab_progress`, `vocab_review_logs`, `user_grammar_attempts`, `user_fsrs_parameters`）。それ以外（`grammar_questions`等）への書き込みコードはそもそも作らない

### 9.5 FSRS統合（クライアント側）

- `ts-fsrs`はサーバーを介さずブラウザ内で直接実行する。復習後の次回due計算をクライアントで行い、結果を`user_vocab_progress`にUPSERT、`vocab_review_logs`にINSERTする
- 計算ロジックは`src/lib/fsrs.ts`に集約し、`computeNextState(currentCard, rating) => { state, stability, difficulty, due_at, ... }`という副作用のない純粋関数として実装する（単体テストしやすくするため）
- **複数端末での競合**: 同一カードをほぼ同時に2端末でレビューするケースは稀かつ実害が小さいため、楽観ロックは実装せず「後勝ち（last-write-wins）」で割り切る

### 9.6 弱点分析ダッシュボードのUI方針

- 「文法カテゴリ別正答率」「語彙タグ別正答率」の2セクションを並べて表示する（5章の方針どおり両軸を必ず表示）
- 正答率が低い項目を強調表示する（目安: 70%未満を警告色）
- 各カテゴリ／タグのカードから該当のドリル・SRSレビューへ直接遷移できる導線を設け、「弱点の可視化→即復習」の動線を短くする

### 9.7 将来のモバイル対応に向けた配慮

- `lib/queries/*.ts`・`lib/fsrs.ts`はReactに依存しない純粋なTypeScriptとして実装し、UIコンポーネントから分離する（React Native移行時に再利用する想定）
- `lib/supabase.ts`は環境変数経由の設定のみに依存させ、Web/モバイルでクライアント初期化コードを差し替えやすくする

---

## 10. 自動問題生成（在庫閾値ベースの自動補充）【設計案】

既存の8章パイプライン（生成→検証→レビュー→コミット）と、それを一括実行する`backfill_grammar_categories.ts`/`backfill_vocab_tags.ts`/`backfill_idiom.ts`（いずれも固定件数を一回だけ流す実行用スクリプト）の上に、「在庫が閾値を下回ったカテゴリ/タグを自動検出し、自動的に生成バッチを流し込む」CLIツールを追加する。

**前提として発見した既存実装とのズレ**: 本章の設計に着手する前提として実装（`schemas.ts`/`promptTemplates.ts`/`generateGrammar.ts`/`generateVocab.ts`）を精読したところ、DESIGN.md自体が実装から取り残されていることが分かった。具体的には、コード中のコメントが指す「13章（イディオム）」「16章（vocab_tags code分離）」「17章（リトライ戦略）」「19章（セルフチェック改訂）」はいずれも本ファイルには存在しない（本ファイルは§1〜§10のみで、それらの内容はコードコメントの中にしか残っていない）。また§8.2/8.3/8.4のSQL・JSON Schemaのスニペット自体も実装と食い違っている（例: §8.3の語彙JSON Schemaに`etymology_note`が無い、§8.4のセルフチェックJSON Schemaに`reasoning`が無い）。これは本タスクの範囲を大きく超える別件のドキュメント整備が必要な状態のため、**今回は全面的な追いつき作業はスコープ外とし、本章の追加と、直下の「未決事項」の該当項目の解消マークのみに留める**（ユーザーに別途報告する）。

### 10.1 「バッチ化」に関する前提の訂正

依頼文では「現状1件ずつ生成している」という前提だったが、実装を確認したところ**既にバッチ化されている**——`GRAMMAR_JSON_SCHEMA`/`VOCAB_JSON_SCHEMA`は元から`type: 'ARRAY'`で、`generateGrammarBatch`/`generateVocabBatch`は1回のGemini呼び出しで`count`件（既存の一回限りスクリプトでは文法15〜20件・語彙20件）をまとめて生成し、`generation_batch_items`に1件ずつ保存している。したがって本章での「バッチ化」対応は、新規のスキーマ変更ではなく以下の2点に絞られる。

1. 新設する自動補充オーケストレーター（10.4）が、不足数をそのまま1回の巨大なバッチとして要求するのではなく、**既定8件（5〜10件の目安の中央値）のサブバッチに分割**して複数回に分けて要求する（1回の出力トークン量を抑え、503・出力切れのリスクを下げるため）。
2. 出力配列のパース処理を、切り詰め検知・部分救済に対応した`generateJsonArray()`に切り替える（10.6）。

既存の`generateGrammarBatch`/`generateVocabBatch`の呼び出し口（1回のバッチ生成の粒度）自体はそのまま流用し、新規の巨大な改修は行わない。

### 10.2 在庫閾値の設計

- **判定単位**: 文法は`grammar_categories`の9カテゴリごとに`grammar_questions`の件数、語彙は`vocab_tags`の各タグ（イディオムを含む）ごとに`vocab_word_tags`経由の紐付け件数。
- **閾値の初期値**: 低水位閾値`30`件・目標補充後件数`40`件。根拠は既存の一回限りバックフィルスクリプトが採用していた目安をそのまま踏襲する——`backfill_grammar_categories.ts`は8カテゴリ×(15+15+10)=カテゴリあたり40問、`backfill_vocab_tags.ts`/`backfill_idiom.ts`は各タグ2バッチ×20語=40語、いずれもコメントで「既存語と合わせて30〜50問/語の目安」と明記されている。閾値30は「target40の下限に近い」水準として設定し、40を下回ってから即座に反応するのではなく実用上ある程度の余裕を持たせる。
- 実装は`--grammar-threshold`/`--vocab-threshold`（低水位）と将来的な目標値の両方をCLI引数で上書き可能にする（デフォルトは上記）。

### 10.3 在庫チェック（`inventoryCheck.ts`、新規）

- `checkGrammarInventory(supabase, threshold, target)`: `grammar_categories`を全件取得し、各`id`について`grammar_questions`を`{count:'exact', head:true}`で件数取得（`commitBatch.ts`の集計と同じSupabaseパターン）。`count < threshold`のカテゴリのみ`{categoryCode, categoryId, nameJa, count, shortfall: target - count}`として返す。
- `checkVocabInventory(supabase, threshold, target)`: `vocab_tags`を全件取得し、各`id`について`vocab_word_tags`を同様に件数取得。閾値未満のタグのみ返す（`code`が`VOCAB_TAG_CODES`に無い＝未知のタグは対象外としてスキップし警告ログを出す——`resolveTagId`が要求する事前登録済みcodeとの整合性を保つため）。
- 両関数とも副作用なし（読み取りのみ）。オーケストレーター側で結果を見てから生成を開始するかどうかを判断できるよう、`--dry-run`フラグでこのチェック結果だけを表示して終了できるようにする。

### 10.4 オーケストレーション（`autoBackfill.ts`、新規）

`checkGrammarInventory`/`checkVocabInventory`の結果を基に、閾値未満のカテゴリ/タグそれぞれについて「不足数を埋めるための生成タスク」を組み立て、10.5〜10.8の各機構を通して実行する。

- 文法の不足数は、既存の難易度3:4:5=15:15:10という比率（≒37.5%:37.5%:25%）を維持したまま不足数に按分し、8件（10.5参照）のサブバッチに分割する。
- 語彙（イディオム含む）の不足数はタグの区別のみで難易度の概念が無いため、単純に8件区切りでサブバッチ分割する。
- 各サブバッチは「生成→検証→(auto_passedのみ)コミット」まで自動で行う。**既存の一回限りバックフィルスクリプトと異なり、needs_reviewが発生してもそのタスクの残り・他のカテゴリ/タグの処理は中断しない**（10.9のエスカレーション方針参照）。理由: 本ツールは日常的な自動補充を想定しており、1件の曖昧な問題のために実行全体を止めるのは運用上望ましくないため。`commitBatch`は`auto_passed`/`approved`のアイテムのみを対象にする実装のため、needs_reviewが混在していても該当バッチの中の合格分だけを安全にコミットできる。
- 総生成件数の上限（10.10）に達した時点で、まだ処理していないカテゴリ/タグを「今回未着手」として要約に記録し、そこで打ち切る。

### 10.5 バッチ化（サブバッチサイズ）

不足数はデフォルト**8件**（5〜10件の中央値、ユーザー指定レンジ内）ごとのサブバッチに分割して`generateGrammarBatch`/`generateVocabBatch`を複数回呼び出す。`--batch-size`で上書き可能。10.1で述べたとおりJSON Schema自体は変更不要。

### 10.6 出力パースの耐性強化（`gemini.ts`拡張）

新規`generateJsonArray<T>()`を追加する（既存の`generateJson<T>()`は自己チェック等の単一オブジェクト用途にそのまま残し、後方互換を維持——挙動・シグネチャ変更なし）。

- Gemini呼び出し自体のリトライ・バックオフ（429/5xx対象、既存の5回・指数バックオフ）は`callGeminiWithRetry`として共通化し、`generateJson`/`generateJsonArray`の両方から使う。
- レスポンスの`candidates[0].finishReason`が`'MAX_TOKENS'`のとき、出力トークン上限による**途中切れ**として`truncated: true`を返す（`@google/genai`の型定義上`Candidate.finishReason`として公式に提供されているフィールドを使う——文字列のヒューリスティック判定はしない）。
- `JSON.parse`がそのまま失敗した場合（切り詰めに限らず、フォーマット崩れ全般に対応）、即座に全滅させず`extractCompleteArrayItems()`で**トップレベル配列要素ごとに完結しているものだけを部分的に救済**する（末尾の不完全な要素だけを破棄し、それより前の完結した要素は活かす）。ブレース/ブラケットの深さと文字列エスケープを追跡する軽量なスキャナで実装し、外部ライブラリは追加しない。
- 救済を使った場合は`parseRecovered: true`を返す。呼び出し元（`generateGrammarBatch`/`generateVocabBatch`）は`truncated || parseRecovered`のとき、`generation_batches.notes`に「依頼N件中M件のみ生成・保存」という注記を残す（人力調査時にSQLで原因を辿れるようにするため——20260812の教訓と同じ思想）。
- **`needs_review`には振り分けない**（設計判断・理由): 不完全な断片はそもそも有効なJSONではなく、`generation_batch_items.raw_payload`は`jsonb not null`で保存先自体が無い。「切り詰められた項目」を無理にレビュー対象として保存するのではなく、不足分は10.4のオーケストレーターが後続のサブバッチ生成でそのまま再要求する（10.7の縮小リトライとも自然に合流する）。

### 10.7 段階的なバッチサイズ縮小

`generateJsonArray`が（gemini.ts内の5回リトライを使い切った末に）429/5xx系のエラーで失敗した場合、オーケストレーター側で以下のリトライを行う（実装する。過度に複雑化しない範囲に収まると判断したため見送らない）。

- 現在のサブバッチサイズが最小件数（既定2件）より大きい場合、半分（切り上げ）に縮小して再要求する。半分に割った残りも別のサブ呼び出しとして処理する（例: 8件失敗→4件+4件で再試行）。
- 縮小は最大3段階まで（8→4→2）。それでも失敗する場合はそのカテゴリ/タグのその回の不足分を諦め、「今回生成できなかった件数」として要約に明記する（次回実行時に自然に再検出され再試行される）。
- 429/5xx以外の致命的エラー（カテゴリコード不正・認証エラー等、`gemini.ts`の`isRetryableError`が false と判定するもの）は縮小せず即座に上位へ伝播させ、実行全体を止める（既存の一回限りバックフィルスクリプトと同じ「予期しないエラーは中断」方針を踏襲）。

### 10.8 同時実行数の制限とスロットリング（`concurrencyPool.ts`、新規）

- 複数カテゴリ/タグのサブバッチを並行して処理できるよう、簡易な同時実行数制限プール（自前実装、外部ライブラリ追加なし）を新設する。
- **同時実行数の既定値: 2**。根拠: 既存の一回限りバックフィルスクリプトは完全直列（実質concurrency=1）で運用されており429の実害は報告されていない。本ツールは並行化による時短を狙う一方、単一APIキーのQPM（分あたりリクエスト数）制限を踏みやすくなるリスクとのバランスを取り、直列からの引き上げ幅を小さく抑えた。`--concurrency`で上書き可能。
- **最小リクエスト間隔の既定値: 1500ms**（ディスパッチ開始時刻の間隔）。根拠: 既存の直列実行ではDB往復+Gemini応答時間により呼び出し間に自然な間隔が生じていたが、concurrency>1にするとその自然な間隔が失われうるため、明示的に下限を設ける。`--throttle-ms`で上書き可能。

### 10.9 バッチ内自己重複チェック（`validateBatch.ts`拡張）

DB全体との近似重複検出（8.4②、既存）に加え、**同一バッチ内で生成された項目同士**の重複を検出する（従来は対象外だった経路）。

- 文法: `question_text`を`trim().toLowerCase()`で正規化し、バッチ内で先に出現した項目と一致する場合、後発の項目を`needs_review`に振り分ける。メッセージには先発項目の`question_text`を含め、どちらと重複したかを明示する（10.10のトレーサビリティ方針）。
- 語彙: 既存の`wordPosKey(word, part_of_speech)`をそのまま流用し、バッチ内で同じキーが再出現した場合に後発を`needs_review`にする。
- 検証ループの最初（構造チェックより前）に判定し、構造チェック・近似重複検出・セルフチェックをスキップして無駄なGemini呼び出し・DB問い合わせを避ける。

### 10.10 エラーの原因追跡性

- `validateBatch.ts`の予期しないエラーのcatch節が`String(error)`をそのまま使っており、Supabaseの`PostgrestError`のようなプレーンオブジェクトに対して`[object Object]`になりうる欠陥を発見したため修正する（`commitBatch.ts`が20260812発見の実例を受けて既に採用している`error instanceof Error ? error.message : JSON.stringify(error)`のパターンに揃える）。
- 上記の10.9の重複メッセージ、10.6の`notes`欄、10.7の縮小リトライの要約ログはいずれも「どのカテゴリ/タグの・どのサブバッチの・どの項目が」原因かを名指しする文面にする（件数の集計のみで終わらせない）。
- なお、ユーザーが挙げた「2026-08-12に1つのラベルバグでバッチ全体10件がneeds_reviewに巻き込まれた事例」そのものはコード上・DESIGN.md上に見つけられなかった。実際に見つかった2件の実例（`commitBatch.ts`のコメントに記録済み）は別の日付・別の内容だった: (a) 20260810、`category_code`が`"SUBJUNCTIVE"`や`"COMP"`のように大文字化・省略されてバッチ全体（10件）がneeds_review相当になった事例（`resolveCategoryId`のcasing正規化+prefix-matchで対応済み）、(b) 2026-08-12、`commitBatch.ts`のエラーメッセージが`[object Object]`になっていた事例（`error.message`優先抽出で対応済み）。本章の10.10はこの(b)と同種の欠陥が`validateBatch.ts`にも残っていたのを見つけて併せて直したもの。ユーザーの記憶と実際の記録に食い違いがあったため、念のためここに明記する。

### 10.11 実行トリガーとスコープ

- 今回はCLIスクリプト（`npx tsx scripts/content-generation/auto_backfill.ts`、`npm run backfill:auto`）による手動実行のみとし、cron等の定期実行は**スコープ外**とする。将来的には`node-cron`やSupabase Edge Functionsの`pg_cron`連携等が候補になるが、無人実行時のエラー通知・Gemini APIコストの上限管理を別途設計する必要があるため、次のステップ（11章）に記録する。
- CLI引数: `--dry-run`（在庫チェック結果のみ表示）、`--max-total`（10.12）、`--batch-size`（既定8）、`--concurrency`（既定2）、`--throttle-ms`（既定1500）、`--grammar-threshold`/`--vocab-threshold`（既定30）、`--grammar-target`/`--vocab-target`（既定40）、`--model`。

### 10.12 1回あたりの生成上限件数

- **既定値: 総計100件/回**。根拠: サブバッチサイズ8件なら約13回の生成呼び出し、文法問題はさらに1件ごとにセルフチェックの追加Gemini呼び出しが発生するため、最悪ケースで1回の実行あたり最大約225回（生成13回+セルフチェック最大100回+近似重複チェック等のDB呼び出し）のAPI呼び出しに収まる範囲として設定した。手動実行を前提とするツールとして、1回の実行が際限なくAPIコストを消費しないよう明示的に上限を設ける。`--max-total`で上書き可能。
- 上限に達した時点で残りのカテゴリ/タグは「未着手」として要約に記録し、次回実行（threshold未満のままなので自動的に再検出される）に持ち越す。

### 10.13 needs_reviewのエスカレート運用

既存方針（`backfill_grammar_categories.ts`等のコメントに記録済み）をそのまま踏襲する: エージェント（Claude Code）がまず`review_batch.ts`相当の判断（`applyReviewDecision`）で一次判断し、文法的・語彙的に明確に誤り/正しいと判断できるものはその場で承認/却下する。**本当に曖昧なケースのみユーザーにエスカレートする**。本ツール自体は新しいエスカレート機構を実装しない（既存の`review_batch.ts`CLIをそのまま使う）。

---

## 11. 間違いが多い問題への自動解説追加【設計案】

正答率・記憶定着率が低い問題/単語を自動検出し、既存の解説（`grammar_questions.explanation`/`vocab_words.etymology_note`）を上書きせず、補足の追加解説を自動生成してDBに反映する。10章のバッチ化・503対策・needs_reviewフローをそのまま流用する。

### 11.1 「間違いが多い」の判定基準

- **文法**: `user_grammar_attempts`を`question_id`単位で集計し、**正答率70%未満**（5章・9.6のWeakPointsダッシュボードの既存閾値と統一）かつ**試行回数5回以上**の問題を対象とする。5回未満は統計的信頼性が低いため対象外（依頼どおりの基準）。
- **語彙**: `vocab_review_logs`を`vocab_word_id`単位で集計し、`rating='again'`の比率が**30%以上**かつ**レビュー回数5回以上**の単語を対象とする。
  - **30%の根拠**: FSRSにおける`again`は「思い出せなかった」という明確な想起失敗を表す（`hard`は思い出せたが確信度が低いだけで想起失敗ではない、既存の6.5参照）。一般的にチューニングされたSRSデッキの定常状態でのagain率はおよそ10〜20%程度に収まることが多く、30%はそれより明確に高い水準——「単に少し苦手」ではなく「継続的に思い出せていない」語彙だけを対象に絞り込むための、やや保守的な（＝過検出を避ける）初期値として設定した。実データで調整可能なようCLI引数（`--vocab-min-again-rate`）で上書きできるようにする。
- 既に`additional_explanation`が設定済みの行は対象から除外する（再生成の重複防止、11.2参照）。

### 11.2 DBスキーマ変更（新規マイグレーション）

- `grammar_questions`・`vocab_words`それぞれに**nullableな`additional_explanation text`列を追加**する（既存の`explanation`/`etymology_note`は一切変更しない、後方互換な追加のみ）。`etymology_note`列追加時（`20260809042257_add_vocab_etymology_note.sql`）と同じスタイルの`alter table ... add column`で実装する。
- **判定用の集計ビューを2つ追加**する（5章・9.6の`user_grammar_category_stats`/`user_vocab_tag_stats`と同じ設計方針・`security_invoker=true`を踏襲。ただし既存ビューは`user_id`単位の集計だが、今回は「どのユーザーが」ではなく「どの問題/単語が」苦手かを見たいため、`question_id`/`vocab_word_id`単位でユーザー横断集計する点が異なる）:
  - `grammar_question_accuracy_stats(question_id, attempt_count, correct_count, accuracy_rate)`
  - `vocab_word_again_stats(vocab_word_id, review_count, again_count, again_rate)`
  - `security_invoker=true`のため、一般ユーザーが直接クエリした場合はRLS越しに自分の行だけの集計になり実害はない。本機能はservice_roleで動くスクリプトからのみ使うため、RLSがバイパスされ実際に全ユーザー横断の集計が取得できる（既存の管理系クエリと同じ前提）。
- `generation_batches.content_type`（enum、既存値`'vocab' | 'grammar'`）に**`'grammar_explanation'`・`'vocab_explanation'`を追加**（`alter type content_type add value`、既存2値の意味は変えない後方互換な追加）。既存の`generation_batch_items`のneeds_review振り分け・レビューCLI（`review_batch.ts`）をそのまま再利用するための拡張。

### 11.3 生成パイプラインの再利用・拡張

- **新規プロンプト**（`prompts/grammar_additional_explanation.md` / `prompts/vocab_additional_explanation.md`）: 既存の`grammar.md`/`vocab.md`（新規問題の生成）とは目的が異なる（既存項目への補足解説の生成）ため別テンプレートとするが、`loadTemplate`/`fillTemplate`の仕組みはそのまま使う。入力は対象項目のリスト（`target_id`・問題文/単語・既存の解説・正答率/again率）をJSONとして埋め込み、出力は`{target_id, additional_explanation}`の配列（`ADDITIONAL_EXPLANATION_JSON_SCHEMA`、8.3のGRAMMAR/VOCAB_JSON_SCHEMAと同じARRAY形式）とする。`target_id`をレスポンスに必ず含めさせることで、レスポンスの配列順序に依存せず`target_id`で確実に対応付ける（8.4③のセルフチェックで`solved_index`の対応取り違えが起きた教訓を踏まえた設計）。
- **セルフチェックは実装しない（意図的なスコープ縮小）**: 8.4③の一意性セルフチェックは「正解を伏せて解かせ、`correct_index`と一致するか」という客観的に検証可能な判定軸があるが、追加解説の「内容が正しいか」を検証するには同程度に信頼できる自動判定軸が無い（2回目のGemini呼び出しで判定させても、その判定自体の正しさを担保できない）。コストをかけて曖昧な検証を追加するより、構造チェック（8.4①相当: `target_id`が有効なUUIDで対象行が実在し、かつ未設定であること）のみで`auto_passed`とし、疑わしい内容は既存のneeds_reviewフロー・エージェントの一次判断に委ねる方が一貫している。
- **構造チェック**（`structuralValidation.ts`拡張）: `validateAdditionalExplanationItemStructure`。Zod検証（`target_id`が UUID・`additional_explanation`が空でない）に加え、`validateBatch.ts`側で対象行（`grammar_questions`/`vocab_words`）の実在確認と「`additional_explanation`が未設定であること」を確認する。
- **コミット**（`commitBatch.ts`拡張）: 新規`commitGrammarExplanationItem`/`commitVocabExplanationItem`。既存の`commitGrammarItem`/`commitVocabItem`はINSERTだが、こちらは対象行への`UPDATE ... SET additional_explanation = ...`。1件の失敗が他の項目に影響しない既存方針（`try/catch`＋needs_review差し戻し）をそのまま踏襲する。
- **人力/エージェントレビュー**（`review_batch.ts`）: 変更不要。`generation_batch_items`をcontent_typeに依らず汎用的に扱う実装のため、そのまま新しいcontent_type 2種にも使える。

### 11.4 バッチ化・503対策の流用

10章の`concurrencyPool.ts`（同時実行数2・間隔1500ms、既定値は10.8と同じ）をそのまま使う。`generateWithShrinkRetry`（10.7）は「件数」を縮小しながら再生成する設計だったが、本機能は「既存の特定の行」に対する解説生成のため、件数ではなく**対象アイテムの配列そのものを半分に割って縮小retryする**変種`generateExplanationsWithShrinkRetry`を新設する（制御フロー・縮小幅（最大3段階、既定8→4→2）・429/5xx判定（`isRetryableError`）はすべて10.7と共通、`autoBackfill.ts`から`generateWithShrinkRetry`/`ShrinkRetryOutcome`をexportして型・判定ロジックを再利用する）。

### 11.5 実行トリガーとスコープ

- CLIスクリプト（`npx tsx scripts/content-generation/enhance_explanations.ts`、`npm run enhance:explanations`）による手動実行のみ。cron等の定期実行はスコープ外とし、10.11であわせて記録済みの「無人実行時のエラー通知・Gemini APIコスト上限の設計」課題に含める（12章の未決事項にも追記）。
- CLI引数: `--dry-run`（対象件数のみ表示）、`--max-total`（11.6）、`--batch-size`（既定8）、`--concurrency`（既定2）、`--throttle-ms`（既定1500）、`--grammar-min-attempts`（既定5）、`--grammar-max-accuracy`（既定0.7）、`--vocab-min-reviews`（既定5）、`--vocab-min-again-rate`（既定0.3）、`--model`。

### 11.6 1回あたりの対象件数上限

- **既定値: 合計50件/回**。根拠: 本機能はセルフチェック（2回目のGemini呼び出し）を行わない設計（11.3）のため、1項目あたり必要なGemini呼び出しはバッチ内の按分で高々1回——10章の自動問題生成（文法は生成+セルフチェックで最大2回/件）よりコスト効率が良い。それでもバッチサイズ8件なら約7回の生成呼び出しで済む水準として、手動実行1回あたりの時間・コストを抑えつつ弱点解消に実質的な効果が出る規模として50件を選んだ。文法・語彙の内訳は文法優先で予算を消費し、残りを語彙に割り当てる（どちらも同じ弱点対策という性質のため優先順位に強い根拠は無く、実装のシンプルさを優先した判断）。`--max-total`で上書き可能。
- 上限超過分は次回実行時に閾値未満のままなので自動的に再検出される。

### 11.7 フロントエンド表示

- 既存の解説ボックス（`GrammarDrill.tsx`/`MixedDrill.tsx`の`explanation`表示、`VocabReview.tsx`の「語源のヒント」表示）とは別に、`additionalExplanation`がある場合のみ**既存解説の下に追加**する。既存デザイントークンをそのまま使い、新しい配色・レイアウトパターンは持ち込まない。
  - コンテナは既存の解説ボックスと同じ`rounded border ... px-3 py-2`だが、「これは弱点として自動検出された補足」であることが一目で分かるよう、色調は`WeakPoints`（5章・9.6・20章）の警告色（`incorrect`系、正答率70%未満の強調と同じ配色）を流用する: `border-incorrect-200 bg-incorrect-50`。ラベルは`text-xs font-medium text-incorrect-700`で「よくある間違いのポイント」、本文は`mt-1 text-sm text-neutral-700`（本文自体は既存の解説文と同じ読みやすさを優先し、警告色を強めすぎない）。
  - 新しい配色トークンや異なるコンポーネント構造は導入しない（依頼にある「既存のデザイントークン・『計器盤』コンセプトに沿わせる」を、既存のcorrect/incorrect二階調の一貫性を保つ、という意味で解釈した）。

### 11.8 needs_reviewのエスカレート運用

10.13と同じ既存方針をそのまま踏襲する: エージェントが`review_batch.ts`相当の判断で一次判断し、本当に曖昧なケースのみユーザーにエスカレートする。新しい仕組みは実装しない。

---

## 21. CEFR-J Wordlistを用いた語彙選定候補の調査【設計案・実装なし】

> **章番号について**: 本来なら12（未決事項）の手前＝13が次の番号だが、コード中のコメントには
> DESIGN.mdに未反映のまま「13章」（イディオム機能）・「14章」（総合問題/mixedDrill）・
> 「16章」（vocab_tags code分離）・「17章」（リトライ戦略）・「18.2」（語彙タグ一覧画面）・
> 「19章」（セルフチェック改訂）・「20章」（弱点ダッシュボードの配色方針）・「22章」
> （AIチューター機能）・「25章」「26章」（キーボード操作・AskTutorPanel関連）という参照が
> 既に多数存在する（`grep -rn "章\|[0-9]\.[0-9]" src scripts`で確認済み）。これらの番号は
> 実装に追いつく形の全面書き直し（10章冒頭・15章の未決事項参照）で使う可能性が高いため、
> 衝突を避けて21・23を割り当てた（12の直後の13・14ではなく、あえて空き番号まで進めている
> ——22は前述のとおりAIチューター機能の参照で既に使われているため22も避けた）。


現状、語彙は単語選定を含め全てGeminiにゼロから生成させているが、単語の**選定**だけを公開語彙リスト（CEFR-J Wordlist）に委ね、日本語訳・例文・語源解説・追加解説の**生成**は既存パイプラインのまま使う、という組み合わせが可能か調査した。本章は調査・設計のみで、DB変更・データ投入は一切行っていない（次セッションで別途指示があった場合に実装する）。

### 21.1 データソースとライセンス

`openlanguageprofiles/olp-en-cefrj`（GitHub、CEFR-Jプロジェクト公認ミラー）を実際に取得して構造を確認した。

- **利用条件**（同リポジトリREADME原文）: "CEFR-J vocabulary and grammar profile datasets can be used for research and commercial purposes with no charge, provided that you cite the dataset properly. The copyright belongs to Tono Laboratory at TUFS (Tokyo University of Foreign Studies)."
- **引用表記**（README記載の参照形式をそのまま使う）: "The CEFR-J Wordlist Version 1.5. Compiled by Yukio Tono, Tokyo University of Foreign Studies. Retrieved from http://www.cefr-j.org/download.html on [取得日]."
- ファイル構成:
  - `cefrj-vocabulary-profile-1.5.csv`（233KB）: 列は`headword, pos, CEFR, CoreInventory 1, CoreInventory 2, Threshold`。**A1〜B2**の4レベル、7,798行・見出し語ユニーク6,867語（同一語が複数品詞で複数行になる、例: "about"がadverb/prepositionの2行）。末尾3列はごく一部の行にのみ値がある補助的な注記でDB取り込み上は無視して問題ない。
  - `octanove-vocabulary-profile-c1c2-1.0.csv`（46KB）: CEFR-Jプロジェクトを補完する**Octanove Labs**作成のC1/C2版。列は`headword, pos, CEFR, notes`。2,136行（C1:1,111・C2:1,025）。**ライセンスがCEFR-J本体とは別**（[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)）——取り込む場合は引用表記を別途用意する必要がある。
  - `cefrj-grammar-profile-20180315.csv`: 文法項目リスト。今回の語彙選定調査の対象外。
- レベル別内訳（CEFR-J本体、A1〜B2）: A1=1,164 / A2=1,411 / B1=2,446 / B2=2,778。
- 品詞別内訳（同）: noun=4,091 / adjective=1,494 / verb=1,349 / adverb=552 / pronoun=83 / preposition=76 / determiner=46 / conjunction=37 / number=30 / modal auxiliary=13 / be-verb=10 / interjection=9 / do-verb=5 / have-verb=3 / infinitive-to=1。**determiner/number/pronoun/conjunction/preposition等の機能語**は語彙カード（`vocab_words`）の性質（意味・語源を学ぶコンテンツ単語）にそぐわないため、取り込み時はnoun/verb/adjective/adverbを中心にフィルタする想定。
- 見出し語には`according to`のような**複数語のフレーズが142件**含まれる（"air conditioning"、"bank account"等の複合名詞が中心で、既存の「イディオム」タグが対象とする慣用表現・句動詞とは性質が異なる）。

### 21.2 既存収録語彙との突き合わせ

ローカルDB（クラウドと同一マイグレーション適用済み）の`vocab_words`（159語、4タグ: ビジネス44・イディオム40・日常会話40・Part7頻出35）とCEFR-J＋Octanove統合リスト（見出し語ユニーク8,653語）を実際に突き合わせた（`comm`コマンドによる集合演算、大小文字を無視した完全一致比較）。

- **既存収録語彙とCEFR-Jの重複**: 159語中85語（約53%）がCEFR-J/Octanoveに存在する一般的な単語。残り74語（約47%）はCEFR-Jに含まれない——内訳は主に(a)複数語のイディオム・句動詞（`across the board`、`burn the midnight oil`、`fill out`等、そもそもCEFR-Jの一般語彙リストの対象外）、(b)TOEICのビジネス文脈に特有の語（`discrepancy`、`expenditure`、`designate`、`contingent`等）で、これらはCEFR-Jのような一般英語学習者向けリストには通常含まれないため、**CEFR-J単独では代替できない**（既存のGeminiゼロ生成を今後も併用する必要がある領域）。
- **CEFRレベルとTOEICの対応関係**: 既存収録語彙（85語）のうちCEFR-Jに存在するもののCEFRレベル分布は、B2=38語・B1=29語・A2=14語・A1=2語。**約81%がB1〜B2**に集中しており、依頼にあった「B1〜B2あたりが目安」という想定と実データが一致した。TOEIC 730点（既定`target_band`）前後の語彙は概ねCEFR B1〜B2相当という経験則が、少なくとも既存のGemini生成語彙の傾向とは整合している。A1（超基礎語）はTOEIC学習者には易しすぎ、C1/C2（Octanove側）はTOEIC 900点を超えて上級寄りになるため、**主軸はB1〜B2、必要に応じてC1の一部を上位帯として検討**、という方針が妥当と判断した。
- **候補語数の規模感**: B1〜B2に絞ったCEFR-J見出し語はユニーク4,906語、うち既存DBに無いものは4,843語。これがそのまま「TOEIC学習に適した難易度帯で、まだ収録していない候補語」のおおよその上限規模になる（後述21.3のとおり、機能語除外・ビジネス文脈適合性フィルタでさらに絞り込む前提の粗い数字）。C1レベル（Octanove、1,111語）も上位帯の補完候補として利用可能。

### 21.3 取り込み方針案

既存パイプライン（8章）は「Gemini APIが単語選定から日本語訳・例文まで全て生成する」設計だが、CEFR-Jを使う場合は**単語選定のステップだけを差し替える**。

1. **新規スクリプト**（案）`scripts/content-generation/importCefrjWordlist.ts`: CSVを読み込み、(a) POSフィルタ（noun/verb/adjective/adverbのみ、determiner等の機能語を除外）、(b) レベルフィルタ（既定B1〜B2、CLI引数で上書き可能）、(c) 複数語フレーズの除外可否（案: 既定除外——イディオムタグとは別の枠組みで扱うべきで混同を避けるため）、(d) 既存`vocab_words`との重複除外（word+part_of_speechの完全一致、8.4①の構造チェックと同じキー`wordPosKey`を再利用可能）を順に適用し、「候補語＋CEFRレベル＋POS」のリストを作る。この時点では`generation_batch_items`のような新しいstaging機構は設けず、既存の`generateVocabBatch`が受け取れる形（単語の配列）にそのまま変換して次段に渡す設計とする。
2. **既存の生成パイプラインとの接続**: `generateVocabBatch`は現状「タグ名＋件数」を受け取りGeminiに単語選定から丸ごと依頼する設計（`buildVocabPrompt`）。CEFR-J由来の候補語を使う場合は、**新しいプロンプト**（案）`prompts/vocab_from_wordlist.md`を追加し、「以下の単語リストの中から、まだ登録されていない語についてカード情報（meaning_ja/example_sentence_en/example_sentence_ja/etymology_note/tags）を生成してください。wordフィールドは指定されたリストの語をそのまま使い、新しい単語を創作しないでください」という指示に変更する。JSON Schema（`VOCAB_JSON_SCHEMA`）自体は変更不要——`word`フィールドの生成源が「Geminiの自由生成」から「指定リストの転記」に変わるだけで、出力構造は同一。
3. **既存のneeds_review・重複チェックフローとの接続**: 8.4の検証フロー（①構造チェック→②近似重複検出→③はvocabなので対象外）はそのまま使える。むしろCEFR-Jから単語を渡すことで、①のword+part_of_speech完全一致チェックに引っかかる確率がGeminiの自由生成より大幅に下がると見込まれる（21.2の分析どおり、既存収録語彙とCEFR-Jの重複はもともと53%程度で、事前にDB側で重複除外した候補だけを渡すため）。②の近似重複検出（pg_trgm）は引き続きセーフティネットとして機能する。
4. **引用表記の記載場所**（案）: (a) `README.md`のクレジット節（新設）、(b) `scripts/content-generation/prompts/vocab_from_wordlist.md`冒頭のコメント、(c) 本章（21.1）に一次情報として記載——の3箇所。フロントエンド（学習者向けUI）への表示は必須ではない（CEFR-Jの利用条件は「データセットの引用」を求めているのみで、エンドユーザー向け表示までは要求していないとREADMEから読み取れる）が、将来的にサイトのクレジットページを作る場合はそこにも追記する。
5. **POSマッピング**: CEFR-Jの`pos`値（`noun`/`verb`/`adjective`/`adverb`が主要4種）は既存`vocab_words.part_of_speech`（自由記述文字列、Geminiが生成する値と同じ語彙）とそのまま一致するため変換不要。`be-verb`/`do-verb`/`have-verb`は`verb`に正規化、`determiner`/`number`/`pronoun`/`conjunction`/`preposition`/`interjection`/`infinitive-to`は取り込み対象外とする案（21.1参照）。

### 21.4 未解決の論点・リスク

- **ビジネス文脈適合性のフィルタが無い**: CEFR-Jは一般英語学習者向けリストであり、TOEICのビジネス文脈での使用頻度は考慮されていない。B1〜B2の4,843語をそのまま候補にすると、TOEICではほぼ出現しない語（日常生活・学校生活寄りの語彙）が相当数混ざる可能性がある。既存タグ（ビジネス/日常会話/Part7頻出）のどれに割り当てるかの判断基準も別途必要——単純にCEFRレベルだけでは決められない。
- **複数語フレーズ（142件）の扱い**: イディオム/句動詞タグとの境界が曖昧。取り込み対象から一律除外する案としたが、`according to`のような頻出コロケーションを機会損失にする可能性もある——次セッションでの実装判断時に再検討の余地あり。
- **Octanove（C1/C2）はライセンスが別**: 取り込む場合は引用表記を独立して管理する必要がある（21.1参照）。今回のB1〜B2中心の方針では優先度は低い。
- **重複判定は`word+part_of_speech`の完全一致のみ**: CEFR-Jの見出し語表記（例: 大文字小文字や"a.m./A.M./am/AM"のような複数表記まとめ）と既存DBの表記揺れがあると見逃す可能性がある。実装時に正規化ルールを詰める必要がある。

---

## 23. Supabase APIキー新方式（sb_secret_）への移行準備【設計案・.env変更なし】

Supabaseの新しいAPIキー体系（`sb_publishable_`＝旧`anon`キーの代替、`sb_secret_`＝旧`service_role`キーの代替）への移行に向けた、コード側の準備調査。本章はDESIGN.mdへの記録のみで、実際の`.env`書き換え・Supabaseダッシュボードでの新規キー発行は行っていない（ユーザー側で実施、23.4参照）。

### 23.1 現状、service_roleキーが参照されている箇所

コードベース全体を検索し、以下の箇所で参照されていることを確認した。

| ファイル | 用途 | 参照方法 |
|---|---|---|
| `scripts/content-generation/env.ts` | Node/tsxスクリプト共通の環境変数読み込み（`loadEnv()`） | プロジェクトルート`.env`の`SUPABASE_SERVICE_ROLE_KEY`を`REQUIRED_KEYS`として必須化、`process.env.SUPABASE_SERVICE_ROLE_KEY!`でそのまま文字列として読む。**フォーマットの検証は一切行っていない**（存在確認のみ） |
| `scripts/content-generation/supabaseAdmin.ts` | `createSupabaseAdminClient()` | `env.SUPABASE_SERVICE_ROLE_KEY`を`createClient(url, key, {...})`の第2引数にそのまま渡す |
| `supabase/functions/ask-tutor/index.ts`（Deno Edge Function） | ユーザーのJWT検証・レート制限RPC呼び出し用のservice_roleクライアント作成 | ~~`Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!`。このEdge Function向けの値はSupabaseプラットフォームが自動的に予約変数として注入するもので、`supabase secrets set`では設定できない~~ **2026-08-12、23.7で`Deno.env.get('SB_SECRET_KEY')!`（非予約名のカスタムシークレット）に変更済み**。予約変数は新sb_secret_キー体系に自動追従しないと判明したため（23.5・23.6・23.7参照） |
| `scripts/content-generation/commit_batch.ts` | コメントのみ（「service_roleキーで実行することが前提」という運用上の注意書き） | コード上の参照なし |
| `gemini.test.ts` / `generateGrammar.test.ts` / `generateVocab.test.ts` / `generateExplanationEnhancement.test.ts` | `loadEnv`のモック | `SUPABASE_SERVICE_ROLE_KEY: 'service-role-key'`という**ダミー文字列**（実キーではない）をテスト全体で共通して使用 |

`src/lib/supabase.ts`（フロントエンド）は`anon`キーのみを使い、service_roleキーには一切触れない（7章のRLS方針どおり、既存の分離設計）。

### 23.2 コード側で変更が必要な箇所の特定

Supabase公式ドキュメント（`supabase.com/docs/guides/api/api-keys`）を確認した限り、**新旧キーは同一のHTTPヘッダ（`apikey`/`Authorization: Bearer`）経由で使われる設計**であり、`createClient(url, key)`の呼び出し方自体を変える必要は無いと判断できる材料が得られた。具体的な変更点は以下の通り、想定より小さい。

1. **`.env`の値のみ変更**（今回はユーザー側作業、23.4参照）: `SUPABASE_SERVICE_ROLE_KEY`の値を、旧JWT形式から新しい`sb_secret_...`形式に置き換える。**変数名自体は変更不要**と判断した——`env.ts`の`REQUIRED_KEYS`・`ScriptEnv`インターフェース・`supabaseAdmin.ts`はいずれも変数名にのみ依存しており、値のフォーマット（JWT vs `sb_secret_`）を一切検査していないため、値を差し替えるだけで動作するはず。変数名を`SUPABASE_SECRET_KEY`のように変える案も検討したが、`env.ts`・`.env`・（もし将来CI/CDを構築する場合の）デプロイ設定など複数箇所を揃って変更する必要が生じ、移行の複雑さが増すだけでメリットが薄いため見送った。
2. **`env.ts`への軽微な追加（任意、今回は未実装）**: 移行完了の確認をしやすくするため、`loadEnv()`に「値が`sb_secret_`で始まっているか」を`console.warn`で通知する程度の軽いチェックを追加する案がある（エラーで止めるほどの検証は不要——旧JWT形式のキーも当面は`supabase.com`側の設計により共存可能なため、強制はしない）。実装するかどうかは次回の判断とする。
3. **Edge Function（`ask-tutor`）側の注意点**: Supabase公式ドキュメントで「Edge FunctionsはデフォルトでJWT形式のanon/service_roleキーのみをJWT検証の対象としてサポートしており、新方式のキーを使う場合は`--no-verify-jwt`オプションと自前の認可ロジックが必要になる」という趣旨の記述を確認した。ただし、この記述が指しているのは**Edge Functionへの着信リクエストの認可ヘッダ**（フロントエンドが`supabase.functions.invoke('ask-tutor', ...)`で送る、ユーザー自身のセッションJWT）の検証の話であり、**関数内部で`Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`から読むプラットフォーム予約変数の値そのもの**（サーバー側でservice_roleクライアントを作るためだけに使っている、`ask-tutor/index.ts`の実際の使い方）とは別の話だと考えられる。ただし公式ドキュメントの記述だけでは完全に断定できなかったため、**実際にダッシュボード側でキーをローテーションした後、`ask-tutor`の呼び出しが従来どおり動作するか（特にJWT検証まわり）を実機で確認する**ことを移行手順に含める（23.3のステップ4）。
4. **依存パッケージのバージョン**: `package.json`の`@supabase/supabase-js`は`^2.112.2`（本プロジェクトで直近に使用中の最新版に近い）。新方式のキーはHTTPヘッダとして渡されるだけで、SDK側の特別なパース処理は不要と考えられるため、現行バージョンで問題無く動作する可能性が高いと判断したが、公式チェンジログから明示的な対応バージョンの記載は見つけられなかった（23.5に不確定要素として記録）。

### 23.3 移行手順案

1. **（ユーザー側）Supabaseダッシュボードで新しい`sb_secret_`キーを発行する**——既存の`service_role`キーはこの時点では削除しない（公式ドキュメントによれば新旧キーは共存可能）。
2. **（このセッションでは未実施）ローカル`.env`の`SUPABASE_SERVICE_ROLE_KEY`を新キーの値に置き換える**。変数名は変更しない（23.2参照）。
3. **ローカルで動作確認**: `npm run backfill:auto -- --dry-run`・`npm run enhance:explanations -- --dry-run`（いずれもservice_roleクライアントでDBを読むだけで書き込みはしない、低リスクな確認コマンド）を実行し、`createSupabaseAdminClient()`が新キーで問題なく認証できることを確認する。問題なければ`npm test`・`npm run lint`・`npm run typecheck:scripts`も実行し、リグレッションが無いことを確認する。
4. **クラウド側Edge Function（`ask-tutor`）の実機確認**（23.2の3参照）: クラウド側で新キーへのローテーションが完了したタイミングで、認証済みユーザーとして実際に「もっと詳しく聞く」を1回使い、正常に回答が返ることを確認する。ここで問題が出た場合は`--no-verify-jwt`の要否等、Edge Function側の追加設定変更が必要になる可能性がある。
5. **クラウドSupabaseプロジェクトのバックエンド処理（`scripts/content-generation/`配下のCLIをクラウド向けに実行する場合）でも同様に動作確認**——ただし現状これらのCLIは主にローカルDB向けに実行しており、クラウドへの反映は`db push`（マイグレーション）またはユーザー承認済みの範囲でのバッチ実行時のみのため、優先度は3・4より低い。
6. **問題が無いことを確認できたら、旧`service_role`キーをSupabaseダッシュボードで失効させる**（ユーザー側作業）。この操作は不可逆（ドキュメント: "Deleting a secret key is irreversible and once done it will be gone forever."）なため、3・4のステップで十分な確認が取れてから実施する。

### 23.4 ユーザー側で必要な作業とタイミング

- **今すぐ可能**: Supabaseダッシュボード（Settings > API Keys）で新しい`sb_secret_`キーを発行する（既存キーはまだ削除しない）。新旧キーは共存できるため、このタイミングに急ぎの制約は無い。
- **新キー発行後**: 発行した`sb_secret_...`の値を教えていただければ、（別途明示的な指示のもとで）ローカル`.env`の`SUPABASE_SERVICE_ROLE_KEY`を書き換え、23.3のステップ3・4の動作確認を実施する。
- **動作確認が取れた後**: 旧`service_role`キーの失効はユーザー側で実施（不可逆操作のため、私からは提案するのみで実行はしない）。
- クラウドSupabaseプロジェクト側で新方式キーへの切り替えに伴う追加設定（Edge Functionsの`--no-verify-jwt`要否等、23.2の3参照）が必要になった場合は、実機確認の結果を見てあらためて相談する。

### 23.5 実機確認の結果（2026-08-12実施、更新履歴も参照）

ユーザーが`sb_secret_...`形式の新キーをSupabaseダッシュボードで発行し、ローカル`.env`の`SUPABASE_SERVICE_ROLE_KEY`をその値に書き換え済みの状態で、以下を実際に確認した（旧`service_role`キーはこの時点でまだ失効させていない、共存状態）。

**✅ `createSupabaseAdminClient()`（`env.ts`/`supabaseAdmin.ts`）— 新キーで正常動作を確認**

一時検証スクリプト（コミットせず確認後に削除）で、`generation_batch_items`・`generation_batches`（いずれもRLS有効・ポリシー無しのdeny-allテーブル、service_role以外は0件しか返らない）に対してカウントクエリを実行。クラウドDB（`qpfmssdhbtlbudqburki`）に対して`generation_batch_items`=500件・`generation_batches`=33件と実データが返ることを確認し、**新キーが引き続きservice_role権限（RLSバイパス）を正しく持つことを直接証明した**。`@supabase/supabase-js@^2.112.2`は新方式キーに問題無く対応していることも同時に確認できた（23.2の4の不確定要素は解消）。

**✅ `ask-tutor` Edge Function — 新キー環境下でエンドツーエンド動作を確認**

使い捨てテストユーザー（`xxx@mailinator.com`、Admin API作成）で認証込みの実機確認を実施。実際にサインインしてJWTを取得し、`ask-tutor`を呼び出したところHTTP 200・正常な回答が返り、Edge Function内部の`increment_tutor_usage`RPC（service_roleクライアント経由）も正しく実行されたことを`tutor_usage`テーブルの実データ（`request_count: 1`）で確認した。確認後、Admin APIでテストユーザーを削除し、`tutor_usage`行がcascade削除されたことも確認済み（22.5と同じ手順）。

**⚠️ ただし完全な断定はできない残存条件**: この確認は**旧`service_role`キーがまだ失効していない状態**で実施した。Edge Functionの`Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`（プラットフォーム予約変数）が「新キー体系に完全移行した後」も同じ変数名・同じ意味で提供され続けるかは、公式ドキュメントからは断定できておらず、今回の確認だけでは「新キーが実際に使われている」のか「旧キーがまだ有効なため裏でそちらが使われている」のかを区別できていない。**旧キーを失効させる前に、この点についてもう一度（Edge Function呼び出しが失敗しないことを）確認することを強く推奨する**——23.3の手順6（旧キー失効）の直前に、本節と同じ確認を再実施する。

**🔴 2026-08-12追記: 上記の残存条件を裏付ける具体的なリスクが判明（旧キー失効は非推奨）**

旧キー失効直前の最終確認として、`.env`のクラウド統一（23.6）後の状態（オーバーライド無し・実際の`.env`そのまま）で`createSupabaseAdminClient`相当の確認（`generation_batch_items=500`・`generation_batches=33`、23.5の初回確認と同じ値で一致）と`ask-tutor`のE2E確認（HTTP 200・`increment_tutor_usage`RPC成功）を再実施し、いずれも成功した。しかし、この結果を評価する過程でSupabase公式ドキュメント・GitHubのissueを調査したところ、以下が判明した。

- Edge Functionsに自動注入される予約環境変数（`SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY`）は「レガシー」変数として、新キー体系（`sb_publishable_`/`sb_secret_`）移行後も**別名の新変数**（`SUPABASE_PUBLISHABLE_KEYS`/`SUPABASE_SECRET_KEYS`）が追加される形であり、既存の予約変数自体が新キーの値に置き換わるわけではないとSupabase公式ドキュメントに明記されている。
- GitHub issue [supabase/supabase#37648](https://github.com/supabase/supabase/issues/37648)（`SUPABASE_ANON_KEY`が対象、同じ仕組みが`SERVICE_ROLE_KEY`にも当てはまる可能性が高い）では、レガシーキーを無効化した後もEdge Functions内の予約変数が旧JWT形式の値のまま更新されず、結果としてEdge Functionが「Legacy API keys are disabled」エラーで失敗するという実例が報告されている（2026-08-12時点、未解決・トリアージ待ち）。
- `supabase/functions/ask-tutor/index.ts`は`Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')`（レガシー予約変数）を直接参照しており、この経路は**プロジェクトルートの`.env`とは完全に独立**している（23.6のクラウド統一・sb_secret_移行は`scripts/content-generation`配下のNode CLIのみが対象で、Edge Functionsのランタイムには一切影響しない）。

**結論**: 今回の確認が成功したことは、旧キーがまだ有効な間は何も壊れていないことの確認にしかならず、**旧キーを失効させた場合に`ask-tutor`が動作し続けるかどうかを検証できていない**という23.5冒頭の懸念は、推測ではなく具体的な裏付け（公式ドキュメントの記載・同一メカニズムでの実例報告）のある実害リスクだと判明した。**現時点では旧キーを失効させるべきではない**。安全に失効させるには、`ask-tutor/index.ts`を新キー体系に対応させる実装変更（例: リクエストの`apikey`ヘッダーから値を取得する、またはSupabaseが提供する新しい予約変数名に切り替える）と再デプロイ、その上での再確認が必要——これは`supabase/functions/`の変更・再デプロイを伴うため、着手前にユーザーの確認を要する。

### 23.7 上記への対応（2026-08-12、`SB_SECRET_KEY`カスタムシークレットへの切り替え・再デプロイ実施済み）

23.6で提案した2案（①リクエストの`apikey`ヘッダーから鍵を取得する／②非予約名のカスタムシークレットに切り替える）のうち、以下の理由で①を却下し②を採用した。

- **①（apikeyヘッダー方式）を却下した理由**: `ask-tutor`はフロントエンドから`supabase.functions.invoke()`で呼ばれており、その際自動送信される`apikey`ヘッダーは**anon/publishableキー**（ブラウザ向けの弱い権限キー）である。一方`increment_tutor_usage()`（`20260811070000_create_tutor_usage.sql`）は`anon`/`authenticated`からのEXECUTE権限を意図的に`REVOKE`したservice_role専用のRPCで、`tutor_usage`テーブルもRLSポリシーを作らずservice_roleのRLSバイパスのみに依存する設計（他人の`user_id`を指定してレート制限枠を消費させる嫌がらせを防ぐため）。apikeyヘッダー方式に切り替えると、RPC呼び出しが権限エラーで失敗しAIチューター機能そのものが壊れるため、この関数には適用できないと判断した。
- **②（採用）**: `supabase secrets set`で非予約名の`SB_SECRET_KEY`シークレットを新規登録し、値は`.env`の`SUPABASE_SERVICE_ROLE_KEY`（新`sb_secret_`キー）と同じものを設定した。`ask-tutor/index.ts`の`createClient()`呼び出しを`Deno.env.get('SB_SECRET_KEY')!`に変更し、予約変数`SUPABASE_SERVICE_ROLE_KEY`への依存を完全に排除した。`GEMINI_API_KEY`と同じ「開発者が明示的に管理する非予約シークレット」のパターンに揃えたことで、Supabase側の予約変数マイグレーション仕様（未確定・issue化されている挙動）に一切依存しなくなった。
- ローカル開発用の`supabase/functions/.env.example`・`supabase/functions/.env`（gitignore対象、コミットなし）も同様に`SB_SECRET_KEY`に更新（値はローカルSupabaseの`SECRET_KEY`＝固定デモ値、`npx supabase status`で取得可能）。
- **再デプロイ**: `npx supabase functions deploy ask-tutor --project-ref qpfmssdhbtlbudqburki`で実施（2026-08-12）。
- **再デプロイ後のE2E確認**: 使い捨てテストユーザー（Admin API作成・確認後削除）で認証込みの実機確認を実施。`ask-tutor`はHTTP 200・`{status: "ok", answer: ...}`を返し、`increment_tutor_usage`RPCも正常動作（`tutor_usage.request_count`を**別クライアントインスタンスで**再取得し`1`であることを確認——前回23.5の確認で`signInWithPassword`とadmin操作を同一クライアントで行いセッションが汚染され`tutor_usage`の読み取りが`null`になっていた検証スクリプト側の不具合を修正済み）。テスト後、ユーザー・`tutor_usage`行（cascade削除）とも削除済み。検証用スクリプトはコミットせず削除。
- **新旧キーの区別について**: 今回の確認は、Edge Functionが読む鍵を`SB_SECRET_KEY`（新`sb_secret_`値のみを保持、旧レガシーキーの値は一切含まれない）に完全に切り替えた上で行っているため、23.5で残っていた「新キーが実際に使われているのか、旧キーが裏で使われ続けているだけなのか区別できない」という limitation はこの回では**解消されている**——`SB_SECRET_KEY`シークレット自体に旧キーの値を含めていないため、成功した時点で新キー体系のみで動作することが直接証明されている。
- テスト: Deno Edge Functions向けの自動テストはこのプロジェクトに元々存在しない（`src`/`scripts`配下のみvitest対象）ため、既存の実機E2E確認パターンを踏襲した。`npm test`・`npm run lint`・`npm run typecheck`・`npm run typecheck:scripts`は本変更の対象ファイル（`supabase/functions/`配下）が対象外のため影響なし、念のため実行し全て通過を確認。

**結論（旧キー失効の可否）**: `ask-tutor`はもはや予約変数`SUPABASE_SERVICE_ROLE_KEY`に一切依存していないため、**旧`service_role`キーを失効させても`ask-tutor`が壊れるリスクは解消された**と判断する。`scripts/content-generation`配下のNode CLI（23.6で新`sb_secret_`キーに移行済み）・`ask-tutor`（本節で新`SB_SECRET_KEY`に移行済み）のいずれも、旧キーには一切依存していないことを実機確認済み。他に旧`service_role`キー（レガシーJWT形式の値）を参照している箇所がないか、23.1の洗い出しリストと照合したが新規発見なし。**旧キーを失効させて問題ない状態と判断する**（失効操作自体はユーザーがSupabaseダッシュボードで実施）。

**🔴 発見した問題（想定外）**: ローカル`.env`の`SUPABASE_URL`は`http://127.0.0.1:54321`（ローカルSupabase）を指したままだが、`SUPABASE_SERVICE_ROLE_KEY`はクラウドプロジェクト向けに新規発行された`sb_secret_`キーに置き換わっていた。この**URLとキーの対応不一致**を実際に検証したところ、ローカルSupabaseは見知らぬクラウドキーを**エラーにせず黙って空集合を返す**（`generation_batch_items`が0件、`grammar_categories`のサンプルも空配列）という挙動を確認した——これは`npm run backfill:auto -- --dry-run`のような読み取り専用コマンドが「閾値未満のカテゴリ/タグはありません」という**誤った（実際にはカテゴリ一覧そのものが空で判定できていないだけの）安全そうに見える結果**を返してしまうという、地味だが実害のある落とし穴だった。

### 23.6 上記の問題への対応（2026-08-12、案(c)を採用・実施済み）

23.5で発見した不一致に対し、以下の対応を実施した（案(a)ローカル専用鍵に戻す・案(b)`.env`ファイルを分ける・案(c)常にクラウドを指す運用に統一する、の3案のうち(c)を採用）。

- **`.env`の`SUPABASE_URL`をクラウドプロジェクトのURL（`https://qpfmssdhbtlbudqburki.supabase.co`）に書き換えた**。`SUPABASE_SERVICE_ROLE_KEY`は既にクラウド向けの新キーになっていたため、これで両方がクラウドを指す状態に統一された。
- **(c)を選んだ理由**: 案(a)・(b)はローカル/クラウドどちらを向いているかが`.env`の見た目からは判断しにくく、今回と同種の「気づかない不一致」を再発させるリスクを構造的に残す。案(c)は「`.env`は常にクラウド」という単純で覚えやすい不変条件にでき、ローカルでの動作確認は例外的な用途として都度の一時上書きで済ませる方が事故を防ぎやすいと判断した（CLAUDE.mdに運用ルールとして明記、下記参照）。
- **ローカルでの動作確認方法**: `.env`自体は書き換えず、コマンド実行時に環境変数で一時的に上書きする（例: `SUPABASE_URL=http://127.0.0.1:54321 SUPABASE_SERVICE_ROLE_KEY=<npx supabase statusで取得> npx tsx scripts/content-generation/generate_grammar.ts ...`）。dotenvの`config()`は既に`process.env`に設定済みの値を上書きしないため、シェルで先に設定した値がそのまま優先される（本セッションの検証で実際に確認済みの挙動）。ローカルのURL/キーは固定のデモ値だが`.env`にハードコードせず、`npx supabase status`で都度取得する運用とした（値自体を文書に残さないため）。
- **`scripts/content-generation/env.ts`に接続先ログ・警告を追加した**（`loadEnv()`内、新規`logConnectionTarget()`）: `SUPABASE_URL`が既知のクラウドプロジェクトURLと一致すれば`[env] Supabase接続先: クラウド (...)`と通常ログを出し、`127.0.0.1`/`localhost`ならローカル向けである旨を、それ以外の想定外URLならその旨を、それぞれ`console.warn`で警告する。プロセス内で`loadEnv()`が複数回呼ばれても（`generateGrammarBatch`/`generateVocabBatch`が呼び出しごとに呼ぶため）ログ・警告は1回だけに絞った。**実装の規模は小さく済んだため、当初の懸念（item 2「大掛かりになる場合は見送り可」）には該当せず、そのまま実装した**。
- **CLAUDE.mdに運用ルールを追記**（新設「`.env`運用ルール」節）: 常にクラウドを指す方針・ローカル動作確認の一時上書き方法・不一致が起きた際の実害（今回の事故）を明記し、既存の`db reset`前バックアップ規約とは矛盾せず両立することも明記した。
- テスト: `scripts/content-generation/env.test.ts`（新規、6件）で`logConnectionTarget`の3分岐（クラウド一致・ローカル・想定外URL）と「1回だけログする」挙動を検証。`npm test`（289件、283件から+6件）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）全て通過。

---

## 24. Home画面リデザイン（計器盤コンセプト「ロッカースイッチ盤」1c案の実装）

> **章番号について**: 21章冒頭の注記と同じ理由で、本来の次番号24自体は空いていたためそのまま使用したが、
> 本章の直後にあった旧「未決事項」章は25・26（コード中に「キーボード操作・AskTutorPanel関連」として
> 既に参照されているphantom番号）との衝突を避けるため27に繰り下げた。

ホーム画面（`src/routes/Home.tsx`）を、claude.ai Design Canvas（プロジェクト「TOEIC-app ホーム画面リデザイン」、`TOEIC Home Cockpit.dc.html`）で作成した3案から、ユーザーが選定した1c案「ロッカースイッチ盤」に基づいてリデザインした。

### 24.1 検討された3案

Design Canvas上には「精密機械の操作盤」という共通コンセプトのもと、以下3案が提示されていた。

- **1a 精密メーターパネル**: 行ごとに小型ダイヤル（残量弧）を配置。Hue 300。
- **1b サーキュラーゲージ・ハブ**: 中央に5連の大型円形メータークラスター（針+目盛りリング）。Hue 288。
- **1c ロッカースイッチ盤**（採用）: パネル面に埋め込まれた物理スイッチ風の行。四隅にネジ、ヘアライン加工の「CONTROL PANEL」ヘッダー、通し番号（01〜05）、キーキャップ風のショートカットバッジが特徴。Hue 312。

### 24.2 実装方針

- 独自のoklch値を新設せず、既存の`index.css`計器盤デザイントークン（`--color-accent-*`・`--color-neutral-*`・`--color-correct-*`。冒頭コメントに「DESIGN.md 20章参照」とあるが20章はphantom番号で本文未記載、実体はこのトークン定義自体）にマッピングして実装した。Design Canvas側のoklch hue 312（赤紫寄り）は、既存の`--color-accent-600: #5B4B8A`系パレットと同系統のため違和感なく流用できた。
- ハザードストライプのヘッダー・埋め込みスイッチのinset影・パネル四隅のネジなど、Tailwindのビルトインユーティリティでは表現できない装飾は、`bg-[repeating-linear-gradient(...)]`や`shadow-[inset_...]`等の任意値記法で実装した（デコード用のCSS変数`var(--color-accent-200)`等をそのまま埋め込める）。
- 旧デザインは1件目のリンクのみ`variant: 'primary'`で強調表示していたが、1c案は5行とも同一のスイッチ意匠で視覚的な優劣をつけない構成だったため、`NAV_LINKS`の`variant`フィールドを削除し、5行を均等なスタイルで描画するよう単純化した（デザイン意図の忠実な反映であり、恣意的な仕様変更ではない）。
- アクセシビリティ構造（`role="link"`/`role="button"`、ショートカットキーがリンクのテキストコンテンツに含まれる、ログアウトはショートカット割り当て対象外）は`Home.test.tsx`が要求する既存の契約をそのまま維持し、`useMenuShortcuts`/`assignShortcutKeys`のロジックには一切手を入れていない。

### 24.3 テスト・検証

- 既存`Home.test.tsx`（4件）は無改修のまま全件通過（役割・アクセシブルネーム・ショートカットバッジの文字列一致で検証しているため、ビジュアル変更のみでは壊れない設計になっていたことを確認）。
- `npm test`（289件）・`npm run lint`（0件）・`npm run typecheck`（0件）、いずれも通過。
- ブラウザでの実地確認: ローカルSupabase（フロントエンドの`.env.local`は`scripts/content-generation`とは別系統で、常にローカルを指す運用のまま——23章のクラウド統一はサーバー側CLIスクリプトのみが対象）に使い捨てテストユーザーを作成し、ログイン後のHome画面表示とショートカットキー（`c`→`/grammar`）遷移を目視確認した。検証用スクリプト・テストユーザーはいずれも作業後に削除済み（コミットにも含まれない）。

---

## 27. 未決事項 / 次のステップ

- レビューCLI（`review_batch.ts`）の具体的なUX（承認・却下・その場編集のコマンド設計）
- 一意性セルフチェックの`confidence`閾値・類似度閾値（0.6, 0.8）の妥当性検証（実データで調整予定）
- ~~Gemini API失敗時のリトライ戦略~~ **解決済み**: `gemini.ts`の`generateJson`/`generateJsonArray`が429/5xx対象に5回・指数バックオフでリトライする実装済み（コード上は「17章」と参照されているが本ファイルには未記載だった。10章と合わせて整理が必要——上記「前提として発見した既存実装とのズレ」参照）。
- ドリルセッションの出題順（弱点カテゴリを優先出題するか、ランダムか）のロジック
- 弱点ダッシュボードの「警告色」閾値（70%）の妥当性は実データで調整
- 自動問題生成（10章）・間違いが多い問題への自動解説追加（11章）の定期実行化（cron等）——無人実行時のエラー通知・Gemini APIコスト上限の設計が必要
- 語彙の30%（11.1）・文法の70%（既存、5章）といった閾値の妥当性は実データで調整予定
- DESIGN.mdの8章（Gemini APIパイプライン）が実装（13章のイディオム・16章のvocab_tags code分離・17章のリトライ戦略・19章のセルフチェック改訂を含む一連の変更）から大きく取り残されている（10章冒頭「前提として発見した既存実装とのズレ」参照、11章は今回のセッションで実装した範囲のみ記録済み・この取り残し分とは別）。実装に追いつく形での全面的な書き直しが必要——**この全面書き直しの際に、コード中で未反映のまま参照されている章番号（13, 14, 16, 17, 18.2, 19, 20, 22, 25, 26）と、21章・23章として今回割り当てた番号の整合を取り直す必要がある**（21章冒頭の注記参照）
- CEFR-J Wordlist（21章）の取り込み実装: 21.3の方針案どおり進めるかの最終判断、複数語フレーズ（142件）の扱い、ビジネス文脈適合性フィルタの設計が未着手
- Supabase APIキー新方式への移行（23章）: ユーザー側での新`sb_secret_`キー発行を待って23.3の手順を実施


