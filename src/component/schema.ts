import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

/**
 * Sandboxed tables — the token registry's own concern. Only the SHA-256 (or
 * SHA-512) hash of a token is stored (`tokenHash`); the raw secret is never
 * persisted. `scope` namespaces tokens and `resourceRef` is an opaque host-owned
 * reference (never assume its shape).
 */
export default defineSchema({
  tokens: defineTable({
    tokenHash: v.string(),
    scope: v.string(),
    resourceRef: v.optional(v.string()),
    revoked: v.boolean(),
    expiresAt: v.number(),
    createdAt: v.number(),
  })
    .index("by_hash", ["tokenHash"])
    .index("by_expires", ["expiresAt"])
    .index("by_scope_resource", ["scope", "resourceRef"])
    .index("by_revoked_created", ["revoked", "createdAt"]),
});
