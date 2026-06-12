import { describe, expect, test } from "vitest";
import {
  clampTtl,
  DEFAULT_HASH_ALGO,
  DEFAULT_MAX_TTL_MS,
  DEFAULT_REVOKED_RETENTION_MS,
  DEFAULT_SCOPE,
  DEFAULT_TOKEN_BYTES,
  DEFAULT_TTL_MS,
  generateToken,
  hashToken,
  MIN_TTL_MS,
  PRUNE_BATCH,
} from "../../src/shared";

describe("shared — hashToken", () => {
  test("produces a 64-char lowercase hex SHA-256 digest by default", async () => {
    const h = await hashToken("hello");
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  test("SHA-512 produces a 128-char hex digest, distinct from SHA-256", async () => {
    const h512 = await hashToken("hello", "SHA-512");
    expect(h512).toHaveLength(128);
    expect(h512).toMatch(/^[0-9a-f]{128}$/);
    expect(h512).not.toBe(await hashToken("hello", "SHA-256"));
  });

  test("is stable for the same input and differs for a different input", async () => {
    expect(await hashToken("abc")).toBe(await hashToken("abc"));
    expect(await hashToken("abc")).not.toBe(await hashToken("abd"));
  });
});

describe("shared — generateToken", () => {
  test("returns hex of 2 * bytes length and differs across calls", () => {
    expect(generateToken(24)).toHaveLength(48);
    expect(generateToken(8)).toHaveLength(16);
    expect(generateToken()).toHaveLength(2 * DEFAULT_TOKEN_BYTES);
    expect(generateToken(24)).not.toBe(generateToken(24));
  });
});

describe("shared — clampTtl", () => {
  test("clamps below min up to min", () => {
    expect(clampTtl(0, MIN_TTL_MS, DEFAULT_MAX_TTL_MS, DEFAULT_TTL_MS)).toBe(
      MIN_TTL_MS,
    );
  });
  test("leaves an in-range value untouched", () => {
    expect(
      clampTtl(DEFAULT_TTL_MS, MIN_TTL_MS, DEFAULT_MAX_TTL_MS, DEFAULT_TTL_MS),
    ).toBe(DEFAULT_TTL_MS);
  });
  test("clamps above max down to max", () => {
    expect(
      clampTtl(
        DEFAULT_MAX_TTL_MS * 2,
        MIN_TTL_MS,
        DEFAULT_MAX_TTL_MS,
        DEFAULT_TTL_MS,
      ),
    ).toBe(DEFAULT_MAX_TTL_MS);
  });
  test("falls back to fallbackMs (then clamps) for NaN", () => {
    expect(
      clampTtl(Number.NaN, MIN_TTL_MS, DEFAULT_MAX_TTL_MS, DEFAULT_TTL_MS),
    ).toBe(DEFAULT_TTL_MS);
  });
  test("falls back to fallbackMs for Infinity", () => {
    expect(
      clampTtl(
        Number.POSITIVE_INFINITY,
        MIN_TTL_MS,
        DEFAULT_MAX_TTL_MS,
        DEFAULT_TTL_MS,
      ),
    ).toBe(DEFAULT_TTL_MS);
  });
  test("falls back to minMs when BOTH ttlMs and fallbackMs are non-finite", () => {
    expect(
      clampTtl(Number.NaN, MIN_TTL_MS, DEFAULT_MAX_TTL_MS, Number.NaN),
    ).toBe(MIN_TTL_MS);
  });
});

describe("shared — constants", () => {
  test("expose the documented defaults", () => {
    expect(DEFAULT_SCOPE).toBe("global");
    expect(DEFAULT_TTL_MS).toBe(86_400_000);
    expect(MIN_TTL_MS).toBe(60_000);
    expect(DEFAULT_MAX_TTL_MS).toBe(2_592_000_000);
    expect(DEFAULT_TOKEN_BYTES).toBe(24);
    expect(DEFAULT_REVOKED_RETENTION_MS).toBe(86_400_000);
    expect(PRUNE_BATCH).toBe(256);
    expect(DEFAULT_HASH_ALGO).toBe("SHA-256");
  });
});
