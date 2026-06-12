/* eslint-disable */
/**
 * Generated `ComponentApi` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type { FunctionReference } from "convex/server";

/**
 * A utility for referencing a Convex component's exposed API.
 *
 * Useful when expecting a parameter like `components.myComponent`.
 * Usage:
 * ```ts
 * async function myFunction(ctx: QueryCtx, component: ComponentApi) {
 *   return ctx.runQuery(component.someFile.someQuery, { ...args });
 * }
 * ```
 */
export type ComponentApi<Name extends string | undefined = string | undefined> =
  {
    mutations: {
      mint: FunctionReference<
        "mutation",
        "internal",
        {
          defaultTtlMs: number;
          maxTtlMs: number;
          resourceRef?: string;
          scope: string;
          tokenHash: string;
          ttlMs: number;
        },
        string,
        Name
      >;
      prune: FunctionReference<
        "mutation",
        "internal",
        { before: number },
        number,
        Name
      >;
      revoke: FunctionReference<
        "mutation",
        "internal",
        { scope: string; tokenHash: string },
        boolean,
        Name
      >;
    };
    queries: {
      getMetadata: FunctionReference<
        "query",
        "internal",
        { id: string },
        {
          createdAt: number;
          expiresAt: number;
          id: string;
          resourceRef?: string;
          revoked: boolean;
          scope: string;
        } | null,
        Name
      >;
      list: FunctionReference<
        "query",
        "internal",
        { limit?: number; resourceRef?: string; scope: string },
        Array<{
          createdAt: number;
          expiresAt: number;
          id: string;
          resourceRef?: string;
          revoked: boolean;
          scope: string;
        }>,
        Name
      >;
      validate: FunctionReference<
        "query",
        "internal",
        { scope: string; tokenHash: string },
        { resourceRef?: string; valid: boolean },
        Name
      >;
    };
  };
