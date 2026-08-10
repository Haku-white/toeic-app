import { create } from 'zustand'

/**
 * 語彙SRSレビューセッションの「進行状態」のみを保持する（9.1の方針: サーバー状態=React Query,
 * セッション進行のようなローカルUI状態=Zustand、と分離する）。カード自体のデータはReact Query側の
 * `['vocab-due', userId]` が単一の情報源であり、ここでは重複して持たない。
 */
interface VocabSessionState {
  currentIndex: number
  isRevealed: boolean
  reviewedCount: number
  reveal: () => void
  advance: () => void
  resetSession: () => void
}

export const useVocabSessionStore = create<VocabSessionState>((set) => ({
  currentIndex: 0,
  isRevealed: false,
  reviewedCount: 0,
  reveal: () => set({ isRevealed: true }),
  advance: () =>
    set((s) => ({ currentIndex: s.currentIndex + 1, isRevealed: false, reviewedCount: s.reviewedCount + 1 })),
  resetSession: () => set({ currentIndex: 0, isRevealed: false, reviewedCount: 0 }),
}))
