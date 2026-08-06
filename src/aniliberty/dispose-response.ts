function ignoreDisposalFailure(_error: unknown): undefined {
  return undefined
}

export async function disposeResponseBody(response: Response): Promise<void> {
  if (response.body === null) return
  await response.body.cancel().then(undefined, ignoreDisposalFailure)
}
