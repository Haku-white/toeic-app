import { beforeEach, describe, expect, it, vi } from 'vitest'

const invokeMock = vi.fn()

vi.mock('../supabase', () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invokeMock(...args) },
  },
}))

const { askTutor } = await import('./tutor')

const baseParams = {
  questionText: 'The company ___ its report by Friday.',
  choices: ['will have submitted', 'submits', 'submitted', 'submitting'],
  correctAnswer: 'will have submitted',
  explanation: '未来完了形を使う。',
  userQuestion: 'なぜ現在完了ではダメなのですか?',
}

beforeEach(() => {
  invokeMock.mockReset()
})

describe('askTutor', () => {
  it('passes the params through to the Edge Function and returns the answer on success', async () => {
    invokeMock.mockResolvedValue({ data: { status: 'ok', answer: '現在完了は継続を表すためです。' }, error: null })

    const result = await askTutor(baseParams)

    expect(result).toEqual({ status: 'ok', answer: '現在完了は継続を表すためです。' })
    expect(invokeMock).toHaveBeenCalledWith('ask-tutor', { body: baseParams })
  })

  it('passes through a rate_limited response from the Edge Function', async () => {
    invokeMock.mockResolvedValue({
      data: { status: 'rate_limited', message: '本日の質問回数上限に達しました。' },
      error: null,
    })

    const result = await askTutor(baseParams)

    expect(result).toEqual({ status: 'rate_limited', message: '本日の質問回数上限に達しました。' })
  })

  it('returns a generic error result when the invoke call itself fails', async () => {
    invokeMock.mockResolvedValue({ data: null, error: new Error('network down') })

    const result = await askTutor(baseParams)

    expect(result).toEqual({ status: 'error', message: 'AIチューターへの接続に失敗しました。' })
  })
})
