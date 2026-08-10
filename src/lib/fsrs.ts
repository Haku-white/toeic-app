import { Rating, State, createEmptyCard, fsrs, generatorParameters, type Card, type Grade } from 'ts-fsrs'

/** DB `fsrs_state` enum values (6.3) */
export type FsrsStateKey = 'new' | 'learning' | 'review' | 'relearning'
/** DB `fsrs_rating` enum values (6.3) — Manual is intentionally excluded */
export type FsrsRatingKey = 'again' | 'hard' | 'good' | 'easy'

const STATE_BY_KEY: Record<FsrsStateKey, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning,
}
const STATE_KEYS: FsrsStateKey[] = ['new', 'learning', 'review', 'relearning']

const RATING_BY_KEY: Record<FsrsRatingKey, Grade> = {
  again: Rating.Again,
  hard: Rating.Hard,
  good: Rating.Good,
  easy: Rating.Easy,
}
const RATING_KEYS: FsrsRatingKey[] = ['again', 'hard', 'good', 'easy']

function stateToKey(state: State): FsrsStateKey {
  return STATE_KEYS[state]
}

function ratingToKey(rating: Rating): FsrsRatingKey {
  // rating is never Manual (0) here since we only ever pass Again/Hard/Good/Easy in
  return RATING_KEYS[rating - 1]
}

/** 3章で決定した目標保持率。SM-2からの移行時にデフォルト(0.9)より高めに設定。 */
export const DESIRED_RETENTION = 0.92

const scheduler = fsrs(generatorParameters({ request_retention: DESIRED_RETENTION, enable_fuzz: true }))

/** `user_vocab_progress` の1行に対応する形（10.2/6.3のカラム名に合わせている） */
export interface VocabProgressState {
  state: FsrsStateKey
  dueAt: string
  stability: number
  difficulty: number
  elapsedDays: number
  scheduledDays: number
  reps: number
  lapses: number
  lastReviewAt: string | null
}

/** `vocab_review_logs` にINSERTする1行分の内容 */
export interface VocabReviewLogEntry {
  rating: FsrsRatingKey
  state: FsrsStateKey
  dueAt: string
  stability: number
  difficulty: number
  elapsedDays: number
  lastElapsedDays: number
  scheduledDays: number
}

export interface ComputeNextStateResult {
  progress: VocabProgressState
  reviewLog: VocabReviewLogEntry
}

function toFsrsCard(progress: VocabProgressState | null, now: Date): Card {
  if (!progress) return createEmptyCard(now)
  return {
    due: new Date(progress.dueAt),
    stability: progress.stability,
    difficulty: progress.difficulty,
    elapsed_days: progress.elapsedDays,
    scheduled_days: progress.scheduledDays,
    reps: progress.reps,
    lapses: progress.lapses,
    state: STATE_BY_KEY[progress.state],
    last_review: progress.lastReviewAt ? new Date(progress.lastReviewAt) : undefined,
  }
}

/**
 * 現在のSRS状態と評価(Again/Hard/Good/Easy)から次回の状態を計算する純粋関数。
 * 副作用（DB書き込み等）は一切持たない — 9.5の設計どおり単体テスト可能にするため。
 */
export function computeNextState(
  currentProgress: VocabProgressState | null,
  rating: FsrsRatingKey,
  now: Date = new Date(),
): ComputeNextStateResult {
  const card = toFsrsCard(currentProgress, now)
  const { card: nextCard, log } = scheduler.next(card, now, RATING_BY_KEY[rating])

  return {
    progress: {
      state: stateToKey(nextCard.state),
      dueAt: nextCard.due.toISOString(),
      stability: nextCard.stability,
      difficulty: nextCard.difficulty,
      elapsedDays: nextCard.elapsed_days,
      scheduledDays: nextCard.scheduled_days,
      reps: nextCard.reps,
      lapses: nextCard.lapses,
      lastReviewAt: (nextCard.last_review ?? now).toISOString(),
    },
    reviewLog: {
      rating: ratingToKey(log.rating),
      state: stateToKey(log.state),
      dueAt: log.due.toISOString(),
      stability: log.stability,
      difficulty: log.difficulty,
      elapsedDays: log.elapsed_days,
      lastElapsedDays: log.last_elapsed_days,
      scheduledDays: log.scheduled_days,
    },
  }
}
