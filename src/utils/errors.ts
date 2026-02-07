export type ErrorCode =
  | "BAD_REQUEST"
  | "NOT_FOUND"
  | "CONFLICT"
  | "LOCKED"
  | "DEGRADED_MODE"
  | "INTERNAL";

export class AppError extends Error {
  public readonly code: ErrorCode;
  public readonly status: number;
  public readonly details?: Record<string, unknown>;

  constructor(code: ErrorCode, message: string, status: number, details?: Record<string, unknown>) {
    super(message);
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function asAppError(error: unknown): AppError {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof Error) {
    return new AppError("INTERNAL", error.message, 500);
  }

  return new AppError("INTERNAL", "Unknown error", 500);
}

export function conciseErrorText(error: unknown): string {
  const appError = asAppError(error);
  return `${appError.code}: ${appError.message}`;
}
