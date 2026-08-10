import { useEffect, useRef } from 'react'
import { Link, useLoaderData, useParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { useMutation, useQuery } from '@tanstack/react-query'
import { getDueVocabCards, getVocabTagByCode, submitVocabReview } from '../lib/queries/vocab'
import { computeNextState, type FsrsRatingKey } from '../lib/fsrs'
import { useVocabSessionStore } from '../stores/vocabSessionStore'
import AskTutorPanel from '../components/AskTutorPanel'

const RATING_LABELS: Record<FsrsRatingKey, string> = {
  again: 'もう一度',
  hard: '難しい',
  good: '普通',
  easy: '簡単',
}
const RATING_ORDER: FsrsRatingKey[] = ['again', 'hard', 'good', 'easy']

function formatIntervalPreview(scheduledDays: number): string {
  if (scheduledDays < 1) {
    const hours = Math.max(1, Math.round(scheduledDays * 24))
    return `${hours}時間後`
  }
  return `${Math.round(scheduledDays)}日後`
}

export default function VocabReview() {
  const { session } = useLoaderData() as { session: Session }
  const { tagCode } = useParams<{ tagCode?: string }>()
  const userId = session.user.id
  // タグ絞り込みが無い場合は "/" へ、weak-pointsから来た場合(タグ指定あり)はそこへ戻す
  const backTo = tagCode ? '/weak-points' : '/'
  const backLabel = tagCode ? '弱点分析ダッシュボードに戻る' : 'ホームに戻る'

  const { data: cards, isLoading, isError, error } = useQuery({
    queryKey: ['vocab-due', userId, tagCode ?? null],
    queryFn: () => getDueVocabCards(userId, 20, tagCode),
  })
  // codeはURL用の英語スラッグ（16章）のため、日本語UIでの表示にはvocab_tags.nameを解決して使う。
  // 解決できるまで（読み込み中・該当タグ無し）はtagCodeをそのままフォールバック表示する。
  const { data: tag } = useQuery({
    queryKey: ['vocab-tag', tagCode ?? null],
    queryFn: () => getVocabTagByCode(tagCode!),
    enabled: !!tagCode,
  })
  const tagLabel = tag?.name ?? tagCode

  const { currentIndex, isRevealed, reviewedCount, reveal, advance, resetSession } = useVocabSessionStore()
  const revealedAtRef = useRef<number | null>(null)

  useEffect(() => {
    resetSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagCode])

  const mutation = useMutation({
    mutationFn: submitVocabReview,
    onSuccess: () => advance(),
  })

  const currentCard = cards?.[currentIndex]

  function handleReveal() {
    revealedAtRef.current = Date.now()
    reveal()
  }

  function handleRate(rating: FsrsRatingKey) {
    if (!currentCard) return
    const revealedAt = revealedAtRef.current
    const now = Date.now()
    const responseTimeMs = revealedAt ? now - revealedAt : undefined
    mutation.mutate({
      userId,
      vocabWordId: currentCard.vocabWordId,
      currentProgress: currentCard.progress,
      rating,
      responseTimeMs,
    })
  }

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
          カードの取得に失敗しました: {error instanceof Error ? error.message : String(error)}
        </p>
      </div>
    )
  }

  if (!cards || cards.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 px-4">
        <p className="text-sm text-neutral-600">
          {tagCode ? `「${tagLabel}」の対象カードはありません。` : '本日レビューする語彙カードはありません。'}
        </p>
        <Link
          to={backTo}
          className="text-sm text-neutral-500 underline transition-colors hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          {backLabel}
        </Link>
      </div>
    )
  }

  if (currentIndex >= cards.length) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-neutral-50 px-4">
        <p className="text-lg font-semibold text-neutral-900">セッション完了</p>
        <p className="text-sm text-neutral-600">{reviewedCount}件のカードをレビューしました。</p>
        <Link
          to={backTo}
          className="rounded bg-accent-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          {backLabel}
        </Link>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-neutral-50 px-4">
      {tagCode && <p className="text-xs text-neutral-400">タグ: {tagLabel}</p>}
      <p className="font-mono text-sm tabular-nums text-accent-700">
        {currentIndex + 1} / {cards.length}
      </p>

      <div className="w-full max-w-md rounded-lg border border-neutral-200 bg-white p-8 shadow-sm">
        <div className="flex items-baseline gap-2">
          <h1 className="font-serif text-2xl font-semibold text-neutral-900">{currentCard!.word}</h1>
          {currentCard!.partOfSpeech && (
            <span className="text-xs text-neutral-400">{currentCard!.partOfSpeech}</span>
          )}
        </div>

        {!isRevealed ? (
          <button
            onClick={handleReveal}
            className="mt-6 w-full rounded bg-accent-600 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            答えを見る
          </button>
        ) : (
          <div className="mt-4 space-y-3">
            <p className="text-lg text-neutral-800">{currentCard!.meaningJa}</p>
            <p className="font-serif text-sm text-neutral-600">{currentCard!.exampleSentenceEn}</p>
            {currentCard!.exampleSentenceJa && (
              <p className="text-sm text-neutral-400">{currentCard!.exampleSentenceJa}</p>
            )}
            {currentCard!.etymologyNote && (
              <div className="rounded border border-neutral-200 bg-neutral-50 px-3 py-2">
                <p className="text-xs font-medium text-neutral-500">語源のヒント</p>
                <p className="mt-1 text-sm text-neutral-700">{currentCard!.etymologyNote}</p>
              </div>
            )}

            <AskTutorPanel
              questionText={`${currentCard!.word}: ${currentCard!.exampleSentenceEn}`}
              correctAnswer={currentCard!.meaningJa}
              explanation={currentCard!.etymologyNote ?? ''}
            />

            <div className="grid grid-cols-4 gap-2 pt-4">
              {RATING_ORDER.map((rating) => {
                const preview = computeNextState(currentCard!.progress, rating)
                return (
                  <button
                    key={rating}
                    disabled={mutation.isPending}
                    onClick={() => handleRate(rating)}
                    className="flex flex-col items-center gap-1 rounded border border-neutral-300 py-2 text-xs font-medium text-neutral-700 transition-colors hover:border-accent-300 hover:bg-neutral-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:opacity-50"
                  >
                    <span>{RATING_LABELS[rating]}</span>
                    <span className="font-mono text-[10px] tabular-nums text-neutral-400">
                      {formatIntervalPreview(preview.progress.scheduledDays)}
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
