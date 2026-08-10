import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { assignShortcutKeys, SHORTCUT_KEYS, useMenuShortcuts } from './useMenuShortcuts'

interface HarnessItem {
  shortcutKey: string | null
  to: string
}

function TestHarness({ items }: { items: HarnessItem[] }) {
  useMenuShortcuts(items)
  return (
    <div>
      <p>home screen</p>
      <input type="text" placeholder="search" />
    </div>
  )
}

function renderHarness(items: HarnessItem[]) {
  const router = createMemoryRouter(
    [
      { path: '/', element: <TestHarness items={items} /> },
      { path: '/a', element: <div>page A</div> },
      { path: '/b', element: <div>page B</div> },
    ],
    { initialEntries: ['/'] },
  )
  return render(<RouterProvider router={router} />)
}

describe('assignShortcutKeys', () => {
  it('assigns A, B, C... in display order by default', () => {
    const result = assignShortcutKeys([{ to: '/a' }, { to: '/b' }, { to: '/c' }])
    expect(result.map((r) => r.shortcutKey)).toEqual(['A', 'B', 'C'])
    // 元の項目のプロパティ(to)はそのまま保持される
    expect(result[0].to).toBe('/a')
  })

  it('offsets the assigned keys by startIndex (for chaining multiple sections into one sequence)', () => {
    const result = assignShortcutKeys([{ to: '/a' }, { to: '/b' }], 2)
    expect(result.map((r) => r.shortcutKey)).toEqual(['C', 'D'])
  })

  it('assigns shortcutKey: null once the 26 available letters are exhausted', () => {
    const items = Array.from({ length: 28 }, (_, i) => ({ to: `/item-${i}` }))
    const result = assignShortcutKeys(items)
    expect(result[25].shortcutKey).toBe('Z')
    expect(result[26].shortcutKey).toBeNull()
    expect(result[27].shortcutKey).toBeNull()
  })

  it('SHORTCUT_KEYS is the 26 letters A-Z in order', () => {
    expect(SHORTCUT_KEYS).toHaveLength(26)
    expect(SHORTCUT_KEYS[0]).toBe('A')
    expect(SHORTCUT_KEYS[25]).toBe('Z')
  })
})

describe('useMenuShortcuts', () => {
  it('navigates to the item whose shortcutKey matches the pressed key (case-insensitive)', async () => {
    renderHarness([
      { shortcutKey: 'A', to: '/a' },
      { shortcutKey: 'B', to: '/b' },
    ])
    expect(await screen.findByText('home screen')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'b' })

    expect(await screen.findByText('page B')).toBeInTheDocument()
  })

  it('does not navigate when a modifier key (Ctrl/Meta/Alt) is held', async () => {
    renderHarness([{ shortcutKey: 'A', to: '/a' }])
    expect(await screen.findByText('home screen')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'a', ctrlKey: true })
    fireEvent.keyDown(window, { key: 'a', metaKey: true })
    fireEvent.keyDown(window, { key: 'a', altKey: true })

    expect(screen.getByText('home screen')).toBeInTheDocument()
  })

  it('does not navigate while an input element is focused', async () => {
    renderHarness([{ shortcutKey: 'A', to: '/a' }])
    const input = await screen.findByPlaceholderText('search')

    fireEvent.keyDown(input, { key: 'a' })

    expect(screen.getByText('home screen')).toBeInTheDocument()
  })

  it('does nothing when the pressed key has no assigned item (e.g. null shortcutKey)', async () => {
    renderHarness([{ shortcutKey: null, to: '/a' }])
    expect(await screen.findByText('home screen')).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'a' })

    expect(screen.getByText('home screen')).toBeInTheDocument()
  })
})
