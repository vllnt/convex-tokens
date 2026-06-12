import { v } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  clampTtl,
  DEFAULT_REVOKED_RETENTION_MS,
  MIN_TTL_MS,
  PRUNE_BATCH,
} from "../shared";

/**
 * Mint a token. The component computes `expiresAt` itself from a requested
 * `ttlMs` — it never trusts a client-supplied timestamp. `ttlMs` is clamped into
 * `[MIN_TTL_MS, maxTtlMs]`; a non-finite `ttlMs` (NaN / Infinity) falls back to
 * `defaultTtlMs`. This guarantees a minted token always outlives a `Date.now()`
 * validate (the floor is `MIN_TTL_MS`).
 */
export const mint = mutation({
  args: {
    tokenHash: v.string(),
    scope: v.string(),
    resourceRef: v.optional(v.string()),
    ttlMs: v.number(),
    defaultTtlMs: v.number(),
    maxTtlMs: v.number(),
  },
  returns: v.id("tokens"),
  handler: async (ctx, args) => {
    const ttl = clampTtl(args.ttlMs, MIN_TTL_MS, args.maxTtlMs, args.defaultTtlMs);
    const now = Date.now();
    return await ctx.db.insert("tokens", {
      tokenHash: args.tokenHash,
      scope: args.scope,
      resourceRef: args.resourceRef,
      revoked: false,
      expiresAt: now + ttl,
      createdAt: now,
    });
  },
});

/** Revoke the token with `tokenHash` in `scope`. Returns true if one was revoked. */
export const revoke = mutation({
  args: { tokenHash: v.string(), scope: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("tokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (row === null || row.scope !== args.scope) {
      return false;
    }
    await ctx.db.patch(row._id, { revoked: true });
    return true;
  },
});

/**
 * Delete up to `PRUNE_BATCH` tokens that expired before `before` (bounded read
 * via `by_expires`). Returns the count deleted in this batch. Idempotent and
 * bounded — safe to schedule; callers loop until it returns < `PRUNE_BATCH`.
 */
export const prune = mutation({
  args: { before: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const expired = await ctx.db
      .query("tokens")
      .withIndex("by_expires", (q) => q.lt("expiresAt", args.before))
      .take(PRUNE_BATCH);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }
    return expired.length;
  },
});

/**
 * Cron-driven sweep. Deletes, in bounded batches, (1) expired tokens and (2)
 * revoked tokens older than `revokedRetentionMs` (so an early-revoked token does
 * not linger for its full TTL). Self-reschedules while a batch fills, so an
 * unbounded backlog is drained without exceeding read limits.
 */
export const pruneExpired = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const now = Date.now();

    const expired = await ctx.db
      .query("tokens")
      .withIndex("by_expires", (q) => q.lt("expiresAt", now))
      .take(PRUNE_BATCH);
    for (const row of expired) {
      await ctx.db.delete(row._id);
    }

    let revokedDeleted = 0;
    const remaining = PRUNE_BATCH - expired.length;
    if (remaining > 0) {
      const revokedCutoff = now - DEFAULT_REVOKED_RETENTION_MS;
      const staleRevoked = await ctx.db
        .query("tokens")
        .withIndex("by_revoked_created", (q) =>
          q.eq("revoked", true).lt("createdAt", revokedCutoff),
        )
        .take(remaining);
      for (const row of staleRevoked) {
        await ctx.db.delete(row._id);
      }
      revokedDeleted = staleRevoked.length;
    }

    if (expired.length + revokedDeleted === PRUNE_BATCH) {
      await ctx.scheduler.runAfter(0, internal.mutations.pruneExpired, {});
    }
    return null;
  },
});
