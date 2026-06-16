export class AutoDnsHttpError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly responseBody: string
  ) {
    super(message);
    this.name = "AutoDnsHttpError";
  }
}

export class AutoDnsAuthError extends AutoDnsHttpError {
  constructor(status: number, responseBody: string) {
    super(`AutoDNS authentication failed with status ${status}`, status, responseBody);
    this.name = "AutoDnsAuthError";
  }
}

export class AutoDnsTimeoutError extends Error {
  constructor(message = "AutoDNS request timed out") {
    super(message);
    this.name = "AutoDnsTimeoutError";
  }
}
