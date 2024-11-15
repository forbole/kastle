export class ErrorResponse {
  error: string;

  constructor(error: string) {
    this.error = error;
  }

  static validate(data: unknown): data is ErrorResponse {
    return typeof data === "object" && !!data && "error" in data;
  }
}
