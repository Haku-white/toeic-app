import { create } from 'zustand'

/**
 * 総合問題（14章）セッションの「進行状態」のみを保持する（他のセッションストアと同じ方針）。
 * 文法・語彙それぞれの正答率をセッション終了後に別々に表示する（14.3）ため、
 * kind別にcorrect/totalを分けて集計する。
 */
interface MixedDrillSessionState {
  currentIndex: number
  /** 現在の設問で選んだ選択肢のindex。nullはまだ未回答。 */
  selectedIndex: number | null
  grammarCorrect: number
  grammarTotal: number
  vocabCorrect: number
  vocabTotal: number
  answer: (index: number, isCorrect: boolean, kind: 'grammar' | 'vocab') => void
  advance: () => void
  resetSession: () => void
}

export const useMixedDrillSessionStore = create<MixedDrillSessionState>((set) => ({
  currentIndex: 0,
  selectedIndex: null,
  grammarCorrect: 0,
  grammarTotal: 0,
  vocabCorrect: 0,
  vocabTotal: 0,
  answer: (index, isCorrect, kind) =>
    set((s) => ({
      selectedIndex: index,
      grammarCorrect: kind === 'grammar' && isCorrect ? s.grammarCorrect + 1 : s.grammarCorrect,
      grammarTotal: kind === 'grammar' ? s.grammarTotal + 1 : s.grammarTotal,
      vocabCorrect: kind === 'vocab' && isCorrect ? s.vocabCorrect + 1 : s.vocabCorrect,
      vocabTotal: kind === 'vocab' ? s.vocabTotal + 1 : s.vocabTotal,
    })),
  advance: () => set((s) => ({ currentIndex: s.currentIndex + 1, selectedIndex: null })),
  resetSession: () =>
    set({ currentIndex: 0, selectedIndex: null, grammarCorrect: 0, grammarTotal: 0, vocabCorrect: 0, vocabTotal: 0 }),
}))
