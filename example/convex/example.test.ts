import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
import { register } from "../../src/test";

const modules = import.meta.glob("./**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  register(t);
  return t;
}

describe("tokens — mint / validate", () => {
  test("mint then validate is valid, carrying resourceRef (happy path)", async () => {
    const t = setup();
    const { token, id } = await t.mutation(api.example.mint, {
      resourceRef: "user_1",
    });
    expect(token).toMatch(/^[0-9a-f]+$/);
    expect(id).toBeTruthy();
    expect(await t.query(api.example.validate, { token })).toEqual({
      valid: true,
      resourceRef: "user_1",
    });
  });

  test("mint without a resourceRef validates with no ref", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.mint, {});
    expect(await t.query(api.example.validate, { token })).toEqual({
      valid: true,
    });
  });

  test("an unknown / wrong token is invalid", async () => {
    const t = setup();
    await t.mutation(api.example.mint, { resourceRef: "u" });
    expect(
      await t.query(api.example.validate, { token: "deadbeef" }),
    ).toEqual({ valid: false });
  });

  test("validating under the wrong scope is invalid (adversarial)", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.mint, {
      scope: "siteA",
      resourceRef: "g1",
    });
    expect(
      await t.query(api.example.validate, { token, scope: "siteA" }),
    ).toEqual({ valid: true, resourceRef: "g1" });
    expect(
      await t.query(api.example.validate, { token, scope: "siteB" }),
    ).toEqual({ valid: false });
  });
});

describe("tokens — server-sourced expiry (SECURITY)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("an expired token fails through the real client.validate — no `now` override exists", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.mint, {
      resourceRef: "u",
      ttlMs: 60_000, // clamps to MIN_TTL_MS = 60s
    });
    // still valid at mint time
    expect(await t.query(api.example.validate, { token })).toEqual({
      valid: true,
      resourceRef: "u",
    });
    // advance the server clock past expiry — validate reads Date.now() itself
    vi.setSystemTime(Date.now() + 10 * 60_000);
    expect(await t.query(api.example.validate, { token })).toEqual({
      valid: false,
    });
  });

  test("a NaN ttlMs falls back to a finite default expiry (cannot mint a non-expiring token)", async () => {
    const t = setup();
    const { token, id } = await t.mutation(api.example.mint, {
      resourceRef: "n",
      ttlMs: Number.NaN,
    });
    const meta = await t.query(api.example.getMetadata, { id });
    expect(meta).not.toBeNull();
    // expiresAt is finite and exactly default TTL (24h) ahead of mint
    expect(Number.isFinite(meta!.expiresAt)).toBe(true);
    expect(meta!.expiresAt - meta!.createdAt).toBe(86_400_000);
    // and it still validates now, then expires once the clock passes it
    expect(await t.query(api.example.validate, { token })).toEqual({
      valid: true,
      resourceRef: "n",
    });
    vi.setSystemTime(meta!.expiresAt + 1);
    expect(await t.query(api.example.validate, { token })).toEqual({
      valid: false,
    });
  });

  test("an Infinity ttlMs is also clamped to a finite default expiry", async () => {
    const t = setup();
    const { id } = await t.mutation(api.example.mint, {
      ttlMs: Number.POSITIVE_INFINITY,
    });
    const meta = await t.query(api.example.getMetadata, { id });
    expect(meta!.expiresAt - meta!.createdAt).toBe(86_400_000);
  });

  test("a huge ttlMs is clamped down to maxTtlMs (30d)", async () => {
    const t = setup();
    const { id } = await t.mutation(api.example.mint, {
      ttlMs: 10 * 365 * 86_400_000,
    });
    const meta = await t.query(api.example.getMetadata, { id });
    expect(meta!.expiresAt - meta!.createdAt).toBe(2_592_000_000);
  });
});

describe("tokens — revoke", () => {
  test("revoking a minted token makes it invalid; revoke returns true", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.mint, {
      resourceRef: "x",
    });
    expect(await t.mutation(api.example.revoke, { token })).toBe(true);
    expect(await t.query(api.example.validate, { token })).toEqual({
      valid: false,
    });
  });

  test("revoking an unknown token returns false", async () => {
    const t = setup();
    expect(await t.mutation(api.example.revoke, { token: "nope" })).toBe(false);
  });

  test("revoking under the wrong scope returns false (adversarial)", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.mint, {
      scope: "siteA",
      resourceRef: "g",
    });
    expect(
      await t.mutation(api.example.revoke, { token, scope: "siteB" }),
    ).toBe(false);
  });
});

describe("tokens — list / getMetadata (safe management surface)", () => {
  test("list returns metadata WITHOUT tokenHash", async () => {
    const t = setup();
    await t.mutation(api.example.mint, { resourceRef: "a" });
    await t.mutation(api.example.mint, { resourceRef: "b" });
    const rows = await t.query(api.example.list, {});
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).not.toHaveProperty("tokenHash");
      expect(Object.keys(row).sort()).toEqual([
        "createdAt",
        "expiresAt",
        "id",
        "resourceRef",
        "revoked",
        "scope",
      ]);
      expect(row.revoked).toBe(false);
    }
  });

  test("list filters by resourceRef and reflects revocation", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.mint, { resourceRef: "a" });
    await t.mutation(api.example.mint, { resourceRef: "b" });
    const onlyA = await t.query(api.example.list, { resourceRef: "a" });
    expect(onlyA).toHaveLength(1);
    expect(onlyA[0].resourceRef).toBe("a");
    await t.mutation(api.example.revoke, { token });
    const afterRevoke = await t.query(api.example.list, { resourceRef: "a" });
    expect(afterRevoke[0].revoked).toBe(true);
  });

  test("list honours an explicit limit", async () => {
    const t = setup();
    await t.mutation(api.example.mint, { resourceRef: "a" });
    await t.mutation(api.example.mint, { resourceRef: "a" });
    expect(await t.query(api.example.list, { resourceRef: "a", limit: 1 })).toHaveLength(1);
  });

  test("getMetadata returns one row without tokenHash, null for unknown id", async () => {
    const t = setup();
    const { id } = await t.mutation(api.example.mint, { resourceRef: "z" });
    const meta = await t.query(api.example.getMetadata, { id });
    expect(meta).not.toBeNull();
    expect(meta).not.toHaveProperty("tokenHash");
    expect(meta!.resourceRef).toBe("z");
    // a syntactically valid but absent id → null
    await t.mutation(api.example.prune, { before: Date.now() + 365 * 86_400_000 });
    expect(await t.query(api.example.getMetadata, { id })).toBeNull();
  });
});

describe("tokens — prune", () => {
  test("prune deletes expired tokens and returns the count", async () => {
    const t = setup();
    await t.mutation(api.example.mint, { resourceRef: "a" });
    await t.mutation(api.example.mint, { resourceRef: "b" });
    // nothing expired yet (TTL >= 60s) → default prune (before = now) removes 0
    expect(await t.mutation(api.example.pruneDefault, {})).toBe(0);
    // prune with a far-future cutoff removes everything
    const future = Date.now() + 365 * 86_400_000;
    expect(await t.mutation(api.example.prune, { before: future })).toBe(2);
    // all gone
    expect(await t.mutation(api.example.prune, { before: future })).toBe(0);
  });
});

describe("tokens — cron sweep (pruneExpired)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("sweep deletes expired tokens", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.mint, { resourceRef: "a" });
    // advance past expiry, then sweep
    vi.setSystemTime(Date.now() + 365 * 86_400_000);
    await t.mutation(api.example.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // token is gone → invalid and not listed
    expect(await t.query(api.example.validate, { token })).toEqual({
      valid: false,
    });
    expect(await t.query(api.example.list, {})).toHaveLength(0);
  });

  test("sweep drops a stale-revoked token before its TTL elapses", async () => {
    const t = setup();
    // long-lived token, revoked immediately
    const { token, id } = await t.mutation(api.example.mint, {
      resourceRef: "r",
      ttlMs: 2_592_000_000, // 30d, far from expiry
    });
    await t.mutation(api.example.revoke, { token });
    // still present (revoked) right after revocation
    expect(await t.query(api.example.getMetadata, { id })).not.toBeNull();
    // advance just past the 24h revoked-retention window, then sweep
    vi.setSystemTime(Date.now() + 86_400_000 + 1);
    await t.mutation(api.example.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // the stale-revoked row is gone even though its TTL has not elapsed
    expect(await t.query(api.example.getMetadata, { id })).toBeNull();
  });

  test("sweep keeps a freshly-revoked token (within retention)", async () => {
    const t = setup();
    const { token, id } = await t.mutation(api.example.mint, {
      resourceRef: "r2",
      ttlMs: 2_592_000_000,
    });
    await t.mutation(api.example.revoke, { token });
    await t.mutation(api.example.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // still retained (revoked < retention age) — just no longer valid
    expect(await t.query(api.example.getMetadata, { id })).not.toBeNull();
  });

  test("a backlog larger than one batch self-reschedules until fully drained", async () => {
    const t = setup();
    // mint a full batch + 1 (PRUNE_BATCH = 256) so the first sweep fills its
    // batch and must self-reschedule to finish.
    const total = 257;
    for (let i = 0; i < total; i++) {
      await t.mutation(api.example.mint, { resourceRef: `b${i}` });
    }
    // advance past every expiry, then kick a single sweep
    vi.setSystemTime(Date.now() + 365 * 86_400_000);
    await t.mutation(api.example.runSweep, {});
    await t.finishAllScheduledFunctions(vi.runAllTimers);
    // the self-reschedule drained the whole backlog
    expect(await t.query(api.example.list, { limit: 1000 })).toHaveLength(0);
  });
});

describe("tokens — client options (short TTL clamp, custom scope, tokenBytes)", () => {
  test("a clamped-up TTL still validates; custom scope is isolated", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.mintShort, {
      resourceRef: "k1",
    });
    // tokenBytes:16 → 32 hex chars
    expect(token).toHaveLength(32);
    // shortTokens default scope is "tenant"
    expect(await t.query(api.example.validateShort, { token })).toEqual({
      valid: true,
      resourceRef: "k1",
    });
    // wrong (global) scope misses
    expect(await t.query(api.example.validate, { token })).toEqual({
      valid: false,
    });
    // revoke through the short client
    expect(await t.mutation(api.example.revokeShort, { token })).toBe(true);
    expect(await t.query(api.example.validateShort, { token })).toEqual({
      valid: false,
    });
  });
});

describe("tokens — hashAlgo config (SHA-512)", () => {
  test("SHA-512 mint round-trips through SHA-512 validate", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.mintSha512, {
      resourceRef: "h",
    });
    expect(await t.query(api.example.validateSha512, { token })).toEqual({
      valid: true,
      resourceRef: "h",
    });
  });

  test("a SHA-256 client cannot validate a SHA-512-hashed token (algo is pinned per mount)", async () => {
    const t = setup();
    const { token } = await t.mutation(api.example.mintSha512, {
      resourceRef: "h",
    });
    // default `tokens` client hashes with SHA-256 → different hash → miss
    expect(await t.query(api.example.validate, { token, scope: "algo" })).toEqual({
      valid: false,
    });
  });
});
