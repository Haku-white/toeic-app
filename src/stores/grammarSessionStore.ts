import { create } from 'zustand'

/**
 * 文法ドリルセッションの「進行状態」のみを保持する（vocabSessionStoreと同じ方針:
 * 問題データ自体はReact Query側の`['grammar-drill', categoryCode]`が単一の情報源）。
 */
interface GrammarSessionState {
  currentIndex: number
  /** 現在の設問で選んだ選択肢のindex。nullはまだ未回答。 */
  selectedIndex: number | null
  correctCount: number
  answeredCount: number
  answer: (index: number, isCorrect: boolean) => void
  advance: () => void
  resetSession: () => void
}

export const useGrammarSessionStore = create<GrammarSessionState>((set) => ({
  currentIndex: 0,
  selectedIndex: null,
  correctCount: 0,
  answeredCount: 0,
  answer: (index, isCorrect) =>
    set((s) => ({ selectedIndex: index, correctCount: isCorrect ? s.correctCount + 1 : s.correctCount })),
  advance: () =>
    set((s) => ({
      currentIndex: s.currentIndex + 1,
      selectedIndex: null,
      answeredCount: s.answeredCount + 1,
    })),
  resetSession: () => set({ currentIndex: 0, selectedIndex: null, correctCount: 0, answeredCount: 0 }),
}))
