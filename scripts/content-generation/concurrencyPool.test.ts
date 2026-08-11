import { describe, expect, it, vi } from 'vitest'
import { createThrottledPool } from './concurrencyPool'

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

describe('createThrottledPool (10.8: 同時実行数制限とスロットリング)', () => {
  it('limits concurrent task execution to the configured concurrency, releasing the next task on completion', async () => {
    const pool = createThrottledPool({ concurrency: 2, minIntervalMs: 0, sleep: async () => {} })
    let active = 0
    let maxActive = 0
    const releasers: Array<() => void> = []

    const tasks = Array.from({ length: 4 }, () =>
      pool.run(
        () =>
          new Promise<void>((resolve) => {
            active += 1
            maxActive = Math.max(maxActive, active)
            releasers.push(() => {
              active -= 1
              resolve()
            })
          }),
      ),
    )

    await flush()
    expect(maxActive).toBe(2)
    expect(releasers.length).toBe(2) // concurrency=2なので残り2件はキュー待ち

    releasers[0]()
    await flush()
    expect(releasers.length).toBe(3) // 1件終わったので3件目が始まる

    releasers[1]()
    releasers[2]()
    await flush()
    expect(releasers.length).toBe(4)
    releasers[3]()

    await Promise.all(tasks)
    expect(maxActive).toBe(2) // 最後まで2を超えなかった
  })

  it('sleeps for the remaining gap when a dispatch would happen sooner than minIntervalMs after the previous one', async () => {
    const nowFn = vi.fn(() => 1000)
    const sleepFn = vi.fn(async () => {})
    const pool = createThrottledPool({ concurrency: 1, minIntervalMs: 500, now: nowFn, sleep: sleepFn })

    await pool.run(async () => {})
    await pool.run(async () => {})

    // 1回目: lastDispatchAtの初期値は-Infinityなのでwait=0、sleepは呼ばれない
    // 2回目: lastDispatchAt=1000(1回目のnow())なので wait = 1000+500-1000 = 500
    expect(sleepFn).toHaveBeenCalledTimes(1)
    expect(sleepFn).toHaveBeenCalledWith(500)
  })

  it('does not sleep when enough time has already passed since the previous dispatch', async () => {
    let currentTime = 1000
    const nowFn = vi.fn(() => currentTime)
    const sleepFn = vi.fn(async () => {})
    const pool = createThrottledPool({ concurrency: 1, minIntervalMs: 500, now: nowFn, sleep: sleepFn })

    await pool.run(async () => {})
    currentTime = 2000 // 十分な時間が経過した
    await pool.run(async () => {})

    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('propagates a task error and still releases the slot for the next queued task', async () => {
    const pool = createThrottledPool({ concurrency: 1, minIntervalMs: 0, sleep: async () => {} })

    await expect(
      pool.run(async () => {
        throw new Error('boom')
      }),
    ).rejects.toThrow('boom')

    // スロットが正しく解放されていれば、次のタスクは即座に実行できる
    const result = await pool.run(async () => 'ok')
    expect(result).toBe('ok')
  })
})
