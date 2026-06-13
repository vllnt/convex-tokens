import { v } from "convex/values";
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { Tokens } from "../../src/client";

/**
 * Host-app wrappers. The host owns auth: resolve identity here, then pass an
 * opaque `resourceRef` (and optional `scope`) into the tokens client.
 */
const tokens = new Tokens(components.tokens);

/** A second client with non-default options — exercises the client's option branches. */
const shortTokens = new Tokens(components.tokens, {
  defaultScope: "tenant",
  defaultTtlMs: 1_000, // below MIN_TTL_MS → clamps up
  maxTtlMs: 120_000,
  tokenBytes: 16,
});

/** A third client pinned to SHA-512 — exercises the `hashAlgo` config point. */
const sha512Tokens = new Tokens(components.tokens, {
  defaultScope: "algo",
  hashAlgo: "SHA-512",
});

const mintResult = v.object({ token: v.string(), id: v.string() });
const validateOut = v.union(
  v.object({ valid: v.literal(true), resourceRef: v.optional(v.string()) }),
  v.object({ valid: v.literal(false) }),
);
const metadataOut = v.object({
  id: v.string(),
  scope: v.string(),
  resourceRef: v.optional(v.string()),
  revoked: v.boolean(),
  expiresAt: v.number(),
  createdAt: v.number(),
});

export const mint = mutation({
  args: {
    scope: v.optional(v.string()),
    resourceRef: v.optional(v.string()),
    ttlMs: v.optional(v.number()),
  },
  returns: mintResult,
  handler: (ctx, a) =>
    tokens.mint(ctx, {
      scope: a.scope,
      resourceRef: a.resourceRef,
      ttlMs: a.ttlMs,
    }),
});

export const validate = query({
  args: { token: v.string(), scope: v.optional(v.string()) },
  returns: validateOut,
  handler: (ctx, a) => tokens.validate(ctx, a.token, a.scope),
});

export const revoke = mutation({
  args: { token: v.string(), scope: v.optional(v.string()) },
  returns: v.boolean(),
  handler: (ctx, a) => tokens.revoke(ctx, a.token, a.scope),
});

export const prune = mutation({
  args: { before: v.optional(v.number()) },
  returns: v.number(),
  handler: (ctx, a) => tokens.prune(ctx, a.before),
});

export const list = query({
  args: {
    scope: v.optional(v.string()),
    resourceRef: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  returns: v.array(metadataOut),
  handler: (ctx, a) =>
    tokens.list(ctx, {
      scope: a.scope,
      resourceRef: a.resourceRef,
      limit: a.limit,
    }),
});

export const getMetadata = query({
  args: { id: v.string() },
  returns: v.union(metadataOut, v.null()),
  handler: (ctx, a) => tokens.getMetadata(ctx, a.id),
});

/** Tenant-scoped, short-TTL variants — exercise the second client's options. */
export const mintShort = mutation({
  args: { resourceRef: v.optional(v.string()) },
  returns: mintResult,
  handler: (ctx, a) => shortTokens.mint(ctx, { resourceRef: a.resourceRef }),
});

export const validateShort = query({
  args: { token: v.string() },
  returns: validateOut,
  handler: (ctx, a) => shortTokens.validate(ctx, a.token),
});

export const revokeShort = mutation({
  args: { token: v.string() },
  returns: v.boolean(),
  handler: (ctx, a) => shortTokens.revoke(ctx, a.token),
});

export const pruneDefault = mutation({
  args: {},
  returns: v.number(),
  handler: (ctx) => tokens.prune(ctx),
});

/** SHA-512 variants — mint and validate must round-trip under the alternate algo. */
export const mintSha512 = mutation({
  args: { resourceRef: v.optional(v.string()) },
  returns: mintResult,
  handler: (ctx, a) => sha512Tokens.mint(ctx, { resourceRef: a.resourceRef }),
});

export const validateSha512 = query({
  args: { token: v.string() },
  returns: validateOut,
  handler: (ctx, a) => sha512Tokens.validate(ctx, a.token),
});

/**
 * Drive the cron's sweep directly so tests can assert it deletes expired and
 * stale-revoked tokens. In production this runs from the component's own cron;
 * the host never needs to call it.
 */
export const runSweep = mutation({
  args: {},
  returns: v.null(),
  handler: (ctx) => ctx.runMutation(components.tokens.mutations.pruneExpired, {}),
});

/**
 * Test harness: call the component's `mint` mutation DIRECTLY with a caller-
 * supplied `tokenHash` string — bypassing the client's `hashToken` helper.
 *
 * This is intentionally NOT a pattern hosts should use in production; it exists
 * only to exercise the server-side hash guard (Fix 1 in the security review).
 */
export const mintDirect = mutation({
  args: {
    tokenHash: v.string(),
    scope: v.optional(v.string()),
    ttlMs: v.optional(v.number()),
    defaultTtlMs: v.optional(v.number()),
    maxTtlMs: v.optional(v.number()),
  },
  returns: v.string(),
  handler: (ctx, a) =>
    ctx.runMutation(components.tokens.mutations.mint, {
      tokenHash: a.tokenHash,
      scope: a.scope ?? "global",
      ttlMs: a.ttlMs ?? 86_400_000,
      defaultTtlMs: a.defaultTtlMs ?? 86_400_000,
      maxTtlMs: a.maxTtlMs ?? 2_592_000_000,
    }),
});
