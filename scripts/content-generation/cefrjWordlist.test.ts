import { describe, expect, it } from 'vitest'
import {
  CEFR_TO_TOEIC_BAND,
  excludeExistingCandidates,
  filterCefrjCandidates,
  parseCefrjCsv,
  type CefrjCandidate,
} from './cefrjWordlist'

describe('parseCefrjCsv', () => {
  it('parses headword/pos/CEFR from the first 3 columns, skipping the header row', () => {
    const csv = [
      'headword,pos,CEFR,CoreInventory 1,CoreInventory 2,Threshold',
      'a,determiner,A1,,,',
      'abandon,verb,B1,,,',
      'abandoned,adjective,B2,,,',
    ].join('\n')

    expect(parseCefrjCsv(csv)).toEqual([
      { headword: 'a', pos: 'determiner', cefr: 'A1' },
      { headword: 'abandon', pos: 'verb', cefr: 'B1' },
      { headword: 'abandoned', pos: 'adjective', cefr: 'B2' },
    ])
  })

  it('skips blank lines and malformed rows', () => {
    const csv = ['headword,pos,CEFR', 'word1,noun,A1', '', 'word2,verb'].join('\n')
    expect(parseCefrjCsv(csv)).toEqual([{ headword: 'word1', pos: 'noun', cefr: 'A1' }])
  })
})

describe('filterCefrjCandidates', () => {
  const rows = [
    { headword: 'a', pos: 'determiner', cefr: 'A1' }, // 機能語→除外
    { headword: 'abandon', pos: 'verb', cefr: 'B1' }, // 対象
    { headword: 'abandoned', pos: 'adjective', cefr: 'B2' }, // 対象
    { headword: 'about', pos: 'adverb', cefr: 'A1' }, // レベル対象外
    { headword: 'according to', pos: 'preposition', cefr: 'B1' }, // 複数語+機能語→除外
    { headword: 'air conditioning', pos: 'noun', cefr: 'B1' }, // 複数語→既定除外
    { headword: 'a.m./A.M./am/AM', pos: 'adverb', cefr: 'A1' }, // スラッシュ表記ゆれ→除外
    { headword: 'is', pos: 'be-verb', cefr: 'B1' }, // be-verb→verbへ正規化
  ]

  it('filters by level and content POS, excludes multi-word phrases by default', () => {
    const result = filterCefrjCandidates({ rows, levels: ['B1', 'B2'] })
    expect(result).toEqual([
      { word: 'abandon', partOfSpeech: 'verb', cefrLevel: 'B1' },
      { word: 'abandoned', partOfSpeech: 'adjective', cefrLevel: 'B2' },
      { word: 'is', partOfSpeech: 'verb', cefrLevel: 'B1' },
    ])
  })

  it('normalizes be-verb/do-verb/have-verb to verb', () => {
    const result = filterCefrjCandidates({
      rows: [
        { headword: 'do', pos: 'do-verb', cefr: 'B1' },
        { headword: 'have', pos: 'have-verb', cefr: 'B1' },
      ],
      levels: ['B1'],
    })
    expect(result).toEqual([
      { word: 'do', partOfSpeech: 'verb', cefrLevel: 'B1' },
      { word: 'have', partOfSpeech: 'verb', cefrLevel: 'B1' },
    ])
  })

  it('includes multi-word phrases when explicitly requested', () => {
    const result = filterCefrjCandidates({
      rows: [{ headword: 'air conditioning', pos: 'noun', cefr: 'B1' }],
      levels: ['B1'],
      includeMultiWordPhrases: true,
    })
    expect(result).toEqual([{ word: 'air conditioning', partOfSpeech: 'noun', cefrLevel: 'B1' }])
  })

  it('deduplicates rows that collapse to the same word+part_of_speech after normalization', () => {
    const result = filterCefrjCandidates({
      rows: [
        { headword: 'well', pos: 'be-verb', cefr: 'B1' },
        { headword: 'well', pos: 'do-verb', cefr: 'B1' }, // 正規化後は同じ"verb"になる
      ],
      levels: ['B1'],
    })
    expect(result).toEqual([{ word: 'well', partOfSpeech: 'verb', cefrLevel: 'B1' }])
  })

  it('returns an empty array when no rows match the requested levels', () => {
    expect(filterCefrjCandidates({ rows, levels: ['C1'] })).toEqual([])
  })
})

describe('excludeExistingCandidates', () => {
  const candidates: CefrjCandidate[] = [
    { word: 'abandon', partOfSpeech: 'verb', cefrLevel: 'B1' },
    { word: 'negotiate', partOfSpeech: 'verb', cefrLevel: 'B2' },
  ]

  it('excludes candidates whose word+part_of_speech exactly matches an existing pair', () => {
    const existing = new Set(['negotiate|verb'])
    expect(excludeExistingCandidates(candidates, existing)).toEqual([
      { word: 'abandon', partOfSpeech: 'verb', cefrLevel: 'B1' },
    ])
  })

  it('does not exclude a same-spelled word under a different part_of_speech', () => {
    const existing = new Set(['negotiate|noun']) // 品詞違いなので除外されない
    expect(excludeExistingCandidates(candidates, existing)).toEqual(candidates)
  })

  it('returns all candidates unchanged when nothing overlaps', () => {
    expect(excludeExistingCandidates(candidates, new Set())).toEqual(candidates)
  })
})

describe('CEFR_TO_TOEIC_BAND', () => {
  it('covers A1 through C1 with monotonically increasing bands', () => {
    const levels = ['A1', 'A2', 'B1', 'B2', 'C1'] as const
    const bands = levels.map((level) => CEFR_TO_TOEIC_BAND[level])
    expect(bands).toEqual([400, 500, 600, 730, 860])
    for (let i = 1; i < bands.length; i += 1) {
      expect(bands[i]).toBeGreaterThan(bands[i - 1])
    }
  })
})
