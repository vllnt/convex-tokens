import { v } from "convex/values";
import { ConvexError } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  clampTtl,
  DEFAULT_REVOKED_RETENTION_MS,
  MIN_TTL_MS,
  PRUNE_BATCH,
} from "../shared";

/**
 * Minimum length of a valid hex digest (SHA-256 = 64 hex chars).
 *
 * The component only stores hashes — a `tokenHash` shorter than this or
 * containing non-hex characters is not a plausible digest and is rejected. This
 * guards against a misconfigured or adversarial host calling the component
 * mutation directly and persisting a raw secret or garbage string.
 */
const MIN_HASH_LENGTH = 64;

/** Pattern that a plausible hex digest must satisfy (lowercase hex only). */
const HASH_PATTERN = /^[0-9a-f]+$/;

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
    const isPlausibleHash =
      args.tokenHash.length >= MIN_HASH_LENGTH &&
      HASH_PATTERN.test(args.tokenHash);
    if (!isPlausibleHash) {
      throw new ConvexError({
        code: "INVALID_TOKEN_HASH",
        message:
          "tokenHash must be a lowercase hex digest of at least 64 characters (SHA-256 minimum). " +
          "Use client.hashToken() to produce a valid hash.",
      });
    }
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

/**
 * Revoke the token with `tokenHash` in `scope`.
 *
 * Returns `true` **only if this call transitioned the token from active to
 * revoked** (i.e. it existed in the given scope and was not already revoked).
 * Returns `false` for an unknown token, a wrong-scope token, or a token that
 * is already in the revoked state — the caller can distinguish "nothing to
 * revoke" from "successfully revoked".
 *
 * @remarks This is the "true = transition" contract, not "true = now revoked".
 *   Calling revoke twice on the same token returns `true` the first time and
 *   `false` the second time. Use `getMetadata` to check the current state
 *   without side effects.
 */
export const revoke = mutation({
  args: { tokenHash: v.string(), scope: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("tokens")
      .withIndex("by_hash", (q) => q.eq("tokenHash", args.tokenHash))
      .unique();
    if (row === null || row.scope !== args.scope || row.revoked) {
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
