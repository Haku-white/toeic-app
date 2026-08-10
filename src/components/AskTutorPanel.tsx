import { useState, type FormEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { askTutor, type AskTutorParams } from '../lib/queries/tutor'

type AskTutorPanelProps = Pick<AskTutorParams, 'questionText' | 'choices' | 'correctAnswer' | 'explanation'>

/** 22章: 解説の下に置く「もっと詳しく聞く」パネル。会話履歴は保持せず、1問につき都度質問→回答のみ。 */
export default function AskTutorPanel({ questionText, choices, correctAnswer, explanation }: AskTutorPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [userQuestion, setUserQuestion] = useState('')
  const mutation = useMutation({ mutationFn: askTutor })

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!userQuestion.trim() || mutation.isPending) return
    mutation.mutate({ questionText, choices, correctAnswer, explanation, userQuestion })
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="text-xs font-medium text-neutral-500 underline transition-colors hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        もっと詳しく聞く
      </button>
    )
  }

  return (
    <div className="space-y-2">
      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          value={userQuestion}
          onChange={(e) => setUserQuestion(e.target.value)}
          placeholder="この問題について質問する..."
          rows={2}
          disabled={mutation.isPending}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-accent-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={mutation.isPending || !userQuestion.trim()}
          className="rounded bg-accent-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          質問する
        </button>
      </form>

      {mutation.isPending && <p className="text-xs text-neutral-500">回答を生成中...</p>}

      {mutation.data?.status === 'ok' && (
        <p className="rounded border border-accent-200 bg-accent-50 px-3 py-2 text-sm text-neutral-800">
          {mutation.data.answer}
        </p>
      )}
      {mutation.data && mutation.data.status !== 'ok' && (
        <p className="text-xs text-incorrect-600">{mutation.data.message}</p>
      )}
    </div>
  )
}
