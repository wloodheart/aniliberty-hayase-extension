export type AniLibertyEndpoint = "health" | "release-torrents" | "search-releases"

export abstract class AniLibertyClientError extends Error {
  abstract readonly kind: string
}

export class AniLibertyHttpError extends AniLibertyClientError {
  readonly kind = "http"
  readonly name = "AniLibertyHttpError"

  constructor(
    readonly endpoint: AniLibertyEndpoint,
    readonly status: number,
  ) {
    super("AniLiberty rejected the request")
  }
}

export class AniLibertyApiValidationError extends AniLibertyClientError {
  readonly kind = "api-validation"
  readonly name = "AniLibertyApiValidationError"
  readonly status = 422

  constructor(readonly endpoint: AniLibertyEndpoint) {
    super("AniLiberty could not validate the request")
  }
}

export class AniLibertyContentTypeError extends AniLibertyClientError {
  readonly kind = "content-type"
  readonly name = "AniLibertyContentTypeError"

  constructor(
    readonly endpoint: AniLibertyEndpoint,
    readonly status: number,
  ) {
    super("AniLiberty returned an unsupported response format")
  }
}

export class AniLibertyMalformedJsonError extends AniLibertyClientError {
  readonly kind = "malformed-json"
  readonly name = "AniLibertyMalformedJsonError"

  constructor(
    readonly endpoint: AniLibertyEndpoint,
    readonly status: number,
  ) {
    super("AniLiberty returned malformed data")
  }
}

export class AniLibertyContractError extends AniLibertyClientError {
  readonly kind = "contract"
  readonly name = "AniLibertyContractError"

  constructor(
    readonly endpoint: AniLibertyEndpoint,
    readonly status: number,
  ) {
    super("AniLiberty returned an incompatible response")
  }
}

export class AniLibertyTimeoutError extends AniLibertyClientError {
  readonly kind = "timeout"
  readonly name = "AniLibertyTimeoutError"

  constructor(
    readonly endpoint: AniLibertyEndpoint,
    readonly timeoutMilliseconds: number,
    readonly attempts: number,
  ) {
    super("AniLiberty did not respond before the deadline")
  }
}

export class AniLibertyAbortedError extends AniLibertyClientError {
  readonly kind = "aborted"
  readonly name = "AniLibertyAbortedError"

  constructor(readonly endpoint: AniLibertyEndpoint) {
    super("AniLiberty request was cancelled")
  }
}

export class AniLibertyTransientError extends AniLibertyClientError {
  readonly kind = "transient-exhausted"
  readonly name = "AniLibertyTransientError"

  constructor(
    readonly endpoint: AniLibertyEndpoint,
    readonly status: number,
    readonly attempts: number,
  ) {
    super("AniLiberty is temporarily unavailable")
  }
}

export class AniLibertyTransportError extends AniLibertyClientError {
  readonly kind = "transport"
  readonly name = "AniLibertyTransportError"

  constructor(readonly endpoint: AniLibertyEndpoint) {
    super("AniLiberty could not be reached")
  }
}
