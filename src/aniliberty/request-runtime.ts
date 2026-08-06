export const REQUEST_TIMEOUT_MILLISECONDS = 3000
export const HEALTH_BUDGET_MILLISECONDS = 3250
export const MAX_RETRY_DELAY_MILLISECONDS = 1000

export type RetrySleeper = (milliseconds: number, signal: AbortSignal | undefined) => Promise<void>
export type DeadlineScheduler = (abort: () => void, milliseconds: number) => () => void

export function parseRetryAfterMilliseconds(value: string | null, now: number): number {
  if (value === null || value.startsWith("-")) return 0

  if (/^\d+(?:\.\d+)?$/.test(value)) {
    const seconds = Number(value)
    if (!Number.isFinite(seconds)) return 0
    return Math.min(seconds * 1000, MAX_RETRY_DELAY_MILLISECONDS)
  }

  const date = Date.parse(value)
  if (Number.isNaN(date)) return 0
  return Math.min(Math.max(date - now, 0), MAX_RETRY_DELAY_MILLISECONDS)
}

export const scheduleDeadline: DeadlineScheduler = (abort, milliseconds) => {
  const timer = setTimeout(abort, milliseconds)
  return () => clearTimeout(timer)
}

export const sleep: RetrySleeper = (milliseconds, signal) => {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"))
  if (milliseconds === 0) return Promise.resolve()

  return new Promise<void>((resolve, reject) => {
    const complete = (): void => {
      signal?.removeEventListener("abort", cancel)
      resolve()
    }
    const cancel = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener("abort", cancel)
      reject(new DOMException("Aborted", "AbortError"))
    }
    const timer = setTimeout(complete, milliseconds)
    signal?.addEventListener("abort", cancel, { once: true })
  })
}
