import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

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
