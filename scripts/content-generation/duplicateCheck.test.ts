import { describe, expect, it, vi } from 'vitest'
import { findSimilarGrammarQuestions, findSimilarVocabWords } from './duplicateCheck'

describe('findSimilarGrammarQuestions', () => {
  it('calls the RPC with the expected params and returns its data', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'q-1', question_text: 'similar text', similarity: 0.71 }],
      error: null,
    })
    const supabase = { rpc } as unknown as Parameters<typeof findSimilarGrammarQuestions>[0]

    const result = await findSimilarGrammarQuestions(supabase, 'The company ___ its report.', 0.6, 5)

    expect(rpc).toHaveBeenCalledWith('find_similar_grammar_questions', {
      query_text: 'The company ___ its report.',
      similarity_threshold: 0.6,
      match_limit: 5,
    })
    expect(result).toEqual([{ id: 'q-1', question_text: 'similar text', similarity: 0.71 }])
  })

  it('applies default threshold/limit when omitted', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [], error: null })
    const supabase = { rpc } as unknown as Parameters<typeof findSimilarGrammarQuestions>[0]

    await findSimilarGrammarQuestions(supabase, 'text')

    expect(rpc).toHaveBeenCalledWith('find_similar_grammar_questions', {
      query_text: 'text',
      similarity_threshold: 0.6,
      match_limit: 5,
    })
  })

  it('throws when the RPC returns an error', async () => {
    const rpc = vi.fn().mockResolvedValue({ data: null, error: new Error('rpc failed') })
    const supabase = { rpc } as unknown as Parameters<typeof findSimilarGrammarQuestions>[0]
    await expect(findSimilarGrammarQuestions(supabase, 'text')).rejects.toThrow('rpc failed')
  })
})

describe('findSimilarVocabWords', () => {
  it('calls the RPC with the expected params and returns its data', async () => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ id: 'w-1', word: 'negotiate', similarity: 0.65 }],
      error: null,
    })
    const supabase = { rpc } as unknown as Parameters<typeof findSimilarVocabWords>[0]

    const result = await findSimilarVocabWords(supabase, 'negotiation', 0.6, 5)

    expect(rpc).toHaveBeenCalledWith('find_similar_vocab_words', {
      query_word: 'negotiation',
      similarity_threshold: 0.6,
      match_limit: 5,
    })
    expect(result).toEqual([{ id: 'w-1', word: 'negotiate', similarity: 0.65 }])
  })
})
