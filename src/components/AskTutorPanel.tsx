import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { useMutation } from '@tanstack/react-query'
import { askTutor, type AskTutorParams } from '../lib/queries/tutor'

type AskTutorPanelProps = Pick<AskTutorParams, 'questionText' | 'choices' | 'correctAnswer' | 'explanation'> & {
  /** テキストエリアのフォーカス状態を親に伝える。親画面はこれを使い、質問入力中は
   *  「Enterで次へ」等のグローバルショートカットのヒント表示を切り替える（26章）。 */
  onFocusChange?: (isFocused: boolean) => void
}

const OPEN_SHORTCUT_KEY = '?'

// 定型の質問文。選択式の設問（choicesあり）でのみ「他の選択肢ではなぜダメか」を加える。
const BASE_SNIPPETS = ['なぜこの答えが正しいのですか?', 'もっと詳しく教えてください']
const CHOICE_SNIPPET = '他の選択肢ではなぜダメなのですか?'

/** 22章: 解説の下に置く「もっと詳しく聞く」パネル。会話履歴は保持せず、1問につき都度質問→回答のみ。 */
export default function AskTutorPanel({
  questionText,
  choices,
  correctAnswer,
  explanation,
  onFocusChange,
}: AskTutorPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [userQuestion, setUserQuestion] = useState('')
  const mutation = useMutation({ mutationFn: askTutor })
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const snippets =
    choices && choices.length > 0 ? [BASE_SNIPPETS[0], CHOICE_SNIPPET, BASE_SNIPPETS[1]] : BASE_SNIPPETS

  function submitQuestion() {
    if (!userQuestion.trim() || mutation.isPending) return
    mutation.mutate({ questionText, choices, correctAnswer, explanation, userQuestion })
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault()
    submitQuestion()
  }

  function applySnippet(snippet: string) {
    setUserQuestion(snippet)
    textareaRef.current?.focus()
  }

  // パネルが閉じている間だけ、"?"キーでパネルを開けるようにする（マウス操作は変更せず併用可能）。
  // 開いた後はこのリスナーを外す——テキストエリア入力中に"?"を打つと文字として入力させたいため。
  useEffect(() => {
    if (isOpen) return
    function handleShortcut(event: globalThis.KeyboardEvent) {
      if (event.key === OPEN_SHORTCUT_KEY) {
        event.preventDefault()
        setIsOpen(true)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [isOpen])

  useEffect(() => {
    if (isOpen) textareaRef.current?.focus()
  }, [isOpen])

  // Enter(Shiftなし)は質問送信、Shift+Enterは改行（デフォルト動作のまま）とする。
  // このパネル内のキー入力は、親画面（GrammarDrill/MixedDrill/VocabReview）が
  // window全体で拾っている「1〜4で選択」「Enterで次へ」ショートカットへ伝播させない
  // （質問文に数字やEnterを含めても誤って回答選択・次へ進む・カード評価が起きないように、
  // このコンポーネントのルート要素のonKeyDownでstopPropagationする——25章参照）。
  // ただしCtrl+Enter(Mac互換でCmd+Enterも)だけは例外とし、質問を開いたまま
  // 親の「Enterで次へ」に委ねられるようにする（26章）。
  function handleTextareaKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submitQuestion()
    }
  }

  // Ctrl+Enter/Cmd+Enterのみ、ルート要素のstopPropagationを素通りさせる
  // （パネルを開いたまま次の問題に進めるための例外——26章）。
  function handleRootKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) return
    e.stopPropagation()
  }

  if (!isOpen) {
    return (
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        onKeyDown={(e) => e.stopPropagation()}
        className="flex items-center gap-1.5 text-xs font-medium text-neutral-500 underline transition-colors hover:text-accent-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
      >
        もっと詳しく聞く
        <span className="font-mono text-neutral-400">{OPEN_SHORTCUT_KEY}</span>
      </button>
    )
  }

  return (
    <div className="space-y-2" onKeyDown={handleRootKeyDown}>
      <div className="flex flex-wrap gap-1.5">
        {snippets.map((snippet) => (
          <button
            key={snippet}
            type="button"
            onClick={() => applySnippet(snippet)}
            disabled={mutation.isPending}
            className="rounded-full border border-neutral-300 px-2.5 py-1 text-xs text-neutral-600 transition-colors hover:border-accent-300 hover:bg-neutral-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
          >
            {snippet}
          </button>
        ))}
      </div>
      <form onSubmit={handleSubmit} className="space-y-2">
        <textarea
          ref={textareaRef}
          value={userQuestion}
          onChange={(e) => setUserQuestion(e.target.value)}
          onKeyDown={handleTextareaKeyDown}
          onFocus={() => onFocusChange?.(true)}
          onBlur={() => onFocusChange?.(false)}
          placeholder="この問題について質問する...（Enterで送信 / Shift+Enterで改行 / Ctrl+Enterで次へ）"
          rows={2}
          disabled={mutation.isPending}
          className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:border-accent-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:opacity-50"
        />
        <button
          type="submit"
          disabled={mutation.isPending || !userQuestion.trim()}
          className="rounded bg-accent-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-700 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
        >
          質問する
        </button>
      </form>

      {mutation.isPending && <p className="text-xs text-neutral-500">回答を生成中...</p>}

      {mutation.data?.status === 'ok' && (
        <p className="rounded border border-accent-200 bg-accent-50 px-3 py-2 text-sm text-neutral-800">
          {mutation.data.answer}
        </p>
      )}
      {mutation.data && mutation.data.status !== 'ok' && (
        <p className="text-xs text-incorrect-600">{mutation.data.message}</p>
      )}
    </div>
  )
}
