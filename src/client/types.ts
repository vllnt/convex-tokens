/** Public TypeScript surface for the tokens client. */

import type { HashAlgo } from "../shared.js";

/** Result of minting a token. `token` is the raw secret — shown ONCE, never stored. */
export interface MintResult {
  /** The raw token. Hand it to the caller now; the component keeps only its hash. */
  token: string;
  /** The component-side id of the minted token record (use it with `getMetadata`). */
  id: string;
}

/** Result of validating a raw token. */
export interface ValidateResult {
  valid: boolean;
  /** The opaque host-owned reference carried by a valid token, if any. */
  resourceRef?: string;
}

/**
 * Safe, leak-free metadata for one token — what a management UI may display.
 * NEVER includes `tokenHash`.
 */
export interface TokenMetadata {
  /** The component-side id of the token record. */
  id: string;
  /** The token's namespace. */
  scope: string;
  /** The opaque host-owned reference, if the token carries one. */
  resourceRef?: string;
  /** Whether the token has been revoked. */
  revoked: boolean;
  /** Expiry timestamp (ms since epoch). */
  expiresAt: number;
  /** Creation timestamp (ms since epoch). */
  createdAt: number;
}

/** Construction options for the {@link Tokens} client. */
export interface TokensOptions {
  /** Namespace applied when a call omits `scope`. Default `"global"`. */
  defaultScope?: string;
  /** Lifetime applied when `mint` omits `ttlMs`, in ms. Default 24h. */
  defaultTtlMs?: number;
  /** Ceiling a requested TTL is clamped to, in ms. Default 30d. */
  maxTtlMs?: number;
  /** Entropy of a generated raw token, in bytes. Default 24. */
  tokenBytes?: number;
  /**
   * Digest algorithm for hashing tokens. Fixed per mount — changing it
   * invalidates every existing hash. Default `"SHA-256"`.
   */
  hashAlgo?: HashAlgo;
}
