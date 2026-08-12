import { supabase } from '../supabase'

export interface GrammarCategory {
  id: number
  code: string
  nameJa: string
  sortOrder: number
}

export interface GrammarQuestion {
  id: string
  categoryId: number
  questionText: string
  choices: string[]
  correctIndex: number
  explanation: string | null
  /** 11章: 正答率が低い問題に自動生成される補足解説。既存のexplanationは上書きしない */
  additionalExplanation: string | null
  difficulty: number
}

export interface GrammarDrillData {
  category: GrammarCategory
  questions: GrammarQuestion[]
}

interface GrammarCategoryRow {
  id: number
  code: string
  name_ja: string
  sort_order: number
}

interface GrammarQuestionRow {
  id: string
  category_id: number
  question_text: string
  choices: string[]
  correct_index: number
  explanation: string | null
  additional_explanation: string | null
  difficulty: number
}

function categoryRowToCategory(row: GrammarCategoryRow): GrammarCategory {
  return { id: row.id, code: row.code, nameJa: row.name_ja, sortOrder: row.sort_order }
}

function questionRowToQuestion(row: GrammarQuestionRow): GrammarQuestion {
  return {
    id: row.id,
    categoryId: row.category_id,
    questionText: row.question_text,
    choices: row.choices,
    correctIndex: row.correct_index,
    explanation: row.explanation,
    additionalExplanation: row.additional_explanation,
    difficulty: row.difficulty,
  }
}

/** 4章の9カテゴリ一覧（9.4の方針: コンポーネントから直接supabase.from()を呼ばない） */
export async function getGrammarCategories(): Promise<GrammarCategory[]> {
  const { data, error } = await supabase
    .from('grammar_categories')
    .select('*')
    .order('sort_order', { ascending: true })
  if (error) throw error
  return (data as GrammarCategoryRow[]).map(categoryRowToCategory)
}

/** カテゴリ情報 + そのカテゴリの出題（ドリル画面用にまとめて取得） */
export async function getGrammarDrillData(categoryCode: string, limit = 10): Promise<GrammarDrillData> {
  const { data: categoryRow, error: categoryError } = await supabase
    .from('grammar_categories')
    .select('*')
    .eq('code', categoryCode)
    .single()
  if (categoryError) throw categoryError

  const category = categoryRowToCategory(categoryRow as GrammarCategoryRow)

  const { data: questionRows, error: questionsError } = await supabase
    .from('grammar_questions')
    .select('*')
    .eq('category_id', category.id)
    .limit(limit)
  if (questionsError) throw questionsError

  return {
    category,
    questions: (questionRows as GrammarQuestionRow[]).map(questionRowToQuestion),
  }
}

const RANDOM_SAMPLE_POOL_SIZE = 50

/** カテゴリを問わずランダムにN問取得する（14章の総合問題用）。母集団をまとめて取得しクライアント側でシャッフルする */
export async function getRandomGrammarQuestions(count: number): Promise<GrammarQuestion[]> {
  const { data, error } = await supabase.from('grammar_questions').select('*').limit(RANDOM_SAMPLE_POOL_SIZE)
  if (error) throw error

  const questions = (data as GrammarQuestionRow[]).map(questionRowToQuestion)
  return shuffleArray(questions).slice(0, count)
}

function shuffleArray<T>(items: T[]): T[] {
  const array = [...items]
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[array[i], array[j]] = [array[j], array[i]]
  }
  return array
}

export interface SubmitGrammarAttemptParams {
  userId: string
  questionId: string
  selectedIndex: number
  isCorrect: boolean
  responseTimeMs?: number
}

/** `user_grammar_attempts`にINSERTする（クライアントから直接書き込むのはこのテーブルのみ、7章のRLS方針どおり） */
export async function submitGrammarAttempt(params: SubmitGrammarAttemptParams): Promise<void> {
  const { userId, questionId, selectedIndex, isCorrect, responseTimeMs } = params
  const { error } = await supabase.from('user_grammar_attempts').insert({
    user_id: userId,
    question_id: questionId,
    selected_index: selectedIndex,
    is_correct: isCorrect,
    response_time_ms: responseTimeMs ?? null,
  })
  if (error) throw error
}
