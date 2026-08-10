/**
 * 16.3: Gemini生成パイプラインが`vocab_tags`を作成・参照する際に使うcode↔nameマッピング。
 * Geminiにcodeを生成させると同一概念に異なる英語スラッグを付与しうる（表記揺れがcodeのunique制約と
 * 衝突し、同じ概念のタグが複数行に分裂する）ため、codeは常にこの固定テーブルから解決する。
 * 未登録の名前は`commitBatch.ts`のresolveTagIdがエラーで止める（サイレントにcode未設定のまま
 * タグを作らない）。新しいタグを導入する場合は、ここに先に追記してから生成を実行する。
 */
export const VOCAB_TAG_CODES: Record<string, string> = {
  ビジネス: 'business',
  日常会話: 'daily_conversation',
  Part7頻出: 'part7',
  イディオム: 'idiom',
}
