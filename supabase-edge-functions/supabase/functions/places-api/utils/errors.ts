// Represents an HTTP error whose status should be returned to the API caller.
export class RequestError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "RequestError"
    this.status = status
  }
}
