/**
 * Optional, tree-shakeable React front-tooling for `@vllnt/convex-tokens`.
 *
 * Thin reactive hook over `useQuery` from `convex/react`. It takes the HOST's
 * re-exported `list` query reference plus its args — the component never imports
 * the host `api`. `react` and `convex/react` are optional peer deps: a
 * backend-only consumer pulls none of this code.
 *
 * NO-LEAK CONTRACT: this layer exposes ONLY non-secret token METADATA (id,
 * scope, resourceRef, revoked, expiresAt, createdAt). It NEVER surfaces a raw
 * token or its hash. Minting returns the raw secret exactly once, from the
 * server-side `mint` mutation the host wraps — that mint-once raw value must
 * never be persisted or logged, and it is intentionally NOT exposed by any hook
 * here.
 */

import type { FunctionReference } from "convex/server";
import { useQuery } from "convex/react";
import type { TokenMetadata } from "../client/types.js";

/**
 * Reactive list of token METADATA for a management surface, scoped by an opaque
 * host `resourceRef` (and an optional namespace). Wraps the `list` query's
 * leak-free projection — never the hash, never a raw token.
 *
 * @param listRef - The host's re-exported `tokens.list` query reference.
 * @param args - `{ scope?, resourceRef }`: optional namespace + the opaque
 *   host-owned reference to list tokens for.
 * @returns The token metadata array, or `undefined` while the query loads.
 */
export function useTokens(
  listRef: FunctionReference<
    "query",
    "public",
    { scope?: string; resourceRef: string },
    TokenMetadata[]
  >,
  args: { scope?: string; resourceRef: string },
): TokenMetadata[] | undefined {
  return useQuery(listRef, args);
}
