// AIチューター機能のEdge Function（DESIGN.md 22章）。
// 問題の解説について、フロントから送られた質問文にGemini APIで回答する。
// GEMINI_API_KEYはこのEdge Functionのsecretsとしてのみ保持し、フロントには一切渡さない。

import { createClient } from 'npm:@supabase/supabase-js@2'

const MAX_DAILY_REQUESTS = 30
const MAX_QUESTION_LENGTH = 500
const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-3.6-flash'

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface AskTutorRequest {
  questionText: string
  choices?: string[]
  correctAnswer: string
  explanation: string
  userQuestion: string
}

type AskTutorResponse =
  | { status: 'ok'; answer: string }
  | { status: 'rate_limited'; message: string }
  | { status: 'error'; message: string }

function json(body: AskTutorResponse | { error: string }, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
  })
}

function isValidRequest(body: unknown): body is AskTutorRequest {
  if (typeof body !== 'object' || body === null) return false
  const b = body as Record<string, unknown>
  return (
    typeof b.questionText === 'string' &&
    typeof b.correctAnswer === 'string' &&
    typeof b.explanation === 'string' &&
    typeof b.userQuestion === 'string' &&
    b.userQuestion.length > 0 &&
    b.userQuestion.length <= MAX_QUESTION_LENGTH &&
    (b.choices === undefined || (Array.isArray(b.choices) && b.choices.every((c) => typeof c === 'string')))
  )
}

const SYSTEM_PROMPT = `あなたはTOEIC学習アプリの解説チューターです。
以下に示す「問題」「選択肢」「正解」「既存の解説」の範囲内で、ユーザーの質問に日本語で簡潔に答えてください。
この問題と無関係な質問をされた場合は、答えずに「この問題に関する質問をしてください」と促してください。`

function buildUserPrompt(body: AskTutorRequest): string {
  const lines = [`【問題】${body.questionText}`]
  if (body.choices?.length) lines.push(`【選択肢】${body.choices.join(' / ')}`)
  lines.push(`【正解】${body.correctAnswer}`, `【既存の解説】${body.explanation}`, '', `【質問】${body.userQuestion}`)
  return lines.join('\n')
}

async function callGemini(body: AskTutorRequest): Promise<string> {
  const apiKey = Deno.env.get('GEMINI_API_KEY')
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured')

  const requestBody = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts: [{ text: buildUserPrompt(body) }] }],
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`

  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  })

  // インタラクティブな対話でユーザーを長時間待たせないため、リトライは1回のみ
  // （8.5のバッチ生成パイプラインの指数バックオフ5回リトライより短く設定）。
  if (!res.ok && (res.status === 429 || res.status >= 500)) {
    await new Promise((resolve) => setTimeout(resolve, 1000))
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    })
  }

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  const answer = data.candidates?.[0]?.content?.parts?.[0]?.text
  if (typeof answer !== 'string' || !answer) {
    throw new Error('Gemini API returned no answer text')
  }
  return answer
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return json({ error: 'unauthorized' }, 401)
  }

  const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  // クライアントから送られてきたuser_idではなく、JWTから検証したuser_idのみを信用する
  // （なりすまし防止。22.5参照）。
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''))
  if (authError || !user) {
    return json({ error: 'unauthorized' }, 401)
  }

  const { data: usage, error: usageError } = await supabase
    .rpc('increment_tutor_usage', { p_user_id: user.id, p_max_daily: MAX_DAILY_REQUESTS })
    .single()
  if (usageError) {
    return json({ error: 'internal' }, 500)
  }
  if (!(usage as { allowed: boolean }).allowed) {
    return json({ status: 'rate_limited', message: '本日の質問回数上限に達しました。' })
  }

  let body: unknown
  try {
    body = await req.json()
  } catch {
    return json({ error: 'invalid_json' }, 400)
  }
  if (!isValidRequest(body)) {
    return json({ error: 'invalid_request' }, 400)
  }

  try {
    const answer = await callGemini(body)
    return json({ status: 'ok', answer })
  } catch {
    return json({ status: 'error', message: 'AIチューターが混み合っています。しばらくしてから再試行してください。' })
  }
})
