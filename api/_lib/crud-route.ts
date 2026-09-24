/**
 * Generic CRUD route factories built on `createHandler` + a Repository.
 *
 * Most entities need the same two endpoints:
 *   collectionHandler(repo)  →  GET (list)   + POST (create)
 *   itemHandler(repo)        →  GET (findById) + PATCH (update) + DELETE (soft)
 *
 * Role gates default to: reads = any authenticated staff, writes = WRITERS,
 * delete = ALL_ADMINS. Override per entity where needed.
 */
import { z } from "zod";
import { createHandler } from "./handler.js";
import { WRITERS, ALL_ADMINS } from "./authz.js";
import { ForbiddenError, NotFoundError, BadRequestError } from "../../lib/core/errors.js";
import type { Repository } from "../../lib/data/ports/repository.js";

const idSchema = z.object({ id: z.string().uuid("A resource id (uuid) is required") });

interface CrudOptions {
  /** Who may read (GET). Defaults to any authenticated user. */
  readRoles?: string[];
  writeRoles?: string[];
  deleteRoles?: string[];
  /** Runs after a successful PATCH — e.g. to cascade a flag onto child rows. */
  onUpdated?: (row: any, patch: Record<string, unknown>) => Promise<void>;
  /** Runs after a successful POST — e.g. to provision a linked record. */
  onCreated?: (row: any) => Promise<void>;
}

export function collectionHandler(
  repo: Repository<any, any, any>,
  opts: CrudOptions = {},
) {
  const writeRoles = opts.writeRoles ?? WRITERS;
  return createHandler({
    methods: ["GET", "POST"],
    requireAuth: true,
    handle: async ({ req, body, query, user }) => {
      if (req.method === "GET") {
        if (opts.readRoles && (!user || !opts.readRoles.includes(user.role))) {
          throw new ForbiddenError("Insufficient role to view");
        }
        return repo.list(query as Record<string, unknown>);
      }
      if (!user || !writeRoles.includes(user.role)) throw new ForbiddenError("Insufficient role to create");
      const created = await repo.create(body);
      if (opts.onCreated) await opts.onCreated(created);
      return created;
    },
  });
}

export function itemHandler(
  repo: Repository<any, any, any>,
  opts: CrudOptions = {},
) {
  const writeRoles = opts.writeRoles ?? WRITERS;
  const deleteRoles = opts.deleteRoles ?? ALL_ADMINS;
  return createHandler({
    methods: ["GET", "PATCH", "DELETE"],
    requireAuth: true,
    handle: async ({ req, body, query, user }) => {
      const { id } = idSchema.parse(query);
      if (req.method === "GET") {
        if (opts.readRoles && (!user || !opts.readRoles.includes(user.role))) {
          throw new ForbiddenError("Insufficient role to view");
        }
        const row = await repo.findById(id);
        if (!row) throw new NotFoundError("Not found");
        return row;
      }
      if (req.method === "PATCH") {
        if (!user || !writeRoles.includes(user.role)) throw new ForbiddenError("Insufficient role to edit");
        if (!body || Object.keys(body).length === 0) throw new BadRequestError("Empty update");
        const updated = await repo.update(id, body);
        if (opts.onUpdated) await opts.onUpdated(updated, body as Record<string, unknown>);
        return updated;
      }
      if (!user || !deleteRoles.includes(user.role)) throw new ForbiddenError("Insufficient role to delete");
      await repo.remove(id);
      return { id, deleted: true };
    },
  });
}
