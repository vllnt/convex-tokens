import { v } from "convex/values";
import { query } from "./_generated/server";
import { tokenMetadata, validateResult } from "./validators";
import { LIST_LIMIT_MAX } from "../shared.js";

/**
 * Validate a token by its hash. Reads the current time from `Date.now()` INSIDE
 * the handler — there is no client-supplied `now`, so an expired token cannot be
 * revived by passing a stale timestamp. Returns `{ valid: false }` for unknown,
 * wrong-scope, revoked, or expired tokens.
 */
export const validate = query({
  args: { tokenHash: v.string(), scope: v.string() },
  returns: validateResult,
  handler: async (ctx, args) => {
    const now = Date.now();
    const row = await ctx.db
      .query("tokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (
      row === null ||
      row.scope !== args.scope ||
      row.revoked ||
      row.expiresAt <= now
    ) {
      return { valid: false };
    }
    return { valid: true, resourceRef: row.resourceRef };
  },
});

/**
 * List token METADATA for a management surface, projecting only non-secret
 * lifecycle fields — NEVER `tokenHash`. Filters by `scope` and optional
 * `resourceRef` via the `by_scope_resource` index (a bounded lookup, not a
 * table scan). Returns up to `limit` (default 100, ceiling {@link LIST_LIMIT_MAX})
 * rows. A `limit` above the ceiling is silently clamped; `limit: 0` returns an
 * empty array.
 */
export const list = query({
  args: {
    scope: v.string(),
    resourceRef: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(tokenMetadata),
  handler: async (ctx, args) => {
    const limit = Math.min(args.limit ?? 100, LIST_LIMIT_MAX);
    const rows = await ctx.db
      .query("tokens")
      .withIndex("by_scope_resource", (q) =>
        args.resourceRef === undefined
          ? q.eq("scope", args.scope)
          : q.eq("scope", args.scope).eq("resourceRef", args.resourceRef),
      )
      .take(limit);
    return rows.map((row) => ({
      id: row._id,
      scope: row.scope,
      resourceRef: row.resourceRef,
      revoked: row.revoked,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    }));
  },
});

/**
 * Fetch the safe METADATA of a single token by its component id — no
 * `tokenHash`. Returns `null` if no such row.
 */
export const getMetadata = query({
  args: { id: v.id("tokens") },
  returns: v.union(tokenMetadata, v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.id);
    if (row === null) {
      return null;
    }
    return {
      id: row._id,
      scope: row.scope,
      resourceRef: row.resourceRef,
      revoked: row.revoked,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
    };
  },
});
