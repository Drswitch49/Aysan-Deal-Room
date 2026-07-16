/**
 * Typed application error hierarchy + HTTP mapping.
 *
 * Handlers throw these; the shared handler wrapper (api/_lib/handler.ts) catches
 * them and maps `.status` → response. This replaces ad-hoc `res.status(500)` and
 * the bogus non-standard codes (e.g. HTTP 455) scattered across the old handlers.
 */

export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  /** Optional machine-readable details (e.g. zod issues). Never include secrets. */
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class BadRequestError extends AppError {
  constructor(message = "Bad request", details?: unknown) {
    super(400, "bad_request", message, details);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Validation failed", details?: unknown) {
    super(422, "validation_failed", message, details);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super(401, "unauthorized", message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, "forbidden", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, "not_found", message);
  }
}

export class MethodNotAllowedError extends AppError {
  constructor(message = "Method not allowed") {
    super(405, "method_not_allowed", message);
  }
}

export class ConflictError extends AppError {
  constructor(message = "Conflict", details?: unknown) {
    super(409, "conflict", message, details);
  }
}

export class InternalError extends AppError {
  constructor(message = "Internal server error", details?: unknown) {
    super(500, "internal_error", message, details);
  }
}

/** Normalize any thrown value into an AppError for consistent responses. */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  const message = err instanceof Error ? err.message : "Internal server error";
  return new InternalError(message);
}
