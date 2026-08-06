export type LocalHandler = (request: Request) => Response | Promise<Response>

export async function withAniLibertyServer<T>(
  handler: LocalHandler,
  action: (baseUrl: URL) => Promise<T>,
): Promise<T> {
  const server = Bun.serve({
    development: false,
    fetch: handler,
    hostname: "127.0.0.1",
    port: 0,
  })

  try {
    return await action(new URL(`http://127.0.0.1:${server.port}/api/v1/`))
  } finally {
    await server.stop(true)
  }
}

export function jsonResponse(body: string, status = 200, headers?: HeadersInit): Response {
  return new Response(body, {
    headers: { "content-type": "application/json", ...headers },
    status,
  })
}
