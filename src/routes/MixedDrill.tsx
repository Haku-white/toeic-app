import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLoaderData, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { useMutation, useQuery } from '@tanstack/react-query'
import { submitGrammarAttempt } from '../lib/queries/grammar'
import { submitVocabReview } from '../lib/queries/vocab'
import { getMixedDrillQuestions, mapMixedDrillAnswerToRating, type MixedQuestion } from '../lib/queries/mixedDrill'
import { useMixedDrillSessionStore } from '../stores/mixedDrillSessionStore'
import AskTutorPanel from '../components/AskTutorPanel'

const CHOICE_LABELS = ['1', '2', '3', '4']
const GRAMMAR_COUNT = 5
const VOCAB_COUNT = 5
const COMPLETE_SCREEN_LINK_TO = '/'

export default function MixedDrill() {
  const { session } = useLoaderData() as { session: Session }
  const userId = session.user.id
  const navigate = useNavigate()

  const { data: questions, isLoading, isError, error } = useQuery({
    queryKey: ['mixed-drill', userId],
    queryFn: () => getMixedDrillQuestions(userId, GRAMMAR_COUNT, VOCAB_COUNT),
  })

  const {
    currentIndex,
    selectedIndex,
    grammarCorrect,
    grammarTotal,
    vocabCorrect,
    vocabTotal,
    answer,
    advance,
    resetSession,
  } = useMixedDrillSessionStore()
  const questionStartRef = useRef<number>(Date.now())
  // AskTutorPanelのテキストエリアにフォーカスがある間は、Enterがショートカット「次へ」ではなく
  // 質問送信に使われる（26章）。下部のヒント表示をそれに合わせて切り替えるための状態。
  const [isAskingTutor, setIsAskingTutor] = useState(false)

  useEffect(() => {
    resetSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    questionStartRef.current = Date.now()
  }, [currentIndex])

  const grammarMutation = useMutation({ mutationFn: submitGrammarAttempt })
  const vocabMutation = useMutation({ mutationFn: submitVocabReview })

  const currentQuestion = questions?.[currentIndex]
  const isSessionComplete = !!questions && questions.length > 0 && currentIndex >= questions.length

  const handleAnswer = useCallback(
    (index: number, question: MixedQuestion) => {
      if (selectedIndex !== null) return
      const isCorrect = index === question.correctIndex
      const revealedAt = questionStartRef.current
      const responseTimeMs = revealedAt ? Date.now() - revealedAt : undefined

      answer(index, isCorrect, question.kind)

      if (question.kind === 'grammar') {
        grammarMutation.mutate({
          userId,
          questionId: question.grammarQuestionId!,
          selectedIndex: index,
          isCorrect,
          responseTimeMs,
        })
      } else {
        vocabMutation.mutate({
          userId,
          vocabWordId: question.vocabWordId!,
          currentProgress: question.vocabProgress ?? null,
          rating: mapMixedDrillAnswerToRating(isCorrect),
          responseTimeMs,
        })
      }
    },
    [selectedIndex, answer, grammarMutation, vocabMutation, userId],
  )

  // 1〜4キーで選択肢を選び、選択済みならEnterキーで次の問題へ進めるようにする
  // （マウス操作は変更せず併用可能。読み込み中/エラー時など問題が無い間は無視する）。
  // セッション完了画面ではcurrentQuestionがundefinedになる（配列範囲外）ため、
  // 個別に判定してEnterで「ホームに戻る」へ遷移できるようにする（25章参照）。
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
          handleAnswer(index, currentQuestion)
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
        <p className="text-sm text-neutral-600">出題できる問題がまだありません。</p>
        <Link
          to="/"
          className="text-sm text-neutral-500 underline transition-colors hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          ホームに戻る
        </Link>
      </div>
    )
  }

  if (currentIndex >= questions.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 px-4">
        <p className="text-lg font-semibold text-neutral-900">セッション完了</p>
        <div className="space-y-1 text-center text-sm text-neutral-600">
          <p>
            文法:{' '}
            <span className="font-mono tabular-nums">
              {grammarTotal}問中{grammarCorrect}問正解
            </span>
          </p>
          <p>
            語彙:{' '}
            <span className="font-mono tabular-nums">
              {vocabTotal}問中{vocabCorrect}問正解
            </span>
          </p>
        </div>
        <Link
          to="/"
          className="rounded bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          ホームに戻る
        </Link>
        <p className="font-mono text-xs text-neutral-400">Enter: ホームに戻る</p>
      </div>
    )
  }

  const isAnswered = selectedIndex !== null
  const question = currentQuestion!

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-50 px-4">
      <p className="text-sm text-neutral-500">
        <span className="font-mono tabular-nums text-accent-700">
          {currentIndex + 1} / {questions.length}
        </span>
        （文法{grammarCorrect}/{grammarTotal}・語彙{vocabCorrect}/{vocabTotal}）
      </p>

      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <span className="text-xs font-medium text-neutral-400">
          {question.kind === 'grammar' ? '文法' : '語彙'}
        </span>
        <p className="mt-1 font-serif text-base text-neutral-900">{question.questionText}</p>

        <div className="mt-6 space-y-2">
          {question.choices.map((choice, index) => {
            const isCorrectChoice = index === question.correctIndex
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
                onClick={() => handleAnswer(index, question)}
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
            {question.explanation && (
              <p className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
                {question.explanation}
              </p>
            )}
            {question.additionalExplanation && (
              <div className="rounded border border-incorrect-200 bg-incorrect-50 px-3 py-2">
                <p className="text-xs font-medium text-incorrect-700">よくある間違いのポイント</p>
                <p className="mt-1 text-sm text-neutral-700">{question.additionalExplanation}</p>
              </div>
            )}
            <AskTutorPanel
              questionText={question.questionText}
              choices={question.choices}
              correctAnswer={question.choices[question.correctIndex]}
              explanation={question.explanation ?? ''}
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
