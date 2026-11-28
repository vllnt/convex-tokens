# @vllnt/convex-tokens

TypeScript Convex component for expiring, revocable secret tokens stored only as
SHA-256 or SHA-512 hashes: mint once, validate, revoke, scope, prune.

## For coding agents

Docs for the installed version are in `node_modules/@vllnt/convex-tokens/`:
`docs/API.md`, `llms.txt`, `CHANGELOG.md` and the TypeScript `src/`. Read them
before writing code against this package.

## When to use

- Use it when a link or one-off action needs a secret that expires, such as an
  email check, a password reset or a share link, and only its hash may be kept.
- Use it when a token must be revocable before it expires.
- Use it when a token must be redeemed at most once, even under concurrent calls.
- Do not use it when customers manage long-lived keys, rotate them or need usage
  counts: use
  [`@vllnt/convex-api-keys`](https://oss.vllnt.com/packages/convex-api-keys).
- Do not use it when you need a full invite → accept flow with roles: use
  [`@vllnt/convex-invitations`](https://oss.vllnt.com/packages/convex-invitations).

## Install

```bash
pnpm add @vllnt/convex-tokens
```

## Quick start

```ts
// convex/convex.config.ts
import tokens from "@vllnt/convex-tokens/convex.config";
import { defineApp } from "convex/server";

const app = defineApp();
app.use(tokens);
export default app;
```

```ts
// convex/tokens.ts
import { Tokens } from "@vllnt/convex-tokens";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";

const tokens = new Tokens(components.tokens);

export const issue = mutation({
  args: {},
  returns: v.object({ token: v.string(), id: v.string() }),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    // `token` is the raw secret. It is returned once; do not store or log it.
    return tokens.mint(ctx, { resourceRef: user.tokenIdentifier });
  },
});

export const check = query({
  args: { token: v.string() },
  returns: v.union(
    v.object({ valid: v.literal(true), resourceRef: v.optional(v.string()) }),
    v.object({ valid: v.literal(false) }),
  ),
  handler: (ctx, { token }) => tokens.validate(ctx, token),
});
```

Run `npx convex dev` once to generate `components.tokens`. The component never
reads auth: the host decides who may mint, validate, revoke and list, and passes
an opaque `resourceRef` (here the user's `tokenIdentifier`).

## API

Full reference: [docs/API.md](docs/API.md).

| Export                                                      | Import from                                 | What it does                                                    |
| ----------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------- |
| [`Tokens`](docs/API.md#tokens)                              | `@vllnt/convex-tokens`                      | Host client: `new Tokens(components.tokens, options?)`          |
| [`mint(ctx, opts?)`](docs/API.md#mint)                      | `Tokens` method, mutation                   | Create a token; returns `{ token, id }`, raw `token` shown once |
| [`validate(ctx, rawToken, scope?)`](docs/API.md#validate)   | `Tokens` method, query                      | `{ valid: true, resourceRef? }` or `{ valid: false }`           |
| [`revoke(ctx, rawToken, scope?)`](docs/API.md#revoke)       | `Tokens` method, mutation                   | `true` only if this call moved the token to revoked             |
| [`list(ctx, opts?)`](docs/API.md#list)                      | `Tokens` method, query                      | Up to `limit` token metadata rows, never the hash               |
| [`getMetadata(ctx, id)`](docs/API.md#getmetadata)           | `Tokens` method, query                      | One token's metadata, or `null`                                 |
| [`prune(ctx, before?)`](docs/API.md#prune)                  | `Tokens` method, mutation                   | Delete up to 256 expired tokens; returns the count              |
| [`TokensComponent`](docs/API.md#tokenscomponent)            | `@vllnt/convex-tokens` (type)               | Type of `components.tokens`                                     |
| [`TokensOptions`](docs/API.md#tokensoptions)                | `@vllnt/convex-tokens` (type)               | `{ defaultScope?, defaultTtlMs?, maxTtlMs?, tokenBytes?, hashAlgo? }` |
| [`MintOptions`](docs/API.md#mintoptions)                    | `@vllnt/convex-tokens` (type)               | `{ scope?, resourceRef?, ttlMs? }`                              |
| [`ListOptions`](docs/API.md#listoptions)                    | `@vllnt/convex-tokens` (type)               | `{ scope?, resourceRef?, limit? }`                              |
| [`MintResult`](docs/API.md#mintresult)                      | `@vllnt/convex-tokens` (type)               | Result of `mint`: `{ token, id }`                               |
| [`ValidateResult`](docs/API.md#validateresult)              | `@vllnt/convex-tokens` (type)               | Result of `validate`, a union on `valid`                        |
| [`TokenMetadata`](docs/API.md#tokenmetadata)                | `@vllnt/convex-tokens` (type)               | `{ id, scope, resourceRef?, revoked, expiresAt, createdAt }`    |
| [`useTokens`](docs/API.md#usetokens)                        | `@vllnt/convex-tokens/react`                | `useTokens(listRef, args)`: hook over your own `list` query     |
| [`default` (component config)](docs/API.md#convexconfig)    | `@vllnt/convex-tokens/convex.config`        | Pass to `app.use(...)`                                          |
| [`register`](docs/API.md#register)                          | `@vllnt/convex-tokens/test`                 | Mount the component in `convex-test`                            |
| [`ComponentApi`](docs/API.md#componentapi)                  | `@vllnt/convex-tokens/_generated/component` | Generated type of the mounted component                         |

## Common tasks

Redeem a token once. `validate` rejects an expired token; `revoke` returns
`true` to exactly one caller, so two concurrent redeems cannot both succeed.

```ts
// convex/redeem.ts
import { Tokens } from "@vllnt/convex-tokens";
import { v } from "convex/values";

import { components } from "./_generated/api";
import { mutation } from "./_generated/server";

const tokens = new Tokens(components.tokens);

export const redeem = mutation({
  args: { token: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, { token }) => {
    const result = await tokens.validate(ctx, token);
    if (!result.valid) return null;
    const first = await tokens.revoke(ctx, token);
    if (!first) return null;
    return result.resourceRef ?? null;
  },
});
```

Use a scope and a custom lifetime for one kind of token, and list the signed-in
user's tokens of that kind. `list` returns metadata only, revoked and expired
rows included.

```ts
// convex/resets.ts
import { Tokens } from "@vllnt/convex-tokens";
import { ConvexError, v } from "convex/values";

import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";

const resets = new Tokens(components.tokens, {
  defaultScope: "password-reset",
  defaultTtlMs: 15 * 60_000,
  maxTtlMs: 60 * 60_000,
});

export const createReset = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null) throw new ConvexError("not signed in");
    const { token } = await resets.mint(ctx, {
      resourceRef: user.tokenIdentifier,
      ttlMs: 30 * 60_000,
    });
    return token;
  },
});

const metadata = v.object({
  id: v.string(),
  scope: v.string(),
  resourceRef: v.optional(v.string()),
  revoked: v.boolean(),
  expiresAt: v.number(),
  createdAt: v.number(),
});

export const myTokens = query({
  args: { scope: v.optional(v.string()), resourceRef: v.string() },
  returns: v.array(metadata),
  handler: async (ctx, { scope, resourceRef }) => {
    const user = await ctx.auth.getUserIdentity();
    if (user === null || user.tokenIdentifier !== resourceRef) {
      throw new ConvexError("forbidden");
    }
    return resets.list(ctx, { scope, resourceRef, limit: 50 });
  },
});
```

Show those tokens in React. `useTokens` takes your own query reference and never
returns a raw token or a hash.

```tsx
// src/ResetLinks.tsx
import { useTokens } from "@vllnt/convex-tokens/react";

import { api } from "../convex/_generated/api";

export function ResetLinks({ userRef }: { userRef: string }) {
  const rows = useTokens(api.resets.myTokens, { resourceRef: userRef });
  if (rows === undefined) return <p>Loading</p>;
  return (
    <ul>
      {rows.map((row) => (
        <li key={row.id}>
          {row.revoked ? "used" : new Date(row.expiresAt).toISOString()}
        </li>
      ))}
    </ul>
  );
}
```

Prune expired tokens more often than the built-in daily sweep. One `prune` call
deletes at most 256 rows, so this function reschedules itself until it deletes
none.

```ts
// convex/maintenance.ts
import { Tokens } from "@vllnt/convex-tokens";
import { v } from "convex/values";

import { components, internal } from "./_generated/api";
import { internalMutation } from "./_generated/server";

const tokens = new Tokens(components.tokens);

export const pruneTokens = internalMutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const deleted = await tokens.prune(ctx);
    if (deleted > 0) {
      await ctx.scheduler.runAfter(0, internal.maintenance.pruneTokens, {});
    }
    return null;
  },
});
```

## Errors and fixes

Invalid input throws a `ConvexError` whose `data` is `{ code, message }`. Catch
it in the host with `error instanceof ConvexError` and read `error.data.code`.

| Code                   | Thrown by                  | Cause                                                                                   | Fix                                                                                    |
| ---------------------- | -------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `INVALID_SCOPE`        | `mint`                     | `scope` (or the client's `defaultScope`) is `""`                                        | Pass a non-empty scope, or omit it to use `defaultScope` (default `"global"`)          |
| `INVALID_RESOURCE_REF` | `mint`                     | `resourceRef` is `""`                                                                   | Pass a non-empty `resourceRef`, or omit it                                             |
| `INVALID_TTL`          | `mint`                     | The client's `maxTtlMs` is NaN, zero or negative                                        | Set `maxTtlMs` to a number greater than 0, or omit it (default 30 days)                |
| `INVALID_TOKEN_BYTES`  | `mint` (client, no call)   | The client's `tokenBytes` is not an integer of at least 1                               | Set `tokenBytes` to a positive integer, or omit it (default 24)                        |
| `INVALID_TOKEN_HASH`   | component `mint`           | A direct caller sent a `tokenHash` that is not lowercase hex of at least 64 characters  | Mint through `Tokens.mint`, which generates and hashes the token                       |
| `DUPLICATE_TOKEN_HASH` | component `mint`           | A direct caller reused a hash, or a small `tokenBytes` made two random tokens collide   | Mint through `Tokens.mint` and keep `tokenBytes` at 24 or more                         |
| `INVALID_LIMIT`        | `list`                     | `limit` is negative or not an integer (NaN, `Infinity`, `1.5`)                          | Pass an integer from 0; values above 1000 are clamped to 1000                          |
| `INVALID_BEFORE`       | `prune`                    | `before` is NaN                                                                         | Pass a timestamp in milliseconds, or omit it to use `Date.now()`                       |

Arguments of the wrong type (for example a string `ttlMs`) are rejected by
Convex argument validation before the component runs. `validate`, `revoke` and
`getMetadata` never throw a coded error: an unknown, wrong-scope, revoked or
expired token gives `{ valid: false }`, `false` or `null`.

## Limits and gotchas

The constants named below (`MIN_TTL_MS`, `LIST_LIMIT_MAX`, `PRUNE_BATCH`) are
not exported from any entry point; their values are given here.

- TTL: `ttlMs` defaults to `defaultTtlMs` (24 hours) and is clamped server-side
  into `[MIN_TTL_MS, maxTtlMs]`. `MIN_TTL_MS` is 60 000 ms; `maxTtlMs` defaults
  to 30 days. The ceiling wins when `maxTtlMs` is lower than 60 000 ms.
- A `ttlMs` of 0 or below becomes 60 000 ms without an error. A NaN or infinite
  `ttlMs` falls back to `defaultTtlMs`. Every token expires; there is no way to
  extend or refresh one.
- `defaultTtlMs` and `maxTtlMs` are sent by the client on each `mint`, so two
  `Tokens` clients on one mount can use different limits.
- `list` returns at most `limit` rows (default 100). An integer above
  `LIST_LIMIT_MAX` (1000) is clamped to 1000 without an error. A non-integer
  limit, including `Infinity`, throws `INVALID_LIMIT`. There is no cursor and
  nothing tells you more rows exist.
- `list` includes revoked tokens and expired tokens not yet pruned. Check
  `revoked` and `expiresAt` yourself.
- `prune` deletes at most `PRUNE_BATCH` (256) rows per call. It deletes tokens
  whose `expiresAt` is before `before`; a `before` in the future also deletes
  tokens that are still valid. It does not delete revoked tokens that have not
  expired.
- The component's daily cron deletes expired tokens and revoked tokens created
  more than 24 hours ago. That retention is fixed and counts from `createdAt`,
  not from revocation. The cron cadence (24 hours) cannot be changed.
- `hashAlgo` (`"SHA-256"` or `"SHA-512"`) is fixed per mount. Changing it makes
  every existing token validate as `{ valid: false }`, with no error.
- `revoke` does not check expiry: it returns `true` for an expired token that
  is not yet pruned. Call `validate` first when that matters.
- `revoke` takes the raw token. There is no revoke by `id`, so `list` and
  `getMetadata` results cannot be used to revoke.
- `validate` is a query, so it cannot redeem a token. Use `revoke` in a
  mutation for single use.
- A wrong scope raises no error: `validate` returns `{ valid: false }`, `revoke`
  returns `false` and `list` returns no rows.
- `getMetadata` takes an id validated as `v.id("tokens")`; pass an id from
  `mint` or `list`.
- The raw token is `2 * tokenBytes` lowercase hex characters (48 by default).

## Compatibility

- Peer dependencies: `convex@^1.45.0`, and `react@>=18` (optional, needed only
  for `@vllnt/convex-tokens/react`). CI runs the unit tests on the locked convex
  version (1.51.0). It installs the packed package with convex 1.45.0 and React
  18.3.1, imports every entry point, type-checks every README example and runs
  the Testing example.
- ES modules only. `package.json` declares Node.js `>=18`, but convex 1.45 to
  1.48 require Node.js 20 and convex 1.49 or later require Node.js 22.
- `validate`, `list` and `getMetadata` run in Convex queries, mutations and
  actions. `mint`, `revoke` and `prune` call `runMutation`, so they need a
  mutation or an action. The client uses the Web Crypto globals `crypto.subtle`
  and `crypto.getRandomValues`.
- `@vllnt/convex-tokens/test` needs `convex-test`, `vitest`, `vite` and
  `@edge-runtime/vm`, with the Vitest config shown under Testing.

## Testing

Mount the component in your own `convex-test` suite with
`register(t, name = "tokens")`. Use the Vitest settings `convex-test`
recommends (edge runtime, `convex-test` inlined), and add `vite` as a direct dev
dependency: `register` uses Vite's `import.meta.glob`.

```ts
// vitest.config.mts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "edge-runtime",
    server: { deps: { inline: ["convex-test"] } },
  },
});
```

```ts
// convex/tokens.test.ts
/// <reference types="vite/client" />
import { register } from "@vllnt/convex-tokens/test";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";

import { api } from "./_generated/api";
import schema from "./schema";

test("an issued token validates and redeems once", async () => {
  const t = convexTest(schema, import.meta.glob("./**/*.ts"));
  register(t);
  const user = t.withIdentity({ tokenIdentifier: "user-1" });
  const { token } = await user.mutation(api.tokens.issue, {});
  expect(await t.query(api.tokens.check, { token })).toEqual({
    valid: true,
    resourceRef: "user-1",
  });
  expect(await t.mutation(api.redeem.redeem, { token })).toBe("user-1");
  expect(await t.mutation(api.redeem.redeem, { token })).toBeNull();
});
```

Pass the mount name as the second argument when you used
`app.use(tokens, { name })`.

This repository's own tests use the simulated `convex-test` runtime
(`pnpm test:coverage`, 100% coverage enforced). `pnpm test:package` installs
the packed tarball, checks these docs, type-checks every README example against
it and runs the Testing example.

## Security

- The component does not authenticate. The host must authorize every call,
  derive `resourceRef` and scope itself, and gate `list` and `getMetadata`.
- Only the hash is stored. The `Tokens` client generates the raw token and
  hashes it before calling the component; `mint` returns the raw token once.
  Never store or log it.
- Expiry uses the component's clock. The client sends a requested `ttlMs`,
  never a timestamp, and `validate` reads `Date.now()` inside the query.
- `list`, `getMetadata` and `useTokens` never return the hash or the raw token.
- Do not expose a public `validate` for tokens that belong to other users.

Report vulnerabilities as described in
[SECURITY.md](https://github.com/vllnt/convex-tokens/blob/main/SECURITY.md).

## Related packages

None. No other @vllnt package depends on this one, and it depends on none.

## Contributing

See
[CONTRIBUTING.md](https://github.com/vllnt/convex-tokens/blob/main/CONTRIBUTING.md).

## Links

- Docs and changelog: [oss.vllnt.com/packages/convex-tokens](https://oss.vllnt.com/packages/convex-tokens) · [release feed](https://oss.vllnt.com/packages/convex-tokens/rss.xml)
- All @vllnt packages: [oss.vllnt.com](https://oss.vllnt.com) · [search packages and docs on index.vllnt.com](https://index.vllnt.com)
- Source and issues: [GitHub](https://github.com/vllnt/convex-tokens) · [issues](https://github.com/vllnt/convex-tokens/issues) · [npm](https://www.npmjs.com/package/@vllnt/convex-tokens)
- Questions and updates: [Discord](https://bntvllnt.com/discord) · [X @bntvllnt](https://x.com/bntvllnt)
- Company and author: [vllnt.com](https://vllnt.com) · [bntvllnt.com](https://bntvllnt.com) · [GitHub @bntvllnt](https://github.com/bntvllnt) · [LinkedIn](https://linkedin.com/in/bntvllnt)
- Sponsor: [GitHub Sponsors](https://github.com/sponsors/bntvllnt)

## License

MIT. See [LICENSE](LICENSE).

[![npm version of @vllnt/convex-tokens](https://img.shields.io/npm/v/@vllnt/convex-tokens.svg)](https://www.npmjs.com/package/@vllnt/convex-tokens)
[![CI status](https://github.com/vllnt/convex-tokens/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-tokens/actions/workflows/ci.yml)

---

Part of [vllnt open source](https://oss.vllnt.com) · [Package page](https://oss.vllnt.com/packages/convex-tokens) · [vllnt.com](https://vllnt.com) · Built by [bntvllnt](https://bntvllnt.com)
