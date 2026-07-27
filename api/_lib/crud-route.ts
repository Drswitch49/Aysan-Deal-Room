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
  writeRoles?: string[];
  deleteRoles?: string[];
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
      if (req.method === "GET") return repo.list(query as Record<string, unknown>);
      if (!user || !writeRoles.includes(user.role)) throw new ForbiddenError("Insufficient role to create");
      return repo.create(body);
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
        const row = await repo.findById(id);
        if (!row) throw new NotFoundError("Not found");
        return row;
      }
      if (req.method === "PATCH") {
        if (!user || !writeRoles.includes(user.role)) throw new ForbiddenError("Insufficient role to edit");
        if (!body || Object.keys(body).length === 0) throw new BadRequestError("Empty update");
        return repo.update(id, body);
      }
      if (!user || !deleteRoles.includes(user.role)) throw new ForbiddenError("Insufficient role to delete");
      await repo.remove(id);
      return { id, deleted: true };
    },
  });
}
