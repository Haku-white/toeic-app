import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useLoaderData, useNavigate } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { useMutation, useQuery } from '@tanstack/react-query'
import { submitGrammarAttempt } from '../lib/queries/grammar'
import { submitVocabReview } from '../lib/queries/vocab'
import { getMixedDrillQuestions, mapMixedDrillAnswerToRating, type MixedQuestion } from '../lib/queries/mixedDrill'
import { useMixedDrillSessionStore } from '../stores/mixedDrillSessionStore'
import SessionSummary, { SessionSummaryAction } from '../components/SessionSummary'
import QuestionCard, { QuestionProgressBar } from '../components/QuestionCard'

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
  // セッション開始時刻（28章: 結果サマリーの「かかった時間」表示用）。GrammarDrillと同じ方式。
  const sessionStartRef = useRef<number>(Date.now())
  const [elapsedMs, setElapsedMs] = useState<number | null>(null)
  // AskTutorPanelのテキストエリアにフォーカスがある間は、Enterがショートカット「次へ」ではなく
  // 質問送信に使われる（26章）。下部のヒント表示をそれに合わせて切り替えるための状態。
  const [isAskingTutor, setIsAskingTutor] = useState(false)

  useEffect(() => {
    resetSession()
    sessionStartRef.current = Date.now()
    // マウント時の初期化(elapsedMsは既にnullが初期値だが、意図を明示するため明示的に設定する)。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setElapsedMs(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    questionStartRef.current = Date.now()
  }, [currentIndex])

  const grammarMutation = useMutation({ mutationFn: submitGrammarAttempt })
  const vocabMutation = useMutation({ mutationFn: submitVocabReview })

  const currentQuestion = questions?.[currentIndex]
  const isSessionComplete = !!questions && questions.length > 0 && currentIndex >= questions.length

  useEffect(() => {
    if (isSessionComplete && elapsedMs === null) {
      setElapsedMs(Date.now() - sessionStartRef.current)
    }
  }, [isSessionComplete, elapsedMs])

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
        <SessionSummary
          correctCount={grammarCorrect + vocabCorrect}
          totalCount={grammarTotal + vocabTotal}
          elapsedMs={elapsedMs}
          categories={[
            { label: '文法', correct: grammarCorrect, total: grammarTotal },
            { label: '語彙', correct: vocabCorrect, total: vocabTotal },
          ]}
          actions={
            <SessionSummaryAction to="/" variant="primary">
              ホームに戻る
            </SessionSummaryAction>
          }
        />
        <p className="font-mono text-xs text-neutral-400">Enter: ホームに戻る</p>
      </div>
    )
  }

  const question = currentQuestion!

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-50 px-4">
      <QuestionProgressBar
        current={currentIndex + 1}
        total={questions.length}
        caption={`文法${grammarCorrect}/${grammarTotal}・語彙${vocabCorrect}/${vocabTotal}`}
      />

      <QuestionCard
        panelLabel="MIXED DRILL"
        kindLabel={question.kind === 'grammar' ? '文法' : '語彙'}
        questionText={question.questionText}
        choices={question.choices}
        correctIndex={question.correctIndex}
        selectedIndex={selectedIndex}
        onSelect={(index) => handleAnswer(index, question)}
        explanation={question.explanation}
        additionalExplanation={question.additionalExplanation}
        onAdvance={advance}
        isLastQuestion={currentIndex + 1 >= questions.length}
        onAskTutorFocusChange={setIsAskingTutor}
      />

      <p className="font-mono text-xs text-neutral-400">
        {isAskingTutor ? 'Enter: 質問を送信 / Shift+Enter: 改行 / Ctrl+Enter: 次へ' : '1〜4: 選択 / Enter: 次へ'}
      </p>
    </div>
  )
}
