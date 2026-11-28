# API reference: @vllnt/convex-tokens

**Compatibility:** `convex@^1.45.0`; optional `react@>=18` for `./react`.

## Entry points

| Import                                                  | Exports                                                                                                                                  |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `@vllnt/convex-tokens`                                  | `Tokens` class; types `TokensComponent`, `TokensOptions`, `MintOptions`, `ListOptions`, `MintResult`, `ValidateResult`, `TokenMetadata` |
| `@vllnt/convex-tokens/react`                            | `useTokens(listRef, args)`                                                                                                               |
| `@vllnt/convex-tokens/convex.config` (or `.js`)         | default component definition for `app.use(...)`                                                                                          |
| `@vllnt/convex-tokens/test`                             | `register(t, name = "tokens")` for `convex-test` (TypeScript source; needs Vite `import.meta.glob`)                                      |
| `@vllnt/convex-tokens/_generated/component` (or `.js`)  | type `ComponentApi` (types only)                                                                                                         |

The constants below are not exported from any entry point, so they cannot be
imported; their values are fixed in `src/shared.ts`.

| Constant                       | Value                     | Used for                                                         |
| ------------------------------ | ------------------------- | ---------------------------------------------------------------- |
| `DEFAULT_SCOPE`                | `"global"`                | `defaultScope` when the client sets none                         |
| `DEFAULT_TTL_MS`               | `86_400_000` (24 hours)   | `defaultTtlMs` when the client sets none                         |
| `MIN_TTL_MS`                   | `60_000` (1 minute)       | Floor of the TTL clamp, unless `maxTtlMs` is lower               |
| `DEFAULT_MAX_TTL_MS`           | `2_592_000_000` (30 days) | `maxTtlMs` when the client sets none                             |
| `DEFAULT_TOKEN_BYTES`          | `24` (48 hex characters)  | `tokenBytes` when the client sets none                           |
| `DEFAULT_HASH_ALGO`            | `"SHA-256"`               | `hashAlgo` when the client sets none                             |
| `LIST_LIMIT_MAX`               | `1000`                    | Ceiling of `list`'s `limit`                                      |
| `PRUNE_BATCH`                  | `256`                     | Rows deleted per `prune` call and per cron batch                 |
| `DEFAULT_REVOKED_RETENTION_MS` | `86_400_000` (24 hours)   | Age (from `createdAt`) after which the cron deletes revoked rows |

## Client

### `Tokens`

```ts
import type { TokensComponent, TokensOptions } from "@vllnt/convex-tokens";
import type {
  FunctionArgs,
  FunctionReference,
  FunctionReturnType,
} from "convex/server";

// Any ctx with runQuery: a query, mutation or action ctx. Not exported.
interface RunQueryCtx {
  runQuery<Q extends FunctionReference<"query", "internal">>(
    reference: Q,
    args: FunctionArgs<Q>,
  ): Promise<FunctionReturnType<Q>>;
}

// Any ctx with runMutation: a mutation or action ctx. Not exported.
interface RunMutationCtx {
  runMutation<M extends FunctionReference<"mutation", "internal">>(
    reference: M,
    args: FunctionArgs<M>,
  ): Promise<FunctionReturnType<M>>;
}

declare class Tokens {
  constructor(component: TokensComponent, options?: TokensOptions);
}
```

The method declarations below use `RunQueryCtx`, `RunMutationCtx` and the
package's exported types. `component` is the mounted component, `components.tokens` (or the name passed
to `app.use`). `options` are described under [`TokensOptions`](#tokensoptions).
Every method takes the host `ctx` first: `mint`, `revoke` and `prune` need
`ctx.runMutation` (a mutation or action), the others need `ctx.runQuery`. Where
a method takes a `scope`, it defaults to `defaultScope`.

The client generates the raw token with `crypto.getRandomValues` and hashes it
with `crypto.subtle.digest` before calling the component; the component only
sees the lowercase hex digest. No method authenticates the caller: the host
decides who may call each one.

Time is server-sourced. The client never sends `now` or an `expiresAt`: `mint`
sends a requested `ttlMs` and the component computes `expiresAt` from its own
`Date.now()`; `validate` reads `Date.now()` inside the query.

### `mint`

```ts
declare class Tokens {
  mint(ctx: RunMutationCtx, opts?: MintOptions): Promise<MintResult>;
}
```

Generates a raw token of `tokenBytes` random bytes, hashes it with `hashAlgo`,
and stores the hash with `scope`, `resourceRef`, `revoked: false`,
`createdAt: now` and `expiresAt: now + ttl`. Returns `{ token, id }`; `token` is
the raw secret and cannot be recovered later.

- `scope` defaults to `defaultScope`; `ttlMs` defaults to `defaultTtlMs`.
- `ttl` is `ttlMs` clamped into `[MIN_TTL_MS, maxTtlMs]` server-side: below
  60 000 ms (including 0 and negative values) becomes 60 000 ms, above
  `maxTtlMs` becomes `maxTtlMs`. When `maxTtlMs` is below 60 000 ms the ceiling
  wins and the token lives `maxTtlMs`.
- A NaN or infinite `ttlMs` falls back to `defaultTtlMs`; a NaN or infinite
  `defaultTtlMs` falls back to 60 000 ms. Every token gets a finite
  `expiresAt`.

Errors: `INVALID_TOKEN_BYTES` (thrown by the client before any call),
`INVALID_SCOPE`, `INVALID_RESOURCE_REF`, `INVALID_TTL`, `INVALID_TOKEN_HASH`,
`DUPLICATE_TOKEN_HASH`. See [Errors](#errors).

### `validate`

```ts
declare class Tokens {
  validate(
    ctx: RunQueryCtx,
    rawToken: string,
    scope?: string,
  ): Promise<ValidateResult>;
}
```

Hashes `rawToken` and looks it up. Returns `{ valid: true, resourceRef? }` when
the token exists in `scope`, is not revoked and `expiresAt > now`. Returns
`{ valid: false }` when it is unknown, in another scope, revoked or expired
(`expiresAt <= now`). `resourceRef` is absent when the token was minted without
one. It never throws a coded error and changes nothing: it is a query and
cannot redeem a token.

### `revoke`

```ts
declare class Tokens {
  revoke(ctx: RunMutationCtx, rawToken: string, scope?: string): Promise<boolean>;
}
```

Sets `revoked: true`. Returns `true` only if this call moved the token from
active to revoked. Returns `false` for an unknown token, a token in another
scope, or a token already revoked. Calling it twice returns `true`, then
`false`.

- It does not check expiry: an expired token that is not yet pruned returns
  `true`. Call `validate` first when an expired token must not be redeemed.
- It runs in one transaction, so of several concurrent calls for one token
  exactly one returns `true`. To redeem once, act only on `true`.
- It takes the raw token; there is no revoke by `id`.

### `list`

```ts
declare class Tokens {
  list(ctx: RunQueryCtx, opts?: ListOptions): Promise<TokenMetadata[]>;
}
```

Returns token metadata in `scope`, filtered by `resourceRef` when given, via the
`by_scope_resource` index. Each row is
`{ id, scope, resourceRef?, revoked, expiresAt, createdAt }`, never `tokenHash`.
Revoked tokens and expired tokens not yet pruned are included.

`limit` defaults to 100. It must be a non-negative integer: an integer above
`LIST_LIMIT_MAX` (1000) is clamped to 1000, `limit: 0` returns `[]`, and NaN,
`Infinity`, fractions and negative values throw `INVALID_LIMIT`. There is no
cursor and no sign that more rows exist. Rows come in index order:
`resourceRef`, then oldest first.

### `getMetadata`

```ts
declare class Tokens {
  getMetadata(ctx: RunQueryCtx, id: string): Promise<TokenMetadata | null>;
}
```

Returns one token's metadata by its component id (from `mint` or `list`), or
`null` if the row no longer exists. Never returns `tokenHash`. The component
validates `id` as `v.id("tokens")`.

### `prune`

```ts
declare class Tokens {
  prune(ctx: RunMutationCtx, before?: number): Promise<number>;
}
```

Deletes up to `PRUNE_BATCH` (256) tokens whose `expiresAt` is before `before`
(default `Date.now()`, read by the client), revoked or not, and returns the
number deleted by this call. Call it again until it returns `0`. A `before` in
the future also deletes tokens that are still valid. Revoked tokens that have
not expired are not deleted; the [cron](#cron) removes them. A NaN `before`
throws `INVALID_BEFORE`.

## Types

### `TokensComponent`

The type of `components.tokens`: the component's mutations (`mint`, `revoke`,
`prune`) and queries (`validate`, `list`, `getMetadata`) as internal function
references. The generated [`ComponentApi`](#componentapi) has the same shape.

### `TokensOptions`

```ts
interface TokensOptions {
  defaultScope?: string; // default "global"; must not be ""
  defaultTtlMs?: number; // default 86_400_000 (24 hours)
  maxTtlMs?: number; // default 2_592_000_000 (30 days); must be > 0
  tokenBytes?: number; // default 24; must be an integer >= 1
  hashAlgo?: "SHA-256" | "SHA-512"; // default "SHA-256"
}
```

`hashAlgo` is fixed per mount. Changing it changes every digest, so existing
tokens then validate as `{ valid: false }`. `defaultTtlMs` and `maxTtlMs` are
sent with every `mint`, so each client sets its own limits.

### `MintOptions`

`{ scope?: string; resourceRef?: string; ttlMs?: number }`. `resourceRef` is an
opaque host string; omit it or pass a non-empty string.

### `ListOptions`

`{ scope?: string; resourceRef?: string; limit?: number }`. See [`list`](#list)
for `limit`.

### `MintResult`

`{ token: string; id: string }`. `token` is the raw secret, `2 * tokenBytes`
lowercase hex characters. `id` is the component-side row id.

### `ValidateResult`

`{ valid: true; resourceRef?: string } | { valid: false }`. Narrow on `valid`
before reading `resourceRef`; the `false` branch has no `resourceRef`.

### `TokenMetadata`

```ts
interface TokenMetadata {
  id: string;
  scope: string;
  resourceRef?: string;
  revoked: boolean;
  expiresAt: number; // ms since epoch
  createdAt: number; // ms since epoch
}
```

## React

### `useTokens`

```ts
import type { TokenMetadata } from "@vllnt/convex-tokens";
import type { FunctionReference } from "convex/server";

declare function useTokens(
  listRef: FunctionReference<
    "query",
    "public",
    { scope?: string; resourceRef: string },
    TokenMetadata[]
  >,
  args: { scope?: string; resourceRef: string },
): TokenMetadata[] | undefined;
```

From `@vllnt/convex-tokens/react`. Calls `useQuery(listRef, args)` from
`convex/react` and returns the rows, or `undefined` while loading. `listRef` is
your own public query that authorizes the caller and returns
`Tokens.list(...)`; the component's functions are internal and cannot be passed
directly. The hook returns metadata only, never a raw token or hash. Needs
`react` and a `ConvexProvider`.

## Other entry points

### `convex.config`

The default export of `@vllnt/convex-tokens/convex.config` is the component
definition, `defineComponent("tokens")`. Mount it with `app.use(tokens)`, or
`app.use(tokens, { name })` for several isolated mounts.

### `register`

```ts
import type { TestConvex } from "convex-test";
import type { GenericSchema, SchemaDefinition } from "convex/server";

// Source: register<TSchema extends GenericSchema>(t, name = "tokens")
declare function register<TSchema extends GenericSchema>(
  t: TestConvex<SchemaDefinition<TSchema, boolean>>,
  name?: string, // default "tokens"
): void;
```

From `@vllnt/convex-tokens/test`. Mounts the component in a `convex-test`
instance under `name` (default `"tokens"`), beside the host's own schema: the
generic `TSchema` accepts any host schema, with or without tables of its own.
Shipped as TypeScript source that uses Vite's `import.meta.glob`, so run it
under Vitest.

### `ComponentApi`

From `@vllnt/convex-tokens/_generated/component`. The Convex-generated type of
the mounted component, the same shape as `TokensComponent`. Types only.

## Schema

One table, `tokens`, reachable only through the component's functions:

| Field          | Type                  | Notes                              |
| -------------- | --------------------- | ---------------------------------- |
| `tokenHash`    | `string`              | Lowercase hex digest; never raw    |
| `scope`        | `string`              | Namespace                          |
| `resourceRef`  | `string \| undefined` | Opaque host reference              |
| `revoked`      | `boolean`             |                                    |
| `expiresAt`    | `number`              | ms since epoch, from server time   |
| `createdAt`    | `number`              | ms since epoch, from server time   |

Indexes: `by_hash` (`tokenHash`), `by_expires` (`expiresAt`),
`by_scope_resource` (`scope`, `resourceRef`), `by_revoked_created` (`revoked`,
`createdAt`).

## Cron

The component registers an internal cron, `tokens: prune expired and
stale-revoked`, every 24 hours. Each run deletes, in batches of 256 that
reschedule while a batch fills:

1. tokens whose `expiresAt` has passed, and
2. revoked tokens created more than 24 hours ago (counted from `createdAt`, not
   from revocation).

The cadence and the 24-hour retention are fixed. Call [`prune`](#prune) from
your own schedule to delete expired tokens more often.

## Errors

Invalid input throws a `ConvexError` whose `data` is `{ code, message }`.
Messages never include the token or hash. Causes and fixes are in the README's
[Errors and fixes](../README.md#errors-and-fixes) table.

| Code                   | Thrown by                      | Message                                                                     |
| ---------------------- | ------------------------------ | --------------------------------------------------------------------------- |
| `INVALID_SCOPE`        | `mint`                         | `scope must be a non-empty string.`                                         |
| `INVALID_RESOURCE_REF` | `mint`                         | `resourceRef must be omitted or a non-empty string.`                        |
| `INVALID_TTL`          | `mint`                         | `maxTtlMs must be a number greater than 0.`                                 |
| `INVALID_TOKEN_BYTES`  | `mint` (client, before a call) | `tokenBytes must be an integer >= 1.`                                       |
| `INVALID_TOKEN_HASH`   | component `mint`               | `tokenHash must be a lowercase hex digest of at least 64 characters (SHA-256 minimum). …` |
| `DUPLICATE_TOKEN_HASH` | component `mint`               | `A token with this hash already exists.`                                    |
| `INVALID_LIMIT`        | `list`                         | `limit must be a non-negative integer.`                                     |
| `INVALID_BEFORE`       | `prune`                        | `before must be a number.`                                                  |

`INVALID_TOKEN_HASH` only happens when host code calls
`components.tokens.mutations.mint` directly; `Tokens.mint` always sends a valid
digest. `DUPLICATE_TOKEN_HASH` happens when a direct call reuses a hash, or when
a small `tokenBytes` lets two random tokens collide; with the default 24 bytes
a collision is negligible.
