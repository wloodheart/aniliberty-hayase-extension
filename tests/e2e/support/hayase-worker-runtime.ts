import { computeAccuracy, queryProxy, sanitizeResults } from "./hayase-sanitizer.ts"

type SourceMethod = "test" | "single" | "batch" | "movie"

type LoadMessage = { readonly kind: "load"; readonly artifact: ArrayBuffer }
type CallMessage = {
  readonly kind: "call"
  readonly id: number
  readonly method: SourceMethod
  readonly query?: object
}
type FetchResultMessage = {
  readonly kind: "fetch-result"
  readonly id: number
  readonly status: number
  readonly headers: readonly (readonly [string, string])[]
  readonly body: ArrayBuffer
}
type FetchFailureMessage = { readonly kind: "fetch-failure"; readonly id: number }
type IncomingMessage = LoadMessage | CallMessage | FetchResultMessage | FetchFailureMessage

type FetchRequestMessage = {
  readonly kind: "fetch"
  readonly id: number
  readonly url: string
  readonly method: string
  readonly headers: readonly (readonly [string, string])[]
}

let source: object | undefined
let fetchSequence = 0
type PendingFetch = {
  readonly resolve: (response: Response) => void
  readonly reject: (error: Error) => void
}

class WorkerFetchError extends Error {
  readonly name = "WorkerFetchError"

  constructor() {
    super("Worker fetch failed")
  }
}

const fetches = new Map<number, PendingFetch>()

function post(message: object, transfer?: Transferable[]): void {
  self.postMessage(message, transfer ?? [])
}

const bridgeFetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit) => {
    const id = fetchSequence
    fetchSequence += 1
    const request = new Request(input, init)
    return new Promise<Response>((resolve, reject) => {
      fetches.set(id, { resolve, reject })
      const message: FetchRequestMessage = {
        kind: "fetch",
        id,
        url: request.url,
        method: request.method,
        headers: Array.from(request.headers.entries()),
      }
      try {
        post(message)
      } catch {
        fetches.delete(id)
        reject(new WorkerFetchError())
      }
    })
  },
  { preconnect: () => undefined },
)

async function loadArtifact(artifact: ArrayBuffer): Promise<void> {
  const url = URL.createObjectURL(new Blob([artifact], { type: "application/javascript" }))
  try {
    const namespace: object = await import(url)
    const loaded = Reflect.get(namespace, "default")
    if (typeof loaded !== "object" || loaded === null) throw new TypeError("invalid default")
    source = loaded
  } finally {
    URL.revokeObjectURL(url)
  }
}

async function callSource(message: CallMessage): Promise<void> {
  const loaded = source
  if (loaded === undefined) throw new TypeError("worker not loaded")
  const callable = Reflect.get(loaded, message.method)
  if (typeof callable !== "function") throw new TypeError("method unavailable")
  if (message.method === "test") {
    post({ kind: "result", id: message.id, value: await Reflect.apply(callable, loaded, []) })
    return
  }
  const { proxy, accessed } = queryProxy({ ...message.query, fetch: bridgeFetch })
  const raw = await Reflect.apply(callable, loaded, [proxy])
  const sanitized = sanitizeResults(raw, computeAccuracy(accessed))
  post({ kind: "result", id: message.id, value: sanitized })
}

globalThis.fetch = bridgeFetch
self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const message = event.data
  if (message.kind === "fetch-result" || message.kind === "fetch-failure") {
    const pending = fetches.get(message.id)
    if (pending !== undefined) {
      fetches.delete(message.id)
      if (message.kind === "fetch-result") {
        pending.resolve(
          new Response(message.body, {
            headers: new Headers(message.headers.map(([name, value]) => [name, value])),
            status: message.status,
          }),
        )
      } else {
        pending.reject(new WorkerFetchError())
      }
    }
    return
  }
  const operation = message.kind === "load" ? loadArtifact(message.artifact) : callSource(message)
  operation.then(
    () => {
      if (message.kind === "load") post({ kind: "loaded" })
    },
    (error: unknown) => {
      const safe =
        error instanceof Error && error.name === "TorrentSourceUnavailableError"
          ? error.message
          : message.kind === "load"
            ? "Worker artifact import failed"
            : "Worker rejected invalid result"
      post({ kind: "failure", id: message.kind === "call" ? message.id : undefined, message: safe })
    },
  )
}
