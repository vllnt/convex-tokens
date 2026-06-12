// @vitest-environment jsdom

/**
 * Tests for the optional `./react` front-tooling layer.
 *
 * Runs under jsdom (per-file pragma above; the global vitest env is
 * edge-runtime). `convex/react` is mocked so `useTokens` is exercised in
 * isolation — we assert it is a thin pass-through to `useQuery` and that its
 * returned METADATA carries no secret/hash field (the no-leak contract).
 */

import { renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { FunctionReference } from "convex/server";
import { useQuery } from "convex/react";
import { useTokens } from "./index.js";
import type { TokenMetadata } from "../client/types.js";

vi.mock("convex/react", () => ({ useQuery: vi.fn() }));

const useQueryMock = vi.mocked(useQuery);

type ListRef = FunctionReference<
  "query",
  "public",
  { scope?: string; resourceRef: string },
  TokenMetadata[]
>;

const listRef = "tokens.list" as unknown as ListRef;

function makeMetadata(): TokenMetadata {
  return {
    id: "tok_1",
    scope: "global",
    resourceRef: "user_1",
    revoked: false,
    expiresAt: 1_700_000_000_000,
    createdAt: 1_699_000_000_000,
  };
}

describe("useTokens", () => {
  test("forwards the host list ref and args to useQuery, returns its data", () => {
    const data = [makeMetadata()];
    useQueryMock.mockReturnValue(data);

    const args = { scope: "global", resourceRef: "user_1" };
    const { result } = renderHook(() => useTokens(listRef, args));

    expect(useQueryMock).toHaveBeenCalledTimes(1);
    expect(useQueryMock).toHaveBeenCalledWith(listRef, args);
    expect(result.current).toBe(data);
  });

  test("returns undefined while the query loads", () => {
    useQueryMock.mockReturnValue(undefined);

    const { result } = renderHook(() =>
      useTokens(listRef, { resourceRef: "user_1" }),
    );

    expect(result.current).toBeUndefined();
  });

  test("returned metadata exposes no raw token or hash (no-leak contract)", () => {
    const item = makeMetadata();
    useQueryMock.mockReturnValue([item]);

    const { result } = renderHook(() =>
      useTokens(listRef, { resourceRef: "user_1" }),
    );

    const got = result.current?.[0];
    expect(got).toBeDefined();
    const keys = Object.keys(got as object);
    expect(keys).not.toContain("tokenHash");
    expect(keys).not.toContain("hash");
    expect(keys).not.toContain("token");
    expect(keys).not.toContain("rawToken");
    expect(keys).not.toContain("secret");
    expect(keys.sort()).toEqual(
      ["createdAt", "expiresAt", "id", "resourceRef", "revoked", "scope"].sort(),
    );
  });
});
