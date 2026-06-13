import { v } from "convex/values";

/**
 * Result of validating a token hash.
 *
 * Discriminated union on `valid`:
 * - `{ valid: true, resourceRef? }` — the token is live and carries an optional
 *   opaque host-owned reference.
 * - `{ valid: false }` — the token is unknown, wrong-scope, revoked, or expired.
 *   The failed branch structurally cannot carry `resourceRef`.
 */
export const validateResult = v.union(
  v.object({ valid: v.literal(true), resourceRef: v.optional(v.string()) }),
  v.object({ valid: v.literal(false) }),
);

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
