<!-- Badges -->

[![Convex Component](https://img.shields.io/badge/convex-component-EE342F.svg)](https://www.convex.dev/components)
[![npm](https://img.shields.io/npm/v/@vllnt/convex-tokens.svg)](https://www.npmjs.com/package/@vllnt/convex-tokens)
[![CI](https://github.com/vllnt/convex-tokens/actions/workflows/ci.yml/badge.svg)](https://github.com/vllnt/convex-tokens/actions/workflows/ci.yml)
[![license](https://img.shields.io/npm/l/@vllnt/convex-tokens.svg)](./LICENSE)

# @vllnt/convex-tokens

Hashed-secret token primitive with mint-once, TTL, revoke and scope, as a Convex
component — mint a secret against an opaque `resourceRef`, return the raw value
once, and store only its SHA-256 hash.

```ts
const tokens = new Tokens(components.tokens);
const { token, id } = await tokens.mint(ctx, { resourceRef }); // show `token` once
const result = await tokens.validate(ctx, rawToken); // { valid: true, resourceRef? } | { valid: false }
```

## Features

- **Mint-once** — the raw token is returned a single time and never persisted;
  only its digest rests in the component.
- **Hash-at-rest** — a leaked DB row can't be replayed; digest is `SHA-256` by
  default, `SHA-512` configurable, fixed per mount.
- **Server-sourced time** — `expiresAt` and validate-time `now` come from the
  server clock; expiry can't be spoofed.
- **TTL with clamp** — every token expires; a requested `ttlMs` is clamped
  server-side into `[MIN_TTL_MS, maxTtlMs]`.
- **Revoke** — invalidate a token before it expires, via a transition contract.
- **Scopes** — global by default, or namespace per tenant / purpose / locale.
- **Self-pruning cron + safe management surface** — sweeps expired/stale-revoked
  tokens; `list`/`getMetadata` never return the hash.

## Installation

```bash
pnpm add @vllnt/convex-tokens
```

Requires `convex@^1.45.0`; React `>=18` is optional for `./react` only. The
command installs `latest` (`0.1.0`); use `@vllnt/convex-tokens@canary` for the
current prerelease. Pin a resolved canary version for reproducible installs.

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
// convex/tokens.ts — expose only the authenticated caller's own tokens.
import { components } from "./_generated/api";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { Tokens } from "@vllnt/convex-tokens";

const tokens = new Tokens(components.tokens);

export const issue = mutation({
  args: {},
  // Show the raw token once; do not persist or log it.
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Unauthenticated");
    return tokens.mint(ctx, { resourceRef: identity.tokenIdentifier });
  },
});

export const list = query({
  args: { scope: v.optional(v.string()), resourceRef: v.string() },
  handler: async (ctx, { scope, resourceRef }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (
      !identity ||
      resourceRef !== identity.tokenIdentifier ||
      (scope !== undefined && scope !== "global")
    ) {
      throw new Error("Forbidden");
    }
    return tokens.list(ctx, { scope: "global", resourceRef });
  },
});
```

## API Reference

| Method                                        | Kind     | Result                                                      |
| --------------------------------------------- | -------- | ----------------------------------------------------------- |
| `mint(ctx, { scope?, resourceRef?, ttlMs? })` | mutation | `{ token, id }` (raw shown once; TTL clamped server-side)   |
| `validate(ctx, rawToken, scope?)`             | query    | `{ valid: true, resourceRef? } \| { valid: false }`         |
| `revoke(ctx, rawToken, scope?)`               | mutation | `boolean` (`true` = transitioned to revoked this call)      |
| `list(ctx, { scope?, resourceRef?, limit? })` | query    | `TokenMetadata[]` (never the hash; `limit` clamped to 1000) |
| `getMetadata(ctx, id)`                        | query    | `TokenMetadata \| null` (never the hash)                    |
| `prune(ctx, before?)`                         | mutation | `number` (deleted in a bounded batch)                       |

Full reference: [docs/API.md](docs/API.md) — including client options
(`defaultScope`, `defaultTtlMs`, `maxTtlMs`, `hashAlgo`, …) and the hash-guard
error code.

## React

Optional, tree-shakeable front-tooling at `@vllnt/convex-tokens/react`; `react`
is optional, but `convex` is required. **No-leak:** hooks expose only token
metadata — never a raw token or hash. Pass the host's own re-exported `list`
query ref.

```tsx
import { useTokens } from "@vllnt/convex-tokens/react";
import { api } from "./convex/_generated/api";

// Inside a React component; resourceRef is the caller's tokenIdentifier.
const tokens = useTokens(api.tokens.list, { resourceRef }); // TokenMetadata[] | undefined
```

| Hook                                          | Wraps               | Returns                                        |
| --------------------------------------------- | ------------------- | ---------------------------------------------- |
| `useTokens(listRef, { scope?, resourceRef })` | host's `list` query | `TokenMetadata[] \| undefined` (metadata only) |

## Security

- Auth-agnostic — the host resolves identity and passes an opaque `resourceRef`;
  the component never authenticates.
- Hash-at-rest — the server-side `Tokens` client generates and hashes the raw
  token (Web Crypto, SHA-256 by default) before calling the component. Only the
  digest is stored; never log or persist the returned raw secret.
- Metadata is not automatically authorized: gate `list` and `getMetadata` in the
  host, including resource and scope access. Avoid exposing a public validation
  oracle for other subjects' tokens.
- Time is server-sourced (expiry can't be forged), `validate` returns a
  discriminated union, and the management surface (`list`, `getMetadata`) never
  returns the hash.

See [docs/API.md](docs/API.md).

## Testing

```bash
pnpm test           # single run
pnpm test:coverage  # enforced 100% on covered files
```

Tests run against the real component runtime via `convex-test`
(`@edge-runtime/vm`), not mocks.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## Author

Built by [bntvllnt](https://github.com/bntvllnt) ·
[bntvllnt.com](https://bntvllnt.com) · [X @bntvllnt](https://x.com/bntvllnt)

Part of the [@vllnt](https://github.com/vllnt) Convex component fleet —
[vllnt.com](https://vllnt.com)

If this is useful, [sponsor the work](https://github.com/sponsors/bntvllnt).

## License

MIT — see [LICENSE](LICENSE).
