/** Shared constants + pure utilities used by both `client/` and `component/`. */

export const COMPONENT_NAME = "tokens";

/** Default namespace when the host does not scope a token. */
export const DEFAULT_SCOPE = "global";

/** Default token lifetime: 24 hours. */
export const DEFAULT_TTL_MS = 86_400_000;

/** Floor for a clamped TTL: 1 minute (a minted token always outlives a `Date.now()` test). */
export const MIN_TTL_MS = 60_000;

/** Default ceiling for a clamped TTL: 30 days. */
export const DEFAULT_MAX_TTL_MS = 2_592_000_000;

/** Default entropy for a generated raw token, in bytes (48 hex chars). */
export const DEFAULT_TOKEN_BYTES = 24;

/** Default retention for a revoked token before the prune sweep drops it: 24 hours. */
export const DEFAULT_REVOKED_RETENTION_MS = 86_400_000;

/** Max rows a single prune mutation deletes before self-rescheduling. */
export const PRUNE_BATCH = 256;

/** Hard ceiling on the `limit` argument of `list` queries. */
export const LIST_LIMIT_MAX = 1000;

/**
 * Supported digest algorithms for {@link hashToken}. Fixed per mount — changing
 * it invalidates every existing hash, so a deployment picks one and keeps it.
 */
export type HashAlgo = "SHA-256" | "SHA-512";

/** Default digest algorithm. */
export const DEFAULT_HASH_ALGO: HashAlgo = "SHA-256";

/** Opaque host-supplied resource reference. Never assume its shape or source. */
export type ResourceRef = string;

/**
 * Hex digest of `raw` under `algo` (default SHA-256). The component stores only
 * this hash — the raw token is hashed by the client and never travels to or
 * rests in the component. Uses Web Crypto (`crypto.subtle`), a global in
 * edge-runtime and Node >=18.
 *
 * @param raw - The raw secret token to hash.
 * @param algo - Digest algorithm; fixed per mount. Default `"SHA-256"`.
 * @returns The lowercase hex digest.
 */
export async function hashToken(
  raw: string,
  algo: HashAlgo = DEFAULT_HASH_ALGO,
): Promise<string> {
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest(algo, bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Generate a cryptographically random raw token as a hex string of `bytes`
 * bytes (`2 * bytes` hex chars). Uses `crypto.getRandomValues` (a global).
 *
 * @param bytes - Entropy in bytes. Default {@link DEFAULT_TOKEN_BYTES}.
 * @returns The hex-encoded random token.
 */
export function generateToken(bytes = DEFAULT_TOKEN_BYTES): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return Array.from(buf)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Clamp `ttlMs` into `[minMs, maxMs]`. A non-finite `ttlMs` (NaN / Infinity)
 * falls back to `fallbackMs`; a non-finite `fallbackMs` falls back to `minMs`.
 * The result is therefore always finite and >= `minMs`, so a malformed request
 * can never produce a non-finite `expiresAt` (the expiry invariant holds).
 *
 * @param ttlMs - Requested lifetime in ms.
 * @param minMs - Lower bound (also the ultimate finite fallback).
 * @param maxMs - Upper bound.
 * @param fallbackMs - Used when `ttlMs` is not finite.
 * @returns The clamped, finite TTL.
 */
export function clampTtl(
  ttlMs: number,
  minMs: number,
  maxMs: number,
  fallbackMs: number,
): number {
  const fallback = Number.isFinite(fallbackMs) ? fallbackMs : minMs;
  const ttl = Number.isFinite(ttlMs) ? ttlMs : fallback;
  return Math.min(maxMs, Math.max(minMs, ttl));
}
