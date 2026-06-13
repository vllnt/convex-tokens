<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `example/convex/_generated/ai/guidelines.md` first** for
important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that
override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

# @vllnt/convex-tokens

Hashed-secret token primitive with mint-once, TTL, revoke and scope, as a Convex component. Follows
the vllnt Component Standard (see the `convex-components` hub `.claude/rules/component-standard.md`).

## Architecture

```
src/
├── shared.ts              # constants + hashToken / generateToken / clampTtl (pure, Web Crypto)
├── test.ts                # convex-test register() helper
├── client/
│   ├── index.ts           # Tokens client class (consumer-facing API)
│   └── types.ts           # public TypeScript interfaces
├── react/
│   └── index.tsx          # optional ./react entry — useTokens hook (metadata only, no-leak)
└── component/
    ├── mutations.ts        # all mutations (mint, revoke, prune, pruneExpired)
    ├── queries.ts          # all queries (validate, list, getMetadata)
    ├── validators.ts       # shared validators
    ├── schema.ts           # sandboxed tokens table
    └── convex.config.ts    # defineComponent("tokens")
```

## Ownership boundary

| Owns | Party |
|------|-------|
| Raw token generation + hashing (Web Crypto, SHA-256/SHA-512) | **Client** (`src/client/`) |
| Hash storage, lifecycle (revoked, expiresAt), expiry clock, TTL clamp | **Component** (`src/component/`) |
| Resource meaning, auth/authz, who may mint/validate/revoke | **Host app** |
| Identity of the subject (`resourceRef` is an opaque string) | **Host app** |
| React surface gating (who may call `list`) | **Host app** (re-exports the query under its auth) |

The component never sees the raw token, never authenticates, and never reads host tables.

## Key design decisions

- **Mint-once, hash-at-rest.** The raw token is generated and hashed client-side with Web Crypto
  before any Convex call; the component stores only the digest. A compromised database yields no
  usable token.
- **Server-sourced time.** `mint` computes `expiresAt` from the component's own `Date.now()` using
  the caller-supplied `ttlMs` (clamped into `[MIN_TTL_MS, maxTtlMs]`). `validate` also reads
  `Date.now()` internally. There is no client-supplied timestamp — expiry cannot be forged or
  extended by a client.
- **Server-side hash guard.** `mint` rejects any `tokenHash` shorter than 64 characters or
  containing non-lowercase-hex characters with `ConvexError({ code: "INVALID_TOKEN_HASH" })`. This
  hardens the component trust boundary against a misconfigured or adversarial direct caller.
- **`revoke` is a transition contract, not idempotent success.** Returns `true` only if this call
  moved the token from active → revoked; returns `false` if already revoked, wrong scope, or
  unknown. Callers distinguish "successfully revoked now" from "was already revoked".
- **`validate` returns a discriminated union.** `{ valid: true, resourceRef? }` or
  `{ valid: false }`. The failed branch structurally cannot carry `resourceRef` — narrowing on
  `result.valid` is the only safe access pattern.
- **`list` hard-caps at 1000 rows** (`LIST_LIMIT_MAX`). Values above the ceiling are silently
  clamped. Management surface never returns `tokenHash`.
- **No-leak React surface.** The `./react` entry exposes only token metadata (id, scope,
  resourceRef, revoked, expiresAt, createdAt). No hook returns a raw token or hash. Minting is
  always a host-wrapped mutation — the raw value is returned exactly once server-side and is
  intentionally absent from all reactive hooks.

## Conventions

- Mutations in `mutations.ts`, queries in `queries.ts` (enforced by `@vllnt/eslint-config/convex`).
- Explicit `args` + `returns` on every Convex function.
- Host data via typed generics / host-supplied validator keyed by an opaque ref — never `v.any()` dumps.
- 100% test coverage is BLOCKING (`vitest.config.mts` thresholds).
- Runtime deps: only official `@convex-dev/*` + `@vllnt/*`.

## Docs sync

| Changed | Update in same commit |
|---------|----------------------|
| Public API (client methods, args, returns, error codes) | README API table, `docs/API.md`, `llms.txt` + regenerate `llms-full.txt` |
| Config options / defaults | README config section, `docs/API.md` |
| Schema / tables / indexes | README Architecture, `docs/API.md` |
| `convex@` peer dep version | `llms.txt` context line, README Installation peer dep note |
| New capability / `./react` hook | README React section, `scripts/generate-llms.mjs` file list, `llms.txt` |
| Version bump | `CHANGELOG.md`, version badges |

Run `pnpm generate:llms` after any change above. Grep the old value before committing to confirm
zero stale references.
