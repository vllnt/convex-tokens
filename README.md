<!-- Badges -->
[![Convex Component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-tokens.svg)](https://www.npmjs.com/package/@vllnt/convex-tokens)
[![CI](https://github.com/vllnt/convex-tokens/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-tokens/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-tokens.svg)](./LICENSE)

# @vllnt/convex-tokens

Hashed-secret token primitive with mint-once, TTL, revoke and scope, as a Convex
component.

Mint a secret token against an opaque `resourceRef`, return the raw value
**exactly once**, and store only its SHA-256 hash. Validate, revoke, and prune
expired tokens — all within a scope. Domain-neutral: SaaS API keys, preview
links, game invites, password-reset / email-verification tokens — one mechanism.
The host owns the resource, auth, and meaning; this component owns only the
hash, the lifecycle, and the expiry.

## Features

- **Mint-once** — the raw token is returned a single time and never persisted; only its digest rests in the component.
- **Hash-at-rest** — a leaked database row cannot be replayed as a token; the raw secret never reaches the component. Digest is `SHA-256` by default, `SHA-512` configurable, fixed per mount.
- **Server-sourced time** — the component computes `expiresAt` from its own clock and reads `Date.now()` inside `validate`; the client never sends a timestamp, so expiry cannot be spoofed.
- **TTL with clamp** — every token expires; a requested `ttlMs` is clamped **server-side** into `[MIN_TTL_MS, maxTtlMs]`, and a non-finite `ttlMs` falls back to the default (no non-expiring tokens).
- **Revoke** — invalidate a token before it expires.
- **Scopes** — global by default, or namespace per tenant / purpose / locale.
- **Self-pruning** — a built-in daily cron sweeps expired tokens **and** stale-revoked ones (past a retention window) in bounded, self-rescheduling batches; `prune` is also callable directly.
- **Safe management surface** — `list` / `getMetadata` return token metadata (id, scope, ref, revoked, expiry) and **never** the hash, so a future admin UI has a no-leak read API.
- **Opaque refs** — `resourceRef` is an arbitrary host string; the component never inspects it.

## Architecture

```
src/
├── shared.ts              # constants + hashToken / generateToken / clampTtl (pure, Web Crypto)
├── test.ts                # convex-test register() helper
├── client/                # Tokens class (the public API; hashes before sending)
└── component/             # schema (tokens) + mutations + queries + crons (sandboxed tables)
```

Sandboxed table: `tokens {tokenHash, scope, resourceRef?, revoked, expiresAt,
createdAt}`, indexed by hash, by expiry, by `(scope, resourceRef)`, and by
`(revoked, createdAt)`. The client hashes the raw secret with Web Crypto before
any call — the component sees only the hash. The component owns its clock
(`expiresAt` and validate-time `now` are server-side) and a daily prune cron.

## Installation

```bash
pnpm add @vllnt/convex-tokens
```

Peer dependency: `convex@^1.41.0`.

## Usage

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import tokens from "@vllnt/convex-tokens/convex.config";

const app = defineApp();
app.use(tokens);
export default app;
```

```ts
// convex/api-keys.ts — host owns auth; pass an opaque resourceRef in.
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Tokens } from "@vllnt/convex-tokens";

const tokens = new Tokens(components.tokens);

export const issue = mutation({
  args: { userId: v.string() },
  // returns { token, id }; show `token` to the user once — it is never recoverable.
  handler: (ctx, { userId }) => tokens.mint(ctx, { resourceRef: userId }),
});

export const check = query({
  args: { token: v.string() },
  handler: (ctx, { token }) => tokens.validate(ctx, token),
});
```

## API Reference

See [docs/API.md](docs/API.md). Summary:

| Method | Kind | Result |
|--------|------|--------|
| `mint(ctx, { scope?, resourceRef?, ttlMs? })` | mutation | `{ token, id }` (raw token shown once; TTL clamped server-side; hash guard rejects invalid digests) |
| `validate(ctx, rawToken, scope?)` | query | `{ valid: true, resourceRef? } \| { valid: false }` (discriminated union; expiry from server clock) |
| `revoke(ctx, rawToken, scope?)` | mutation | `boolean` (`true` = transitioned to revoked this call; `false` = already revoked, wrong scope, or unknown) |
| `list(ctx, { scope?, resourceRef?, limit? })` | query | `TokenMetadata[]` (metadata only — never the hash; `limit` clamped to 1000) |
| `getMetadata(ctx, id)` | query | `TokenMetadata \| null` (metadata only — never the hash) |
| `prune(ctx, before?)` | mutation | `number` (tokens deleted in a bounded batch) |

Client options: `new Tokens(component, { defaultScope = "global", defaultTtlMs = 86_400_000, maxTtlMs = 2_592_000_000, tokenBytes = 24, hashAlgo = "SHA-256" })`.

## React

Optional, tree-shakeable front-tooling via the `./react` entry. `react` and
`convex/react` are **optional** peer deps — a backend-only consumer pulls none
of this code.

**No-leak contract:** the React layer exposes ONLY non-secret token METADATA
(id, scope, resourceRef, revoked, expiresAt, createdAt). There is **no** hook
that returns a raw token or its hash, and no reactive secret. Minting still
returns the raw value exactly once from the server-side `mint` mutation the host
wraps — never persist or log it; it is intentionally not surfaced by any hook.

```tsx
// The host re-exports the component's list query under its own auth.
import { useTokens } from "@vllnt/convex-tokens/react";
import { api } from "./convex/_generated/api";

function TokenList({ resourceRef }: { resourceRef: string }) {
  // Pass the HOST's re-exported ref — the component never owns your `api`.
  const tokens = useTokens(api.apiKeys.list, { resourceRef });
  if (tokens === undefined) return <p>Loading…</p>;
  return (
    <ul>
      {tokens.map((t) => (
        <li key={t.id}>
          {t.scope} · {t.revoked ? "revoked" : "active"} · expires{" "}
          {new Date(t.expiresAt).toISOString()}
        </li>
      ))}
    </ul>
  );
}
```

| Hook | Wraps | Returns |
| --- | --- | --- |
| `useTokens(listRef, { scope?, resourceRef })` | host's `list` query | `TokenMetadata[] \| undefined` (metadata only — never the hash) |

## Security Model

The component is **auth-agnostic**: it never authenticates or authorizes. The
host resolves identity, decides whether a caller may mint or validate a token,
and passes an opaque `resourceRef`. The raw token is generated and hashed
**client-side** with Web Crypto (SHA-256 by default, SHA-512 configurable) — only
the digest is sent to and stored by the component, so a compromised component
database cannot yield usable tokens.

**Time is server-sourced, not client-trusted.** `mint` sends a requested `ttlMs`
and the component computes `expiresAt` from its own clock; `validate` reads
`Date.now()` inside the query. There is no `now` or `expiresAt` argument a caller
could forge, so an expired token cannot be revived. A non-finite `ttlMs` falls
back to the default — a malformed request can never mint a non-expiring token.

**Server-side hash guard.** The `mint` mutation validates the `tokenHash` it
receives: a string shorter than 64 characters or containing non-lowercase-hex
characters is rejected with `ConvexError({ code: "INVALID_TOKEN_HASH" })`. This
guards the component trust boundary against a misconfigured or adversarial direct
caller; the client's `hashToken` always produces a compliant digest.

**`validate` return is a discriminated union.** `{ valid: false }` structurally
cannot carry `resourceRef` — the failed branch has no such key. Use `result.valid`
to narrow the type: if `true`, `result.resourceRef` is available; if `false`, the
result object has only the `valid` key.

**`revoke` uses the transition contract.** `revoke` returns `true` only if this
call transitioned a token from active to revoked. A second call returns `false`
(already revoked). This lets callers distinguish "successfully revoked now" from
"was already revoked before this call". Use `getMetadata` to inspect state without
side effects.

The **management surface** (`list`, `getMetadata`) projects only non-secret
metadata — never `tokenHash` — so an admin UI can enumerate and inspect tokens
without ever touching a value that could reconstruct a hash. The `list` query
caps results at **1000 rows** regardless of the `limit` argument.

Component tables are sandboxed; the host reaches them only through the exported
functions. `resourceRef` and `scope` are opaque strings the component never
inspects. A built-in cron prunes expired and stale-revoked tokens so secrets do
not outlive their purpose.

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests run against the real component runtime via `convex-test` (`@edge-runtime/vm`), not mocks.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) · [bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet — [vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
