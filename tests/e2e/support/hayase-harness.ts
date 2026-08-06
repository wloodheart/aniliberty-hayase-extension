import type { ReleaseWorkspace } from "./artifacts.ts"
import { loadReleaseArtifact } from "./manifest-loader.ts"
import { WorkerFetchBridge, type WorkerFetchRequest } from "./worker-fetch-bridge.ts"

export type WorkerMethod = "test" | "single" | "batch" | "movie"

export type WorkerQuery = {
  readonly media: unknown
  readonly anilistId: number
  readonly anidbAid?: number
  readonly anidbEid?: number
  readonly tvdbId?: number
  readonly tvdbEId?: number
  readonly imdbId?: string
  readonly tmdbId?: string
  readonly titles: readonly string[]
  readonly episode: number
  readonly episodeCount?: number
  readonly absoluteEpisodeNumber?: number
  readonly resolution: "2160" | "1080" | "720" | "540" | "480" | ""
  readonly exclusions: readonly string[]
}

export type SanitizedTorrentResult = {
  readonly title: string
  readonly link: string
  readonly id: number | undefined
  readonly seeders: number
  readonly leechers: number
  readonly downloads: number
  readonly accuracy: "high" | "medium" | "low"
  readonly hash: string
  readonly size: number
  readonly date: Date
  readonly type: "batch" | "best" | "alt" | undefined
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
  | WorkerFetchRequest

type PendingCall = {
  readonly resolve: (value: boolean | SanitizedTorrentResult[]) => void
  readonly reject: (error: Error) => void
}

export class HayaseWorkerHarness {
  private sequence = 0
  private readonly pending = new Map<number, PendingCall>()
  private readonly fetchBridge: WorkerFetchBridge
  private state: "loading" | "ready" | "closed" = "loading"

  private constructor(
    private readonly worker: Worker,
    fixtureBaseUrl: URL,
    private readonly loaded: Promise<void>,
  ) {
    this.fetchBridge = new WorkerFetchBridge(worker, fixtureBaseUrl, () =>
      this.fail("Worker stopped unexpectedly"),
    )
    worker.onmessage = (event: MessageEvent<WorkerResponse>) => this.receive(event.data)
    worker.addEventListener("error", (event) => {
      event.preventDefault()
      this.fail("Worker stopped unexpectedly")
    })
    worker.addEventListener("messageerror", () => this.fail("Worker stopped unexpectedly"))
    worker.addEventListener("close", () => this.fail("Worker stopped unexpectedly"))
  }

  static async create(
    workspace: ReleaseWorkspace,
    fixtureBaseUrl: URL,
  ): Promise<HayaseWorkerHarness> {
    const harness = HayaseWorkerHarness.start(workspace, fixtureBaseUrl)
    try {
      await harness.loaded
      return harness
    } catch (error) {
      await harness.close()
      throw error
    }
  }

  static start(workspace: ReleaseWorkspace, fixtureBaseUrl: URL): HayaseWorkerHarness {
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
    try {
      worker.postMessage({ kind: "load", artifact: artifact.buffer }, [artifact.buffer])
    } catch {
      harness.fail("Worker artifact import failed")
    }
    return harness
  }

  private loadResolution:
    | {
        readonly resolve: (() => void) | undefined
        readonly reject: ((error: Error) => void) | undefined
      }
    | undefined

  call(method: WorkerMethod, query?: WorkerQuery): Promise<boolean | SanitizedTorrentResult[]> {
    if (this.state === "closed") {
      return Promise.reject(new WorkerCompatibilityError("Worker closed"))
    }
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

  ready(): Promise<void> {
    return this.loaded
  }

  private receive(message: WorkerResponse): void {
    if (message.kind === "loaded") {
      this.state = "ready"
      this.loadResolution?.resolve?.()
      this.loadResolution = undefined
      return
    }
    if (message.kind === "fetch") {
      this.fetchBridge.handle(message)
      return
    }
    if (message.kind === "failure" && message.id === undefined) {
      this.fail(message.message)
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

  private fail(message: string): void {
    if (this.state === "closed") return
    this.state = "closed"
    const error = new WorkerCompatibilityError(message)
    this.loadResolution?.reject?.(error)
    this.loadResolution = undefined
    for (const pending of this.pending.values()) pending.reject(error)
    this.pending.clear()
    this.fetchBridge.close()
    this.worker.terminate()
  }

  close(): Promise<void> {
    this.fail("Worker closed")
    return Promise.resolve()
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.close()
  }
}
