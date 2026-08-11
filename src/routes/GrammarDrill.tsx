import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLoaderData, useNavigate, useParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getGrammarDrillData, submitGrammarAttempt } from '../lib/queries/grammar'
import { useGrammarSessionStore } from '../stores/grammarSessionStore'
import AskTutorPanel from '../components/AskTutorPanel'

const CHOICE_LABELS = ['1', '2', '3', '4']
const COMPLETE_SCREEN_LINK_TO = '/grammar'

export default function GrammarDrill() {
  const { session } = useLoaderData() as { session: Session }
  const { categoryCode } = useParams<{ categoryCode: string }>()
  const userId = session.user.id
  const navigate = useNavigate()

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['grammar-drill', categoryCode],
    queryFn: () => getGrammarDrillData(categoryCode!),
    enabled: !!categoryCode,
  })

  const { currentIndex, selectedIndex, correctCount, answeredCount, answer, advance, resetSession } =
    useGrammarSessionStore()
  const questionStartRef = useRef<number>(Date.now())
  // AskTutorPanelのテキストエリアにフォーカスがある間は、Enterがショートカット「次へ」ではなく
  // 質問送信に使われる（26章）。下部のヒント表示をそれに合わせて切り替えるための状態。
  const [isAskingTutor, setIsAskingTutor] = useState(false)

  useEffect(() => {
    resetSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryCode])

  useEffect(() => {
    questionStartRef.current = Date.now()
  }, [currentIndex])

  const mutation = useMutation({ mutationFn: submitGrammarAttempt })

  const questions = data?.questions
  const currentQuestion = questions?.[currentIndex]
  const isSessionComplete = !!questions && questions.length > 0 && currentIndex >= questions.length

  const handleAnswer = useCallback(
    (index: number) => {
      if (!currentQuestion || selectedIndex !== null) return
      const isCorrect = index === currentQuestion.correctIndex
      const questionStartedAt = questionStartRef.current
      const responseTimeMs = questionStartedAt ? Date.now() - questionStartedAt : undefined
      answer(index, isCorrect)
      mutation.mutate({
        userId,
        questionId: currentQuestion.id,
        selectedIndex: index,
        isCorrect,
        responseTimeMs,
      })
    },
    [currentQuestion, selectedIndex, answer, mutation, userId],
  )

  // 1〜4キーで選択肢を選び、選択済みならEnterキーで次の問題へ進めるようにする
  // （マウス操作は変更せず併用可能。読み込み中/エラー時など問題が無い間は無視する）。
  // セッション完了画面ではcurrentQuestionがundefinedになる（配列範囲外）ため、
  // 個別に判定してEnterで「カテゴリ一覧に戻る」へ遷移できるようにする
  // （25章: 以前はここが手薄でキーボードのみでの操作が完結していなかった）。
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isSessionComplete) {
        if (event.key === 'Enter') navigate(COMPLETE_SCREEN_LINK_TO)
        return
      }
      if (!currentQuestion) return
      if (selectedIndex === null) {
        const index = CHOICE_LABELS.indexOf(event.key.toUpperCase())
        if (index !== -1 && index < currentQuestion.choices.length) {
          handleAnswer(index)
        }
      } else if (event.key === 'Enter') {
        advance()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isSessionComplete, currentQuestion, selectedIndex, advance, handleAnswer, navigate])

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50">
        <p className="text-sm text-neutral-500">読み込み中...</p>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-50 px-4">
        <p className="text-sm text-incorrect-600">
          問題の取得に失敗しました: {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    )
  }

  if (!questions || questions.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 px-4">
        <p className="text-sm text-neutral-600">このカテゴリにはまだ問題がありません。</p>
        <Link
          to="/grammar"
          className="text-sm text-neutral-500 underline transition-colors hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          カテゴリ一覧に戻る
        </Link>
      </div>
    )
  }

  if (currentIndex >= questions.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 px-4">
        <p className="text-lg font-semibold text-neutral-900">セッション完了</p>
        <p className="text-sm text-neutral-600">
          {questions.length}問中{correctCount}問正解しました。
        </p>
        <div className="flex gap-3">
          <Link
            to="/grammar"
            className="rounded bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            カテゴリ一覧に戻る
          </Link>
          <Link
            to="/"
            className="rounded border border-neutral-300 px-4 py-2 text-sm text-neutral-700 transition-colors hover:bg-neutral-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            ホームに戻る
          </Link>
        </div>
        <p className="font-mono text-xs text-neutral-400">Enter: カテゴリ一覧に戻る</p>
      </div>
    )
  }

  const isAnswered = selectedIndex !== null

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-50 px-4">
      <p className="text-sm text-neutral-500">
        {data!.category.nameJa} —{' '}
        <span className="font-mono tabular-nums text-accent-700">
          {currentIndex + 1} / {questions.length}
        </span>
        （{answeredCount}問中{correctCount}問正解）
      </p>

      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <p className="font-serif text-base text-neutral-900">{currentQuestion!.questionText}</p>

        <div className="mt-6 space-y-2">
          {currentQuestion!.choices.map((choice, index) => {
            const isCorrectChoice = index === currentQuestion!.correctIndex
            const isSelectedChoice = index === selectedIndex

            let stateClasses = 'border-neutral-300 hover:border-accent-300 hover:bg-neutral-50'
            if (isAnswered && isCorrectChoice) {
              stateClasses = 'border-correct-600 bg-correct-50 text-correct-900'
            } else if (isAnswered && isSelectedChoice && !isCorrectChoice) {
              stateClasses = 'border-incorrect-600 bg-incorrect-50 text-incorrect-900'
            }

            return (
              <button
                key={index}
                disabled={isAnswered}
                onClick={() => handleAnswer(index)}
                className={`flex w-full items-center gap-2 rounded border px-3 py-2 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:cursor-default ${stateClasses}`}
              >
                <span className="font-mono font-semibold text-neutral-400">{CHOICE_LABELS[index]}</span>{' '}
                <span>{choice}</span>
              </button>
            )
          })}
        </div>

        {isAnswered && (
          <div className="mt-4 space-y-3">
            {currentQuestion!.explanation && (
              <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                {currentQuestion!.explanation}
              </p>
            )}
            <AskTutorPanel
              questionText={currentQuestion!.questionText}
              choices={currentQuestion!.choices}
              correctAnswer={currentQuestion!.choices[currentQuestion!.correctIndex]}
              explanation={currentQuestion!.explanation ?? ''}
              onFocusChange={setIsAskingTutor}
            />
            <button
              onClick={advance}
              className="w-full rounded bg-accent-600 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
            >
              {currentIndex + 1 >= questions.length ? '結果を見る' : '次の問題へ'}
            </button>
          </div>
        )}
      </div>

      <p className="font-mono text-xs text-neutral-400">
        {isAskingTutor ? 'Enter: 質問を送信 / Shift+Enter: 改行 / Ctrl+Enter: 次へ' : '1〜4: 選択 / Enter: 次へ'}
      </p>
    </div>
  )
}
