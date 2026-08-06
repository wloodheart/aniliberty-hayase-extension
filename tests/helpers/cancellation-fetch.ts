import type { AniLibertyFetch } from "../../src/aniliberty/client.ts"

export type CancellationFetch = {
  readonly fetch: AniLibertyFetch
  readonly cancellationCount: () => number
}

export function trackBodyCancellation(fetch: AniLibertyFetch): CancellationFetch {
  let cancellations = 0

  return {
    cancellationCount: () => cancellations,
    fetch: async (input, init) => {
      const response = await fetch(input, init)
      if (response.body === null) return response
      const reader = response.body.getReader()
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          const chunk = await reader.read()
          if (chunk.done) controller.close()
          else controller.enqueue(chunk.value)
        },
        cancel() {
          cancellations += 1
          return reader.cancel()
        },
      })
      return new Response(body, {
        headers: response.headers,
        status: response.status,
        statusText: response.statusText,
      })
    },
  }
}
