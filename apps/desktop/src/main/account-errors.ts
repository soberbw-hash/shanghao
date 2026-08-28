export class AccountDesktopError extends Error {
  constructor(
    readonly code: string,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "AccountDesktopError";
  }
}
