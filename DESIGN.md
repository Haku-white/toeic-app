# TOEIC学習アプリ 設計ドキュメント

このファイルはプロジェクトの設計決定事項を記録する。機能追加・仕様変更のたびに追記していく運用とする。

---

## 更新履歴

- 2026-08-08: 初版作成。ディレクトリ構成・DBスキーマ（FSRS版）・ER図・RLSポリシーを確定。
- 2026-08-08: Gemini APIバッチ生成パイプライン（プロンプトテンプレート・自動検証・人力レビュー・本番反映フロー）を確定。
- 2026-08-08: フロントエンド設計（技術スタック・認証方式・ルーティング・FSRS統合方針）を確定。
- 2026-08-08: 認証設計の詳細（Supabase Auth設定・profiles自動作成トリガー・認証フロー・ルートガード実装）を確定。FSRS複数端末競合の実質的な影響範囲（progress上書きのみでレビュー履歴は保全される）を明記。
- 2026-08-08: Supabaseプロジェクトのローカル実セットアップを実施（migration 9本・seed・ローカルDocker起動まで確認）。実装時に発見した`security_invoker`未設定によるRLSバイパスの不具合を修正。
- 2026-08-08: クラウドSupabaseプロジェクト（`toeic-app` / ap-northeast-1）に9マイグレーション+seedを反映。migration historyの一致・RLSの実効性（anon拒否/service_role許可）を確認。
- 2026-08-08: ローカルSupabaseにGoogle OAuthを設定し、Vite+React+TypeScript+Tailwind+React Router v7でフロントエンド初期実装（ログイン/サインアップ・OAuthコールバック・保護ルート）を追加。`npm run dev`でローカル起動確認済み（ブラウザでの目視確認はユーザー側で実施）。
- 2026-08-08: サインアップ後にprofilesが空に見える不具合を調査・修正。トリガー自体は正常だったが、`anon`/`authenticated`/`service_role`ロールへのテーブルGRANTが未定義だったことが根本原因。migration追加でローカル・クラウド両方に適用済み。
- 2026-08-08: 同じ症状の再報告を再調査。DB側（トリガー・GRANT）は正常で、実際の原因は`Login.tsx`が`signUp`の`session`有無を見ずに常に「確認メールを送信しました」と表示していたUIバグ（ローカルはメール確認オフのため即ログイン済みだった）。修正済み。あわせて`supabase migration list`はデフォルトでクラウドと比較する仕様（ローカル確認には`--local`必須）という運用上の注意点を記録。
- 2026-08-09: 語彙SRS画面（9章の設計どおり）を実装。
  - ツール整備: ESLint（flat config, typescript-eslint）と Vitest（jsdom + Testing Library）を新規導入。`npm run lint` / `npm test`。
  - `src/lib/fsrs.ts`: `computeNextState(currentProgress, rating, now)` を純粋関数として実装（9.5の設計どおり）。`DESIRED_RETENTION = 0.92`（3章）を使用。**`ts-fsrs`はv5系ではなくv4.7.1に固定**——v5で`Card`/`ReviewLog`に`learning_steps`フィールドが追加されており、6.3で定義済みのDBスキーマ（`learning_steps`列を持たない）と食い違うため。スキーマ変更は今回のスコープ外と判断し、6.3のフィールド構成と完全一致するv4系を選定した。単体テスト12件（`fsrs.test.ts`）で新規カード・既存カードの状態遷移、lapses増加、reps増分、純粋性（同一入力→同一出力）を検証。
  - `src/lib/queries/vocab.ts`: `getDueVocabCards(userId, limit)`（due優先→新規カードで残り枠を充填）、`submitVocabReview(...)`（`user_vocab_progress`をUPSERT、`vocab_review_logs`にINSERT。書き込み先はRLSで許可された2テーブルのみ）。Supabaseクライアントをモックしたテスト5件。
  - `src/lib/authLoader.ts`: `Home.tsx`に直書きされていた認証ガードのloaderを`requireSession()`として切り出し、`Home`・`VocabReview`の両ルートで共有（重複排除）。
  - `src/stores/vocabSessionStore.ts`: レビューセッションの進行状態（現在のカード位置・答え表示フラグ・レビュー件数）のみを持つZustandストア（9.1の方針どおり、カードデータ自体はReact Query側が単一の情報源）。
  - `src/routes/VocabReview.tsx`: 単語カード表示→「答えを見る」→意味・例文＋Again/Hard/Good/Easyの4段階評価ボタン（各ボタンに次回間隔のプレビュー付き）→セッション完了画面、という一連のフローを実装。`/vocab/review`として`main.tsx`にルーティング・`QueryClientProvider`とあわせて追加。コンポーネントテスト3件（空状態・reveal動作・評価送信からセッション完了までの一連の流れ）。
  - モック語彙データ: Gemini APIバッチ生成（8章）が未実装のため、TOEIC頻出語彙12語・タグ3種を手動投入。ローカル専用（`supabase/seed.sql`に追記、直接ローカルDBにも適用）で、クラウドへは意図的に反映していない。
  - 検証: `npm test`（20件全て成功）・`npm run lint`（0件）・`npx tsc --noEmit`（0件）を確認。`eslint-plugin-react-hooks`のrecommended設定に含まれる`react-hooks/purity`ルールは、イベントハンドラ内の`Date.now()`呼び出しまで「render中の不純関数呼び出し」として誤検知したため無効化（React Compiler未導入のプロジェクトのため実害なし）。
- 2026-08-09: 語彙カードに語源ベースのヒントを追加。
  - `vocab_words`に`etymology_note text`（nullable）を追加（`20260809042257_add_vocab_etymology_note.sql`、ローカル・クラウド両方に適用済み）。接頭辞・語幹・接尾辞の分解と意味を示す任意項目（6.3参照）。
  - `src/lib/queries/vocab.ts`の`VocabCard`に`etymologyNote`を追加し、`getDueVocabCards`が併せて取得するよう更新。
  - `src/routes/VocabReview.tsx`: reveal後、意味・例文と一緒に「語源のヒント」ボックスを表示するよう追加。
  - モック12語すべてに語源メモを追加（`supabase/seed.sql`のINSERT文に`etymology_note`列を追加、ローカルDBにも直接反映）。
  - 8.3のGemini語彙生成プロンプト・JSON Schemaを更新し、`etymology_note`の生成を必須項目として追加（分解が難しい語は語源エピソードで代替可、という例外規定つき）。
  - 検証: 既存テストの型を新フィールドに追随（`VocabCard`の型エラーを修正）、`VocabReview.test.tsx`にreveal後の語源ヒント表示を確認するアサーションを追加。`npm test`（20件成功）・`npm run lint`（0件）・`npx tsc --noEmit`（0件）を再確認。
- 2026-08-09: 文法カテゴリ別ドリル画面（9章の設計どおり、`/grammar`・`/grammar/:categoryCode`）を実装。
  - `src/lib/queries/grammar.ts`: `getGrammarCategories()`（9カテゴリ一覧）、`getGrammarDrillData(categoryCode, limit)`（カテゴリ情報+設問をまとめて取得）、`submitGrammarAttempt(...)`（`user_grammar_attempts`にINSERT。書き込み先はRLSで許可された1テーブルのみ、insert-only）。Supabaseクライアントをモックしたテスト6件。
  - `src/stores/grammarSessionStore.ts`: ドリルセッションの進行状態（現在の設問位置・選択した選択肢・正解数・解答数）のみを持つZustandストア（`vocabSessionStore`と同じ方針）。
  - `src/routes/GrammarCategories.tsx`（`/grammar`）: 9カテゴリを一覧表示し、各カテゴリの`/grammar/:categoryCode`へのリンクを提供。コンポーネントテスト2件。
  - `src/routes/GrammarDrill.tsx`（`/grammar/:categoryCode`）: 設問文＋4択（A〜D）を表示→選択即座に正誤判定（正解を緑・誤答した選択肢を赤でハイライト）＋解説表示→「次の問題へ」→全問終了でセッション完了画面（正解数/全問数）、という一連のフローを実装。`main.tsx`にルーティング追加、`Home.tsx`に「文法ドリルを始める」導線を追加。コンポーネントテスト4件（空カテゴリ・正誤ハイライトと解説表示・回答済み後の再クリック無効化・全問完了までの一連の流れ）。
  - モック文法問題データ: Gemini APIバッチ生成（8章）が未実装のため、TOEIC Part5形式の問題を9カテゴリ×3問（計27問）で手動投入。語彙データと同じ方針でローカル専用（`supabase/seed.sql`に追記、直接ローカルDBにも適用）、クラウドへは意図的に反映していない。
  - 自己修正した点: React Query v5の`mutation.mutate()`は`mutationFn`を同期的に呼ばないため、クリック直後に`toHaveBeenCalledTimes`を同期アサートすると実際の呼び出し前に検査してしまいテストが偽陽性で失敗する不具合を発見・修正（`waitFor`で待つよう変更）。また選択肢ボタンのラベル(`A`/`B`/`C`/`D`)と本文の間に明示的なスペースが無くアクセシブルネームが連結してしまっていた表示上の不具合も発見し、`{' '}`を挿入して修正（テストのために発見したが実際のスクリーンリーダー読み上げにも影響する実害のある不具合だった）。
  - 検証: `npm test`（32件全て成功）・`npm run lint`（0件）・`npx tsc --noEmit`（0件）を確認。
- 2026-08-09: 弱点分析ダッシュボード（9章・5章の設計どおり、`/weak-points`）を実装。
  - `user_grammar_category_stats`ビューに`category_code`列を追加（`20260809044731_add_category_code_to_grammar_stats_view.sql`、ローカル・クラウド両方に適用）。弱点カテゴリから`/grammar/:categoryCode`へ直接遷移するために必要だった（既存の`category_name`だけではリンクを組み立てられなかった）。`CREATE OR REPLACE VIEW`は既存列の位置・名前を変更できない制約があるため、新列は末尾に追加している。`security_invoker = true`は再指定必須（11.1/11.4参照）で、正しく維持されていることを確認済み。
  - `src/lib/queries/weakPoints.ts`: `getGrammarCategoryStats(userId)` / `getVocabTagStats(userId)`が`user_grammar_category_stats` / `user_vocab_tag_stats`ビューを正答率の低い順に取得。テスト4件。
  - `src/routes/WeakPoints.tsx`（`/weak-points`）: 文法カテゴリ別・語彙タグ別の正答率を2カラムで並列表示（9.6の方針）。**正答率70%未満を警告色（赤）で強調**。各行はカードリンクになっており、文法カテゴリは該当の`/grammar/:categoryCode`へ、語彙タグは`/vocab/review`へ直接遷移できる（弱点から即復習への導線）。`main.tsx`にルーティング追加、`Home.tsx`に「弱点分析ダッシュボード」導線を追加。コンポーネントテスト3件（警告色の出し分け・空データ時のメッセージ・エラー時のメッセージ）。
  - **語彙タグのリンク先について**: `/vocab/review`にタグ絞り込みパラメータが無い（9.3のルーティング表に存在しない）ため、語彙タグの「即復習」導線は特定タグに絞ったレビューではなく汎用の`/vocab/review`への遷移にとどまる。タグ別レビューへの絞り込みは将来の拡張候補。
  - モック正答履歴: 既存のvocab/grammarモックデータに対する解答・レビュー履歴が無いとダッシュボードが空になるため、ローカルに現存する全テストユーザー（15件）に対して`user_grammar_attempts`405件（27問×15人）・`vocab_review_logs`540件（12語×3件×15人）を一括投入。文法は9カテゴリ中4カテゴリ（接続詞33%・仮定法33%・関係詞67%・比較67%）が70%未満、語彙は3タグ中1タグ（Part7頻出33%）が70%未満になるよう意図的に正答率へ変化をつけ、警告色表示を確認できるようにした。**この履歴データは`supabase/seed.sql`には含めていない**——`db reset`時点では`auth.users`が空でありユーザーIDに紐付く履歴を再現できないため（vocab_words/grammar_questionsのような「誰が使っても良いコンテンツ」とは性質が異なる）。ローカルDBへの一回限りの直接適用であり、クラウドへも反映していない。
  - 検証: 実データでも`user_grammar_category_stats`/`user_vocab_tag_stats`が意図通りの正答率を返すことをSQLで確認、anonキーでのアクセスが引き続き空応答（RLSにより拒否）になることも確認。`npm test`（39件全て成功）・`npm run lint`（0件）・`npx tsc --noEmit`（0件）。
- 2026-08-09: 語彙タグで絞り込んだSRSレビュー画面（`/vocab/review/:tagCode`）を追加し、直前のエントリで残していた「語彙タグのリンク先」の制約を解消。
  - 9.3のルーティング表に`/vocab/review/:tagCode`を追加。`:tagCode`は`vocab_tags.name`をそのまま使う（`grammar_categories.code`のような専用スラッグ列が無いため。URLエンコード/デコードはReact Routerの`Link`/`useParams`任せ）。
  - `src/lib/queries/vocab.ts`の`getDueVocabCards(userId, limit, tagCode?)`に**第3引数として**`tagCode`フィルタを追加（新規関数は作らず既存関数を拡張、というご指示どおり）。内部で`vocab_tags`→`vocab_word_tags`を解決して対象`vocab_word_id`一覧を求め、due一覧・新規カード充填の両クエリに`.in('vocab_word_id'/'id', tagWordIds)`で絞り込みをかける。該当タグに単語が1つも無い場合は以降のクエリを発行せず即座に空配列を返す早期リターンも実装。テスト2件追加（計7件）。
  - `src/routes/VocabReview.tsx`は新規コンポーネントを作らず、`useParams<{ tagCode?: string }>()`で`/vocab/review`と`/vocab/review/:tagCode`の両方を1つのコンポーネントで処理するよう拡張（ご指示の「既存ロジックを再利用」）。`tagCode`をReact Queryの`queryKey`に含めて（`['vocab-due', userId, tagCode ?? null]`）タグ別セッションのキャッシュを分離し、Zustandセッションのリセットも`tagCode`変更時に発火するよう修正。画面内に「タグ: {tagCode}」の表示、タグ指定時は「戻る」導線を`/`ではなく`/weak-points`に変更。テスト2件追加。
  - `src/routes/WeakPoints.tsx`: 語彙タグのリンク先を汎用の`/vocab/review`から`` `/vocab/review/${encodeURIComponent(stat.tagName)}` ``に変更し、実際にタグ別の即復習ができるようにした。既存テストのアサーションを更新。
  - `main.tsx`に`/vocab/review/:tagCode`ルートを追加（`VocabReview`コンポーネントを`/vocab/review`と共用）。
  - 検証: ローカルDBで`vocab_tags`→`vocab_word_tags`の実データ解決とRLS（anon拒否/authenticated許可）を確認。`npm test`（43件全て成功）・`npm run lint`（0件）・`npx tsc --noEmit`（0件）。
- 2026-08-09: 8章の設計どおりGemini APIバッチ生成パイプラインを実装（`scripts/content-generation/`）。「生成→自動チェック→必要なら人力レビュー→本番反映」を一通り実装し、実データでcommitまで動作確認済み。
  - **スキーマ追加**: `find_similar_grammar_questions` / `find_similar_vocab_words` RPC（`20260809050638_add_similarity_search_rpc.sql`、ローカル・クラウド両方に適用）。8.4②の近似重複検出はPostgRESTのクエリビルダでは`similarity()`のような任意関数呼び出しを表現できないため、Postgres関数として公開し`supabase.rpc(...)`から呼ぶ設計に変更。`SECURITY INVOKER` + `search_path = public`（pg_trgmの`similarity()`/`%`演算子が`public`スキーマにあるため。DEFINERではなくINVOKERなのでsearch_pathハイジャックの実害は無いと判断——詳細はマイグレーション内コメント参照）。
  - **アーキテクチャ**: 各CLIスクリプト（`generate_grammar.ts`等の snake_case ファイル）は薄いエントリポイントとし、実処理は同名camelCaseファイル（`generateGrammar.ts`等）にexported関数として実装。依存（`supabase`クライアント・`generateJson`）は引数で注入する設計にし、テストでは実Gemini APIも実Supabaseも呼ばずにモック注入で検証している。
  - `scripts/content-generation/env.ts` / `supabaseAdmin.ts` / `gemini.ts`: `.env`からservice_roleキー・Gemini APIキーを読む（ブラウザ向け`VITE_*`とは完全に分離）。`GEMINI_API_KEY`は起動時必須にせず、実際にGeminiを呼ぶ`generateJson()`内で遅延検証するよう設計——`commit_batch.ts`/`review_batch.ts`やvocabの検証（自己チェック不要）はGeminiを一切呼ばないため、キー未設定でも実行できるようにした（実装中にこの過剰な制約に気づき修正）。
  - `schemas.ts`（Zod）・`prompts/grammar.md` `prompts/vocab.md`（8.3のテンプレートをそのままファイル化）・`promptTemplates.ts`（プレースホルダー埋め込み+JSON Schema定義）。
  - `generateGrammar.ts` / `generateVocab.ts`: 8.1のA→B→C。カテゴリ/タグごとの既存サンプル直近30件を取得してプロンプトに埋め込み、Geminiの構造化出力をそのまま`generation_batch_items`に`pending_validation`で保存、`generation_batches.status`を`validating`に更新。
  - `structuralValidation.ts`（8.4①: Zod再検証+選択肢の正規化後重複チェック+語彙の`word`+`part_of_speech`重複チェック）・`duplicateCheck.ts`（8.4②: 上記RPC呼び出し）・`selfCheck.ts`（8.4③: 正解を伏せた2回目のGemini呼び出し+判定ロジック`judgeSelfCheck`を純粋関数として分離）。
  - `validateBatch.ts`: ①→②→③を順に実行し`auto_passed`/`needs_review`へ振り分け、`generation_batches.needs_review_count`と`status`を更新するオーケストレーター。
  - `reviewBatch.ts`（テスト可能な核）+ `review_batch.ts`（8.5: `needs_review`アイテムを1件ずつ表示し`a`/`r`/`s`で判定する対話式CLI、`readline/promises`使用）。
  - `commitBatch.ts`（8.6）: `auto_passed`/`approved`アイテムを`grammar_questions`/`vocab_words`へINSERT（語彙は`vocab_tags`を`upsert`し`vocab_word_tags`に紐付け）。`category_code`→`grammar_categories.id`の解決はバッチ内でキャッシュ。個別アイテムのコミット失敗は`needs_review`へ差し戻しバッチ全体は継続。**実装時に発見し修正した不具合**: `generation_batches`の集計カラム（`committed_count`等）を「この実行での増分」で更新していたが、`commit_batch.ts`を複数回に分けて実行すると値が正しくなくなる（前回実行分が上書きで消える）ため、常に`generation_batch_items`の実件数を数え直す実装に修正した。
  - `package.json`に`content:generate-grammar` / `content:generate-vocab` / `content:validate` / `content:review` / `content:commit`と`typecheck` / `typecheck:scripts`を追加。`scripts/tsconfig.json`を新設（Node向け、DOM libを含まない別tsconfig。ルートの`tsconfig.json`は`src`のみを対象とするため）。`eslint.config.js`に`scripts/**/*.ts`用のnode globalsブロックを追加。
  - **テスト**: 58件追加（計101件）。生成・検証・コミットの各オーケストレーターはモック注入で分岐を網羅。加えてローカルDBに対する実データE2Eスモークテストを実施——ダミーのvocabバッチを直接INSERTし、`validate_batch.ts`→`commit_batch.ts`を実コマンドとして実行、`vocab_words`/`vocab_word_tags`/`generation_batch_items`/`generation_batches`が期待どおりに更新されることを確認後、テストデータは削除済み。
  - 検証: `npm test`（101件全て成功）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）。
  - **`.env`に追加が必要な設定**（詳細は次のメッセージでユーザーに案内）: `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`（ローカルの値を設定済み）・`GEMINI_API_KEY`（未設定、ユーザーがGoogle AI Studioで発行して設定する必要あり）・`GEMINI_MODEL`（任意、既定`gemini-2.5-flash`）。`.env.example`を新設してテンプレート化した。
- 2026-08-09: `.env`の`GEMINI_MODEL`変更が反映されない不具合を修正し、実際にGemini APIで10問生成・検証・本番反映まで確認。
  - **根本原因**: `generateGrammar.ts` / `generateVocab.ts`が`params.modelName ?? 'gemini-2.5-flash'`と自前でモデル名のデフォルトをハードコードしており、CLIで`--model`を明示しない限り`.env`の`GEMINI_MODEL`（`gemini.ts`側のフォールバック）が一切参照されていなかった。`generateJson()`は`params.model`が渡された時点でそれを優先するため、常にハードコード値が使われていた。
  - **修正**: 両ファイルで`params.modelName ?? loadEnv().GEMINI_MODEL`に変更し、優先順位を「CLIの`--model`指定 > `.env`の`GEMINI_MODEL` > `env.ts`内のデフォルト」に統一。`generateGrammar.test.ts` / `generateVocab.test.ts`に`./env`のモックを追加し、`--model`未指定時に`env.GEMINI_MODEL`がそのまま`generateJson`とDB記録（`generation_batches.model_name`）に使われることを検証するアサーションを追加（再発防止）。
  - **利用可能モデルの確認**: 実APIキーでGemini APIの`ListModels`エンドポイント（`GET /v1beta/models`）に直接問い合わせ、`gemini-3.6-flash`が実在し`generateContent`に対応していることを確認した上で採用（コスト効率重視のFlash系軽量モデル、ユーザー指定どおり）。
  - **実データでの動作確認**: 修正後に`generate_grammar.ts --category tense --count 10`を実行し、`gemini-3.6-flash`で実際に10問生成（`generation_batches.model_name`が正しく`gemini-3.6-flash`で記録されることを確認）。続けて`validate_batch.ts`（自己チェックの2回目のGemini呼び出しも含む）で10件全てauto_passed、`commit_batch.ts`で10件全てcommittedとなり`grammar_questions`（`tense`カテゴリ）に実際に反映されることを確認（`status='completed'`）。このデータはそのままコンテンツとして残した（従来のダミーデータのスモークテストとは異なり、実際に生成された正規コンテンツのため）。
  - 検証: `npm test`（101件全て成功）・`npm run lint`（0件）・`npm run typecheck:scripts`（0件）。
- 2026-08-09: 13章（イディオムコンテンツ）・14章（語彙・文法ミックスドリル）を設計どおり実装。
  - **13章 イディオムコンテンツ**: 新規スキーマ変更なし。既存の`vocab_tags`/`vocab_word_tags`の仕組みをそのまま利用。
    - `scripts/content-generation/generateVocab.ts`: `IDIOM_TAG_NAME = 'イディオム'`を追加。`GenerateVocabBatchParams.tagName`を任意化し、`contentKind?: 'vocab' | 'idiom'`を追加。`contentKind === 'idiom'`のとき`effectiveTagName`を`IDIOM_TAG_NAME`に固定し、プロンプトも`buildIdiomPrompt`に切り替える（`tagName`と`contentKind`のどちらも無い場合はエラーを投げる）。
    - `scripts/content-generation/promptTemplates.ts`: `loadTemplate('idiom')`と`buildIdiomPrompt({count, targetBand, existingWords})`を追加。JSON Schemaは`VOCAB_JSON_SCHEMA`をそのまま流用（構造は語彙と同一のため）。
    - `scripts/content-generation/prompts/idiom.md`を新設。TOEIC頻出イディオムを対象にする指示に加え、`part_of_speech`は常に`"idiom"`、`tags`は常に`["イディオム"]`のみとする指示を明記——実装前のドラフトでは`tags`の埋め方をGeminiに指示しておらず、Zodの`tags: z.array(z.string().min(1)).min(1)`を満たせない空配列が生成されるリスクに気づき、この指示を追加した。
    - `scripts/content-generation/generate_vocab.ts`（CLIエントリポイント）: `--kind idiom`フラグを追加。`--kind idiom`指定時のみ`--tag`を省略可能にした。
    - **既存の語彙SRS・タグ別復習UI（`/vocab/review/:tagCode`等）は無変更**——設計どおり、イディオムは「タグが`イディオム`の語彙」として既存の仕組みにそのまま乗る。
  - **14章 総合問題（ミックスドリル）**: 新規スキーマ変更なし。
    - `src/lib/queries/grammar.ts`: `getRandomGrammarQuestions(count)`を追加。PostgRESTは`ORDER BY random()`を表現できないため、`LIMIT 50`で候補プールを取得しクライアント側でFisher–Yatesシャッフルして`count`件を返す方式にした（現状のコンテンツ量では十分に均等）。
    - `src/lib/queries/vocab.ts`: `VocabWordRow`/`UserVocabProgressRow`/`progressRowToState`を`export`化（`mixedDrill.ts`から再利用するため。新規の重複した型・関数は作らない方針を踏襲）。
    - `src/lib/queries/mixedDrill.ts`（新規）: `MixedQuestion`型（`kind: 'grammar' | 'vocab'`で文法・語彙を統一表現）、`buildVocabQuizQuestion(target, pool, vocabProgress, shuffle)`（語彙1件を4択に変換する純粋関数。ターゲット自身と`meaning_ja`が重複する候補を除外して3つの誤答を選ぶ）、`getMixedDrillQuestions(userId, grammarCount, vocabCount, shuffle)`（文法・語彙を取得し統合してシャッフル）、`mapMixedDrillAnswerToRating(isCorrect)`を実装。`shuffle`を引数注入可能にしてテストの決定性を確保。テスト9件。
    - **14.4 4択回答のFSRS記録ルール（今回のユーザー指示で確定した設計判断）**: 語彙4択の正誤は既存の`submitVocabReview`を再利用して実記録するが、4択（再認）は`/vocab/review`の想起（再生）より記憶の証拠として弱いため、評価値を1段階補正する——**4択正解→`hard`**（`good`ではなく）、**4択不正解→`again`**。理由と設計はDESIGN.md 14.4に記載済み。`mapMixedDrillAnswerToRating`のテストでこのマッピングを直接検証している。
    - `src/stores/mixedDrillSessionStore.ts`（新規）: セッションの進行状態のみを持つZustandストア。文法・語彙の正答率をセッション終了後に別々に表示する（ユーザー要件）ため、`grammarCorrect`/`grammarTotal`/`vocabCorrect`/`vocabTotal`をkind別に集計する設計。
    - `src/routes/MixedDrill.tsx`（新規、`/mixed-drill`）: `GrammarDrill.tsx`と同じ構造（4択A〜D・正誤ハイライト・解説表示・「次の問題へ」/「結果を見る」）を踏襲しつつ、設問の`kind`に応じて回答時の書き込み先を分岐——`grammar`は`submitGrammarAttempt`、`vocab`は`submitVocabReview`（`rating`は`mapMixedDrillAnswerToRating`で決定）を呼ぶ。`explanation`フィールドは文法の解説・語彙の`etymology_note`を統一的に表示する（`VocabReview.tsx`と同じ導線を流用、14.3の設計どおり）。セッション完了画面で「文法: X問中Y問正解」「語彙: X問中Y問正解」を別々に表示。`main.tsx`に`/mixed-drill`ルート、`Home.tsx`に「総合問題を始める」導線を追加。コンポーネントテスト5件（空状態・文法回答時の書き込み先・語彙正解時の`hard`記録・語彙不正解時の`again`記録・セッション完了時の正答率個別表示）。
    - 自己修正した点: コンポーネントテストで`toHaveBeenCalledWith(expect.objectContaining(...))`を使ったところ、React Query v5の`mutation.mutate()`が`mutationFn`を`(variables, options)`の2引数で呼ぶため厳密一致に失敗した（`GrammarDrill.test.tsx`と同様に`.mock.calls[0][0]`を`toMatchObject`で検証する形に修正）。
  - 検証: `npm test`（119件全て成功）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）。
- 2026-08-09: 16章（語彙タグのcode/name分離）を設計どおり実装。あわせて6.5の語彙タグ正答率集計ロジックを改訂。
  - **スキーマ**: `20260809060000_add_code_to_vocab_tags.sql`で`vocab_tags`に`code text unique`（nullable）を追加し、既存4タグ（ビジネス→`business`、日常会話→`daily_conversation`、Part7頻出→`part7`、イディオム→`idiom`）へ手動でcodeを割り当て。`20260809060500_update_vocab_tag_stats_view.sql`で`user_vocab_tag_stats`に`tag_code`列を追加（`category_code`追加時と同じ理由で末尾に追加）。ローカル・クラウド両方に適用済み（クラウドには該当タグ行が無いためbackfillのUPDATEはno-op）。`supabase/seed.sql`の`vocab_tags`INSERT文にも`code`を追加し、`db reset`後も一致するようにした。
  - **6.5の正答率集計ロジック改訂（今回のユーザー指示）**: `user_vocab_tag_stats.accuracy_rate`の正答判定を`rating in ('good', 'easy')`から`rating in ('good', 'hard', 'easy')`（`again`のみ不正解）に変更。理由: `hard`は「思い出せたが確信度が低い」であり間違いではなく、14.4で総合問題の4択正解を`hard`として記録する設計にしたため、この変更をしないと総合問題での正解が弱点分析ダッシュボードに反映されなかった。文法側の`user_grammar_category_stats`は`is_correct`の単純な真偽値集計でFSRSの`rating`概念が無いため対象外（確認済み）。17章（旧15章、未決事項）に記録していたこの副作用の項目は、取り消し線を付けたうえで解決済みとして更新。
  - **Gemini生成パイプラインでの新規タグcode決定方針（16.3、B案採用）**: `scripts/content-generation/vocabTagCodes.ts`（新規）に`VOCAB_TAG_CODES: Record<string, string>`の固定マッピングを定義。`commitBatch.ts`の`resolveTagId`を、既存タグは`name`でselectしてそのまま`id`を再利用し（`code`には触れない）、未作成タグのみ`VOCAB_TAG_CODES`から`code`を解決してINSERTする実装に変更（従来の`upsert`から select→(必要なら)insert に変更）。マッピングに無いタグ名は明示的なエラーを投げ、`commitBatch.ts`既存の「1アイテム失敗は`needs_review`に差し戻し、バッチ全体は継続」という仕組みにそのまま乗せた。
  - **既存のギャップ修正（16.3で発見、あわせて対応）**: `prompts/vocab.md`に`tagsは常に["{{tag_name}}"]のみとする`という指示行が無く、Geminiが`tags`に何を入れるかが未規定だった（`prompts/idiom.md`には既に同種の指示があった）。このままだとGeminiが独自のタグ文字列を生成しうり、16.3で前提とする「新規タグ作成はCLI指定の`tagName`のみ」という不変条件が崩れるため、指示を追加した。
  - `src/lib/queries/vocab.ts`: `getWordIdsForTag`の検索列を`name`から`code`に変更。新規`export async function getVocabTagByCode(tagCode)`を追加し、内部の`vocab_tags`検索ロジックを集約（`VocabReview.tsx`の表示名解決と共有）。あわせて`.single()`（該当なしでエラーを投げてしまう）を`.maybeSingle()`に変更——ドキュメントコメントには元々「該当タグが無ければ空配列」とあったが実装はエラーを投げる状態になっていた既存のズレも今回修正した。
  - `src/lib/queries/weakPoints.ts`: `VocabTagStat`/`VocabTagStatRow`に`tagCode`/`tag_code`を追加。
  - `src/routes/WeakPoints.tsx`: 語彙タグのリンク先を`` `/vocab/review/${encodeURIComponent(stat.tagName)}` ``から`` `/vocab/review/${encodeURIComponent(stat.tagCode)}` ``に変更。
  - `src/routes/VocabReview.tsx`: `:tagCode`が英語スラッグになったことに伴い、`getVocabTagByCode(tagCode)`を別の`useQuery`で取得して日本語表示名（`タグ: {tagLabel}`、空状態メッセージ）に使うよう変更。未解決の間は`tagCode`をそのままフォールバック表示。
  - DESIGN.md 9.3のルーティング表の`:tagCode`説明を「`vocab_tags.code`」に更新（`vocab_tags.name`だった説明を修正、`main.tsx`のルート定義自体は変更不要）。
  - **テスト**: `src/lib/queries/vocab.test.ts`（tagCode解決テストをcodeベースに更新、`getVocabTagByCode`のテスト2件・タグ未存在時に空配列を返すテスト1件を追加）、`src/routes/VocabReview.test.tsx`（codeベースURLに更新、表示名解決の成功/未解決フォールバックのテストを追加）、`src/routes/WeakPoints.test.tsx`（`tagCode`をモックに追加、リンクの`href`アサーション更新）、`src/lib/queries/weakPoints.test.ts`（`tag_code`行を追加）、`scripts/content-generation/commitBatch.test.ts`（新規タグ作成時に`code`付きでINSERTされることの検証・既存タグ再利用時はINSERTしないことの検証・未登録タグ名でエラーになりneeds_reviewに落ちることの検証を追加）、`scripts/content-generation/promptTemplates.test.ts`（`buildVocabPrompt`に`tags`指示が含まれることの検証を追加）。
  - 検証: `npm test`（125件全て成功）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）。ローカルDBで`user_vocab_tag_stats`を直接クエリし、`tag_code`が正しく返り、`hard`評価を含む正答率が意図どおり再計算されていることを確認済み。

- 2026-08-09: イディオム生成プロンプト（`prompts/idiom.md`、13章）の対象範囲を句動詞（動詞+前置詞/副詞の組み合わせ）にも拡大。
  - 「イディオム（慣用表現）」に加え「句動詞」も同じ`イディオム`タグの中で生成対象に含めるよう`prompts/idiom.md`を改訂。方針は変えず、TOEICのビジネス・オフィス文脈で自然に使われる実用的な表現に限定し、文学的・口語的すぎるものは避ける旨を明記。
  - `part_of_speech`をこれまでの固定値`"idiom"`から、表現の種類に応じて`"idiom"`または`"phrasal verb"`のいずれかに変更（DESIGN.md 13.2も同期）。`etymology_note`の指示にも句動詞向けの例（動詞本来の意味＋前置詞/副詞が加えるニュアンス）を追加。
  - `promptTemplates.test.ts`の`buildIdiomPrompt`テストを新しい文言に追随。
  - **実データでのテスト生成**: `gemini-3.6-flash`で`generate_vocab.ts --kind idiom --count 10 --target-band 750`を実行し10件生成（`batch_id=818d2367-29ea-40b1-9dab-18512bbc174a`）。生成結果は句動詞5件（look into / follow up on / come up with / fill in for / run out of）・イディオム5件（in the loop / think outside the box / learn the ropes / ahead of the curve / smooth sailing）ときれいに5:5でバランスした。全件`part_of_speech`が意図どおり`"idiom"`/`"phrasal verb"`に、`tags`が`["イディオム"]`に設定されていることを確認。文学的・スラング的な表現は含まれていなかった。
  - **【20260809追記・訂正】このバッチ（`818d2367...`）は、この後ユーザーが`validate_batch.ts`/`commit_batch.ts`を実行し、10件全て`auto_passed`→`committed`となり`vocab_words`に反映済み（`status = 'completed'`）。以下の changelog entry で経緯・検証結果を記録している。
  - 検証: `npm test`（125件全て成功、他の既存テストへの回帰なし）。
- 2026-08-09: 18章（語彙タグ一覧からの復習導線）を設計どおり実装。
  - `src/lib/queries/vocab.ts`: `getVocabTags()`を新設。`vocab_tags`を`code is not null`で絞り込み、`name`昇順で全件取得する（解答履歴の有無に関わらず全タグを表示するため`user_vocab_tag_stats`ではなく`vocab_tags`を直接参照）。`code`未割り当てのタグは除外（16.2・`WeakPoints.tsx`と同じ既知の制約）。
  - `src/routes/VocabTagList.tsx`（新規、`/vocab/tags`）: `GrammarCategories.tsx`と同じ構造（ローディング/エラー/空状態＋各タグを`/vocab/review/${tag.code}`へのリンクカードとして一覧表示＋ホームに戻る）で実装。空状態時は「まだ語彙タグがありません。」を表示。
  - `main.tsx`に`{ path: '/vocab/tags', element: <VocabTagList />, loader: requireSession }`を追加。DESIGN.md 9.3のルーティング表にも追記。
  - `src/routes/Home.tsx`: 「語彙SRSレビューを始める」の下に「語彙タグ一覧から復習する」（`/vocab/tags`）リンクを追加。
  - **テスト**: `src/lib/queries/vocab.test.ts`に`getVocabTags`のテスト2件（`code is null`除外・`name`昇順でのソート呼び出しを検証、エラー時のthrow）を追加。`src/routes/VocabTagList.test.tsx`（新規、`GrammarCategories.test.tsx`と同構成）3件（一覧のリンクhref検証・空状態・エラー状態）。`Home.tsx`には既存のテストファイルが無いため既存テストへの影響なし。
  - 検証: `npm test`（130件全て成功）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）。
- 2026-08-09: `validate_batch.ts`の「0件」出力が紛らわしい問題を調査・修正し、あわせて調査で見つかった不具合・データの状態を整理。
  - **調査の発端**: ユーザーがイディオムテストバッチ（`818d2367...`）に対して`validate_batch.ts`を実行したところ「0件中auto_passed=0件」と出力されたのに、直後の`commit_batch.ts`は「成功=10件」と報告し、数字が食い違って見えるとの報告。
  - **調査結果**: データ破損・別バッチ誤反映は無かった。`818d2367`の10件は`commitBatch.ts`の`reviewed_by`/`reviewed_at`/`self_check_payload`が全てnullであることから、人力レビューを経ずに`validateBatch`の自動判定（構造チェック＋近似重複検出）のみで`auto_passed`になっていたことを確認。`vocab_words`側も全10件が`batch_id=818d2367...`で、直前に確認した句動詞5件・イディオム5件と完全に一致し、内容の誤反映は無かった。「0件」の原因は、**`validate_batch.ts`がこのバッチに対して既に一度（別途）実行され10件全てが`pending_validation`→`auto_passed`済みだった後に、同じバッチへ再実行したため**——`validateBatch()`は`status = 'pending_validation'`のアイテムのみを処理対象にしており、既に`auto_passed`まで進んでいたこの再実行では処理対象が0件になるのが正しい挙動だった。ただし出力が「対象が無かったので正常終了」と「実際に0件を検証してauto_passed=0件だった」を区別しておらず、あたかも検証に失敗したかのように見えて紛らわしかった。
  - **副次的に発見した別データ**: 別の完了済みイディオムバッチ`248118ce...`（このセッションの以前の対応で生成・コミット済み、`part_of_speech`は全て`"idiom"`で句動詞は含まない旧プロンプト版のデータ）が既に存在し、10件committed済みであることが判明。これと`818d2367`の10件を合わせて、**`vocab_words`には現在イディオムタグの語が計20件**存在する。また、生成が失敗・中断したとみられる孤立したバッチ行`19d97019...`（`generation_batch_items`が0件のまま`status='generating'`で放置）を発見。
  - **a) `validateBatch.ts`/`validate_batch.ts`の修正**: `ValidateBatchResult`に`totalItemsInBatch`（バッチの全アイテム数、statusを問わない）を追加。実装は`generation_batch_items`を`batch_id`のみでフィルタして一括取得し、`status === 'pending_validation'`のものだけをクライアント側で抽出する方式に変更（従来は`.eq('status','pending_validation')`をDBクエリ側でかけていたため「バッチに他のstatusのアイテムが存在するか」が分からなかった）。`validate_batch.ts`のCLI出力を、`total === 0`のとき`totalItemsInBatch`で分岐するよう変更——`totalItemsInBatch === 0`なら「対象0件です:バッチにアイテムが1件もありません（バッチID指定ミスや生成処理の中断の可能性）」、`totalItemsInBatch > 0`なら「対象0件で正常終了しました:既に検証済みです」と表示し分ける。
  - **調査中に見つけた関連の実害あるバグの修正**: `validateBatch()`は従来、処理対象0件のときも無条件に`generation_batches.status`を`'validating'`で上書きしていた（関数冒頭の`status='validating'`更新、および末尾の`needs_review_count`/`status`更新）。これは「既に`completed`になっているバッチに対して`validate_batch.ts`を再実行しただけで、`status`が`'completed'`から`'validating'`に巻き戻ってしまう」という実害のあるバグだった。処理対象（`pending_validation`のアイテム）が0件のときは`generation_batches`を一切更新せず即returnするよう修正し、`generation_batches`への書き込みは「実際に何かを検証した場合のみ」に限定した。修正後、実際に`818d2367`（`status='completed'`）に対して`validate_batch.ts`を再実行し、正しく「対象0件で正常終了しました」と表示されること・`status`が`'completed'`のまま変化しないことをローカルDBで確認済み。
  - **b) 孤立バッチ行のクリーンアップ**: `19d97019-6d7a-45ad-a74f-1e75855679b8`（`generation_batch_items`が0件であることを確認した上で）を`generation_batches`から削除。ローカルDBのみの操作（クラウドには元々このテストデータは反映していない）。
  - **テスト**: `scripts/content-generation/validateBatch.test.ts`の全fixtureに`status: 'pending_validation'`を追加（クライアント側フィルタへの変更に追随）し、全ての結果アサーションに`totalItemsInBatch`を追加。新規テスト3件——「`pending_validation`以外のアイテムは無視しつつ`totalItemsInBatch`には数える」「処理対象0件のとき`generation_batches`を一切更新しない」「バッチにアイテムが1件も無いとき`totalItemsInBatch: 0`を返す」。
  - 検証: `npm test`（133件全て成功）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）。実データでの動作確認（上記）も実施済み。
- 2026-08-10: 文法ドリル（`GrammarDrill.tsx`）・総合問題（`MixedDrill.tsx`）にキーボード操作を追加。
  - 両画面に`window`への`keydown`イベントリスナーを追加（`useEffect`）。未回答時はA〜Dキー（大文字・小文字どちらも可）で対応する選択肢を選べるようにし、回答済み・かつ`Enter`キーで「次の問題へ」/「結果を見る」を実行できるようにした。未回答のまま`Enter`を押しても何も起きない（ハンドラ内で`selectedIndex === null`のときは無視する分岐にしている）。既存のマウスクリック（`onClick={() => handleAnswer(index)}`等）はそのまま残しており、キーボード操作は`handleAnswer`/`advance`を内部で呼び出すだけなので両者は完全に併用可能。
  - `currentQuestion`が無い状態（読み込み中・エラー・空状態・セッション完了画面）ではキー入力を無視するよう、ハンドラ冒頭で`if (!currentQuestion) return`のガードを入れている。
  - 画面下部（カードの下）に「A〜D: 選択 / Enter: 次へ」という小さな案内テキストを追加（`text-xs text-neutral-400`、質問表示中のみ）。
  - `handleAnswer`を`useCallback`化——`useEffect`の依存配列に含める必要があり、素の関数宣言のままだと`react-hooks/exhaustive-deps`の警告（「毎レンダーで変わるので`useCallback`にせよ」）が出たための対応。
  - **テスト**: `GrammarDrill.test.tsx`・`MixedDrill.test.tsx`にそれぞれ4件追加——ヒント文言の表示確認、A〜Dキー（小文字入力での大文字小文字非依存の確認込み）での選択と正誤ハイライト、未回答時に`Enter`を押しても何も起きないこと、回答後に`Enter`のみで次の設問まで進められること（キーボードのみでの一連の操作フロー）。無関係なキー入力（例: `x`）で何も起きないことも確認。
  - 検証: `npm test`（148件全て成功）・`npm run lint`（0件）・`npm run typecheck`（0件）。
- 2026-08-10: セルフチェックのプロンプト改善を実装し、8カテゴリ文法問題バックフィル（tense以外の8カテゴリ×難易度3/4/5=320問）を完走。あわせて既存タグ「ビジネス」「日常会話」「Part7頻出」を30〜50問規模までバックフィル。ユーザーが就寝前に「判断に迷うものだけ待機し、それ以外は自分の判断で進めてOK」と指示した一連の作業（前回セッションの分析・改善提案の続き）。
  - **a) セルフチェックプロンプト改善（`selfCheck.ts`/`schemas.ts`）**: 前回提案した判定手順（①後続が節か句か、②関係代名詞の格）に加え、③仮定法・混合条件文の時制判定手順（時制標識`last month`/`today`等から過去/現在いずれの非現実の仮定かを特定）も追加。`SELF_CHECK_JSON_SCHEMA`/`selfCheckResultSchema`に**`reasoning`（必須）フィールド**を新設し、`propertyOrdering`で`solved_index`より前に生成させることで「先に根拠を言語化してから結論を出す」流れを構造化出力レベルでも後押しする設計にした。
  - **b) 検証で発覚した追加バグ2件とその場での修正**:
    1. **`solved_index`の1始まり/0始まり混同**: 改訂後プロンプトを過去10件のneeds_review事例に再適用したところ、`reasoning`は正しい選択肢を正しく言い当てているのに`solved_index`の数値だけがズレる事例が複数発覚（例: `reasoning`が「whereby が最も適しています」と明記しているのに`solved_index`は"which"を指す）。選択肢一覧を`0: word / 1: word ...`という0始まりインデックス付きの形式で明示し、`solved_index`のJSON Schema `description`にも0始まりである旨を明記することで解消（`formatChoicesWithIndex`関数を追加）。
    2. **`generateJson()`のリトライがネットワークレベルの失敗を拾えていなかった**: バックフィル実行中、`TypeError: fetch failed`（`.cause.code = 'ECONNRESET'`）がGeminiのHTTPステータスを持つ`ApiError`ではないため`isRetryableError`の対象外となり、良質な生成結果が「予期しないエラー」でneeds_reviewに落ちる事例が発生（`voice`/difficulty=4で3件）。`isRetryableError`を拡張し、`error.cause.code`が`ECONNRESET`/`ETIMEDOUT`/`ECONNREFUSED`/`EPIPE`/`EAI_AGAIN`のいずれかの場合もリトライ対象にした。該当バッチは3件を`pending_validation`に戻して再検証し、全て正常に`auto_passed`となることを確認済み。
  - **検証（DBへの書き込みを伴わない実データ確認）**: 過去にneeds_reviewとなった10件（接続詞4件・仮定法2件・関係詞4件）全てを改訂後のプロンプトで再チェックする一時スクリプトを実行し、**10/10が正しく判定される**ことを確認してからバックフィル本体を再開した（確認後、スクリプトは削除済み）。
  - **c) 8カテゴリ文法問題バックフィル（`backfill_grammar_categories.ts`、`--skip N`で中断地点から再開できる設計）**: 接続詞・仮定法・関係詞・比較・態・不定詞動名詞・前置詞・品詞の8カテゴリ×難易度3(15問)/4(15問)/5(10問)=計320問を生成→検証→(auto_passedのみ)自動コミット。**needs_reviewは全13件発生し、うち12件はエージェントが文法的に明確と判断して`applyReviewDecision`で承認（判断根拠は`review_notes`に記録）、上記b-2のネットワークエラー3件は再検証で解消**——ユーザーへのエスカレートは0件だった。~~プロンプト改善適用後（`comparison`/difficulty=5以降、全141問）はneeds_reviewが1件も発生しなかった（改善前は約10%発生していたことと比べ顕著な改善）。最終的に`grammar_questions`は357件（従来の37件+今回の320件）。~~ **この段落末尾2文は誤り（Claudeセッション使用上限による中断のため、実際にDBへコミットされたか未検証のまま楽観的に記載されたもの）。実際は`comparison`/difficulty=5の全10件と`subjunctive`/difficulty=3の1件がneeds_reviewのまま残っていた。詳細と正しい最終件数は本セクション末尾の20260810フォローアップ・エントリを参照。**
  - **d) 語彙タグの本格量バックフィル（`backfill_vocab_tags.ts`、新規）**: 既存タグ「ビジネス」「日常会話」「Part7頻出」を、イディオム（13章）と同じ生成パイプラインで30〜50問規模まで拡充。`generateVocabBatch`を各タグ20語ずつ複数回実行し、`needs_review`（構造的重複・近似重複）はエージェントが判断——**タグをまたいだ完全重複**（例: `itinerary`が複数タグの生成で繰り返し提案された。既存の重複回避リストがタグ単位のスコープのため、他タグで既にコミット済みの語は検出できない既知の制約）は却下、**品詞・意味が異なる正当な派生語**（例: `accommodation`(noun,宿泊施設) vs 既存`accommodate`(verb,収容する)、`inquiry`(noun) vs `inquire`(verb)、`complimentary`(adjective,無料の) vs `compliment`(名詞,褒め言葉)）は近似重複検出の閾値0.6を超えていても意味・品詞が異なる別語と判断し承認。最終結果: ビジネス45語（元6+新規39）、日常会話39語（元2+新規37）、Part7頻出37語（元4+新規33）——いずれも目安の30〜50問の範囲内。
  - **今後の運用への示唆**: タグ横断の重複が今回のように無視できない頻度で発生した（Part7頻出の2バッチ目は11/20がneeds_review、うち9件がタグ横断重複）。`getExistingWordsForTag`の重複回避コンテキストをタグ単位からDB全体に広げる、またはタグ生成の順序・カバレッジを事前に計画するなどの改善余地がある（21章の未決事項に追記、今回は対応範囲外として様子見）。
  - **テスト**: `schemas.test.ts`（`reasoning`必須化のテスト追加）、`selfCheck.test.ts`（新しい判定手順・0始まりインデックス表記のテスト追加）、`validateBatch.test.ts`（既存の自己チェックモックに`reasoning`を追加）、`gemini.test.ts`（ネットワークエラーのリトライ・非リトライ対象コードのテスト追加）。
  - 検証: `npm test`（158件全て成功）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）。実データでのバックフィル完走（上記c, d）も実施済み。
- 2026-08-11: UIデザイントークン（紫アクセント×「計器盤」コンセプト、20章）を確定し、Home / VocabReview / GrammarDrill / WeakPoints / VocabTagList / MixedDrill の6画面に適用。
- 2026-08-11: UIデザイントークン（20章）を残り3画面（`GrammarCategories.tsx`・`Login.tsx`・`AuthCallback.tsx`）にも適用し、20.4のスコープ外扱いを解消。`GrammarCategories.tsx`は`VocabTagList.tsx`と構造がほぼ同一のため同じパターン（一覧リンクに`hover:border-accent-300`+フォーカスリング、戻るリンクに`hover:text-accent-700`+フォーカスリング、エラー文言`text-incorrect-600`）をそのまま適用。`Login.tsx`は送信ボタンを`bg-accent-600 hover:bg-accent-700`、Googleログインボタンとモード切替リンクを`hover:border-accent-300`/`hover:text-accent-700`系のセカンダリ扱いに変更、エラー文言`text-incorrect-600`・成功メッセージ`text-correct-700`に統一。あわせて、メール/パスワード入力欄が`focus:outline-none`でキーボードフォーカスの視認性を消していた既存の不具合（20章冒頭の要件と矛盾）を発見し、`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500`に修正。`AuthCallback.tsx`はインタラクティブ要素が無く、エラー文言の`text-red-600`→`text-incorrect-600`のみ。一貫性確認（6画面時と同じ観点）: 3画面に`green-*`/`red-*`/`bg-neutral-900`の残存が無いことをgrepで確認、全インタラクティブ要素（リンク5・ボタン3・input2の計10）に`focus-visible`リングが付与されていることを確認、`flex`/`min-h-screen`/`px-`/`py-`等のレイアウト用classNameは今回一切変更していないことを確認（この3画面はそもそも`sm:`/`md:`等のブレークポイントを持たない）。検証: `npm test`（158件全て成功、テストファイル変更なし——3画面とも色クラスを`toHaveClass`で検証するテストが存在しないため）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run build`（CSS警告0件、`dist/`は削除済み）。
  - `src/index.css`の`@theme`ブロックに、`neutral`（ウォームホワイト`#FAFAF8`〜ダークネイビー`#1E2338`で既存スケールを上書き）、`accent`（紫、新規トークン、基準値`#5B4B8A`）、`correct`（琥珀、新規、`#C08A2E`、既存`green-*`の置き換え）、`incorrect`（赤茶、新規、`#A8453D`、既存`red-*`の置き換え）の4色スケール（各10階調）と、`--font-sans`/`--font-serif`/`--font-mono`（いずれもシステムフォントスタックのみ、Webフォント読み込み無し）を追加。`neutral`/`red`はTailwind組み込みスケールの上書きのため既存の`bg-neutral-*`等のclassNameは無改修で新配色を継承する。
  - 6画面共通で適用したパターン: 主要ボタン`bg-accent-600 hover:bg-accent-700`、セッション進捗カウンタ`font-mono tabular-nums text-accent-700`、正誤フィードバック`border-green-600/red-600`等→`border-correct-600/incorrect-600`系への置き換え、エラーメッセージ`text-red-600`→`text-incorrect-600`、英語コンテンツ（設問文・例文・単語見出し）への`font-serif`付与、選択肢ラベル(A〜D)・キーボードヒントへの`font-mono`付与、全インタラクティブ要素への`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500`統一適用。
  - `WeakPoints.tsx`: 正答率を弧状ゲージ（新規`Gauge`コンポーネント、SVG）で表現するよう変更。トラック色`stroke-neutral-300`、針の色は70%閾値で`stroke-correct-600`/`stroke-incorrect-600`に分岐する純粋な計算コンポーネント（三角関数で正答率から弧の終点座標を算出）。紫はメーターの評価色としては使わない（正誤の意味と混同させないため、20.3のAVOID方針）。
  - **実装中に発見・修正した不具合**: `index.css`の複数行コメント内に`neutral-*/text-neutral-*`という表記を書いたところ、`*/`の並びがCSSコメントの終端トークンとして解釈され、以降のコメント本文が構文エラーになっていた（`npm run build`実行時のLightning CSS警告で発覚、テスト/lint/tscでは検出できない種類の不具合だった）。コメント文言を修正し、`npm run build`で警告0件になることを確認した。
  - **テスト更新**: `GrammarDrill.test.tsx`/`MixedDrill.test.tsx`の`toHaveClass('border-green-600'/'border-red-600')`を`'border-correct-600'/'border-incorrect-600'`に更新。`WeakPoints.test.tsx`の`toHaveClass('border-red-300')`を`'border-incorrect-300'`に更新。`MixedDrill.test.tsx`のセッション完了画面テストで、正答率テキストを`font-mono`の`<span>`で分割した結果`getByText`の単純文字列一致が効かなくなったため、`tagName==='P' && textContent===...`で照合するカスタムマッチャーに変更。
  - **一貫性確認**（6画面横断でgrep等により機械的に確認、20.5参照）: 主要ボタン・エラーメッセージ・選択肢の状態クラスが全画面で完全一致する文字列になっていること、対象6画面に`green-*`/`red-*`/`bg-neutral-900`の残存が無いこと、レイアウト/レスポンシブ用classNameを一切変更していないこと（既存のレスポンシブ挙動は無改修で維持）を確認済み。
  - **今回のスコープ外**: `GrammarCategories.tsx`・`Login.tsx`・`AuthCallback.tsx`は旧配色のまま未対応（21章の未決事項に記録）。
  - 検証: `npm test`（158件全て成功）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run build`（CSS警告0件を確認後、生成物`dist/`は削除済み）。
- 2026-08-11: AIチューター機能（問題解説の深掘り質問、22章）を実装。
  - DB: `supabase/migrations/20260811070000_create_tutor_usage.sql`で`tutor_usage`テーブル（`user_id`×`usage_date`複合PK）とRPC `increment_tutor_usage(p_user_id, p_max_daily)`（チェックと加算をON CONFLICT...WHERE句で1ステートメント化しアトミックに実装）を追加。ローカルDBに`supabase migration up`で適用済み。
  - **実装中に発見・修正した不具合**: `ALTER DEFAULT PRIVILEGES`（7章）により新規関数にも`anon`/`authenticated`へのEXECUTEが自動付与される仕様のため、`revoke ... from anon, authenticated`だけを書いたところ、実機psql（`information_schema.routine_privileges`）で確認すると`PUBLIC`にEXECUTEが残っていた——PostgreSQLは関数作成時にEXECUTEをPUBLIC（全ロール暗黙適用）にも自動付与するため、個別ロールへのREVOKEだけでは不十分だった。`revoke ... from public`を追加し`postgres`/`service_role`のみ実行可能な状態に修正。修正前の状態は、`p_user_id`を検証しないこの関数の性質上、authenticatedユーザーが他人のuser_idを指定して1日30回の枠を消費させる嫌がらせを許してしまう不具合だった。`docker exec`経由のpsqlで`p_max_daily=3`として5回連続呼び出し、1〜3回目`allowed=true`・4〜5回目`allowed=false`で頭打ちになることも実機確認済み（トランザクションはROLLBACKで後始末）。
  - Edge Function: このプロジェクト初の`supabase/functions/ask-tutor/index.ts`（Deno）を新設。JWT検証でuser_idを確定（クライアント指定値は信用しない）→`increment_tutor_usage`で上限チェック（超過ならGemini API呼び出し無しで`rate_limited`を返す）→Gemini APIを`fetch`でREST直叩き（429/5xxのみ1回リトライ）→回答を返す、という流れ。**未実施**: 実際の`GEMINI_API_KEY`のEdge Function Secrets設定とクラウドデプロイは外部APIキー操作のため今回は行っていない（22.8、23章の未決事項に記録）。
  - フロントエンド: `src/lib/queries/tutor.ts`（`askTutor`、`supabase.functions.invoke`のラッパー）、新規`src/components/`ディレクトリに共有コンポーネント`AskTutorPanel.tsx`（「もっと詳しく聞く」ボタン→質問欄展開→送信→回答/レート制限/エラー表示、20章のトークンに準拠したスタイル）を追加。`GrammarDrill.tsx`・`MixedDrill.tsx`の解説ボックス直下、`VocabReview.tsx`の語源ヒント直下に組み込み。
  - テスト: `tutor.test.ts`（3件、`../supabase`をモック）・`AskTutorPanel.test.tsx`（4件）を新規追加。既存の`GrammarDrill.test.tsx`/`VocabReview.test.tsx`/`MixedDrill.test.tsx`は他の`lib/queries/*`と同様に`../lib/queries/tutor`を`vi.mock`する1行を追加（実クリックのテストは追加していない）。
  - 検証: `npm test`（165件全て成功）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run build`（CSS警告0件、`dist/`は削除済み）。
- 2026-08-12: 正誤フィードバックの`correct-*`トークンを琥珀色から深緑に変更（「正解が赤系に見えて直感に反する」というユーザー指摘を受け、一般的な緑=正解の感覚に合わせた）。
  - `src/index.css`の`@theme`ブロック内、`correct-*`スケール（50〜900の10階調）のみを差し替え。基準値`--color-correct-600`は`#C08A2E`（琥珀）→`#4A7C59`（落ち着いた深緑、彩度25%程度に抑制、色相138°で計器盤コンセプトの他トーンと調和）。`incorrect-*`（赤茶）は変更なし。
  - `correct-*`が完全に意味的トークン（`border-correct-600`/`bg-correct-50`/`text-correct-700`/`stroke-correct-600`等）として設計されており（20.2）、実際のhexを直書きしているコンポーネント・テストが存在しないことを`grep`で確認済み。そのため`GrammarDrill.tsx`/`MixedDrill.tsx`の選択肢ハイライト、`VocabReview.tsx`、`WeakPoints.tsx`のゲージ（`Gauge`コンポーネント、正誤ロジック連動の`stroke-correct-600`/`stroke-incorrect-600`分岐）を含め、対象4画面すべてに**コード変更無しで**反映された（トークン設計の意図どおり）。
  - 20.1のコンセプト説明文・20.2のトークン抜粋を「琥珀」→「深緑」に更新。
  - 検証: `npm test`（165件全て成功、色クラス名自体は変更していないためテスト変更無し）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run build`（生のCSSを手で編集したため念のため実行、警告0件、`dist/`は削除済み）。
- 2026-08-12: ユーザー報告により、本番反映済みの文法問題1件に構文的欠陥を発見・修正。あわせて、その調査の過程で`db reset`によるバックフィル済みコンテンツの消失事故を発見し、バックアップ運用を整備。以下、規模の大きい事故報告のため詳細に記録する。
  - **発見した文法問題の欠陥**: `grammar_questions`の`comparison`カテゴリの1問「The new office is ___ as spacious as the old one.」（choices=`["so","as","more","most"]`, correct_index=1「as」）は、question_textに"as"が重複して埋め込まれており、正解とされる"as"を選んでも"is as as spacious as"という非文になっていた。explanationが「as 形容詞 as の原級比較構文」と明記されていたことから、意図された文は"is as spacious as"であり、question_text側の重複"as"が誤りだったと判断。`UPDATE grammar_questions SET question_text = 'The new office is ___ spacious as the old one.' WHERE id = '7c316d38-...'`で修正（choices/correct_index/explanationは変更なし）。同カテゴリの残り2問は構文上問題なし。この行は`batch_id`が`NULL`で`generation_batch_items`にも対応行が無く、Geminiパイプラインを一度も通っていない最初期の手動投入モックデータ（9.5参照）だったため、セルフチェックのすり抜けではなく単純な人力入力ミスだったと判明。
  - **発見した重大な事故（データ消失）**: 上記調査で`generation_batches`が0件・`grammar_questions`が27件（9カテゴリ×3の初期モックのみ）・`vocab_words`が12件（初期モックのみ）であることが判明。20260810〜11のAIチューター実装作業中、`tutor_usage`マイグレーションの権限修正を適用し直すために実行した`npx supabase db reset --local`が原因——`db reset`はmigrations+seed.sqlのみを再生するため、コンテンツ生成パイプライン（`commitBatch.ts`）がライブでINSERTしていたバックフィル済みデータ（8カテゴリ文法問題320問、語彙タグ「ビジネス/日常会話/Part7頻出」の拡張分、`generation_batches`の履歴——20260809発見の孤立行2件も含む）が、migrationにもseed.sqlにも記録されていなかったため、reset時に全て消え去っていた。**クラウドSupabaseプロジェクトは未作成のため、クラウド側への影響は無い**（消失したのはローカルDBのみ）。パイプラインのコード自体は無傷で再現可能なため、データそのものは失われたが再生成は可能な状態。
  - **再発防止**: `scripts/backup-db.sh`（`npm run db:backup`）を新設。ローカルDBの`public`スキーマをdata-onlyでpg_dump（`--inserts --column-inserts --disable-triggers`、循環FK—`grammar_questions.batch_id`→`generation_batches`—があっても復元できるように）し、`backups/`（新規gitignore対象）にタイムスタンプ付きで保存する。CLAUDE.mdの「必ず立ち止まって確認すること」に、「`db reset`実行前には必ず`npm run db:backup`を実行する（ユーザー確認ではなく自動手順として）」というルールを追記した。
  - **再生成**: 消失した文法問題バックフィル（8カテゴリ×難易度3/4/5=320問）と語彙タグ拡張（ビジネス/日常会話/Part7頻出、各30〜50語目安）・新規イディオムタグ（30〜50語目安、新設`scripts/content-generation/backfill_idiom.ts`——`backfill_vocab_tags.ts`と同パターンで`generateVocabBatch({ contentKind: 'idiom' })`を使う）の再生成を、2体のサブエージェント（文法/語彙で分担、並列実行）に委任した。セルフチェックのプロンプトは変更せず（既に仮定法時制・reasoningフィールド改善済みのものをそのまま使用）、needs_reviewが発生した場合は「文法的に明確に判断できるケースはエージェント自身が承認/却下、本当に曖昧なケース・今回のような構文的欠陥（as~as等）はエスカレート」という、20260809確立済みの運用方針をそのまま踏襲する指示とした。実行結果は後続のchangelogエントリに記録する（本エントリ記載時点では実行中）。

- 2026-08-10（本エントリ記載日は20260812だが、実際の作業実行日時はDB上20260810のため実時刻で記載）: 上記再生成の結果。文法・語彙のサブエージェントとも、Claudeセッション使用上限により一度中断し、リセット後（19:00 JST）に再開して完走した。

  **語彙タグ・イディオム（`backfill_vocab_tags.ts`＋新設`backfill_idiom.ts`）**: 中断なく完走。エスカレート0件。

  | タグ | 生成 | auto_passed | needs_review | 承認 | 却下 | コミット | 最終件数 |
  |---|---|---|---|---|---|---|---|
  | ビジネス | 40 | 38 | 2 | 0 | 2 | 38 | 44（従来6） |
  | 日常会話 | 40 | 38 | 2 | 0 | 2 | 38 | 40（従来2） |
  | Part7頻出 | 40 | 21 | 19 | 1 | 18 | 22 | 26（従来4、目安30〜50を下回る） |
  | イディオム | 40 | 40 | 0 | 0 | 0 | 40 | 40（新規） |

  needs_reviewの大半（22/23）はタグ横断の完全重複語（`getExistingWordsForTag`がタグ単位でしか既存語を見ない、20260810発見済みの制限——16.xの未決事項参照）。Part7頻出は2バッチ目がビジネスタグの既存語と大きく重複し、目安を下回る結果になった（追加バッチを打つかは未定、対応不要なら21章の未決事項に残す）。1件（`reimbursement`名詞、既存`reimburse`動詞とsimilarity 0.60）は品詞違いの正当な別語として承認。新設`backfill_idiom.ts`はバグ無く動作。

  **文法問題バックフィル（`backfill_grammar_categories.ts`）**: 24バッチ中2バッチでClaude使用上限により中断、リセット後に別セッションで引き継いで完走。

  - `comparison`/difficulty=5（batch `aa11fc54-46d6-423d-8a41-fbf4ec37a805`）: 10件全件が`needs_review`のまま残存していたが、原因はコンテンツ品質ではなく**バッチ全体に共通するラベル不整合**——Geminiが10件全てで`category_code`を`"COMP"`（正しくは`"comparison"`）という誤った略称で出力していた。`commitBatch.ts`の`resolveCategoryId`はcasingの正規化（`toLowerCase()`）はするが略称は救済しないため、`grammar_categories.code`と一致せず`.single()`が0行でエラーになり、10件とも同一原因でコミット時に`needs_review`へ差し戻されていた（保存されていた`validation_errors`は`[object Object]`という非情報的なメッセージのみで、原因特定にはSQLで実際の`category_code`値を見る必要があった）。10件それぞれのself_check結果（`confidence=1`、`is_ambiguous=false`、`solved_index`が`correct_index`と完全一致）と内容そのものを個別確認し、10件とも文法的に問題なしと判断。`raw_payload.category_code`を`"comparison"`に修正のうえ`approved`にしてコミットし、10件全件を反映（10件が独立に判断の分かれる内容だったのではなく、1つのラベルバグがバッチ全体を道連れにした結果である点に注意）。**この略称ゆれパターン（casingではなく単語そのものの省略）は`resolveCategoryId`では救済されないため、今後の大規模バックフィルで再発しうる**——21章の未決事項に対応要否を記録。
  - `subjunctive`/difficulty=3（batch `5018603a-792b-4680-89cc-0b12ba253f03`）: 15件中14件は正常に`committed`、残り1件（`id=1b18eb14-6285-4160-a87f-5ff2560091e6`）はエスカレート（**今回唯一のエスカレート事例**）。設問「Were the director ___ to offer a higher salary, Ms. Tanaka might reconsider the job proposal.」は倒置された仮定法（"If the director were to offer..."→"Were the director to offer..."）で、文頭の"Were"が既に倒置された助動詞を担っているため"director"と"to offer"の間の空所には本来何も入らない。選択肢（is/were/to be/be）のどれを入れても非文になる（生成時の`correct_index`="to be"とself_checkの`solved_index`="were"も不一致——この不一致自体が最初にneeds_reviewへ振り分けられた理由）。20260812冒頭に発見した「as spacious as」と同種の、設問テンプレート自体の構造的欠陥のパターン。承認/却下いずれの自己判断も行わず`needs_review`のまま保持し、エスカレートした。**このアイテムをどう扱うか（再生成／破棄／`grammar_questions`に反映しないまま放置）は未対応——25章の未決事項に記録済み**（`subjunctive`/difficulty=3は14/15件のまま運用しても実害は小さいと判断し、今回は緊急対応しない）。
  - 他の22バッチ（8カテゴリ×3難易度のうち上記2つを除く全て）は全件`committed`。`gemini-3.6-flash`の503エラーを複数回検知したが、指数バックオフリトライ（19章）で全て回復し、コンテンツの欠落・品質劣化は無かった。

  **最終結果**: `grammar_questions`は346件（初期モック27件＋バックフィル319件、320問中`subjunctive`の1件のみエスカレートで未コミットのため320-1=319）。`vocab_words`は150件（ビジネス44・日常会話40・Part7頻出26・イディオム40）。

  検証: 両サブエージェントとも作業内容はDB操作のみ（`src/`配下のコード変更は無し）のため、`npm test`/`lint`/`typecheck`への影響無し。
- 2026-08-10: キーボード操作を再編成（24章）。ドリル回答キーをA〜Dから1〜4に変更し、Home/GrammarCategories/VocabTagList/WeakPointsにA,B,C...のメニューナビゲーションを新規追加。
  - `GrammarDrill.tsx`/`MixedDrill.tsx`: `CHOICE_LABELS`配列を`['1','2','3','4']`に変更するだけで判定・表示の両方が更新される設計だったため、ロジック変更は無し。ヒント文言も更新。
  - `VocabReview.tsx`: 元々キーボード操作が皆無だった画面に、1〜4キーでの評価選択を新規実装（`isRevealed && !mutation.isPending`のときのみ有効）。クリックと同様に選択即送信+次カードへ進む一手のUIのため、GrammarDrill/MixedDrillと異なりEnterでの「次へ」は無い。
  - 新規`src/lib/useMenuShortcuts.ts`（初のカスタムHook）: `assignShortcutKeys(items, startIndex)`（表示順にA〜Zを割り当てる純粋関数、27件目以降は`null`）と`useMenuShortcuts(items)`（該当キー押下で`navigate()`、Ctrl/Cmd/Alt同時押下とinput/textarea/select中は無視）。
  - Home（ログアウトボタンは対象外）・GrammarCategories・VocabTagList・WeakPoints（文法/語彙2セクション+戻るリンクを1つの連番シーケンスとして扱う。9文法カテゴリ+3〜4語彙タグ+戻るリンクで現在13〜14件と、既に「10件超」画面の実例）に適用。バッジは小さくmonospace・neutral色、Homeの紫背景ボタンのみ視認性のため白系バリアント。
  - 実装はサブエージェントに委任（バックフィル作業と並行、ファイル衝突無しを確認のうえ実行）。Claudeセッション使用上限で一度中断（ファイル変更ゼロの探索段階だったため実質ロス無し）、リセット後に`SendMessage`で同一エージェントを再開して完走。
  - **仕様からの逸脱**: `eslint.config.js`の`ignores`に`.claude`を追加。並行実行中の別サブエージェントが作成した`.claude/worktrees/`配下のgit worktreeにより`typescript-eslint`のtsconfig自動検出が壊れ`npm run lint`が無関係な148件のエラーで失敗していたための回避策（該当worktreeは作業完了後に削除済み、将来の同種並行作業への保険として設定は残す）。
  - 検証: `npm test`（185件全て成功、165件から+20件）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）・`npm run build`（既存の500kB超チャンク警告のみ、無関係。`dist/`は削除済み）。ライブブラウザでの目視確認は未実施（ブラウザツール未使用のため自動テストのみで検証）。私自身も`git status`で変更ファイル一覧を確認し、`npm test`/`lint`/`typecheck`/`typecheck:scripts`を独立に再実行して同じ結果を確認、`WeakPoints.tsx`/`Home.tsx`/`useMenuShortcuts.ts`/`VocabReview.tsx`のコードを直接読んで設計どおりの実装であることを確認済み。
- 2026-08-12: 残っていた2件の未決事項（25章参照）を解消。
  - **構造的欠陥のあった`subjunctive`/difficulty=3の1問を修正**: ユーザー指示によりb案（倒置をやめて平叙形に書き換え）を採用。「Were the director ___ to offer a higher salary...」（倒置、空所自体が不要な構造的欠陥）→「If the director ___ to offer a higher salary, Ms. Tanaka might reconsider the job proposal.」（平叙形の「If + S + were to + 動詞原形」仮定法）に書き換え、`correct_index`を"to be"(2)→"were"(1)に変更。explanationも新しい構文に合わせて全面的に書き直した——"is"（"is to offer"＝取り決め・計画のニュアンス）が"were"と紙一重で両立しうる構文である点を踏まえ、主節の"might"という不確かな推量が"were to"と自然に呼応することを明記し、単なる文法チェックに留まらず語調の一致で"were"が最適と判断できる説明にした。`generation_batch_items`を直接UPDATEして`approved`にし、`commit_batch.ts`で反映。`subjunctive`/difficulty=3は15/15、`grammar_questions`は347件に。
  - **語彙タグ「Part7頻出」を目標30〜50語まで追加生成**: `npx tsx scripts/content-generation/generate_vocab.ts --tag Part7頻出 --count 20`を実行。20件中auto_passed=7・needs_review=13（内訳: 11件は他タグに既に同一word+part_of_speechで登録済みの完全重複のため却下、2件は既存語と類似度0.6台だが品詞が異なる正当な別語——`correspond`動詞 vs 既存`correspondence`名詞、`promptly`副詞 vs 既存`prompt`形容詞——のため承認、reimbursement/reimburse等の既承認前例と同じ判断基準）、9件をコミット。Part7頻出は26語→35語、`vocab_words`合計は159件。
  - 検証: DB操作のみのため`npm test`/`lint`/`typecheck`への影響無し。修正後の`grammar_questions`/`vocab_words`の件数はいずれもSQLで直接確認済み。
- 2026-08-12: クラウドSupabaseプロジェクト（`qpfmssdhbtlbudqburki`、11.2で作成・リンク済み）に、ローカルで積み上がったマイグレーション・コンテンツデータを反映。各ステップともユーザーに確認を取ってから実行した。
  - **マイグレーション反映**: `npx supabase db push`で、ローカルのみに存在した3本（`20260809060000_add_code_to_vocab_tags.sql`・`20260809060500_update_vocab_tag_stats_view.sql`・`20260811070000_create_tutor_usage.sql`）をクラウドに適用。事前に`--dry-run`と各ファイルの内容確認を行い、破壊的変更が無いことを確認してから実行。`grammar_categories`のid/codeがローカルとクラウドで完全一致することも確認済み（同一migrationから両方に反映されているため）。
  - **コンテンツデータ移行**: 移行前に`npx supabase db query --linked`でクラウドの現状を確認したところ、`grammar_categories`（9件、migration由来）以外の`grammar_questions`/`vocab_tags`/`vocab_words`/`vocab_word_tags`/`generation_batches`は全て0件——過去の設計判断（モックデータは意図的にクラウド未反映）どおり、コンテンツ系テーブルは今回が実質初回投入だった。この事実を踏まえ、a）ローカルDBからのpg_dumpによるデータ移行を採用（b案の`commit_batch.ts`再実行は、cloud側に先に`generation_batches`/`generation_batch_items`を投入する必要がありどのみちダンプ作業が発生すること、500件超を1件ずつINSERTし直すため新しいUUIDが振られ ローカルと非同一になること、cloud service_role_keyをスクリプトの環境変数として扱う必要が生じることから、pg_dumpより手間とリスクが大きいと判断して不採用）。
    - 対象6テーブル（`generation_batches`・`vocab_tags`・`grammar_questions`・`vocab_words`・`vocab_word_tags`・`generation_batch_items`）をFK依存順（batches→tags→questions/words→word_tags→items）でテーブルごとに`pg_dump --data-only --inserts --column-inserts`し、INSERT文のみを結合。
    - **実装時に踏んだ不具合**: 当初`--disable-triggers`付きで1回のpg_dumpにまとめて実行したところ、`supabase db query --linked`適用時に`permission denied: "RI_ConstraintTrigger_a_17676" is a system trigger`で失敗した。マネージド環境の接続ロールはローカルDockerの`postgres`と異なりtrue superuserではなく、システムトリガー（FK制約の内部実装）を無効化する権限が無いため。`--disable-triggers`無しでテーブル単位にダンプし直し、FK依存順に結合することで解決。あわせて、pg_dump出力に含まれる`\restrict`/`\unrestrict`（PostgreSQL新しめのバージョンで追加されたpsql専用メタコマンド、セキュリティ目的でセッションの機能を制限/解除する）が`supabase db query --linked`のSQL実行系では解釈できず投入前に手動で除去する必要があった（生のSQLではないため）。
    - 反映後、件数（347/4/159/159/33/500）が全てローカルと完全一致することと、内容面でも修正済みのsubjunctive設問（`correct_index=1`の"If the director..."）とvocab_tagsのcode列がクラウド側に正しく反映されていることを`db query --linked`で個別に確認した。
    - 一時ファイル（`backups/`、gitignore対象）は確認後に削除。ユーザー個人データ系テーブル（`profiles`/`user_vocab_progress`/`tutor_usage`等）は対象外——本番では実ユーザーのデータとして空の状態から始まるべきため。
  - **ask-tutor Edge Functionのクラウドデプロイ**: `npx supabase secrets set --env-file supabase/functions/.env`でGEMINI_API_KEY/GEMINI_MODELをクラウドSecretsに設定（`SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`はプラットフォーム予約名のためローカル同様スキップされる、意図どおり）。値はユーザーの指示で「ローカルの.envから直接参照し画面表示しない」形で実行。`npx supabase functions deploy ask-tutor`でデプロイ完了。
    - **動作確認**: 使い捨てテストユーザーで認証込みのエンドツーエンド確認を実施。`example.com`宛のサインアップはクラウド側のメールアドレス検証で拒否された（ローカルには無い制限）ため`mailinator.com`ドメインで再試行。クラウドは「メール確認必須」設定（ローカルはオフ）のためサインアップ直後はセッションが無く、Admin API（`PUT /auth/v1/admin/users/{id}` with `email_confirm: true`）でメール確認済みにしてからパスワードサインインし、実際のJWTを取得。そのJWTで`ask-tutor`を呼び出し、実際のGemini応答（「as spacious as」原級比較構文の解説）が返ることを確認。あわせて`tutor_usage`にレート制限用の行（`request_count=1`）が実際に書き込まれることも確認——JWT検証・レート制限RPC・Gemini呼び出しの全経路が本番で機能している。確認後、Admin APIでテストユーザーを削除し、`tutor_usage`行が`on delete cascade`で連動削除されクラウド側に痕跡が残っていないことも確認した。
    - **実装時に踏んだ問題**: 検証用に`npx supabase projects api-keys`を実行した際、想定していたanonキーだけでなく`service_role`の生の値も出力にそのまま含まれてしまった（このコマンドの仕様上、フィルタできなかった）。以降の操作でservice_roleキーを再度画面表示することは避け、変数として一度だけ内部的に使用（テストユーザーのメール確認・削除のAdmin API呼び出し）した。ユーザーには直接この露出を伝え、念のためのローテーションを検討してもらうよう申し添えた。
- 2026-08-13: 25章の技術的負債3件を解消（セキュリティ関連はユーザーと相談のうえ解決済みと確認し、対象外）。3件は独立した変更のため任意の順で実施。
  - **`resolveCategoryId`のcategory_code略称ゆれ対応**（`scripts/content-generation/commitBatch.ts`）: 二段構えで対応。①`prompts/grammar.md`に、`category_code`フィールドは9件共通の固定値を一字一句そのまま出力する（省略形・言い換え禁止）という指示を明示追加。②`resolveCategoryId`に前方一致フォールバックを追加——casing正規化後の完全一致（`.single()`→`.maybeSingle()`に変更）が無い場合、`grammar_categories`全件を取得し双方向前方一致（略称→正式名/正式名→略称）で解決、1件のみヒットすれば採用、0件/複数件ならそのアイテムだけ具体的な理由付きでエラーにしてneeds_reviewへ戻す（バッチ全体を道連れにしない）。`grammar_categories`は9件の固定クローズドセットで、実データ上どの2つのcodeも互いの接頭辞にならないため曖昧性は生じない。あわせて`commitBatch`のcatch節で`String(error)`が`[object Object]`になっていた不具合も修正し、`error.message`を優先抽出するよう変更。`commitBatch.test.ts`にテスト3件追加（略称"COMP"→"comparison"の解決成功、フォールバックも曖昧な場合のneeds_review化、エラーメッセージが`[object Object]`にならないことの確認）。既存のneeds_reviewテストも新しい2段クエリのモックに合わせて更新。
  - **語彙生成の重複回避コンテキストをDB全体に拡張**（`scripts/content-generation/generateVocab.ts`）: `getExistingWordsForTag`（タグ→`vocab_word_tags`→`vocab_words`の2段join）を`getExistingWords`（`vocab_words`を作成日時降順でタグを問わず直接取得）に置き換え。`vocab_tags`/`vocab_word_tags`への問い合わせが丸ごと不要になり実装もシンプルになった。`generateVocab.test.ts`の3テストを新しい取得方法に合わせて更新（DB全体からの取得を検証するテスト名に変更、「タグ未作成」ケースは「既存語0件」ケースに置き換え、イディオムテストからvocab_tags関連の不要になったアサーションを削除）。
  - **孤立`generation_batches`行2件の削除**: 削除前の再確認として`generation_batch_items`件数を確認しようとしたところ、該当2行がローカルに存在しないことが判明（`status='generating'`の行が0件）。20260810〜11の`db reset`データ消失事故で巻き込まれて消去され、失敗した空アーティファクトだったため再生成時にも作られなかったと判明。クラウド側にも同IDが存在しないことを`db query --linked`で確認（クラウドの`generation_batches`も33件、`status='generating'`は0件）。削除操作自体は不要だった。
  - 検証: `npm test`（187件全て成功、185件から+2件——commitBatch.test.tsに3件追加・generateVocab.test.tsは既存3件を書き換えのため純増0件）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）。

---

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
  etymology_note text,
  batch_id uuid references generation_batches(id),
  created_at timestamptz not null default now(),
  unique (word, part_of_speech)
);
```

`etymology_note`は接頭辞・語幹・接尾辞の分解と意味を示す語源ヒント（例: `neg-(否定)+otium(暇)→「暇ではない」→交渉する`）。任意項目のためnullable（`20260809042257_add_vocab_etymology_note.sql`で追加）。語彙SRSレビュー画面（`/vocab/review`）で単語カードのreveal後、正解表示と一緒にヒントとして表示する。

```sql
create table vocab_tags (
  id serial primary key,
  name text not null unique,
  code text unique -- 16章: grammar_categories.codeと同じ方針のURL用英語スラッグ。段階的導入のため当面nullable
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
-- security_invoker = true が必須: 付けないとビュー所有者(RLSをバイパスするmigration実行ロール)の
-- 権限で評価され、認証済みユーザーなら誰でも他人の解答履歴が見えてしまう(11.1で発見・修正済み)
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
  max(a.answered_at) as last_attempted_at,
  c.code as category_code -- 弱点分析ダッシュボードから/grammar/:categoryCodeへ直接遷移するために追加(20260809044731)。
                           -- CREATE OR REPLACE VIEWは既存列の位置・名前を変更できないため末尾に追加している。
from user_grammar_attempts a
join grammar_questions q on q.id = a.question_id
join grammar_categories c on c.id = q.category_id
group by a.user_id, q.category_id, c.name_ja, c.parent_id;

-- 語彙タグ別正答率
-- rating in ('good','hard','easy') を正答、('again') のみを誤答とみなして集計（20260809060500で改訂）。
-- hardは「思い出せたが確信度が低い」という評価であり間違いではないため正答に含める。
-- 総合問題(14.4)の4択正解はhardとして記録されるため、againのみを誤答とすることで
-- 総合問題での正解も正しく弱点分析ダッシュボードに反映されるようにしている。
create view user_vocab_tag_stats
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
  t.code as tag_code -- 16章: 弱点分析ダッシュボードから/vocab/review/:tagCodeへ直接遷移するために追加。
                      -- category_codeと同じ理由でCREATE OR REPLACE VIEWの末尾に追加している。
from vocab_review_logs l
join vocab_word_tags wt on wt.vocab_word_id = l.vocab_word_id
join vocab_tags t on t.id = wt.tag_id
group by l.user_id, t.id, t.name, t.code;
```

文法側（`user_grammar_category_stats`）は`user_grammar_attempts.is_correct`という単純な正誤フラグを集計しているだけで、FSRSの`rating`のような「正誤の強度」を持つ概念が無い（文法ドリル・総合問題ともに4択の正誤をそのまま記録している）ため、今回の改訂の対象外。

`parent_id`を含めているため、将来サブカテゴリを追加しても親カテゴリ単位のロールアップ集計（再帰CTE）に対応できる。

---

## 7. RLS（Row Level Security）ポリシー

### 方針

- ユーザー個人データ（`profiles`, `user_vocab_progress`, `vocab_review_logs`, `user_fsrs_parameters`, `user_grammar_attempts`）→ 本人（`auth.uid()`）のみ読み書き可
- コンテンツデータ（`vocab_words`, `vocab_tags`, `vocab_word_tags`, `grammar_categories`, `grammar_questions`, `generation_batches`）→ 認証済みユーザーはSELECTのみ。INSERT/UPDATE/DELETEはservice_role（バッチ生成スクリプト）のみ

**前提: RLSポリシーの前にテーブルレベルのGRANTが必要**（11.4で実装時に発見した不具合）。RLSは「どの行が見えるか」を絞るだけで、その手前で`anon`/`authenticated`/`service_role`ロールに対する`GRANT SELECT/INSERT/UPDATE/DELETE ON <table>`が無ければPostgREST経由のアクセスは（service_roleであっても）`permission denied`になる。実際に何を許可するかは引き続き本章のRLSポリシーが決める——ポリシーの無いコマンド・テーブル（例: `generation_batches`へのSELECT、`grammar_categories`へのINSERT）はGRANTがあってもRLSにより全面拒否されるため、GRANTを広く（`ALL TABLES IN SCHEMA public`）付与しても安全性は損なわれない。GRANT自体は8.2で追加した`generation_batch_items`用migrationの後（11.4の`grant_default_privileges`migration）でまとめて定義している。

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
- ビュー（`user_grammar_category_stats`, `user_vocab_tag_stats`）自体に追加のRLSポリシーは不要だが、**`with (security_invoker = true)`の指定が必須**（6.5参照）。指定しないとビュー所有者（migrationを実行するsuperuserロール、RLSをバイパスする）の権限で評価されてしまい、認証済みユーザーなら誰でも他人の解答履歴を見られる状態になる。11.1でこの不具合を実装時に発見・修正した。

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
- etymology_noteは接頭辞・語幹（多くはラテン語/ギリシャ語源）・接尾辞に分解し、
  それぞれの意味と語全体の意味への繋がりを日本語で簡潔に示すこと
  （例: `neg-(否定)+otium(暇)→「暇ではない」→交渉する`）。
  分解が難しい語（借用語・固有名詞由来など）の場合は、語源に関する
  一言エピソードで代替してよい
- tagsは常に["{{tag_name}}"]のみとする

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
      "etymology_note":       { "type": "STRING" },
      "tags":                 { "type": "ARRAY", "items": { "type": "STRING" } }
    },
    "required": ["word", "part_of_speech", "meaning_ja", "example_sentence_en", "example_sentence_ja", "toeic_band", "etymology_note", "tags"],
    "propertyOrdering": ["word", "part_of_speech", "meaning_ja", "example_sentence_en", "example_sentence_ja", "toeic_band", "etymology_note", "tags"]
  }
}
```

`{{existing_question_samples}}` / `{{existing_words}}`はDB上の同一カテゴリ・同一タグの直近N件（目安30件）を取得して埋め込む。プロンプト内の除外リストだけでは件数が増えるほど機能しなくなるため、8.4の近似重複検出をセーフティネットとして必ず併用する。

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
2. 語彙: `vocab_words`にINSERT（unique制約でレース時の重複はDB側で防止）。`tags`配列は`vocab_tags`を`upsert`し`vocab_word_tags`に紐付け（新規タグ作成時の`code`決定方針は16.3参照）
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
/vocab/review/:tagCode  語彙タグで絞り込んだSRSレビューセッション（弱点分析ダッシュボードからの導線用）
/vocab/tags             語彙タグ一覧（全タグを無条件表示し、各タグの復習セッションへ遷移。18章）
/grammar                文法カテゴリ一覧（9カテゴリ）
/grammar/:categoryCode  カテゴリ別ドリル実行
/weak-points            弱点分析ダッシュボード（文法×語彙）
/settings               プロフィール設定（target_score等）
```

`:tagCode`は`vocab_tags.code`（英語スラッグ、例: `business`）を使う。以前は専用のスラッグ列が無かったため`vocab_tags.name`（日本語、例: `ビジネス`）をそのままURLセグメントに流用していたが、`grammar_categories.code`と同じ方針の列を追加したことで揃えた（16章）。

認証ガードはRouterの`loader`内でSupabaseセッションを確認し、未ログイン時は`/login`にリダイレクトする方式に統一する（コンポーネント側で毎回チェックしない）。

### 9.4 データフェッチ層の設計方針

- Supabaseクエリは`src/lib/queries/*.ts`に集約する（例: `getDueVocabCards(userId)`、`getGrammarQuestionsByCategory(categoryCode, count)`、`getWeakPointStats(userId)`）。コンポーネントから直接`supabase.from(...)`を呼ばない
- React Queryの`queryKey`規約を統一する（例: `['vocab-due', userId]`、`['grammar-stats', userId]`、`['vocab-tag-stats', userId]`）
- ミューテーション（SRSレビュー記録・文法解答記録）はSupabaseへのINSERT/UPSERT後、関連する`queryKey`を`invalidateQueries`する
- クライアントから直接書き込むテーブルは7章のRLS方針で許可された4つのみ（`user_vocab_progress`, `vocab_review_logs`, `user_grammar_attempts`, `user_fsrs_parameters`）。それ以外（`grammar_questions`等）への書き込みコードはそもそも作らない

### 9.5 FSRS統合（クライアント側）

- `ts-fsrs`はサーバーを介さずブラウザ内で直接実行する。復習後の次回due計算をクライアントで行い、結果を`user_vocab_progress`にUPSERT、`vocab_review_logs`にINSERTする
- 計算ロジックは`src/lib/fsrs.ts`に集約し、`computeNextState(currentCard, rating) => { state, stability, difficulty, due_at, ... }`という副作用のない純粋関数として実装する（単体テストしやすくするため）
- **複数端末での競合**: `vocab_review_logs`はINSERT専用のため、2端末でほぼ同時に同じ単語を復習しても両方のレビューログはそのまま残る（学習履歴・弱点分析データが失われることはない）。失われ得るのは`user_vocab_progress`（次回出題日などのスケジューリング状態）のみで、オフライン中に同じ単語を2端末で復習し後から同期した場合、片方の計算結果がもう片方を上書きする。実質的なリスクは「次回出題タイミングが稀に多少ズレる」程度であり、データ消失には至らないため楽観ロックは実装せず「後勝ち（last-write-wins）」で割り切る

### 9.6 弱点分析ダッシュボードのUI方針

- 「文法カテゴリ別正答率」「語彙タグ別正答率」の2セクションを並べて表示する（5章の方針どおり両軸を必ず表示）
- 正答率が低い項目を強調表示する（目安: 70%未満を警告色）
- 各カテゴリ／タグのカードから該当のドリル・SRSレビューへ直接遷移できる導線を設け、「弱点の可視化→即復習」の動線を短くする

### 9.7 将来のモバイル対応に向けた配慮

- `lib/queries/*.ts`・`lib/fsrs.ts`はReactに依存しない純粋なTypeScriptとして実装し、UIコンポーネントから分離する（React Native移行時に再利用する想定）
- `lib/supabase.ts`は環境変数経由の設定のみに依存させ、Web/モバイルでクライアント初期化コードを差し替えやすくする

---

## 10. 認証設計（詳細）

9.2の方針（メール+パスワード + Google OAuth）を実装レベルに落とし込む。

### 10.1 Supabase Auth設定

- 有効化するプロバイダ: Email（パスワード）／ Google OAuth
- **Email confirmation: 有効にする**（サインアップ後、確認メールのリンクを踏むまでログイン不可）。要件上必須ではないが、誤入力メールやいたずらアカウントによって弱点分析データが無駄に散逸するのを防ぐための判断
- Google OAuth: Google Cloud ConsoleでOAuthクライアントを発行し、SupabaseのRedirect URL（`https://<project>.supabase.co/auth/v1/callback`）を許可リストに登録。アプリ側のリダイレクト先は`{origin}/auth/callback`

### 10.2 プロフィール自動作成

サインアップ直後に`profiles`行が存在しないと、初回表示時にアプリ側で参照エラーになる。`auth.users`へのINSERTをトリガーに`profiles`へ自動INSERTする。

```sql
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
```

`security definer`によりRLSをバイパスして書き込む（サインアップ時点ではまだ`auth.uid()`ベースのポリシーが評価できる状態ではないため必須）。`search_path`は`public`ではなく**空文字**に固定する。`public`スキーマは`authenticated`ロールが書き込める（=悪意あるオブジェクトを混入されうる）ため、`search_path = public`のままだとsearch_pathハイジャックの余地が残る。空にした上で`public.profiles`のように全参照をスキーマ修飾することで関数解決を`pg_catalog`（常に暗黙的に検索される）のみに限定し、Supabaseのセキュリティlinterが警告する`function_search_path_mutable`を回避する。Google OAuthの場合は`raw_user_meta_data->>'full_name'`、メール登録の場合はメールのローカル部を初期表示名として使う。

### 10.3 クライアント側のSupabase初期化

```ts
export const supabase = createClient(url, anonKey, {
  auth: {
    flowType: 'pkce',
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: true,
  },
});
```

PKCEフローを使うことで、Google OAuthのリダイレクト後もトークンをURLフラグメントに残さず安全に交換できる。

### 10.4 認証フロー

| フロー | 実装 |
|---|---|
| メール+パスワードでサインアップ | `supabase.auth.signUp({ email, password })` → 確認メール送信 → `/login?confirm=1`で案内表示 |
| メール+パスワードでログイン | `supabase.auth.signInWithPassword({ email, password })` |
| Googleログイン | `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: \`${origin}/auth/callback\` } })` |
| パスワードリセット | `supabase.auth.resetPasswordForEmail(email, { redirectTo: \`${origin}/reset-password\` })` → `/reset-password`で`supabase.auth.updateUser({ password })` |
| ログアウト | `supabase.auth.signOut()` |

`/auth/callback`はOAuthリダイレクト後の一時的な着地ページ。`detectSessionInUrl`によりsupabase-jsが自動でセッションを確立した後、`/`へ`replace`遷移するだけのローディング画面とする。

### 10.5 ルートガード

9.3の方針を実装レベルに落とし込む。React Routerのレイアウトルート（`routes/_protected.tsx`）のloaderでセッションを確認する。

```ts
export async function loader() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw redirect('/login');
  return { session };
}
```

セッション切れ（トークンリフレッシュ失敗等）の検知は、ルートレイアウトで`supabase.auth.onAuthStateChange`を購読し、`SIGNED_OUT`イベント発火時に`/login`へ遷移させる形で対応する。

---

## 11. Supabaseプロジェクト セットアップ

### 11.1 ローカル環境（実施済み）

`toeic-app/`直下で以下を実行し、ローカルDocker上にSupabaseスタックを構築した。

```bash
git init
npm init -y
npm install supabase@2.113.0 --save-dev   # CLIをバージョン固定でdevDependency化
npx supabase init
npx supabase migration new <name>          # 9本、依存順に作成
npx supabase start                          # 初回はDockerイメージのpullで数分かかる
```

**マイグレーション構成**（`supabase/migrations/`、実行順）:

| ファイル | 内容 |
|---|---|
| `..._extensions_and_enums.sql` | `pgcrypto`/`pg_trgm`、全enum型（6章・8章の型定義） |
| `..._profiles.sql` | `profiles`（6.1） |
| `..._generation_batches.sql` | `generation_batches`（6.2 + 8.2の集計カラムを統合、最初から最終形で作成） |
| `..._vocab_schema.sql` | 語彙SRS一式（6.3） |
| `..._grammar_schema.sql` | 文法ドリル一式（6.4） |
| `..._weak_point_views.sql` | 弱点分析ビュー2本（6.5） |
| `..._generation_batch_items.sql` | バッチ生成ステージングテーブル + trgmインデックス（8.2） |
| `..._rls_policies.sql` | RLSポリシー全件（7章 + `generation_batch_items`分を追加） |
| `..._auth_trigger.sql` | `handle_new_user`トリガー（10.2） |

`supabase/seed.sql`に文法9カテゴリの初期データを配置し、`supabase start`実行時に自動投入されることを確認済み。

**実装時に発見し修正した不具合**: Postgresのビューはデフォルトで**所有者（マイグレーションを実行するsuperuserロール、RLSをバイパスする）の権限**で評価される。そのため`with (security_invoker = true)`を付けずに`user_grammar_category_stats` / `user_vocab_tag_stats`を作成すると、認証済みユーザーなら誰でも他人の解答履歴・レビュー履歴を閲覧できてしまう状態になっていた。両ビューに`security_invoker = true`を追加し、ローカルDB上で`reloptions`に反映されていることを確認済み（6.5の該当SQLも同じ対応が必要）。

**動作確認済み**: `supabase start`成功、9マイグレーション全て適用、`grammar_categories`が9件seed、両ビューが`security_invoker=true`、対象12テーブル全てで`rowsecurity = true`。

ローカル接続情報は`npx supabase status`で都度取得する（Studio: `http://127.0.0.1:54323`、API: `http://127.0.0.1:54321`、DB: `postgresql://postgres:postgres@127.0.0.1:54322/postgres`）。ローカルのanon/service_roleキーはCLIが生成する固定のデモ鍵であり本番シークレットではないため、DESIGN.mdには値を記載せず`supabase status`参照とする。

`package.json`に運用スクリプトを追加: `db:start` / `db:stop` / `db:reset`（migrations+seedを再適用）/ `db:diff`。

### 11.2 クラウドプロジェクト接続（実施済み）

ユーザーが事前に作成していたプロジェクト（名前: `toeic-app`、region: `ap-northeast-1` / Tokyo、project ref: `qpfmssdhbtlbudqburki`）に接続した。

```bash
npx supabase link --project-ref qpfmssdhbtlbudqburki
npx supabase db push                 # 9マイグレーションを適用
npx supabase db push --include-seed  # supabase/seed.sql（文法9カテゴリ）を投入
```

**動作確認**:
- `npx supabase migration list`でlocal/remoteの9件全てのタイムスタンプが一致（drift なし）
- service_roleキー経由のREST呼び出しで`grammar_categories`が9件登録されていることを確認
- anonキー（未認証）での同じ呼び出しは空配列を返すことを確認 → `grammar_categories_select_authenticated`ポリシー（`auth.role() = 'authenticated'`のみ許可）が意図通り機能している

**`db diff --linked`実行時の注記**: リモートとローカルshadow DBの差分に`DROP EXTENSION pg_net`および一部`GRANT`文が出力されたが、これは実行していない。`pg_net`はSupabaseのホスティング基盤側が標準で追加する拡張機能であり、こちらのマイグレーション履歴の管理対象外。GRANT文もホスティングテンプレート側のデフォルト権限設定との比較ノイズであり、こちらが定義したテーブル・RLSポリシー・ビューの`security_invoker`設定には差分なし。**今後`db diff`を実行する際はこの2種類の差分が定常的に出ることを踏まえ、実際のスキーマ変更のみを拾う**。

未実施（ユーザー側の操作が必要）:
- Supabaseダッシュボードの Authentication 設定で以下を有効化（10.1の方針どおり）
  - Email confirmation: ON
  - Google OAuth provider: ON（クラウド用の認証情報は11.3のローカル用クライアントと分けて発行することを推奨。認可済みリダイレクトURIに本番のSupabase Auth callback URLを追加する必要あり）
- フロントエンドの環境変数（`.env.local`、`.gitignore`済み）にクラウドの`SUPABASE_URL` / `SUPABASE_ANON_KEY`（`sb_publishable_...`）を設定

### 11.3 ローカルでのGoogle OAuth設定 + フロントエンド起動確認

ユーザーがGoogle Cloud ConsoleでOAuthクライアント（Web application、ローカル開発用）を発行済みだったため、ローカルSupabaseスタックにGoogleログインを設定した。

**設定内容**:
- `toeic-app/.env`（gitignore済み、コミットされない）に`SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` / `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`を配置。**OAuthクライアントシークレットは絶対にリポジトリにコミットしない**——`supabase/config.toml`側は`env(...)`参照のみで実値を持たない
- `supabase/config.toml`の`[auth.external.google]`を追加: `enabled = true`、`skip_nonce_check = true`（ローカルでのGoogleサインインに必須、CLIのコメントにも明記あり）
- `[auth]`の`additional_redirect_urls`に`http://127.0.0.1:3000`系のURLを追加（`redirectTo`に指定するURLは*完全一致*でこのリストに含まれている必要がある）
- `supabase stop` → `supabase start`で設定を再読込し、`GET /auth/v1/settings`で`external.google: true`を確認

**要確認事項（ユーザー側）**: Google Cloud Consoleの当該OAuthクライアントの「承認済みのリダイレクトURI」に、ローカルGoTrueのコールバックURL `http://127.0.0.1:54321/auth/v1/callback` が登録されていること。未登録の場合、Googleログインボタン押下後に`redirect_uri_mismatch`エラーになる。

**フロントエンド初期実装**（9章の設計に沿って最小構成を実装）:
- Vite + React + TypeScript + Tailwind CSS（`@tailwindcss/vite`）、React Router v7（data router）
- `src/lib/supabase.ts`（10.3のPKCE設定）
- `src/routes/Login.tsx`（メール+パスワードのサインイン/サインアップ切り替え + Googleログインボタン）
- `src/routes/AuthCallback.tsx`（`/auth/callback`、`onAuthStateChange`で`SIGNED_IN`検知後`/`へ遷移）
- `src/routes/Home.tsx`（`protectedLoader`でセッション確認、未ログインは`redirect('/login')`）
- `vite.config.ts`でdevサーバーをport 3000に固定（config.tomlの`site_url`/`additional_redirect_urls`のデフォルトと合わせるため）
- `.env.local`（gitignore済み）にローカルSupabaseの`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`を設定

**動作確認**: `npm run dev`でVite起動（`http://localhost:3000`）、`/`・`/login`・`/src/main.tsx`が200を返すことをcurlで確認。ブラウザでの目視確認は本セッションでは未実施（Claude in Chromeの権限が未許可のため）。ユーザー側で以下を開いて確認: `http://localhost:3000/login`

**ローカルのメール確認設定について**: `supabase/config.toml`の`[auth.email] enable_confirmations`はCLIのデフォルトである`false`のまま変更していない（ローカル動作確認を素早く行うため）。10.1で決めた「Email confirmation: ON」はクラウド側ダッシュボードでのみ適用する方針とする。

### 11.4 不具合調査: profilesが空に見える問題（発見・修正済み）

**症状**: ブラウザでサインアップ後、`auth.users`にはユーザーが作成されるが`profiles`が空に見える、との報告。

**調査**:
1. `pg_trigger`で`on_auth_user_created`トリガーの存在を確認 → `auth.users`に`AFTER INSERT FOR EACH ROW`で正しく設定・有効（`tgenabled = 'O'`）
2. `pg_proc`で`handle_new_user`関数を確認 → `prosecdef = t`（SECURITY DEFINER）、`search_path = ''`ともに10.2の設計どおり
3. Postgres/GoTrueのログを確認 → トリガー・関数由来のエラーは見つからず
4. 管理者APIで実際にテストユーザーを作成し直接検証 → **`profiles`に正しく行が作成された**（トリガー自体は正常に動作）
5. しかしその後、`profiles`をREST経由（anon/service_roleキー）で読もうとしたところ、**`service_role`キーですら`permission denied for table profiles`（42501）というエラー**が返ってきた

**根本原因**: `anon` / `authenticated` / `service_role`ロールに対して、`profiles`を含む**全テーブルのGRANT（SELECT/INSERT/UPDATE/DELETE）が一度も定義されていなかった**。RLSポリシー（7章）は行を絞り込む役割であり、その手前の「テーブルへのアクセスを許可する」通常のPostgres権限（GRANT）が無ければ、RLSポリシーの正しさに関わらずPostgREST経由のアクセスは`permission denied`になる。トリガーによる行の作成自体は成功していたため、`auth.users`だけが更新されて`profiles`が「空に見えた」（＝実際には行はあるが、アプリからは権限エラーで読めない状態だった）。

クラウド側では同じ状況で`anon`キーが`[]`（権限エラーではなく、RLSによる正常な空応答）を返しており、ホスティング基盤側の初期プロビジョニングで同等のGRANTが設定されていたと考えられる。ローカルの`supabase start`環境（CLIのDockerイメージ + 自前のmigrationsのみ）ではこのGRANTがどこにも定義されておらず、再現性のあるバグとして残っていた。**この差異自体が、`security_invoker`の件と同様に「マイグレーション履歴を唯一の正とすべきで、プラットフォーム側の暗黙の設定に依存すべきでない」という教訓**（11.1参照）。

**修正**: `supabase/migrations/20260808145101_grant_default_privileges.sql`を追加。

```sql
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
```

**安全性**: GRANTを広く付与しても、実際に許可される操作は引き続き7章のRLSポリシーが決める。ポリシーの無いコマンド・テーブル（例: `generation_batches`へのSELECT、`grammar_categories`へのINSERT/UPDATE/DELETE）はGRANTがあってもRLSによって全面拒否されるため、意図しない書き込み穴は生まれない。

**検証**: `supabase migration up`（ローカル）・`supabase db push`（クラウド、10migrationsに）を実行後、`anon`キーは`profiles`に対して`[]`（RLSにより正常に空）、`service_role`キーは実データを正しく返すことを確認。`migration list`でlocal/remote 10件が一致。

### 11.5 不具合再調査: GRANT修正後もprofilesに行ができないとの報告（実際の原因はフロントエンドUI）

GRANT修正後にユーザーから同じ症状の再報告があり、指定された手順で再調査した。

**1. マイグレーションが本当にローカルDBに適用されているか**: `supabase migration list`（フラグなし）は**デフォルトでリンク済みのクラウドプロジェクトと比較する**ため、ローカルのDocker DBの状態確認には使えないことが判明（`--local`フラグが必要）。ローカルDBの`supabase_migrations.schema_migrations`テーブルを直接クエリし、`20260808145101_grant_default_privileges`を含む10件全てが適用済みであることを確認。`\dp public.profiles`でも`anon`/`authenticated`/`service_role`に`arwdDxtm`（フルDML権限）が付与された状態を再確認した。**今後この手のローカル環境の状態確認は`supabase migration list --local`または直接SQLで行うこと**（教訓としてここに記録）。

**2. 実際にauth.usersへユーザーが作成されているか**: 作成されていた。GoTrueの監査ログを確認したところ、ユーザーは以下の手順を踏んでいた:
1. `POST /signup`（`test@example.com`）→ `200`で成功
2. 36秒後、**同じメールアドレスで再度`POST /signup`**→ `422 User already registered`
3. その後`POST /token`（password grant）でログイン → `200`成功、`POST /logout`

**3. Postgresログにトリガーのエラーがないか**: 該当時刻帯（14:56台）にエラーなし。`profiles`テーブルを直接確認したところ、`test@example.com`のユーザーには**正しく`profiles`行が作成されていた**（`display_name: test`）。

**4. サーバー再起動後の再テスト**: `npm run dev`・`supabase stop`→`supabase start`を実施した上で、実際のフロントエンドと同じ`POST /auth/v1/signup`エンドポイントを直接呼び出して新規サインアップを再現 → `profiles`に正しく行が作成されることを確認（検証用ユーザーは`admin/users`APIで削除しクリーンアップ済み）。

**結論（DBは正常。原因はフロントエンドのUIロジック）**: `auth.users`・`profiles`・トリガー・GRANTは全て正常に機能しており、DB側に問題はなかった。手順2の「同じメールで2回目のsignup」が発生した理由を`src/routes/Login.tsx`で確認したところ、根本原因を特定した:

```tsx
// 修正前
const { error } = mode === 'signup'
  ? await supabase.auth.signUp({ email, password })
  : await supabase.auth.signInWithPassword({ email, password })
...
if (mode === 'signup') {
  setMessage('確認メールを送信しました。メール内のリンクからログインを完了してください。')
} else {
  window.location.assign('/')
}
```

ローカル環境は`enable_confirmations = false`（11.3参照）のため、`signUp`は呼び出し直後に**有効なセッションを返す**（メール確認不要で即ログイン状態になる）。しかし上のコードは`data.session`の有無を見ずに、サインアップ成功時は常に「確認メールを送信しました」と表示していた。ユーザーはこのメッセージを見て「サインアップが完了していない」と誤解し、同じメールアドレスで再度サインアップを試みて`422`エラーに遭遇した——`profiles`自体は最初の`signUp`で正しく作成されていたが、UIがそれを伝えていなかった。

**修正**（`src/routes/Login.tsx`）:

```tsx
const { data, error } = mode === 'signup'
  ? await supabase.auth.signUp({ email, password })
  : await supabase.auth.signInWithPassword({ email, password })
...
if (mode === 'signup' && !data.session) {
  // メール確認が有効な環境ではsignUp直後はセッションが張られない。
  // ローカル(確認オフ)ではdata.sessionが返るため、下のelseで即ログイン扱いにする。
  setMessage('確認メールを送信しました。メール内のリンクからログインを完了してください。')
} else {
  window.location.assign('/')
}
```

`data.session`の有無で分岐することで、確認不要な環境（ローカル、または将来的に確認をオフにする場合）では即座に`/`へ遷移し、確認が必要な環境（10.1の方針どおりクラウドではEmail confirmation: ON）では従来どおり案内メッセージを表示する。

---

## 13. イディオムコンテンツの追加

### 13.1 方針

`vocab_tags` / `vocab_words`のスキーマは既に汎用的なため、**スキーマ変更は不要**。イディオムは「`vocab_tags.name = 'イディオム'`というタグが付いた`vocab_words`の行」として扱う。

**対象範囲（20260809改訂）**: イディオム（慣用表現）に加え、句動詞（動詞+前置詞/副詞の組み合わせ、例: `look into`, `follow up on`, `run out of`, `come up with`）も同じ`イディオム`タグの中で生成対象に含める。方針は変えず、TOEICのビジネス・オフィス文脈で自然に使われる実用的な表現に限定し、文学的・口語的すぎるものは避ける。両者をタグで分けなかった理由: ユーザー向けの復習体験（`/vocab/review/:tagCode`）としては「定型表現をまとめて覚える」という点で両者に違いが無く、タグを分けると`業務でよく使う表現をまとめて復習する`という導線が分断されるため。

- タグ名は英語の`idiom`ではなく`イディオム`（日本語）とする。既存タグ（`ビジネス`/`日常会話`/`Part7頻出`）が全て日本語表示名であり、`vocab_tags.name`はUI表示にも`:tagCode`（URL）にもそのまま使われるため（9.3）、英語タグが1つだけ混在すると表示が不揃いになるための判断。
- タグ行自体の事前migration/seedは不要。8.6の`commit_batch.ts`は`vocab_tags`を`upsert`する設計に既になっているため、イディオムバッチを初めてcommitした時点で自動的にタグが作成される。

### 13.2 Gemini生成プロンプトの追加

- `scripts/content-generation/prompts/idiom.md`を新設。既存の`vocab.md`をベースに、以下を変更する。
  - `word`は表現全体（例: `get the ball rolling` / `look into`）
  - `part_of_speech`は`"idiom"`（イディオム）または`"phrasal verb"`（句動詞）のいずれか（新しいenum/カラムを増やさず、既存の自由入力テキスト列で表現する）
  - `etymology_note`は「接頭辞・語幹の分解」ではなく「直訳とイディオムとしての意味の違い」を説明する用途に読み替える
    （例: `文字通りには「ボールを転がし始める」→そこから「物事を始動させる」という意味に発展`）
  - 出力JSON Schemaは既存の`VOCAB_JSON_SCHEMA`をそのまま再利用する（構造が完全に一致するため新規Schema不要）

- `generateVocabBatch`（`scripts/content-generation/generateVocab.ts`）に`contentKind?: 'vocab' | 'idiom'`（既定`'vocab'`）を追加し、`idiom`指定時は`prompts/idiom.md`を読み込む。`generate_vocab.ts`のCLIに`--kind idiom`オプションを追加する。
- 重複検出（8.4②）・構造チェック（8.4①）・コミット処理（8.6）は無改修でそのまま使う（`word`/`part_of_speech`/`tags`という同じ形のデータを扱うため）。

### 13.3 UI側の影響

変更不要。`/vocab/review`・`/vocab/review/:tagCode`・`/weak-points`は全てタグ名やDBの内容に依存しない汎用実装のため、`イディオム`タグの単語が増えれば自動的に復習対象・弱点分析対象に含まれる。

---

## 14. 総合問題（語彙・文法ミックスドリル）

### 14.1 ルーティング追加（9.3）

```
/mixed-drill            文法・語彙混合ドリル（総合問題）
```

### 14.2 出題ロジック

- **文法問題**: 既存の`grammar_questions`をそのまま使用する（4択・正解・解説が既にDBにある）。
- **語彙問題**: `vocab_words`から新規に4択形式へ変換する。`meaning_ja`を正解の選択肢とし、他の`vocab_words`から3件の`meaning_ja`をランダムに抽出して誤答選択肢にする。

- ランダム抽出方法: PostgRESTのクエリビルダは`ORDER BY random()`を直接表現できないため、`grammar_questions`/`vocab_words`をそれぞれある程度の件数（例: 50件）取得した上でクライアント側でシャッフルして必要数を切り出す（現状の問題数規模ではこれで十分。将来的に問題数が大幅に増えたら8.4②の`similarity` RPCと同様にPostgres側の`random()`ソート用RPCを検討する）。

- 新規ファイル `src/lib/queries/mixedDrill.ts`:
  ```ts
  export interface MixedQuestion {
    id: string
    kind: 'grammar' | 'vocab'
    questionText: string
    choices: string[]
    correctIndex: number
    explanation: string | null   // grammarは既存explanation、vocabはetymology_noteを流用
    grammarQuestionId?: string   // kind='grammar'のとき submitGrammarAttempt 用
    vocabWordId?: string         // kind='vocab'のとき使用
    vocabProgress?: VocabProgressState | null // kind='vocab'のとき submitVocabReview 用
  }

  export function buildVocabQuizQuestion(
    target: VocabWordRow,
    distractorPool: VocabWordRow[],
    shuffle = defaultShuffle, // 注入可能にしてテストしやすくする
  ): MixedQuestion

  export async function getMixedDrillQuestions(
    userId: string,
    grammarCount = 5,
    vocabCount = 5,
  ): Promise<MixedQuestion[]>
  ```
- 文法・語彙をランダムに1つの配列にまとめてシャッフルし、交互ではなくランダムな順番で出題する（「交互」だと単調・予測可能になるため）。

### 14.3 セッション管理・UI

- `src/stores/mixedDrillSessionStore.ts`（Zustand、既存の`grammarSessionStore`と同じ方針）:
  `currentIndex` / `selectedIndex` / `grammarCorrect` / `grammarTotal` / `vocabCorrect` / `vocabTotal`
- `src/routes/MixedDrill.tsx`: `GrammarDrill.tsx`と同様の見た目（設問→4択→即時正誤判定→解説→次へ）。vocab由来の設問では解答後に`etymology_note`があれば表示する（`VocabReview.tsx`と同じ導線を流用）。
- セッション完了画面で「文法: X/Y問正解」「語彙: A/B問正解」を別々に表示する。
- `main.tsx`にルート追加、`Home.tsx`に「総合問題を始める」導線を追加する。

### 14.4 語彙4択の回答記録: 再認と再生の記憶強度を区別する

語彙問題の正誤は`submitVocabReview`（既存、9.4/9.5）を再利用して`vocab_review_logs`・`user_vocab_progress`（FSRS）に実記録する。弱点分析ダッシュボード（5章）にも反映される。

ただし、4択から選ぶ「再認」は、単語カードで意味を思い出す`/vocab/review`の「再生」よりも記憶の証拠として弱い。同じ評価（`good`）で記録すると、実際にはうろ覚えの単語がFSRS上は「よく身についた」と誤って評価され、復習間隔が不当に伸びてしまう。そのため評価値を1段階下げて記録する。

| 総合問題での結果 | `submitVocabReview`に渡すrating |
|---|---|
| 4択正解 | `hard`（`good`ではなく1段階下げる） |
| 4択不正解 | `again` |

**理由**: 再認（多肢選択でそれらしいものを選べる）と再生（ノーヒントで意味を引き出せる）は記憶研究上区別される異なる強度の指標であり、同一視するとFSRSの間隔計算の前提が崩れる。`hard`にマッピングすることで「正解はしたが`/vocab/review`での自己採点ほど確信度は高くない」という実態に近い形でスケジューリングに反映させる。不正解は再認ですら失敗しているため、通常の`again`と同様に扱う。

`getMixedDrillQuestions`で語彙問題を構築する際に、対象単語の既存`user_vocab_progress`（無ければ`null`）を`MixedQuestion.vocabProgress`として保持しておき、回答時に`submitVocabReview({ userId, vocabWordId, currentProgress: vocabProgress, rating: isCorrect ? 'hard' : 'again' })`を呼び出す。

---

## 16. 語彙タグのcode/name分離

### 16.1 目的

`grammar_categories`の`code`（URL用英語スラッグ）/`name_ja`（表示用日本語）分離パターンを`vocab_tags`にも適用する。

現状（9.3）は`/vocab/review/:tagCode`の`:tagCode`に`vocab_tags.name`（日本語、例:「ビジネス」）をそのままURLセグメントとして使っている。`vocab_tags`に`grammar_categories.code`に相当する専用のスラッグ列が無く、既存の一意な`name`列を代用していたための暫定対応だった。日本語がそのままURLに現れる点・将来のモバイル対応（9.7）や多言語化を見据えると望ましくないため、正式に`code`列を追加する。

### 16.2 スキーマ変更

**migration 1**（`vocab_tags`への`code`列追加 + 既存タグへの手動割り当て）:

```sql
alter table vocab_tags add column code text unique;

-- 既存タグへの手動割り当て（supabase/seed.sqlのローカル専用モックタグが対象。
-- クラウドには元々これらの行が無いため、以下のUPDATEはクラウドではno-opになる）
update vocab_tags set code = 'business' where name = 'ビジネス';
update vocab_tags set code = 'daily_conversation' where name = '日常会話';
update vocab_tags set code = 'part7' where name = 'Part7頻出';
```

`code`は当面nullable（unique制約のみ付与）。理由: `grammar_categories`と異なり`vocab_tags`は固定9分類ではなく、8.6の`commitBatch.ts`がバッチコミット時に新規タグを都度`upsert`で作成しうる開放集合のため、既存の全タグに`code`が行き渡るまでは`NOT NULL`化できない。16.3のマッピングテーブル運用が定着し全タグに`code`が揃ったことを確認した後、別migrationで`alter column code set not null`する（17章の未決事項に追記）。

**migration 2**（`user_vocab_tag_stats`ビューへの`tag_code`列追加、6.5参照）:

```sql
create or replace view user_vocab_tag_stats
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
  max(l.reviewed_at) as last_reviewed_at,
  t.code as tag_code
from vocab_review_logs l
join vocab_word_tags wt on wt.vocab_word_id = l.vocab_word_id
join vocab_tags t on t.id = wt.tag_id
group by l.user_id, t.id, t.name, t.code;
```

`category_code`追加時（`20260809044731_add_category_code_to_grammar_stats_view.sql`）と同じ制約により、新列は`CREATE OR REPLACE VIEW`の末尾に追加する。`group by`にも`t.code`の追加が必要（`t.name`と1:1関係なので集計結果自体への影響はない）。

`security_invoker = true`の再指定を忘れないこと（11.1/11.4/6.5で繰り返し踏んだ不具合）。

### 16.3 Gemini生成パイプラインでの新規タグcode決定方針

検討した2案:

- **A. Geminiにcode（英語）とname（日本語）の両方を生成させる**
- **B. コード側に固定のcode↔nameマッピングテーブルを持つ**

**B（コード側マッピングテーブル）を採用する。**

理由:
- `vocab_tags`は開放集合ではあるが、実際には人間が`generate_vocab.ts --tag <name>`で意図的に選んだテーマ単位でしか増えない運用であり、「Geminiが自由に思いついたタグを大量に作る」わけではない
- A案だと、Geminiが同一概念に対して実行のたびに異なる英語スラッグ（`business` / `biz` / `Business`等）を生成しうる。`code`にunique制約を張る以上、表記揺れが起きれば同じ概念のタグが複数行に分裂し、タグ別の集計・絞り込み（5章・6.5）が壊れる。`grammar_categories.code`は人間が事前に決めているからこそ安全なのであり、同じ安全性をGeminiの自由生成には期待できない
- B案なら、`resolveTagId`が新規タグ行を作る瞬間に必ずマッピングテーブルを参照させ、未登録の名前であれば明示的にエラーで止められる（サイレントに`code = null`のまま放置しない）。A案のリスクを構造的に防げる

実装方針:
- `scripts/content-generation/vocabTagCodes.ts`（新規）に`VOCAB_TAG_CODES: Record<string, string>`を定義する。初期値:
  ```ts
  export const VOCAB_TAG_CODES: Record<string, string> = {
    'ビジネス': 'business',
    '日常会話': 'daily_conversation',
    'Part7頻出': 'part7',
    'イディオム': 'idiom', // 13.1のIDIOM_TAG_NAMEに対応。code='idiom', name='イディオム'の要件を満たす
  }
  ```
- `commitBatch.ts`の`resolveTagId`: `vocab_tags`をnameで検索し、既存タグがヒットすればそのまま`id`を使う（`code`は変更しない）。ヒットしなければ`VOCAB_TAG_CODES[tagName]`を引いて`code`とともにINSERTする。マッピングに無い名前の場合は`未登録のタグ名です。vocabTagCodes.tsにcodeを追加してください: {tagName}`のようなエラーを投げる。この失敗は`commitBatch.ts`の既存の「1アイテムの失敗は`needs_review`に差し戻し、バッチ全体は継続する」仕組み（8.6）にそのまま乗る

副次的な修正（この設計を正しく機能させるために必要、あわせて実施）:
- `prompts/vocab.md`に`tagsは常に["{{tag_name}}"]のみとする`という指示行を追加する。`prompts/idiom.md`には既に同種の指示（`tagsは常に["イディオム"]のみとする`）があるが、通常語彙用の`vocab.md`には無かった。現状Geminiに`tags`へ何を入れるかを明示していないため、放置するとGeminiが独自の文字列を生成し得て、16.3で前提としている「`tags`配列 = CLIで指定した`tagName`のみ」という不変条件が崩れる。今回のcode設計で初めて表面化した既存のギャップであり、対応する

### 16.4 クエリ層の変更

`src/lib/queries/vocab.ts`:
- `getWordIdsForTag(tagCode: string)`: `vocab_tags`の検索条件を`.eq('name', tagCode)`から`.eq('code', tagCode)`に変更する。`getDueVocabCards(userId, limit, tagCode?)`の外部シグネチャ・呼び出し側は変更不要（引数名は元々`tagCode`だったが、実体がname検索になっていたズレを今回で解消する）
- 新規: `getVocabTagByCode(tagCode: string): Promise<{ id: number; name: string } | null>`をexportする。`getWordIdsForTag`内部の`vocab_tags`検索ロジックをこの関数に集約し、`getWordIdsForTag`はここから`id`だけを使う形にリファクタする。この関数は16.5で`VocabReview.tsx`の表示名解決にも再利用する（新規の重複ロジックを作らない、既存関数を拡張・再利用する方針を踏襲）

### 16.5 フロントエンドの変更

`src/lib/queries/weakPoints.ts`:
- `VocabTagStat`に`tagCode: string`、内部の`VocabTagStatRow`に`tag_code: string`を追加

`src/routes/WeakPoints.tsx`:
- 語彙タグのリンク先を`` `/vocab/review/${encodeURIComponent(stat.tagName)}` ``から`` `/vocab/review/${encodeURIComponent(stat.tagCode)}` ``に変更

`src/routes/VocabReview.tsx`:
- `useParams`の`tagCode`は今後英語スラッグ（例: `business`）になる。画面内の「タグ: {tagCode}」表示・空状態メッセージ「「{tagCode}」の対象カードはありません。」をそのまま出すと日本語UIに英語スラッグがそのまま表示され体験が悪化する
- 対応: `tagCode`がある場合、`getVocabTagByCode(tagCode)`を別の`useQuery`（`queryKey: ['vocab-tag', tagCode]`）で取得し、解決できれば日本語の`name`を表示に使う。未取得・該当タグなしの間は`tagCode`をそのままフォールバック表示する

9.3のルーティング表の`:tagCode`の説明を「`vocab_tags.code`（英語スラッグ）を使う」に更新済み（本セクション追記と同時に修正）。

### 16.6 影響を受ける既存テストの更新方針

- `src/lib/queries/vocab.test.ts`: 「resolves tagCode to its word ids」テストは`vocab_tags`モックの`.eq`呼び出し意図がname→codeに変わる点を確認する形に更新（返り値`{id:5}`自体は変更不要）。新規`getVocabTagByCode`のテストを追加
- `src/routes/VocabReview.test.tsx`: 既存2テストの`renderVocabReview('/vocab/review/ビジネス')`を`'/vocab/review/business'`に変更し、`getVocabTagByCode`もモックして日本語名「ビジネス」がラベル・空状態メッセージに表示されることを検証する形に更新
- `src/routes/WeakPoints.test.tsx`: `getVocabTagStats`のモックに`tagCode: 'part7'`を追加し、リンクの`href`アサーションを`` `/vocab/review/${encodeURIComponent('Part7頻出')}` ``から`` `/vocab/review/part7` ``に変更
- `src/lib/queries/weakPoints.test.ts`: `user_vocab_tag_stats`の行モックに`tag_code`を追加
- `scripts/content-generation/commitBatch.test.ts`: `resolveTagId`のテストで新規タグ作成時の`upsert`呼び出しに`code`が含まれることを検証する形に更新。マッピング未登録のタグ名でエラーを投げる異常系テストを追加
- `scripts/content-generation/promptTemplates.test.ts`: `buildVocabPrompt`の出力に`tagsは常に["ビジネス"]のみ`のような文言が含まれることを検証するアサーションを追加（`buildIdiomPrompt`の既存テストと対称の形にする）

---

## 18. 語彙タグ一覧からの復習導線

### 18.1 背景・目的

現状、`/vocab/review/:tagCode`（16章）への導線は弱点分析ダッシュボード（`/weak-points`）経由のみである。`WeakPoints.tsx`は`user_vocab_tag_stats`ビュー（6.5）を元に一覧を出しているため、**そのタグに解答履歴（`vocab_review_logs`）が1件も無いユーザーには、そのタグが画面に一切表示されない**。結果として、まだ手を付けていない新しい語彙タグ（例: 新規追加された`イディオム`タグ）に実質アクセスする手段が無い。

対応として、`vocab_tags`を無条件（解答履歴の有無に関わらず）に一覧表示し、各タグから`/vocab/review/:tagCode`へ直接遷移できる新しい画面`/vocab/tags`を追加する。`GrammarCategories.tsx`（`/grammar`、9カテゴリを無条件一覧表示してドリルへ導線を張る画面）と全く同じ役割・構造であり、実装もそれをそのまま踏襲する。

### 18.2 データ層

`src/lib/queries/vocab.ts`に追加:

```ts
export interface VocabTagSummary {
  id: number
  code: string
  name: string
}

/** 全vocab_tagsを一覧表示用に取得する（/vocab/tags用）。codeがまだ割り当たっていないタグ
 * （16.2: 移行期でnullable）はURLを組み立てられないため除外する。 */
export async function getVocabTags(): Promise<VocabTagSummary[]> {
  const { data, error } = await supabase
    .from('vocab_tags')
    .select('id, code, name')
    .not('code', 'is', null)
    .order('name', { ascending: true })
  if (error) throw error
  return data as VocabTagSummary[]
}
```

`grammar_categories`と違い`vocab_tags`に`sort_order`が無いため、`name`昇順（日本語の文字コード順）で表示する。将来並び順にこだわる要望が出た場合の対応は17章の未決事項に追記する。

**既知の制約**: `code is not null`で絞り込むため、16.2で`code`が未割り当てのまま残っているタグ（理論上、移行期にのみ発生しうる）はこの一覧に出現しない。`WeakPoints.tsx`も同様に`tag_code`が存在する前提の実装になっており（16.5）、同じ制約を共有している。全タグへの`code`バックフィルが完了している限り実害は無いが、17章の「`vocab_tags.code`のNOT NULL化のタイミング」の未決事項と合わせて解消されるべき暫定事項として扱う。

### 18.3 画面

`src/routes/VocabTagList.tsx`（新規、`/vocab/tags`）。`GrammarCategories.tsx`と同じ構造で実装する:

- `useQuery({ queryKey: ['vocab-tags'], queryFn: getVocabTags })`
- ローディング / エラー表示は既存画面と同じスタイル
- 空状態（`vocab_tags`が1件も無い場合。Gemini生成パイプライン未実行の初期状態などで起こりうる）: 「まだ語彙タグがありません。」を表示
- 各タグを`Link to={`/vocab/review/${tag.code}`}`のカードとして一覧表示し、ラベルに`tag.name`（日本語）を表示
- 「ホームに戻る」リンク

### 18.4 ルーティング

`main.tsx`に追加: `{ path: '/vocab/tags', element: <VocabTagList />, loader: requireSession }`

9.3のルーティング表に追記:
```
/vocab/tags             語彙タグ一覧（全タグを無条件表示し、各タグの復習セッションへ遷移）
```

### 18.5 Home.tsxの導線追加

「語彙SRSレビューを始める」ボタンの下に「語彙タグ一覧から復習する」（`/vocab/tags`への`Link`、既存の`border-neutral-300`スタイルのボタンと統一）を追加する。

### 18.6 影響を受ける既存テスト・新規テスト

- `src/lib/queries/vocab.test.ts`: `getVocabTags`の新規テスト（code昇順ではなくname順に並ぶこと、`code is null`のタグが除外されること）を追加
- `src/routes/VocabTagList.test.tsx`（新規）: `GrammarCategories.test.tsx`と同じ構成——一覧表示・各リンクのhref検証・エラー表示・空状態表示
- `Home.tsx`には現状専用のテストファイルが無い（`Home.test.tsx`は存在しない）ため、既存テストへの影響は無い

---

## 20. UIデザインシステム（計器盤コンセプト）

### 20.1 コンセプト

TOEIC 900点という数値目標に向けて精密に測定・記録する道具、というトーン。ウォームホワイトの盤面にダークネイビーの文字、深みのある紫を計器の針や表示灯のように要所だけに効かせる。正誤の判定は深緑（正答）と赤茶（誤答）という警告灯を思わせる2色に語らせる（20260812変更、20.2参照——当初は琥珀だったが「正解が赤系に見える」という直感との不一致の指摘を受け、一般的な緑=正解の感覚に合わせた）。紫は面を塗る色ではなく、「ここを見て・ここを押して」を示すための色として扱う。ダークモードは今回スコープ外。

### 20.2 デザイントークン（`src/index.css`）

Tailwind v4はCSS-first設定（`tailwind.config.js`は存在しない）のため、`@theme`ブロックでトークンを定義する。

```css
@theme {
  /* neutral/redはTailwind組み込みスケールの値を上書き。既存のbg-neutral-*/text-neutral-*/
     border-neutral-*等のclassNameは無改修で新配色を継承する */
  --color-neutral-50: #FAFAF8;   /* ...9段階... */ --color-neutral-900: #1E2338;

  /* 完全新規の意味的トークン */
  --color-accent-50: #F4F2FA;    /* ...9段階... */ --color-accent-600: #5B4B8A;  /* 基準値 */
  --color-correct-50: #F2F7F4;   /* ...9段階... */ --color-correct-600: #4A7C59; /* 基準値、深緑（20260812変更、当初は琥珀色） */
  --color-incorrect-50: #FBEEEC; /* ...9段階... */ --color-incorrect-600: #A8453D; /* 基準値、既存red-*の置き換え */

  --font-sans: -apple-system, BlinkMacSystemFont, "Hiragino Kaku Gothic ProN", "Hiragino Sans", "Yu Gothic", "Segoe UI", sans-serif;
  --font-serif: Georgia, "Iowan Old Style", "Palatino Linotype", "Hiragino Mincho ProN", serif;
  --font-mono: ui-monospace, "SF Mono", "Cascadia Code", Consolas, monospace;
}
```

全10色階調の完全な値は`src/index.css`を参照。英語serifはWebフォントではなくシステムスタック（Georgia等）を採用——フォント読み込みインフラが無く、オフライン動作・表示速度を優先したため。

**実装時に踏んだ不具合**: CSSの複数行コメント内に`neutral-*/text-neutral-*`という表記を書いたところ、`*/`の並びがコメント終端として解釈され、それ以降のコメント本文が生のCSSとして構文エラーになった（`npm run build`のLightning CSS警告で発覚）。コメント中で`*`と`/`が隣接する表記（グロブパターン等）は避ける必要がある。

### 20.3 デザインシステム方針

- **紫の使用ルール**: USE=主要アクションボタン（`bg-accent-600 hover:bg-accent-700`）、セッション内の進捗表示（`font-mono tabular-nums text-accent-700`）、リンク/ボタンのホバー時アクセント（`hover:text-accent-700`/`hover:border-accent-300`）、キーボードフォーカスリング（`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500`、全インタラクティブ要素に統一適用）。AVOID=ページ/セクション全体の背景塗り、本文テキストの既定色、正答率メーターの針色（correct/incorrectが優先）、見出し（h1/h2）の既定色（全画面で`text-neutral-900`に統一し、restraintを優先）。
- **正誤色の使い分け**: `correct`/`incorrect`は個別回答のフィードバックと弱点メーターの評価色の両方で共用し、「良い/悪い」の語彙を一貫させる。
- **タイポグラフィ**: 英語問題文・例文・単語見出し（`GrammarDrill`/`MixedDrill`の設問文、`VocabReview`の単語・例文英語）は`font-serif`。日本語UI・ラベルは既定の`font-sans`のまま。数値（進捗カウンタ・正答率・選択肢ラベルA〜D・キーボードヒント）は`font-mono tabular-nums`。
- **カード階層**: ページ背景`bg-neutral-50`（ウォームホワイト）に対し、カードは純白`bg-white`のまま据え置き——わずかな明度差で「盤面の上のパネル」の階層を無改修で維持する。
- **弱点分析メーター**（`WeakPoints.tsx`）: 正答率を弧状ゲージ（SVG、`Math.cos`/`Math.sin`で正答率から弧の終点座標を算出）で表現。トラックは`stroke-neutral-300`、針の色は70%閾値で`stroke-correct-600`/`stroke-incorrect-600`に分岐（紫は使わない、20.3のAVOID参照）。

### 20.4 実装対象と反映範囲

Home / VocabReview / GrammarDrill / WeakPoints / VocabTagList / MixedDrill / GrammarCategories / Login / AuthCallback の全9画面に適用済み（20260811、後者3画面を追加適用）。認証系（Login/AuthCallback）は画面数が少なくインタラクティブ要素も限定的なため、既存6画面と同一のクラス文字列パターンをそのまま踏襲する形で統一した。

### 20.5 一貫性確認（実施済み）

9画面全てで以下を機械的に確認した:
- 主要ボタンの`bg-accent-600`パターン文字列が全画面で完全一致
- `GrammarDrill.tsx`/`MixedDrill.tsx`の選択肢ボタンの状態クラス（`stateClasses`）が完全一致
- エラーメッセージの`text-incorrect-600`が全画面で統一
- `green-*`/`red-*`/`bg-neutral-900`の残存が対象9画面に無いことをgrepで確認
- 全インタラクティブ要素に`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500`が付与されていることを確認（`Login.tsx`の2つの`<input>`は元々`focus:outline-none`でフォーカスリングを消していた不具合を修正）
- レイアウト・レスポンシブ用のclassName（`grid`/`md:grid-cols-2`/`flex`等）は今回一切変更していないため、既存のレスポンシブ挙動はそのまま維持

---

## 22. AIチューター機能（問題解説の深掘り質問）

### 22.1 概要・UX

文法ドリル・語彙SRS・総合問題の解説表示（`explanation`/`etymology_note`）の下に「もっと詳しく聞く」ボタンを追加する。押すと自由記述の質問欄が開き、送信するとGemini APIが生成した回答をその場に表示する。会話履歴はDBに保存せず、画面遷移で消えてよい——質問対象は常に「今表示している1問」に閉じたスコープであるため、Zustandのセッションストアではなくコンポーネントローカルの`useState`/`useMutation`（TanStack Query）で完結させる。

対象画面: `GrammarDrill.tsx`・`VocabReview.tsx`・`MixedDrill.tsx`の3画面（解説/語源ヒントが表示される全画面）。

### 22.2 リクエスト契約（フロントエンド↔Edge Function共通）

画面によって「問題」の形が異なる（文法・総合問題の文法枠＝4択+正解、総合問題の語彙枠＝4択+正解、`/vocab/review`のフラッシュカード＝正解概念なし）ため、共通フィールドに正規化する。`choices`は4択画面のみ渡し、`VocabReview.tsx`（フラッシュカード）では`correctAnswer`に単語の意味（`meaningJa`）を、`explanation`に`etymologyNote`（無ければ空文字）を渡す。

```ts
interface AskTutorRequest {
  questionText: string       // 設問文 or "単語: 例文"
  choices?: string[]         // 4択のときのみ
  correctAnswer: string      // 正解の選択肢 or 単語の意味
  explanation: string        // 既存のexplanation or etymology_note
  userQuestion: string       // ユーザーの自由記述質問（最大500字、Edge Function側で検証）
}

type AskTutorResponse =
  | { status: 'ok'; answer: string }
  | { status: 'rate_limited'; message: string }
  | { status: 'error'; message: string }
```

### 22.3 DBスキーマ（`tutor_usage`）

`supabase/migrations/20260811070000_create_tutor_usage.sql`:

```sql
create table tutor_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  usage_date date not null default (now() at time zone 'utc')::date,
  request_count integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, usage_date)
);
```

`(user_id, usage_date)`を複合PKにすることで、同一ユーザー・同一日のカウンタ行を1件に保証し、UPSERTの衝突キーとしてそのまま使う。

**チェックと加算は1ステートメントでアトミックに行う**（複数タブからの同時質問で上限を超過して加算されないようにするため）:

```sql
create or replace function increment_tutor_usage(p_user_id uuid, p_max_daily integer)
returns table (allowed boolean, current_count integer)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into tutor_usage (user_id, usage_date, request_count)
  values (p_user_id, (now() at time zone 'utc')::date, 1)
  on conflict (user_id, usage_date) do update
    set request_count = tutor_usage.request_count + 1,
        updated_at = now()
    where tutor_usage.request_count < p_max_daily
  returning request_count into v_count;

  if v_count is null then
    select request_count into v_count from tutor_usage
      where user_id = p_user_id and usage_date = (now() at time zone 'utc')::date;
    return query select false, v_count;
  else
    return query select true, v_count;
  end if;
end;
$$;
```

`ON CONFLICT ... DO UPDATE ... WHERE <条件>`は単一ステートメント内で評価されるため、行ロックの範囲でチェックと加算が完結する。ローカルDBで`p_max_daily=3`として5回連続実行し、1〜3回目は`allowed=true`（`current_count`が1→2→3）、4・5回目は`allowed=false`のまま`current_count=3`で頭打ちになることを実機（`docker exec`経由のpsql、トランザクションをROLLBACKして後始末）で確認済み。

`security invoker`とした理由: 呼び出し元（Edge Functionが使うservice_role）は元々RLSをバイパスする権限を持つため、`security definer`で権限を昇格させる必要が無い（8.4②の`find_similar_*`と同じ判断）。

**実装時に踏んだ不具合**: `ALTER DEFAULT PRIVILEGES`（20260808145101、7章）により新規関数にも`anon`/`authenticated`へのEXECUTEが自動付与される。当初`revoke execute on function ... from anon, authenticated`だけを書いたが、`information_schema.routine_privileges`を実機で確認したところ`PUBLIC`にもEXECUTEが残っていた——PostgreSQLは関数作成時にEXECUTEをPUBLIC（暗黙的に全ロールに適用される）にも自動付与するため、個別ロールへのREVOKEだけでは不十分だった。`revoke execute on function ... from public`を追加することで、`postgres`と`service_role`のみが実行可能な状態に修正した。この関数は`p_user_id`を検証なしに受け取るため、修正しないままだと認証済みユーザーが他人のuser_idを指定して1日30回の枠を勝手に消費させる（嫌がらせ）ことが可能な状態だった。

### 22.4 RLS

```sql
alter table tutor_usage enable row level security;
-- ポリシーは作成しない: ask-tutor Edge Functionはservice_roleキーでRPC呼び出しするためRLSをバイパスする。
-- クライアント（authenticated）からの直接SELECT/INSERT/UPDATEは一切許可しない
-- （generation_batchesと同じ「ポリシー無し=デフォルト拒否」パターン、7章）。
```

### 22.5 Supabase Edge Function（`ask-tutor`）

このプロジェクト初のEdge Function（`supabase/functions/ask-tutor/index.ts`）。Deno runtime、`npm:@supabase/supabase-js@2`をnpm specifierで読み込む。

処理フロー:
1. `Authorization`ヘッダのJWTを`supabase.auth.getUser(jwt)`で検証し`user_id`を取得する。**クライアントから送られてきた値ではなく、JWTから導出した`user_id`のみを信用する**（なりすまし防止）。
2. `increment_tutor_usage(user_id, 30)`をRPC呼び出し。`allowed = false`なら即座に`{ status: 'rate_limited', message: '本日の質問回数上限に達しました。' }`を返し、**Gemini API呼び出しは行わない**（コスト防止）。
3. リクエストボディを簡易バリデーション（必須フィールドの型・`userQuestion`の文字数上限500字・`choices`の要素型）。不正なら400を返す。
4. システムプロンプトに問題文・選択肢・正解・既存解説を埋め込み、Gemini APIを`fetch`でREST直叩き（`generateContent`エンドポイント、モデルは`GEMINI_MODEL`環境変数、既定値`gemini-3.6-flash`）。429/5xxのときのみ1秒待って1回だけリトライ（インタラクティブな対話でユーザーを長時間待たせないため、8.5のバッチ生成パイプラインの指数バックオフ5回よりも短く設定）。
5. 応答テキストを`{ status: 'ok', answer }`で返す。失敗時は`{ status: 'error', message: '...' }`。

システムプロンプト（無関係な質問への制約）:

```
あなたはTOEIC学習アプリの解説チューターです。
以下に示す「問題」「選択肢」「正解」「既存の解説」の範囲内で、ユーザーの質問に日本語で簡潔に答えてください。
この問題と無関係な質問をされた場合は、答えずに「この問題に関する質問をしてください」と促してください。
```

**環境変数はEdge Function専用のSecrets（`supabase secrets set`）として設定し、フロントエンドの`.env`（`VITE_`プレフィックス、ビルド時にバンドルされクライアントに露出する）とは完全に分離する**。既存の`scripts/content-generation/`が使う`.env`のGEMINI_API_KEYとは別管理（Node/tsx実行環境用とDeno Edge Function実行環境用でSecretsストア自体が異なるため、値は同じでも設定操作は別途必要）。ローカル動作確認用に`supabase/functions/.env.example`を用意した（実際の値を入れた`supabase/functions/.env`はコミットしない。ルートの`.gitignore`の`.env`パターンが全階層にマッチするため追加設定不要）。

### 22.6 フロントエンド設計

- `src/lib/queries/tutor.ts`: `askTutor(params: AskTutorParams): Promise<AskTutorResult>` — `supabase.functions.invoke('ask-tutor', { body: params })`のラッパー。invoke自体がエラーを返した場合（ネットワーク障害等）は`{ status: 'error', message: 'AIチューターへの接続に失敗しました。' }`にフォールバックする。テスト3件（`tutor.test.ts`、`../supabase`をモック）。
- 新規共有コンポーネント `src/components/AskTutorPanel.tsx`（このプロジェクト初の`src/components/`ディレクトリ）: `questionText`/`choices`/`correctAnswer`/`explanation`をpropsで受け取る汎用部品。3画面で解説表示の構造がそれぞれ異なるため、パネル自体は「今の1問」の文脈をpropsで渡されるだけの受動的な部品にした。
  - 初期状態:「もっと詳しく聞く」ボタン（`hover:text-accent-700` + フォーカスリング、20章のトークンに準拠）
  - クリックで質問入力欄（`textarea`）と送信ボタン（`bg-accent-600 hover:bg-accent-700`）を展開
  - 送信中: ボタン・入力欄を無効化し「回答を生成中...」を`text-neutral-500`でローディング表示（20章方針どおり派手なアニメーションは使わない）
  - 成功時: 回答を`bg-accent-50 border-accent-200`のパネルに表示（「AIチューターの発言」という区別のための狭い範囲の意味的な紫使用であり、20.3のAVOID「ページ/セクション全体の背景塗り」には抵触しないと判断）
  - `rate_limited`/`error`時: `text-incorrect-600`でメッセージ表示
  - `useMutation({ mutationFn: askTutor })`で送信状態を管理（既存の`submitGrammarAttempt`等と同じパターン）
  - テスト4件（`AskTutorPanel.test.tsx`）: ボタン押下での展開、送信→回答表示、レート制限メッセージ表示、質問未入力時の送信ボタン無効化
- 各画面の解説ブロック直下に組み込み:
  - `GrammarDrill.tsx`/`MixedDrill.tsx`: `choices`・`correctAnswer`（`choices[correctIndex]`）・`explanation`（`explanation ?? ''`）を渡す
  - `VocabReview.tsx`: `questionText`に`"${word}: ${exampleSentenceEn}"`、`correctAnswer`に`meaningJa`、`explanation`に`etymologyNote ?? ''`を渡す（`choices`は渡さない＝フラッシュカードには4択が無いため）
- 既存の3画面テスト（`GrammarDrill.test.tsx`/`VocabReview.test.tsx`/`MixedDrill.test.tsx`）は他の`lib/queries/*`と同様に`../lib/queries/tutor`を`vi.mock`する1行を追加（実際にボタンを押すテストは追加していない——それは`AskTutorPanel.test.tsx`側の責務）。

### 22.7 コスト・セキュリティ考慮点

- APIキーはフロントに一切露出しない（Edge Function Secretsのみ）。
- レート制限はDB側でアトミックにチェックしてから呼び出すため、上限到達後にGemini APIコストが発生することはない。
- ユーザーIDはJWT検証由来のみを信用し、クライアント指定のuser_idは受け付けない。
- `increment_tutor_usage`のEXECUTE権限をservice_role専用に絞り、authenticated/anon/PUBLICから直接RPC呼び出しできないようにした（22.3の不具合参照）。
- 会話履歴を保存しないため、個人情報保持の観点での追加リスクは無い（質問文自体もDBに残らない）。

### 22.8 未実施の運用作業（実行前に要確認）

以下はCLAUDE.mdの「外部APIキーが絡む操作」「クラウドSupabaseプロジェクトへの反映」に該当するため、今回のコード実装には含めていない。別途確認のうえ実行する。

- **実際の`GEMINI_API_KEY`のEdge Function Secretsへの設定**（`supabase secrets set`、ローカル・クラウドとも）
- **`ask-tutor`のクラウドへのデプロイ**（`supabase functions deploy ask-tutor`）
- クラウドSupabaseプロジェクトへの`20260811070000_create_tutor_usage.sql`マイグレーション反映

ローカルでの動作確認（`supabase functions serve` + ローカルSecrets設定）は、実際のGemini APIキー（ユーザー自身のキー）を`supabase/functions/.env`に設定した上でユーザー側に依頼する想定——エージェント側でAPIキーの値そのものを扱う操作は行わない。

---

## 24. キーボード操作の再編成

### 24.1 概要

ドリル系画面の回答選択キーをA〜Dから1〜4（メインキーボードの数字列）に統一し、あわせてメニュー系画面（Home/GrammarCategories/VocabTagList/WeakPoints）にA,B,C...のナビゲーションショートカットを新規追加した。両者は同じ画面に同居しないため、キー割り当ての衝突は無い。

### 24.2 ドリル回答キー: A〜D → 1〜4

`GrammarDrill.tsx`/`MixedDrill.tsx`は`CHOICE_LABELS`配列がキー判定（`event.key.toUpperCase()`との照合）と表示ラベルの両方を兼ねる設計だったため、配列の中身を`['1','2','3','4']`に変えるだけで両方が同時に更新された（ロジック変更は無し）。Enterで次へ進む挙動は無改修。

`VocabReview.tsx`は元々キーボード操作が一切無かった画面（既存のA〜D等はそもそも存在しなかった）。評価ボタン（もう一度/難しい/普通/簡単）はクリックで送信と次カードへの遷移が同時に起きる一手のUIのため、GrammarDrill/MixedDrillと異なりEnterでの「次へ」相当は無い。`isRevealed && !mutation.isPending`のときのみ1〜4キーで評価する処理を新規追加。

### 24.3 メニュー画面のA/B/C...ナビゲーション（新規）

初のカスタムHook `src/lib/useMenuShortcuts.ts`（`src/lib/`に配置——専用のhooksディレクトリが無く、`authLoader.ts`/`fsrs.ts`と同じ「共有ロジックの置き場」のため）:

- `assignShortcutKeys(items, startIndex=0)`: 表示順にA〜Zを割り当てる純粋関数。27件目以降は`shortcutKey: null`（バッジ非表示・キー割り当て無し、クリック/タップは常時可能なため実害なし）。`startIndex`は複数セクションを連番にする用途（WeakPoints参照）。
- `useMenuShortcuts(items)`: 割り当て済みキー押下で`navigate()`する。Ctrl/Cmd/Alt同時押下、input/textarea/select要素へのフォーカス中は無視する（OS/ブラウザショートカットとの衝突・フォーム入力の誤爆を防止）。

適用方針（4画面共通のルール）:
- **ログアウトボタン（Home）はショートカット対象外**——破壊的操作を誤爆させたくないため、ナビゲーション用`<Link>`のみを対象とする。
- **戻るリンクもシーケンスに含める**（DOM順で本体リストの次の文字）。
- **WeakPointsの2セクション（文法/語彙）は1つの連番シーケンス**として扱う（文法セクション→語彙セクション→戻るリンク）。同画面は9文法カテゴリ+3〜4語彙タグ+戻るリンクで現在13〜14件と、既に「10件超」の実例になっている。
- バッジは小さくmonospace・neutral色（`rounded border border-neutral-300 px-1 font-mono text-xs text-neutral-500`）——20.3の「紫は装飾ではなくアクションに使う」方針を踏襲。Homeの主要ボタン（`bg-accent-600`の紫背景）だけは`border-white/40 text-white/80`の白系バリアントを使用（neutral-500だと紫背景に対して視認性が低いため）。
- 4画面とも`isLoading`/`isError`の早期returnより前で`assignShortcutKeys`/`useMenuShortcuts`を呼ぶ（Hooksのルール——早期returnの後にHookを呼ぶことはできない）。データ未取得の間は`?? []`で対応。

### 24.4 実装

サブエージェントに委任（デザイン確定後、バックフィル作業と並行、ファイル衝突無しを確認のうえ実行）。Claudeセッション使用上限で一度中断（探索段階のみでファイル変更は0件だったため実質的なロス無し）、上限リセット後に`SendMessage`で同一エージェントを再開して完走。

- 新規: `src/lib/useMenuShortcuts.ts` + `useMenuShortcuts.test.tsx`（8件、純粋関数のケースと`createMemoryRouter`によるナビゲーション/修飾キー/フォーム入力中の振る舞いテスト）、`src/routes/Home.test.tsx`（4件、ログアウトボタンが誤爆しないことの確認含む）。
- 変更: `GrammarDrill.tsx`/`MixedDrill.tsx`（配列変更+ヒント文言）、`VocabReview.tsx`（新規キーボード処理+バッジ+ヒント文言）、`Home.tsx`/`GrammarCategories.tsx`/`VocabTagList.tsx`/`WeakPoints.tsx`（ショートカット適用）。既存テスト（`GrammarDrill.test.tsx`/`MixedDrill.test.tsx`/`VocabReview.test.tsx`/`GrammarCategories.test.tsx`/`VocabTagList.test.tsx`/`WeakPoints.test.tsx`）をバッジ追加によるアクセシブルネーム変化・キー変更にあわせて更新。
- **仕様からの逸脱**: `eslint.config.js`の`ignores`に`.claude`を追加。並行実行していた別のサブエージェントが`.claude/worktrees/`配下にgit worktreeを作成しており、`typescript-eslint`のtsconfig自動検出が2つのルートを検出して`npm run lint`が無関係な148件のエラーで全面的に壊れていたための最小限の回避策（該当worktreeは作業完了後に削除済みだが、将来また同種の並行作業が起きた場合の保険として残す）。
- 検証: `npm test`（185件全て成功、165件から+20件）・`npm run lint`（0件）・`npm run typecheck`（0件）・`npm run typecheck:scripts`（0件）・`npm run build`（既存の500kB超チャンク警告のみ、無関係。`dist/`は削除済み）。ライブブラウザでの目視確認は実施していない（ブラウザツール未使用、自動テストのみでの検証）。

---

## 25. 未決事項 / 次のステップ

- レビューCLI（`review_batch.ts`）の具体的なUX（承認・却下・その場編集のコマンド設計）
- 一意性セルフチェックの`confidence`閾値・類似度閾値（0.6, 0.8）の妥当性検証（実データで調整予定）
- ~~Gemini API失敗時のリトライ戦略~~ **解決済み（20260809、`gemini.ts`）**: `generateJson()`に429（レート制限）・5xx（一時的な過負荷等）を対象にした指数バックオフリトライを実装（最大5回、3秒基点で倍々に増加）。それ以外（400等のリクエスト自体の誤り、認証エラー等）は即座に失敗させる。8カテゴリ文法問題の一括バックフィル実行中に実際に`gemini-3.6-flash`の503（高負荷）を複数回検知し、リトライで正常に回復することを実運用で確認済み。テスト6件（`gemini.test.ts`、`vi.useFakeTimers`でリトライ間隔を検証）。
- ドリルセッションの出題順（弱点カテゴリを優先出題するか、ランダムか）のロジック
- 弱点ダッシュボードの「警告色」閾値（70%）の妥当性は実データで調整
- ブラウザでの実際のサインアップ再テスト（今回の修正がユーザー体感でも解消しているかの最終確認）
- Google Cloud ConsoleでのOAuthクライアント発行（誰が・いつ実施するか、実際のプロジェクト作成が必要）
- クラウドSupabaseプロジェクトの作成・リンク（11.2、ユーザーのアカウント操作待ち）
- 総合問題（14章）の出題数（現在は文法5問+語彙5問の計10問を仮定）が適切かは実運用で調整
- 語彙4択の`hard`マッピング（14.4）が実際のFSRS間隔に与える影響は、ある程度データが貯まった時点で見直す
- ~~（16章の設計時に発見）`user_vocab_tag_stats`の`accuracy_rate`が`rating in ('good', 'easy')`のみを正答とみなしており、14.4で総合問題の4択正解を`hard`として記録する設計にしたことと組み合わさって、総合問題での正解がダッシュボードにカウントされない副作用があった。~~ **解決済み（20260809060500）**: `accuracy_rate`の正答判定を`rating in ('good', 'hard', 'easy')`（`again`のみ誤答）に変更し、`hard`も正答として扱うようにした（6.5）。理由: `hard`は「思い出せたが確信度が低い」という評価であり間違いではないため。文法側（`user_grammar_category_stats`）は`is_correct`の単純な真偽値集計でFSRSの`rating`概念が無いため対象外
- `vocab_tags.code`のNOT NULL化のタイミング（16.2）: 全タグに`code`が行き渡ったことをどう確認・運用するか（`vocab_tags`に`code is null`の行が残っていないかを定期チェックする運用が必要か等）
- ~~セルフチェックの誤判定パターン例（20260809、8カテゴリ文法問題バックフィル中に発見）~~ **解決済み（20260810）**: 接続詞vs前置詞（後続が節か句か）・関係代名詞の格/種類・仮定法混合条件文の時制、という3パターンの誤判定を`selfCheck.ts`のプロンプト改訂で解消した。詳細は20260810のchangelogエントリを参照。
- **needs_reviewの一次判断をエージェント（Claude）に委ねる運用（20260809、8カテゴリ文法問題バックフィル中にユーザー指示で決定）**: 320問規模の一括生成では`needs_review`が一定数発生することが避けられず、毎回ユーザーに承認を求めると運用上のボトルネックになる。そのため、**文法的に明確に判断できるケース（正解・誤りが一意に決まる、セルフチェック側の見落としが明らかなど）はエージェントが`applyReviewDecision`（`reviewBatch.ts`）で自己判断のうえ承認/却下し、本当に曖昧な（どちらとも取れる）ケースのみユーザーにエスカレートする**、という運用に変更した。承認・却下の判断根拠は`review_notes`に必ず記録する。8.5の人力レビュー運用（レビュー者=人間を前提とした記述）に対する、大量バックフィル作業時の例外的運用として位置づける。~~20260810の8カテゴリ文法バックフィル・語彙タグバックフィルではこの運用のもとエスカレートが1件も発生しなかった（全てエージェントの自己判断で解決）。~~ **訂正（20260812フォローアップ、更新履歴参照）**: 上記はDBへのコミットを未確認のまま楽観的に記載されたもので誤り。実際には`subjunctive`/difficulty=3の1件が「選択肢のどれを選んでも文法的に正しい文が作れない」という構造的欠陥に該当し、ユーザーへエスカレートした（今回唯一の事例）。語彙タグバックフィル側はエスカレート0件のまま変更なし。
- ~~孤立した`generation_batches`行が2件残存（`76c3c893...`, `14ba9664...`、いずれも`status='generating'`・アイテム0件・作成日時05:41-05:42、原因不明の古い失敗）~~ **解決済み（20260813、対応不要と確認）**: 削除前に`generation_batch_items`が0件であることを再確認しようとしたところ、そもそも該当行が両方とも存在しなかった（`status='generating'`の行がローカルに0件）。20260810〜11の`db reset`データ消失事故（更新履歴参照）で`generation_batches`が全消去された際にこの2件も巻き込まれ、失敗した空アーティファクトだったため再生成時にも再現されなかったと判明。クラウド側にも同IDは元より反映されていないことを`db query --linked`で確認済み（クラウド`generation_batches`も33件、`status='generating'`は0件）。削除操作自体は不要だった。
- ~~語彙生成の重複回避コンテキストがタグ単位でDB全体を見ていない（20260810発見）~~ **解決済み（20260813）**: `generateVocab.ts`の`getExistingWordsForTag`（タグ→`vocab_word_tags`→`vocab_words`の2段join）を`getExistingWords`（`vocab_words`を直近作成順にタグを問わず直接取得）に置き換え。`vocab_tags`/`vocab_word_tags`への問い合わせが不要になった分シンプルにもなった。`generateVocab.test.ts`の該当3テストを新しい取得方法に合わせて更新。
- ~~UIデザイントークン（20章）が`GrammarCategories.tsx`・`Login.tsx`・`AuthCallback.tsx`に未適用（20260811）~~ **解決済み（20260811）**: 20.4の通り残り3画面にも適用し、全9画面で統一済み。
- ~~AIチューター機能（22章）のEdge Function Secrets設定・クラウドデプロイが未実施（20260811）~~ **解決済み（20260812）**: クラウドSupabaseへのマイグレーション・データ移行の一環として、`secrets set`でGEMINI_API_KEY/GEMINI_MODELを設定し`ask-tutor`をデプロイ。認証込みのエンドツーエンド確認済み（更新履歴参照）。
- **`supabase projects api-keys`実行時にservice_roleキーの生の値が出力に含まれてしまった件（20260812発見）**: anonキーだけが必要な場面でこのコマンドを使うとservice_role/secretキーも一緒に画面表示されてしまう。ユーザーには直接伝えた上でローテーションを検討してもらうよう申し添え済み——実施したかどうかは未確認。今後はこのコマンドを避け、Supabaseダッシュボードから個別にanonキーだけを確認する運用に切り替えることを検討する。
- ~~文法問題1件が構造的欠陥のためエスカレートされたまま未対応（20260812発見、`subjunctive`/difficulty=3、`generation_batch_items.id=1b18eb14-6285-4160-a87f-5ff2560091e6`、`needs_review`のまま）~~ **解決済み（20260812）**: ユーザー指示によりb案（倒置をやめて平叙形に書き換え）で修正。`question_text`を「Were the director ___ to offer a higher salary...」（倒置、空所自体が不要）から「If the director ___ to offer a higher salary, Ms. Tanaka might reconsider the job proposal.」（平叙形の「If + S + were to + 動詞原形」仮定法構文）に書き換え、`correct_index`を2（"to be"）→1（"were"）に変更。explanationも新しい構文に合わせて全面的に書き直し（主節の"might"という不確かな推量が"were to"と自然に呼応する一方、"is to offer"は取り決め・計画のニュアンスで語調が合わないことを明記——"is"が"were"と紙一重で両立しうる構文である点を意識した説明にした）。`review_notes`に修正理由を記録のうえ`approved`にし、`commit_batch.ts`で反映。`subjunctive`/difficulty=3は15/15、`grammar_questions`は347件に。
- ~~`commitBatch.ts`の`resolveCategoryId`がcategory_codeの略称ゆれを救済しない（20260812発見）~~ **解決済み（20260813）**: ユーザーとの相談のうえ二段構えで対応。①`prompts/grammar.md`に「category_codeフィールドには次の文字列を一字一句そのまま出力（省略形・大文字化禁止）」という明示指示を追加（再発防止の一次防御）。②`resolveCategoryId`に前方一致fallbackを追加——完全一致（casing正規化後）が無い場合、`grammar_categories`全9件に対して双方向の前方一致（略称→正式名、正式名→略称の両方向）で解決し、1件のみヒットすればそれを採用、0件/複数件ならバッチ全体を道連れにせずそのアイテムだけ具体的な理由付きでエラーにする（9件のcodeは互いに前方一致しないクローズドセットのため実データ上曖昧性は生じない）。あわせて、コミット失敗時のエラーメッセージが`String(error)`で`[object Object]`になっていた不具合も修正し`error.message`を優先抽出するように変更（原因調査でSQLを直接叩く必要があった実害箇所）。テスト3件追加（略称からの解決成功、fallbackも曖昧な場合のエラー、`[object Object]`にならないことの確認）。
- ~~語彙タグ「Part7頻出」が目安30〜50語を下回ったまま（20260812、現在26語）~~ **解決済み（20260812）**: `generate_vocab.ts --tag Part7頻出 --count 20`で追加バッチを実行。20件中auto_passed=7件、needs_review=13件（うち11件は他タグに既に同一word+part_of_speechで登録済みの完全重複のため却下、2件は既存語と類似度0.6台だが品詞が異なる正当な別語——`correspond`動詞 vs 既存`correspondence`名詞、`promptly`副詞 vs 既存`prompt`形容詞、`reimbursement`/`reimburse`と同じパターン——のため承認）、9件をコミット。Part7頻出は26語→**35語**（目安30〜50語の範囲内）、`vocab_words`合計は159件。
