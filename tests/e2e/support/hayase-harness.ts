import type { ReleaseWorkspace } from "./artifacts.ts"
import { loadReleaseArtifact } from "./manifest-loader.ts"

const LOCAL_FETCH = globalThis.fetch

export type WorkerMethod = "test" | "single" | "batch" | "movie"

export type WorkerQuery = {
  readonly media: unknown
  readonly anilistId: number
  readonly titles: readonly string[]
  readonly episode: number
  readonly episodeCount?: number
  readonly resolution: "2160" | "1080" | "720" | "540" | "480" | ""
  readonly exclusions: readonly string[]
}

export type SanitizedTorrentResult = {
  readonly title: string
  readonly link: string
  readonly id?: number
  readonly seeders: number
  readonly leechers: number
  readonly downloads: number
  readonly accuracy: "high" | "medium" | "low"
  readonly hash: string
  readonly size: number
  readonly date: Date
  readonly type?: "batch" | "best" | "alt"
}

export class WorkerCompatibilityError extends Error {
  readonly name = "WorkerCompatibilityError"

  constructor(message: string) {
    super(message)
    this.stack = `${this.name}: ${message}`
  }
}

type WorkerResponse =
  | { readonly kind: "loaded" }
  | { readonly kind: "result"; readonly id: number; readonly value: unknown }
  | { readonly kind: "failure"; readonly id?: number; readonly message: string }
  | {
      readonly kind: "fetch"
      readonly id: number
      readonly url: string
      readonly method: string
      readonly headers: readonly (readonly [string, string])[]
    }

type PendingCall = {
  readonly resolve: (value: boolean | SanitizedTorrentResult[]) => void
  readonly reject: (error: Error) => void
}

export class HayaseWorkerHarness {
  private sequence = 0
  private readonly pending = new Map<number, PendingCall>()

  private constructor(
    private readonly worker: Worker,
    private readonly fixtureBaseUrl: URL,
    private readonly loaded: Promise<void>,
  ) {
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data)
  }

  static async create(
    workspace: ReleaseWorkspace,
    fixtureBaseUrl: URL,
  ): Promise<HayaseWorkerHarness> {
    const artifact = loadReleaseArtifact(workspace)
    const worker = new Worker(new URL("./hayase-worker-runtime.ts", import.meta.url), {
      type: "module",
    })
    let resolveLoaded: (() => void) | undefined
    let rejectLoaded: ((error: Error) => void) | undefined
    const loaded = new Promise<void>((resolve, reject) => {
      resolveLoaded = resolve
      rejectLoaded = reject
    })
    const harness = new HayaseWorkerHarness(worker, fixtureBaseUrl, loaded)
    harness.loadResolution = { resolve: resolveLoaded, reject: rejectLoaded }
    worker.postMessage({ kind: "load", artifact: artifact.buffer }, [artifact.buffer])
    try {
      await loaded
      return harness
    } catch (error) {
      worker.terminate()
      throw error
    }
  }

  private loadResolution:
    | {
        readonly resolve: (() => void) | undefined
        readonly reject: ((error: Error) => void) | undefined
      }
    | undefined

  call(method: WorkerMethod, query?: WorkerQuery): Promise<boolean | SanitizedTorrentResult[]> {
    const id = this.sequence
    this.sequence += 1
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker.postMessage({
        kind: "call",
        id,
        method,
        ...(query === undefined ? {} : { query }),
      })
    })
  }

  private receive(message: WorkerResponse): void {
    if (message.kind === "loaded") {
      this.loadResolution?.resolve?.()
      this.loadResolution = undefined
      return
    }
    if (message.kind === "fetch") {
      void this.bridgeFetch(message)
      return
    }
    if (message.kind === "failure" && message.id === undefined) {
      this.loadResolution?.reject?.(new WorkerCompatibilityError(message.message))
      this.loadResolution = undefined
      return
    }
    const id = message.id
    if (id === undefined) return
    const pending = this.pending.get(id)
    if (pending === undefined) return
    this.pending.delete(id)
    if (message.kind === "failure") {
      pending.reject(new WorkerCompatibilityError(message.message))
    } else if (typeof message.value === "boolean" || Array.isArray(message.value)) {
      pending.resolve(message.value)
    } else {
      pending.reject(new WorkerCompatibilityError("Worker returned an incompatible value"))
    }
  }

  private async bridgeFetch(
    message: Extract<WorkerResponse, { readonly kind: "fetch" }>,
  ): Promise<void> {
    const upstream = new URL(message.url)
    const target = new URL(
      `${upstream.pathname.replace(/^\/api\/v1\//, "")}${upstream.search}`,
      this.fixtureBaseUrl,
    )
    const headers = new Headers(message.headers.map(([name, value]) => [name, value]))
    const response = await LOCAL_FETCH(target, { headers, method: message.method })
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
  }

  async close(): Promise<void> {
    await this.loaded
    this.worker.terminate()
    for (const pending of this.pending.values()) {
      pending.reject(new WorkerCompatibilityError("Worker closed"))
    }
    this.pending.clear()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }
}
