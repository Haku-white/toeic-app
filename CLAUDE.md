# CLAUDE.md

このファイルは、Claude Codeが本プロジェクト（toeic-app）で作業する際の運用ルールをまとめたものです。
詳細な設計判断・変更の経緯は `DESIGN.md` を参照してください。このファイルはDESIGN.mdの内容を踏まえた
「進め方」の指針であり、設計そのものの記録はDESIGN.md側に一元化します（重複させない）。

## 技術スタック概要

- フロントエンド: Vite + React 19 + TypeScript + Tailwind CSS v4 + React Router v7（data router、`loader`での認証ガード）
- サーバー状態: TanStack Query v5（Supabaseクエリのキャッシュ・再検証）
- ローカルUI状態: Zustand v5（セッションの進行状態など、サーバー状態と分離すべきものに限定）
- バックエンド: Supabase（Postgres + Auth + RLS）。ローカル開発は `supabase start`（`npm run db:start`）
- SRSアルゴリズム: `ts-fsrs` **v4.7.1に固定**（`^5`系へは上げない）。理由: v5で`Card`/`ReviewLog`に追加された`learning_steps`フィールドを、既存DBスキーマ（`user_vocab_progress`/`vocab_review_logs`）が持たないため。アップグレードする場合は必ずスキーマ変更とセットで設計し直すこと（DESIGN.md 3章・6.3）
- コンテンツ生成: `@google/genai`（Gemini API）。既定モデルは`.env`の`GEMINI_MODEL`（現在`gemini-3.6-flash`）。`generateJson()`に429/5xx向けの指数バックオフリトライ実装済み（DESIGN.md 19章）
- バリデーション: Zod v4
- Node実行: `tsx`（`scripts/content-generation/`配下）
- テスト: Vitest + Testing Library（jsdom）
- Lint: ESLint（flat config, typescript-eslint）

## 進め方の基本方針

- DESIGN.mdに記録済みの設計判断・方針に沿っている限り、**明確に間違っている場合を除いて、都度確認を求めずに自分の判断で実装を進めてよい**。設計上の選択肢が複数あり判断に迷う場合も、まず自分なりの結論を出し、その理由を添えて進める（判断を丸投げしない）。
- 実装後は必ずテスト・lint・typecheckを実行し、失敗があれば自己修正してから完了とする（下記「テスト方針」参照）。
- 完了したら必ずDESIGN.mdの更新履歴に記録する（下記「DESIGN.mdへの記録」参照）。

## 必ず立ち止まって確認すること

以下に該当する操作は、一見明らかに正しそうに見えても、実行前に必ずユーザーに確認する。

- **DBスキーマの破壊的変更**: 列やテーブルの削除、型変更、既存列のNOT NULL化など、既存データや既存コードとの互換性を壊しうる変更（新しい列・テーブルの追加のように後方互換な変更はこの限りではない）
- **RLSポリシーの変更**: ポリシーの追加・削除・条件変更。誤ると他人のデータが見える／自分のデータが見えなくなる、といった実害に直結するため
- **外部APIキーが絡む操作**: `.env`の読み書き、Gemini APIキーの取り扱い、実際にコスト・クォータが発生するAPI呼び出しを新規に開始すること。ただし、対象範囲（件数・カテゴリ等）が事前に明確に合意されている場合、その範囲内での実行（例: 合意済みの一括生成作業の各バッチ実行）は都度の再確認なしに進めてよい
- **既存データの削除を伴う操作**: DB上のレコード削除、ファイル削除、生成済みコンテンツの破棄など
- （上記に準ずるものとして）**クラウドSupabaseプロジェクトへのマイグレーション反映・データ変更**も、明示的な指示がない限り行わない。ローカルでの適用と本番（クラウド）への反映は必ず分けて考える

## コーディング規約

### ディレクトリ構成・命名パターン

既存ファイルの命名パターンを踏襲する（新しい規約を持ち込まない）。

- `src/lib/queries/*.ts`: Supabaseへのクエリ関数を集約する層。ファイル名はcamelCase（例: `vocab.ts`, `grammar.ts`, `weakPoints.ts`, `mixedDrill.ts`）。コンポーネントから直接`supabase.from()`を呼ばない（DESIGN.md 9.4）
- `src/routes/*.tsx`: 画面コンポーネント。ファイル名はコンポーネント名と一致するPascalCase（例: `GrammarDrill.tsx`, `VocabReview.tsx`）
- `src/stores/*.ts`: Zustandのセッション状態ストア。camelCase + `SessionStore`サフィックス（例: `grammarSessionStore.ts`, `mixedDrillSessionStore.ts`）
- `scripts/content-generation/`: Gemini APIバッチ生成パイプライン。CLIエントリポイントはsnake_case（例: `generate_grammar.ts`, `validate_batch.ts`）とし、薄いラッパーに徹する。実処理は同名camelCaseファイル（例: `generateGrammar.ts`, `validateBatch.ts`）に切り出し、依存（`supabase`クライアント・`generateJson`等）は引数で注入する——テストで実API・実DBに繋がず差し替えられるようにするため
- 既存の類似機能があるときは、新しい関数を作る前に既存関数を拡張できないか検討する（例: `getDueVocabCards`にオプション引数`tagCode`を追加した前例）

### テスト方針

- 新規・変更した`.ts`/`.tsx`ファイルには、原則として同じディレクトリに対応する`.test.ts`/`.test.tsx`を用意する
- Supabaseクライアントは`vi.mock`でモックし、実DBには繋がない。チェーン可能・awaitable（`.then()`を持つ）なクエリビルダのモックパターンを既存テストから踏襲する
- 実装完了時は必ず以下を実行し、全て通ることを確認する
  - `npm test`
  - `npm run lint`
  - `npm run typecheck`（`src/`配下を変更した場合）
  - `npm run typecheck:scripts`（`scripts/`配下を変更した場合）
- 失敗があれば自己修正してから完了とする。テストなしでの完了報告はしない

### DESIGN.mdへの記録

- 設計判断を伴う変更は、実装前にDESIGN.mdの該当セクションへ設計案を追記する（新しい章が必要な場合は既存の「未決事項」章の手前に採番する）
- 実装完了後は必ず「更新履歴」に日付つきでエントリを追記する。ファイル単位で何を変えたか・発見した不具合・テスト件数などを含め、後から経緯を追える程度の詳細さで書く（既存のエントリの粒度を踏襲する）
- 実装の過程で既存の記載が実装と食い違っていることに気づいたら、その場で修正する。DESIGN.mdは常に現状を反映する生きたドキュメントとして扱う
