import { supabase } from '../supabase'

export interface AskTutorParams {
  questionText: string
  choices?: string[]
  correctAnswer: string
  explanation: string
  userQuestion: string
}

export type AskTutorResult =
  | { status: 'ok'; answer: string }
  | { status: 'rate_limited'; message: string }
  | { status: 'error'; message: string }

/** `ask-tutor` Edge Function（22章）を呼び出す。GEMINI_API_KEYはEdge Function側のみが保持し、フロントには一切渡らない。 */
export async function askTutor(params: AskTutorParams): Promise<AskTutorResult> {
  const { data, error } = await supabase.functions.invoke<AskTutorResult>('ask-tutor', {
    body: params,
  })
  if (error || !data) {
    return { status: 'error', message: 'AIチューターへの接続に失敗しました。' }
  }
  return data
}
