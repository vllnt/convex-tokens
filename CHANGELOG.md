# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.1] - Unreleased

### Fixed

- `mint` rejects a `maxTtlMs` that is NaN, zero or negative with
  `ConvexError({ code: "INVALID_TTL" })`; a NaN ceiling produced a NaN
  `expiresAt`, i.e. a token that never expired.
- `mint` rejects an empty `scope` (`INVALID_SCOPE`), an empty `resourceRef`
  (`INVALID_RESOURCE_REF`) and a `tokenHash` that already exists
  (`DUPLICATE_TOKEN_HASH`; a duplicate made `validate` and `revoke` throw for
  it).
- `list` rejects a NaN, negative or fractional `limit` (`INVALID_LIMIT`);
  `prune` rejects a NaN `before` (`INVALID_BEFORE`).
- `tokenBytes` below 1 or not an integer is rejected (`INVALID_TOKEN_BYTES`);
  `0` or `NaN` previously minted the empty token.
- `@vllnt/convex-tokens/test` now type-checks under `moduleResolution: nodenext`
  (explicit `.js` relative imports, Vite client types referenced).

### Documentation

- Document the error codes, the single-use pattern (`revoke` returns `true` for
  exactly one concurrent caller) and `/test` usage in the consuming app.

## [0.1.0] - 2026-09-01

### Added

- First release of `@vllnt/convex-tokens` — a hashed-secret token primitive.
- `Tokens` client: `mint` (mint-once, raw returned a single time), `validate`,
  `revoke`, `prune`, and the safe management reads `list` and `getMetadata`
  (token metadata only — never `tokenHash`).
- Hash-at-rest: only the digest of a token is stored; the raw secret is
  generated and hashed client-side with Web Crypto and never reaches the
  component. Digest algorithm is configurable per mount (`hashAlgo`: `"SHA-256"`
  default or `"SHA-512"`).
- Server-sourced time: the component computes `expiresAt` from a requested
  `ttlMs` and reads `Date.now()` inside `validate` — the client never sends a
  timestamp, so expiry cannot be forged. A non-finite `ttlMs` falls back to the
  default, so no non-expiring token can be minted.
- TTL clamped **server-side** into `[MIN_TTL_MS, maxTtlMs]`, scoping via an
  opaque `scope`, and an opaque host-owned `resourceRef` carried on each token.
- A built-in daily cron prunes expired tokens and revoked tokens past a
  retention window, in bounded self-rescheduling batches.
- Configurable client options: `defaultScope`, `defaultTtlMs`, `maxTtlMs`,
  `tokenBytes`, `hashAlgo`.

### Changed

- Treat Convex `_generated` output as CLI-owned, exclude it from formatting, and
  expose a dedicated codegen script.
- Refresh all direct dependencies to their latest compatible releases for canary
  validation.
- Require `convex@^1.45.0` and update `convex-test` to `^0.0.56`.

### Security

- Expiry is enforced from the component's own clock; there is no client-supplied
  `now` or `expiresAt` to bypass it.
- The management surface (`list`, `getMetadata`) never exposes `tokenHash`.
- **Server-side hash guard on `mint`**: the component now rejects a `tokenHash`
  argument that is not a plausible hex digest (minimum 64 characters, lowercase
  hex only — SHA-256 minimum). A misconfigured or adversarial direct caller
  cannot persist a raw token or garbage string as the stored digest. Throws
  `ConvexError({ code: "INVALID_TOKEN_HASH" })`.
- **Discriminated union on `validate` return**: `{ valid: false }` structurally
  cannot carry `resourceRef` — the failed branch has no such key at the type
  level. `ValidateResult` is now a discriminated union on `valid`.
- **`revoke` semantics clarified (transition contract)**: `revoke` returns
  `true` only if this call transitioned a token from active to revoked. A second
  call on the same token returns `false` (already revoked). This distinguishes
  "successfully revoked" from "token was already revoked".
- **`list` ceiling**: the `limit` argument is clamped to a hard ceiling of 1000
  rows. Values above the ceiling are silently clamped; `limit: 0` returns an
  empty array.
