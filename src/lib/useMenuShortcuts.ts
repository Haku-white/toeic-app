import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

export const SHORTCUT_KEYS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')

/** 表示順にA,B,C...を割り当てる。startIndexで開始位置をずらせる(複数セクションを連番にする用途)。
 * 27件目以降(A-Zを使い切った分)はshortcutKey=nullとし、キー割り当て・バッジ表示ともに無しにする
 * (クリック/タップは常に使えるので、キーボード操作は補助的な位置づけ)。 */
export function assignShortcutKeys<T>(items: T[], startIndex = 0): (T & { shortcutKey: string | null })[] {
  return items.map((item, i) => ({
    ...item,
    shortcutKey: startIndex + i < SHORTCUT_KEYS.length ? SHORTCUT_KEYS[startIndex + i] : null,
  }))
}

interface ShortcutTarget {
  shortcutKey: string | null
  to: string
}

/** 割り当て済みキー押下でnavigate()する。修飾キー押下時・フォーム入力中(input/textarea/select)は無視する。 */
export function useMenuShortcuts(items: ShortcutTarget[]): void {
  const navigate = useNavigate()
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.ctrlKey || event.metaKey || event.altKey) return
      const target = event.target as HTMLElement | null
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      const match = items.find((item) => item.shortcutKey === event.key.toUpperCase())
      if (match) navigate(match.to)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [items, navigate])
}
