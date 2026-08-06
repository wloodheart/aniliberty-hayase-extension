type Accuracy = "high" | "medium" | "low"
type ResultType = "batch" | "best" | "alt"
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
type IncomingMessage = LoadMessage | CallMessage | FetchResultMessage

type FetchRequestMessage = {
  readonly kind: "fetch"
  readonly id: number
  readonly url: string
  readonly method: string
  readonly headers: readonly (readonly [string, string])[]
}

const ACCURACY_RANK = { high: 0, medium: 1, low: 2 } as const
const QUERY_RULES = {
  anilistId: { setTo: "medium", maxAllowed: "high" },
  episode: { setTo: "low", maxAllowed: "high" },
  episodeCount: { setTo: "low", maxAllowed: "high" },
  resolution: { setTo: "low", maxAllowed: "high" },
  exclusions: { setTo: "low", maxAllowed: "high" },
  titles: { setTo: "low", maxAllowed: "medium" },
  media: { setTo: "low", maxAllowed: "medium" },
} as const
const RESULT_TYPES = new Set<ResultType>(["batch", "best", "alt"])

let source: object | undefined
let fetchSequence = 0
const fetches = new Map<number, (response: Response) => void>()

function post(message: object, transfer?: Transferable[]): void {
  self.postMessage(message, transfer ?? [])
}

const bridgeFetch = Object.assign(
  (input: RequestInfo | URL, init?: RequestInit) => {
    const id = fetchSequence
    fetchSequence += 1
    const request = new Request(input, init)
    return new Promise<Response>((resolve) => {
      fetches.set(id, resolve)
      const message: FetchRequestMessage = {
        kind: "fetch",
        id,
        url: request.url,
        method: request.method,
        headers: Array.from(request.headers.entries()),
      }
      post(message)
    })
  },
  { preconnect: () => undefined },
)

function queryProxy(query: object): { readonly proxy: object; readonly accessed: Set<string> } {
  const accessed = new Set<string>()
  return {
    accessed,
    proxy: new Proxy(query, {
      get(target, property, receiver) {
        if (typeof property === "string") accessed.add(property)
        return Reflect.get(target, property, receiver)
      },
    }),
  }
}

function computeAccuracy(accessed: ReadonlySet<string>): Accuracy {
  let bestSetToRank = Number.POSITIVE_INFINITY
  let worstMaxAllowedRank = 0
  for (const key of accessed) {
    if (!(key in QUERY_RULES)) continue
    const rule = Reflect.get(QUERY_RULES, key)
    const setToRank = Reflect.get(ACCURACY_RANK, rule.setTo)
    const maxAllowedRank = Reflect.get(ACCURACY_RANK, rule.maxAllowed)
    bestSetToRank = Math.min(bestSetToRank, setToRank)
    worstMaxAllowedRank = Math.max(worstMaxAllowedRank, maxAllowedRank)
  }
  const rank = Math.max(
    bestSetToRank === Number.POSITIVE_INFINITY ? 0 : bestSetToRank,
    worstMaxAllowedRank,
  )
  return rank === 0 ? "high" : rank === 1 ? "medium" : "low"
}

function finiteCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0
}

function sanitizeResults(value: unknown, maximum: Accuracy): readonly object[] | null {
  if (!Array.isArray(value)) return null
  const results: object[] = []
  const maximumRank = ACCURACY_RANK[maximum]
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null
    const hash = Reflect.get(item, "hash")
    const link = Reflect.get(item, "link")
    if (
      typeof hash !== "string" ||
      !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(hash) ||
      typeof link !== "string" ||
      link.length === 0
    ) {
      return null
    }
    const accuracy = Reflect.get(item, "accuracy")
    const accuracyRank =
      typeof accuracy === "string" && accuracy in ACCURACY_RANK
        ? Reflect.get(ACCURACY_RANK, accuracy)
        : undefined
    const date = Reflect.get(item, "date")
    const id = Reflect.get(item, "id")
    const type = Reflect.get(item, "type")
    const size = Reflect.get(item, "size")
    results.push({
      hash: hash.toLowerCase(),
      accuracy: accuracyRank !== undefined && accuracyRank <= maximumRank ? accuracy : maximum,
      title: typeof Reflect.get(item, "title") === "string" ? Reflect.get(item, "title") : "",
      link,
      seeders: finiteCount(Reflect.get(item, "seeders")),
      leechers: finiteCount(Reflect.get(item, "leechers")),
      downloads: finiteCount(Reflect.get(item, "downloads")),
      size: typeof size === "number" && Number.isFinite(size) ? Math.max(0, size) : 0,
      date: date instanceof Date && !Number.isNaN(date.getTime()) ? date : new Date(0),
      ...(typeof id === "number" ? { id } : {}),
      ...(typeof type === "string" && RESULT_TYPES.has(type as ResultType) ? { type } : {}),
    })
  }
  return results
}

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
  if (sanitized === null) throw new TypeError("invalid torrent result")
  post({ kind: "result", id: message.id, value: sanitized })
}

globalThis.fetch = bridgeFetch
self.onmessage = (event: MessageEvent<IncomingMessage>) => {
  const message = event.data
  if (message.kind === "fetch-result") {
    const resolve = fetches.get(message.id)
    if (resolve !== undefined) {
      fetches.delete(message.id)
      resolve(
        new Response(message.body, {
          headers: new Headers(message.headers.map(([name, value]) => [name, value])),
          status: message.status,
        }),
      )
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
