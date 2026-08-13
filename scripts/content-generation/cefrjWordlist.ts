import { wordPosKey } from './structuralValidation'

/**
 * CEFR-J Wordlist（21章）の取り込みロジック。DB/ファイルI/Oに依存しない純粋関数群。
 * データソース・ライセンス・引用表記は`data/README.md`参照。
 */

export interface CefrjRow {
  headword: string
  pos: string
  cefr: string
}

/** CSVの`headword,pos,CEFR,...`列のうち先頭3列のみを使う（21.1: 残りは一部行にのみ値がある補助情報）。 */
export function parseCefrjCsv(csvText: string): CefrjRow[] {
  const lines = csvText.split('\n').slice(1) // ヘッダー行を除く
  const rows: CefrjRow[] = []
  for (const line of lines) {
    if (line.trim().length === 0) continue
    const [headword, pos, cefr] = line.split(',')
    if (!headword || !pos || !cefr) continue
    rows.push({ headword: headword.trim(), pos: pos.trim(), cefr: cefr.trim() })
  }
  return rows
}

/** 21.1: 語彙カード(意味・語源を学ぶ内容語)にふさわしい品詞のみを対象にする。機能語は除外。 */
const CONTENT_POS = new Set(['noun', 'verb', 'adjective', 'adverb', 'be-verb', 'do-verb', 'have-verb'])

/** 21.1: be-verb/do-verb/have-verbは既存`vocab_words.part_of_speech`の語彙(Geminiが使う値)に合わせてverbへ正規化する。 */
const POS_NORMALIZE: Record<string, string> = { 'be-verb': 'verb', 'do-verb': 'verb', 'have-verb': 'verb' }

/** 21.5: CEFRレベル→TOEIC目安スコアのマッピング。根拠はDESIGN.md 21.5参照。 */
export const CEFR_TO_TOEIC_BAND: Record<string, number> = {
  A1: 400,
  A2: 500,
  B1: 600,
  B2: 730,
  C1: 860,
}

export interface CefrjCandidate {
  word: string
  partOfSpeech: string
  cefrLevel: string
}

export interface FilterCefrjCandidatesParams {
  rows: CefrjRow[]
  /** 対象CEFRレベル（例: ['B1', 'B2']）。 */
  levels: string[]
  /** 複数語フレーズ（空白/スラッシュを含む見出し語）を含めるか。既定false（21.3・21.5参照）。 */
  includeMultiWordPhrases?: boolean
}

/**
 * POSフィルタ・レベルフィルタ・複数語フレーズ除外を適用し、CSV内の重複行
 * （同一語が複数品詞で複数行になる、または正規化後に品詞が一致してしまう行）を除いた
 * 候補語リストを返す。既存DBとの突き合わせ（`excludeExistingCandidates`）はここでは行わない。
 */
export function filterCefrjCandidates(params: FilterCefrjCandidatesParams): CefrjCandidate[] {
  const levelSet = new Set(params.levels)
  const includePhrases = params.includeMultiWordPhrases ?? false
  const seen = new Set<string>()
  const result: CefrjCandidate[] = []

  for (const row of params.rows) {
    if (!levelSet.has(row.cefr)) continue
    if (!CONTENT_POS.has(row.pos)) continue
    if (!includePhrases && /[\s/]/.test(row.headword)) continue

    const partOfSpeech = POS_NORMALIZE[row.pos] ?? row.pos
    const key = wordPosKey(row.headword, partOfSpeech)
    if (seen.has(key)) continue
    seen.add(key)

    result.push({ word: row.headword, partOfSpeech, cefrLevel: row.cefr })
  }

  return result
}

/**
 * 既存`vocab_words`との重複（word+part_of_speech完全一致、`wordPosKey`基準）を除外する。
 * `existingWordPosPairs`は`validateBatch.ts`の`loadExistingVocabWordPosPairs`が返す集合と
 * 同じ形式（大文字小文字を正規化しない完全一致）を想定する。
 */
export function excludeExistingCandidates(
  candidates: CefrjCandidate[],
  existingWordPosPairs: ReadonlySet<string>,
): CefrjCandidate[] {
  return candidates.filter((c) => !existingWordPosPairs.has(wordPosKey(c.word, c.partOfSpeech)))
}

/**
 * 21.9: `items`から`limit`件を、配列全体からほぼ等間隔になるよう決定的に選ぶ。
 * CEFR-J CSVは見出し語のアルファベット順のため、`items.slice(0, limit)`のような先頭からの
 * 単純な切り出しだと特定の頭文字（"a"始まりなど）に偏ってしまう問題への対応。乱数は使わず
 * （スクリプトの再現性を保つため）、`items.length / limit`のストライド幅でインデックスを取る。
 */
export function sampleEvenly<T>(items: T[], limit: number): T[] {
  if (limit <= 0) return []
  if (items.length <= limit) return [...items]

  const stride = items.length / limit
  const indices = new Set<number>()
  for (let i = 0; i < limit; i += 1) {
    indices.add(Math.min(items.length - 1, Math.floor(i * stride)))
  }
  return Array.from(indices)
    .sort((a, b) => a - b)
    .map((i) => items[i])
}
