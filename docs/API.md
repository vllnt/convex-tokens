# API Reference — @vllnt/convex-tokens

Construct the client with the mounted component and optional config:

```ts
import { Tokens } from "@vllnt/convex-tokens";
const tokens = new Tokens(components.tokens, {
  defaultScope: "global", // namespace applied when a call omits `scope`
  defaultTtlMs: 86_400_000, // lifetime applied when `mint` omits `ttlMs` (24h)
  maxTtlMs: 2_592_000_000, // ceiling a requested TTL is clamped to (30d)
  tokenBytes: 24, // entropy of a generated raw token (48 hex chars)
  hashAlgo: "SHA-256", // digest algorithm — fixed per mount (or "SHA-512")
});
```

All methods take the host `ctx` (a query or mutation context) as the first
argument. `scope` is optional and defaults to `defaultScope`. The raw token is
generated and hashed by the client; the component only ever sees the digest.

**Time is sourced server-side.** The client never sends `now` or an `expiresAt`:
`mint` sends a requested `ttlMs` and the component computes `expiresAt` from its
own clock; `validate` reads `Date.now()` inside the query handler. An expired
token therefore cannot be revived by a forged client timestamp.

**`hashAlgo` is fixed per mount.** Pick one when you construct the client and
keep it — changing the algorithm changes every digest, invalidating all existing
tokens.

## Mutations

### `mint(ctx, { scope?, resourceRef?, ttlMs? }) → { token, id }`

Mint a new token. `token` is the raw secret — return it to the caller **now**, it
is never recoverable afterwards. `id` is the component-side record id (use it
with `getMetadata`). `resourceRef` is an opaque host reference carried on the
token; `ttlMs` is the requested lifetime, clamped **server-side** into
`[MIN_TTL_MS, maxTtlMs]` (so a minted token always outlives a `Date.now()`
validate). A non-finite `ttlMs` (NaN / Infinity) falls back to `defaultTtlMs` —
the component can never produce a non-expiring token. Defaults:
`scope = defaultScope`, `ttlMs = defaultTtlMs`.

### `revoke(ctx, rawToken, scope?) → boolean`

Revoke `rawToken`. Returns `true` if a token with that hash existed in `scope`
and was marked revoked; `false` if no match (unknown token or wrong scope).

### `prune(ctx, before?) → number`

Delete up to a bounded batch of tokens whose `expiresAt` is before `before`
(default `Date.now()`), revoked or not. Returns the number deleted in this
batch. Idempotent and bounded — call repeatedly until it returns `0` to drain a
backlog. A component cron also runs this sweep daily (see Cron below).

## Queries

### `validate(ctx, rawToken, scope?) → { valid, resourceRef? }`

Validate `rawToken`. Returns `{ valid: false }` when the token is unknown, in a
different scope, revoked, or expired (`expiresAt <= now`, with `now` read
server-side). Otherwise returns `{ valid: true, resourceRef }` carrying the
opaque reference the token was minted with (absent if minted without one).

### `list(ctx, { scope?, resourceRef?, limit? }) → TokenMetadata[]`

List token **metadata** for a management surface, filtered by `scope` and
optional `resourceRef` via an index. Each row is
`{ id, scope, resourceRef?, revoked, expiresAt, createdAt }` — **never
`tokenHash`**, so the result is safe to surface to an admin UI. `limit` defaults
to 100.

### `getMetadata(ctx, id) → TokenMetadata | null`

Fetch the safe metadata of one token by its component `id` (the `id` returned by
`mint`). Returns `null` if the row no longer exists. Never returns `tokenHash`.

## Cron

The component registers an internal daily cron (`tokens: prune expired and
stale-revoked`) that sweeps, in bounded self-rescheduling batches:

1. expired tokens, and
2. revoked tokens older than `DEFAULT_REVOKED_RETENTION_MS` (24h) — so an
   early-revoked token does not linger for its full TTL.

The cadence is fixed at the component layer (Convex crons are static). A mount
that needs a different frequency can additionally call `prune` from its own
schedule.
