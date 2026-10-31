import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import schema from "./schema.js";

const modules = import.meta.glob("./**/*.ts");
const HASH = "a".repeat(64);
const LONG_TTL = 2_592_000_000;

function setup() {
  return convexTest(schema, modules);
}

async function mint(
  t: ReturnType<typeof setup>,
  tokenHash: string,
  ttlMs = 86_400_000,
) {
  return await t.mutation(api.mutations.mint, {
    tokenHash,
    scope: "global",
    ttlMs,
    defaultTtlMs: 86_400_000,
    maxTtlMs: LONG_TTL,
  });
}

describe("tokens component — cron sweep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("deletes expired tokens", async () => {
    const t = setup();
    const id = await mint(t, HASH);
    vi.setSystemTime(Date.now() + 365 * 86_400_000);
    await t.mutation(internal.mutations.pruneExpired, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(await t.query(api.queries.getMetadata, { id })).toBeNull();
  });

  test("drops stale revoked tokens but keeps fresh revoked tokens", async () => {
    const t = setup();
    const freshHash = `b${"a".repeat(63)}`;
    const staleId = await mint(t, HASH, LONG_TTL);
    await t.mutation(api.mutations.revoke, { tokenHash: HASH, scope: "global" });
    vi.setSystemTime(Date.now() + 86_400_000 + 1);
    const freshId = await mint(t, freshHash, LONG_TTL);
    await t.mutation(api.mutations.revoke, {
      tokenHash: freshHash,
      scope: "global",
    });
    await t.mutation(internal.mutations.pruneExpired, {});
    expect(await t.query(api.queries.getMetadata, { id: staleId })).toBeNull();
    expect(await t.query(api.queries.getMetadata, { id: freshId })).not.toBeNull();
  });

  test("self-reschedules until a backlog is drained", async () => {
    const t = setup();
    for (let i = 0; i < 257; i++) {
      await mint(t, i.toString(16).padStart(64, "0"));
    }
    vi.setSystemTime(Date.now() + 365 * 86_400_000);
    await t.mutation(internal.mutations.pruneExpired, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    expect(
      await t.query(api.queries.list, { scope: "global", limit: 1000 }),
    ).toHaveLength(0);
  });
});

async function codeOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return (error as { data?: { code?: unknown } }).data?.code;
  }
  return undefined;
}

describe("tokens component — input validation", () => {
  const base = {
    tokenHash: HASH,
    scope: "global",
    ttlMs: 86_400_000,
    defaultTtlMs: 86_400_000,
    maxTtlMs: LONG_TTL,
  };

  test("mint rejects an empty scope", async () => {
    const t = setup();
    const code = await codeOf(
      t.mutation(api.mutations.mint, { ...base, scope: "" }),
    );
    expect(code).toBe("INVALID_SCOPE");
  });

  test("mint rejects an empty resourceRef but accepts an omitted one", async () => {
    const t = setup();
    const code = await codeOf(
      t.mutation(api.mutations.mint, { ...base, resourceRef: "" }),
    );
    expect(code).toBe("INVALID_RESOURCE_REF");
    await expect(t.mutation(api.mutations.mint, base)).resolves.toBeTruthy();
  });

  test("mint rejects a NaN, zero or negative maxTtlMs (a NaN expiry would never lapse)", async () => {
    const t = setup();
    for (const maxTtlMs of [Number.NaN, 0, -1]) {
      const code = await codeOf(
        t.mutation(api.mutations.mint, { ...base, maxTtlMs }),
      );
      expect(code).toBe("INVALID_TTL");
    }
    expect(await t.query(api.queries.list, { scope: "global" })).toHaveLength(0);
  });

  test("mint rejects a second token with the same hash", async () => {
    const t = setup();
    await t.mutation(api.mutations.mint, base);
    const code = await codeOf(t.mutation(api.mutations.mint, base));
    expect(code).toBe("DUPLICATE_TOKEN_HASH");
    expect(await t.query(api.queries.list, { scope: "global" })).toHaveLength(1);
    // validate/revoke use `.unique()` and must keep working for that hash.
    expect(
      await t.query(api.queries.validate, { tokenHash: HASH, scope: "global" }),
    ).toEqual({ valid: true });
  });

  test("errors never echo the supplied hash", async () => {
    const t = setup();
    const secret = "s3cr3t-raw-token";
    const error = await t
      .mutation(api.mutations.mint, { ...base, tokenHash: secret })
      .catch((e: unknown) => e as Error);
    expect(String(error)).not.toContain(secret);
  });

  test("list rejects a NaN, negative or fractional limit; 0 is allowed", async () => {
    const t = setup();
    for (const limit of [Number.NaN, -1, 1.5]) {
      const code = await codeOf(
        t.query(api.queries.list, { scope: "global", limit }),
      );
      expect(code).toBe("INVALID_LIMIT");
    }
    expect(await t.query(api.queries.list, { scope: "global", limit: 0 })).toEqual(
      [],
    );
  });

  test("prune rejects a NaN `before`", async () => {
    const t = setup();
    await t.mutation(api.mutations.mint, base);
    const code = await codeOf(
      t.mutation(api.mutations.prune, { before: Number.NaN }),
    );
    expect(code).toBe("INVALID_BEFORE");
    expect(await t.query(api.queries.list, { scope: "global" })).toHaveLength(1);
  });
});

describe("tokens component — single-use redemption", () => {
  test("of many concurrent revokes of one token exactly one wins", async () => {
    const t = setup();
    await t.mutation(api.mutations.mint, {
      tokenHash: HASH,
      scope: "global",
      ttlMs: 86_400_000,
      defaultTtlMs: 86_400_000,
      maxTtlMs: LONG_TTL,
    });
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        t.mutation(api.mutations.revoke, { tokenHash: HASH, scope: "global" }),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
  });
});
