import type { AdapterErrorCode, AdapterErrorDetails } from './contracts.js'

export class AdapterError extends Error implements AdapterErrorDetails {
  readonly code: AdapterErrorCode
  readonly adapterId: string
  readonly retryable: boolean
  readonly retryAfterSeconds?: number
  readonly providerStatus?: number
  readonly providerCode?: string

  constructor(details: AdapterErrorDetails, options?: ErrorOptions) {
    super(details.message, options)
    this.name = 'AdapterError'
    this.code = details.code
    this.adapterId = details.adapterId
    this.retryable = details.retryable
    this.retryAfterSeconds = details.retryAfterSeconds
    this.providerStatus = details.providerStatus
    this.providerCode = details.providerCode
  }

  toJSON(): AdapterErrorDetails {
    return {
      code: this.code,
      adapterId: this.adapterId,
      message: this.message,
      retryable: this.retryable,
      ...(this.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: this.retryAfterSeconds }),
      ...(this.providerStatus === undefined ? {} : { providerStatus: this.providerStatus }),
      ...(this.providerCode === undefined ? {} : { providerCode: this.providerCode }),
    }
  }
}

export function isAdapterError(error: unknown): error is AdapterError {
  return error instanceof AdapterError
}
