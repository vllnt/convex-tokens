import { v } from "convex/values";

/**
 * Result of validating a token hash. `resourceRef` is the opaque host-owned
 * reference carried by the token, present only when `valid` is true and the
 * token was minted with one.
 */
export const validateResult = v.object({
  valid: v.boolean(),
  resourceRef: v.optional(v.string()),
});

/**
 * Safe, leak-free projection of a token row for a management surface. NEVER
 * includes `tokenHash` — only lifecycle metadata a UI may display.
 */
export const tokenMetadata = v.object({
  id: v.id("tokens"),
  scope: v.string(),
  resourceRef: v.optional(v.string()),
  revoked: v.boolean(),
  expiresAt: v.number(),
  createdAt: v.number(),
});
