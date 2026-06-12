# Changelog

All notable changes to this project are documented here. The format is based on
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.0] - 2026-06-12

### Added

- First release of `@vllnt/convex-tokens` — a hashed-secret token primitive.
- `Tokens` client: `mint` (mint-once, raw returned a single time), `validate`,
  `revoke`, `prune`, and the safe management reads `list` and `getMetadata`
  (token metadata only — never `tokenHash`).
- Hash-at-rest: only the digest of a token is stored; the raw secret is
  generated and hashed client-side with Web Crypto and never reaches the
  component. Digest algorithm is configurable per mount (`hashAlgo`:
  `"SHA-256"` default or `"SHA-512"`).
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

### Security

- Expiry is enforced from the component's own clock; there is no client-supplied
  `now` or `expiresAt` to bypass it.
- The management surface (`list`, `getMetadata`) never exposes `tokenHash`.
