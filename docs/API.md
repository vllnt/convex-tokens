# API Reference — @vllnt/convex-tokens

**Compatibility:** `convex@^1.45.0`; optional `react@>=18` for `./react`.

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
generated and hashed by the server-side `Tokens` client; the component only sees
the digest. The host must authorize minting and metadata reads; no client method
authenticates the caller.

**Time is sourced server-side.** The client never sends `now` or an `expiresAt`:
`mint` sends a requested `ttlMs` and the component computes `expiresAt` from its
own clock; `validate` reads `Date.now()` inside the query handler. An expired
token therefore cannot be revived by a forged client timestamp.

**`hashAlgo` is fixed per mount.** Pick one when you construct the client and
keep it — changing the algorithm changes every digest, invalidating all existing
tokens.

## Mutations

### `mint(ctx, { scope?, resourceRef?, ttlMs? }) → { token, id }`

Mint a new token. `token` is the raw secret — return it to the caller **now**,
it is never recoverable afterwards. `id` is the component-side record id (use it
with `getMetadata`). `resourceRef` is an opaque host reference carried on the
token; `ttlMs` is the requested lifetime, clamped **server-side** into
`[MIN_TTL_MS, maxTtlMs]` (so a minted token always outlives a `Date.now()`
validate). A non-finite `ttlMs` (NaN / Infinity) falls back to `defaultTtlMs` —
the component can never produce a non-expiring token. Defaults:
`scope = defaultScope`, `ttlMs = defaultTtlMs`.

**Hash guard (server-side):** the component validates the `tokenHash` it
receives. A `tokenHash` shorter than 64 characters or containing
non-lowercase-hex characters is rejected with
`ConvexError({ code: "INVALID_TOKEN_HASH" })`. This prevents a misconfigured or
adversarial direct caller from persisting a raw token or garbage string. The
client's `hashToken` always produces a valid digest; this guard hardens the
component's trust boundary for direct callers.

### `revoke(ctx, rawToken, scope?) → boolean`

Revoke `rawToken`. Returns `true` **only if this call transitioned the token
from active to revoked** — i.e. the token existed in `scope` and was not already
revoked. Returns `false` for an unknown token, a wrong-scope token, or a token
that is already in the revoked state.

**Transition contract (not idempotent success):** calling `revoke` twice on the
same token returns `true` the first time and `false` the second time. Use
`getMetadata` to check the current state without side effects.

### `prune(ctx, before?) → number`

Delete up to a bounded batch of tokens whose `expiresAt` is before `before`
(default `Date.now()`), revoked or not. Returns the number deleted in this
batch. Idempotent and bounded — call repeatedly until it returns `0` to drain a
backlog. A component cron also runs this sweep daily (see Cron below).

## Queries

### `validate(ctx, rawToken, scope?) → ValidateResult`

Validate `rawToken`. Returns a discriminated union on `valid`:

- `{ valid: true, resourceRef? }` — the token is live; `resourceRef` is the
  opaque host-owned reference the token was minted with, absent if minted
  without one.
- `{ valid: false }` — the token is unknown, in a different scope, revoked, or
  expired (`expiresAt <= now`, with `now` read server-side). This branch
  structurally cannot carry `resourceRef`.

Expiry is evaluated against the component's server clock — there is no
client-supplied `now` to forge.

### `list(ctx, { scope?, resourceRef?, limit? }) → TokenMetadata[]`

List token **metadata** for a management surface, filtered by `scope` and
optional `resourceRef` via an index. Each row is
`{ id, scope, resourceRef?, revoked, expiresAt, createdAt }` — **never
`tokenHash`**. Only expose it to callers authorized for that resource and scope.

`limit` defaults to 100; the hard ceiling is **1000**. A value above the ceiling
is silently clamped to 1000. `limit: 0` returns an empty array. This is a
bounded array, not a paginated API: there is no continuation cursor.

### `getMetadata(ctx, id) → TokenMetadata | null`

Fetch the safe metadata of one token by its component `id` (the `id` returned by
`mint`). Returns `null` if the row no longer exists. Never returns `tokenHash`.

## Cron

The component registers an internal daily cron
(`tokens: prune expired and stale-revoked`) that sweeps, in bounded
self-rescheduling batches:

1. expired tokens, and
2. revoked tokens older than `DEFAULT_REVOKED_RETENTION_MS` (24h) — so an
   early-revoked token does not linger for its full TTL.

The cadence is fixed at the component layer (Convex crons are static). A mount
that needs a different frequency can additionally call `prune` from its own
schedule.
