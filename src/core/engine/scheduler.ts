interface SchedulerWithYield {
  yield: () => Promise<void>
}

function hasSchedulerYield(value: unknown): value is SchedulerWithYield {
  return (
    typeof value === 'object' &&
    value !== null &&
    'yield' in value &&
    typeof (value as { yield: unknown }).yield === 'function'
  )
}

/**
 * Give the main thread back: `scheduler.yield()` (Chrome 129+, Firefox 142+),
 * otherwise a MessageChannel task (Safari has neither `scheduler` nor
 * `requestIdleCallback`).
 */
export function yieldToMain(): Promise<void> {
  const scheduler: unknown = Reflect.get(globalThis, 'scheduler')
  if (hasSchedulerYield(scheduler)) return scheduler.yield()
  return new Promise(resolve => {
    const channel = new MessageChannel()
    channel.port1.onmessage = () => {
      channel.port1.close()
      resolve()
    }
    channel.port2.postMessage(null)
  })
}

/**
 * Work queue processed in time slices (≤ `budgetMs` per task). `drainSync`
 * processes as much as fits into a deadline synchronously, e.g. right before
 * a navigation commits.
 */
export class SlicedRun<T> {
  private position = 0
  private aborted = false
  /** Main-thread time spent processing items (excludes time yielded to the browser). */
  busyMs = 0

  constructor(
    private readonly items: readonly T[],
    private readonly process: (item: T) => void,
  ) {}

  get done(): boolean {
    return this.position >= this.items.length
  }

  abort(): void {
    this.aborted = true
  }

  /** Process items until `deadline` (performance.now()); returns true when all items are done. */
  drainSync(deadline: number): boolean {
    const started = performance.now()
    while (!this.done && !this.aborted) {
      const item = this.items[this.position++]
      if (item !== undefined) this.process(item)
      if ((this.position & 15) === 0 && performance.now() >= deadline) break
    }
    this.busyMs += performance.now() - started
    return this.done
  }

  /** Runs to completion in slices; resolves to false if aborted before finishing. */
  async run(budgetMs: number): Promise<boolean> {
    while (!this.done && !this.aborted) {
      this.drainSync(performance.now() + budgetMs)
      if (!this.done && !this.aborted) await yieldToMain()
    }
    return this.done
  }
}
