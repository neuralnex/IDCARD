export class PoolOverloadedError extends Error {
  readonly statusCode = 503

  constructor(message = 'PDF service is busy. Please retry shortly.') {
    super(message)
    this.name = 'PoolOverloadedError'
  }
}

export class ConcurrencyPool {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(
    readonly concurrency: number,
    readonly maxQueue: number,
  ) {
    if (!Number.isInteger(concurrency) || concurrency < 1) throw new Error('Pool concurrency must be a positive integer')
    if (!Number.isInteger(maxQueue) || maxQueue < 0) throw new Error('Pool queue limit must be a non-negative integer')
  }

  get activeCount(): number { return this.active }
  get queuedCount(): number { return this.waiters.length }

  run<T>(operation: () => Promise<T> | T): Promise<T> {
    if (this.active < this.concurrency) return this.execute(operation)
    if (this.waiters.length >= this.maxQueue) return Promise.reject(new PoolOverloadedError())

    return new Promise<T>((resolve, reject) => {
      this.waiters.push(() => {
        this.execute(operation).then(resolve, reject)
      })
    })
  }

  private async execute<T>(operation: () => Promise<T> | T): Promise<T> {
    this.active += 1
    try {
      return await operation()
    } finally {
      this.active -= 1
      this.waiters.shift()?.()
    }
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback
}

export const pdfRenderPool = new ConcurrencyPool(
  positiveInteger(process.env.PDF_RENDER_CONCURRENCY, 2),
  nonNegativeInteger(process.env.PDF_RENDER_QUEUE_LIMIT, 30),
)
