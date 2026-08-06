const LOCAL_FETCH = globalThis.fetch

export type WorkerFetchRequest = {
  readonly kind: "fetch"
  readonly id: number
  readonly url: string
  readonly method: string
  readonly headers: readonly (readonly [string, string])[]
}

export class WorkerFetchBridge {
  private readonly controllers = new Map<number, AbortController>()

  constructor(
    private readonly worker: Worker,
    private readonly fixtureBaseUrl: URL,
    private readonly onTerminalFailure: () => void,
  ) {}

  handle(message: WorkerFetchRequest): void {
    void this.complete(message)
  }

  close(): void {
    for (const controller of this.controllers.values()) controller.abort()
    this.controllers.clear()
  }

  private async complete(message: WorkerFetchRequest): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(message.id, controller)
    try {
      const upstream = new URL(message.url)
      const target = new URL(
        `${upstream.pathname.replace(/^\/api\/v1\//, "")}${upstream.search}`,
        this.fixtureBaseUrl,
      )
      const headers = new Headers(message.headers.map(([name, value]) => [name, value]))
      const response = await LOCAL_FETCH(target, {
        headers,
        method: message.method,
        signal: controller.signal,
      })
      const body = await response.arrayBuffer()
      this.worker.postMessage(
        {
          kind: "fetch-result",
          id: message.id,
          status: response.status,
          headers: Array.from(response.headers.entries()),
          body,
        },
        [body],
      )
    } catch {
      try {
        this.worker.postMessage({ kind: "fetch-failure", id: message.id })
      } catch {
        this.onTerminalFailure()
      }
    } finally {
      this.controllers.delete(message.id)
    }
  }
}
