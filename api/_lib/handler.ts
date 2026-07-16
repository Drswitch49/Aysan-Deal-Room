/**
 * Standard serverless handler wrapper.
 *
 * Every rewritten API route is built with `createHandler`, giving a uniform
 * pipeline: method check → input validation (zod) → authentication →
 * authorization → service call → typed JSON response, with centralized error
 * mapping (replaces ad-hoc `res.status(500)` and non-standard codes like 455).
 */
import type { ZodType } from "zod";
import { AppError, MethodNotAllowedError, UnauthorizedError, ForbiddenError, ValidationError, toAppError } from "../../lib/core/errors.js";
import { logger } from "../../lib/core/logger.js";
import { getUserContext, type UserContext } from "./authz.js";

type Method = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface HandlerContext<TBody, TQuery> {
  req: any;
  res: any;
  body: TBody;
  query: TQuery;
  user: UserContext | null;
}

export interface HandlerConfig<TBody, TQuery> {
  methods: Method[];
  bodySchema?: ZodType<TBody>;
  querySchema?: ZodType<TQuery>;
  /** Require an authenticated user (401 if absent). Default true. */
  requireAuth?: boolean;
  /** Allowed roles (403 if the user's role isn't included). Empty = any authenticated user. */
  roles?: string[];
  handle: (ctx: HandlerContext<TBody, TQuery>) => Promise<unknown>;
}

function sendError(res: any, err: AppError) {
  res.status(err.status).json({
    error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
  });
}

export function createHandler<TBody = unknown, TQuery = unknown>(config: HandlerConfig<TBody, TQuery>) {
  const requireAuth = config.requireAuth !== false;

  return async function handler(req: any, res: any): Promise<void> {
    try {
      if (!config.methods.includes(req.method)) {
        res.setHeader("Allow", config.methods.join(", "));
        throw new MethodNotAllowedError(`${req.method} not allowed`);
      }

      const user = await getUserContext(req);
      if (requireAuth && !user) throw new UnauthorizedError();
      if (config.roles?.length && (!user || !config.roles.includes(user.role))) {
        throw new ForbiddenError(`Requires role: ${config.roles.join(", ")}`);
      }

      let body = req.body as TBody;
      if (config.bodySchema) {
        const parsed = config.bodySchema.safeParse(req.body ?? {});
        if (!parsed.success) throw new ValidationError("Invalid request body", parsed.error.issues);
        body = parsed.data;
      }

      let query = req.query as TQuery;
      if (config.querySchema) {
        const parsed = config.querySchema.safeParse(req.query ?? {});
        if (!parsed.success) throw new ValidationError("Invalid query parameters", parsed.error.issues);
        query = parsed.data;
      }

      const data = await config.handle({ req, res, body, query, user });
      if (!res.headersSent) res.status(200).json({ data });
    } catch (err) {
      const appErr = toAppError(err);
      if (appErr.status >= 500) {
        logger.error({ err, path: req.url, method: req.method }, "handler error");
      }
      if (!res.headersSent) sendError(res, appErr);
    }
  };
}
