export interface ThrottledPoolOptions {
  /** 同時実行数の上限（10.8） */
  concurrency: number
  /** ディスパッチ開始時刻どうしの最小間隔（ミリ秒、10.8） */
  minIntervalMs: number
  /** テスト用の差し替え。省略時は`Date.now`/実際の`setTimeout`を使う。 */
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface ThrottledPool {
  run<T>(task: () => Promise<T>): Promise<T>
}

/**
 * 10.8: 同時実行数の上限とディスパッチ間隔の下限を両方守る簡易プール。
 * 外部ライブラリ（p-limit等）を追加せず自前実装する（cliArgs.tsと同じ「この規模なら自前で十分」方針）。
 * `run()`に渡したタスクは、空きスロットが出るまでキューで待機し、空いたら前回のディスパッチ時刻から
 * `minIntervalMs`経過するまで待ってから実行される。
 */
export function createThrottledPool(options: ThrottledPoolOptions): ThrottledPool {
  const { concurrency, minIntervalMs } = options
  const now = options.now ?? (() => Date.now())
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))

  let active = 0
  let lastDispatchAt = -Infinity
  const queue: Array<() => void> = []

  async function acquire(): Promise<void> {
    if (active >= concurrency) {
      await new Promise<void>((resolve) => queue.push(resolve))
    }
    active += 1
    const wait = Math.max(0, lastDispatchAt + minIntervalMs - now())
    if (wait > 0) await sleep(wait)
    lastDispatchAt = now()
  }

  function release(): void {
    active -= 1
    const next = queue.shift()
    if (next) next()
  }

  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      await acquire()
      try {
        return await task()
      } finally {
        release()
      }
    },
  }
}
