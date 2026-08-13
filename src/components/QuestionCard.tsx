import AskTutorPanel from './AskTutorPanel'

/**
 * ドリル回答画面（GrammarDrill/MixedDrill）の設問カード（計器盤コンセプト、DESIGN.md 32章）。
 * 両画面でverbatimに重複していた設問・選択肢・状態分岐・解説/警告/AskTutorPanel/次へボタンの
 * ブロックをここに集約した。`GrammarQuestion`/`MixedQuestion`型は一切知らず、プリミティブのみを
 * 受け取る（MixedDrill固有の分岐はkindLabelプロパティで吸収し、内部でドリル種別分岐は行わない）。
 */

const CHOICE_LABELS = ['1', '2', '3', '4']

interface QuestionCardProps {
  panelLabel: string
  kindLabel?: string
  questionText: string
  choices: string[]
  correctIndex: number
  selectedIndex: number | null
  onSelect: (index: number) => void
  explanation: string | null
  additionalExplanation: string | null
  onAdvance: () => void
  isLastQuestion: boolean
  onAskTutorFocusChange: (isFocused: boolean) => void
}

export default function QuestionCard({
  panelLabel,
  kindLabel,
  questionText,
  choices,
  correctIndex,
  selectedIndex,
  onSelect,
  explanation,
  additionalExplanation,
  onAdvance,
  isLastQuestion,
  onAskTutorFocusChange,
}: QuestionCardProps) {
  const isAnswered = selectedIndex !== null

  return (
    <div className="relative w-full max-w-md overflow-hidden rounded-[18px] bg-neutral-50 px-6 pb-6 pt-7 shadow-[0_1px_3px_rgba(0,0,0,.08),0_12px_28px_-14px_rgba(0,0,0,.18)]">
      {/* パネル四隅のネジ(計器盤モチーフ) */}
      <span className="absolute left-3 top-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-300" />
      <span className="absolute right-3 top-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-300" />
      <span className="absolute bottom-3 left-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-300" />
      <span className="absolute bottom-3 right-3 z-10 h-1.5 w-1.5 rounded-full bg-neutral-300" />

      <div className="mb-4 flex items-center justify-between rounded-md bg-[repeating-linear-gradient(135deg,var(--color-accent-200)_0px,var(--color-accent-200)_2px,var(--color-accent-100)_2px,var(--color-accent-100)_4px)] px-3 py-1.5 shadow-[inset_0_1px_2px_rgba(0,0,0,.08)]">
        <span className="font-mono text-[9.5px] font-bold tracking-[0.14em] text-accent-700">{panelLabel}</span>
        <div className="flex gap-[3px]">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className="h-2.5 w-0.5 bg-accent-300" />
          ))}
        </div>
      </div>

      {kindLabel && (
        <span className="mb-2 inline-flex items-center rounded-full bg-accent-100 px-2 py-0.5 font-mono text-[10px] font-bold tracking-[0.08em] text-accent-700">
          {kindLabel}
        </span>
      )}
      <p className="font-serif text-base text-neutral-900">{questionText}</p>

      <div className="mt-5 space-y-2">
        {choices.map((choice, index) => {
          const isCorrectChoice = index === correctIndex
          const isSelectedChoice = index === selectedIndex

          let stateClasses = 'border-neutral-200 bg-white text-neutral-800 hover:-translate-y-px hover:border-accent-300 hover:shadow-md'
          if (isAnswered && isCorrectChoice) {
            stateClasses = 'border-correct-600 bg-correct-50 text-correct-900'
          } else if (isAnswered && isSelectedChoice && !isCorrectChoice) {
            stateClasses = 'border-incorrect-600 bg-incorrect-50 text-incorrect-900'
          } else if (isAnswered) {
            stateClasses = 'border-neutral-100 bg-neutral-50 text-neutral-400 shadow-none'
          }

          return (
            <button
              key={index}
              disabled={isAnswered}
              onClick={() => onSelect(index)}
              className={`flex w-full items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left text-sm shadow-sm transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500 disabled:cursor-default ${stateClasses}`}
            >
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-md border-b-2 border-neutral-300 bg-neutral-50 font-mono text-xs font-bold text-neutral-500">
                {CHOICE_LABELS[index]}
              </span>{' '}
              <span>{choice}</span>
            </button>
          )
        })}
      </div>

      {isAnswered && (
        <div className="mt-4 space-y-3">
          {explanation && (
            <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-2">
              <p className="font-mono text-[9px] font-bold tracking-[0.1em] text-neutral-400">解説</p>
              <p className="mt-1 text-sm text-neutral-700">{explanation}</p>
            </div>
          )}
          {additionalExplanation && (
            <div className="rounded-lg border border-incorrect-200 bg-incorrect-50 px-3 py-2">
              <p className="text-xs font-medium text-incorrect-700">よくある間違いのポイント</p>
              <p className="mt-1 text-sm text-neutral-700">{additionalExplanation}</p>
            </div>
          )}
          <AskTutorPanel
            questionText={questionText}
            choices={choices}
            correctAnswer={choices[correctIndex]}
            explanation={explanation ?? ''}
            onFocusChange={onAskTutorFocusChange}
          />
          <div className="rounded-xl bg-accent-100 p-1 shadow-[inset_0_2px_4px_rgba(0,0,0,.08),inset_0_-1px_0_#fff]">
            <button
              onClick={onAdvance}
              className="flex h-11 w-full items-center justify-center rounded-lg bg-gradient-to-b from-accent-700 to-accent-900 text-sm font-bold text-white transition-transform hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-500"
            >
              {isLastQuestion ? '結果を見る' : '次の問題へ'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export function QuestionProgressBar({
  current,
  total,
  caption,
}: {
  current: number
  total: number
  caption?: string
}) {
  const pct = total > 0 ? Math.round((current / total) * 100) : 0

  return (
    <div className="w-full max-w-md">
      <div className="flex items-center gap-3">
        <span className="flex-none rounded-md bg-neutral-900 px-2.5 py-1 shadow-[inset_0_1px_2px_rgba(0,0,0,.35)]">
          <span className="font-mono text-xs font-bold tabular-nums text-accent-200">
            {current} / {total}
          </span>
        </span>
        <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-neutral-200">
          <span className="block h-full rounded-full bg-accent-600" style={{ width: `${pct}%` }} />
        </span>
      </div>
      {caption && <p className="mt-1.5 text-xs text-neutral-500">{caption}</p>}
    </div>
  )
}
