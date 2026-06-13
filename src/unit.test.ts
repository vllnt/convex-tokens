/**
 * Unit tests for shared pure utilities: {@link generateToken} and
 * {@link hashToken}. These run in the global edge-runtime environment.
 *
 * Property-style coverage:
 * - `generateToken(bytes)` always produces exactly `2 * bytes` lowercase hex chars.
 * - `hashToken("")` does not throw; it returns a valid hex string.
 */

import { describe, expect, test } from "vitest";
import { generateToken, hashToken } from "./shared.js";

describe("generateToken — property tests", () => {
  test("default byte count yields 48 hex chars (24 bytes * 2)", async () => {
    const token = generateToken();
    expect(token).toHaveLength(48);
    expect(token).toMatch(/^[0-9a-f]+$/);
  });

  const byteCounts = [1, 8, 16, 24, 32, 48, 64];
  for (const bytes of byteCounts) {
    test(`generateToken(${bytes}) yields exactly ${2 * bytes} lowercase hex chars`, () => {
      const token = generateToken(bytes);
      expect(token).toHaveLength(2 * bytes);
      expect(token).toMatch(/^[0-9a-f]+$/);
    });
  }
});

describe("hashToken — edge cases", () => {
  test("hashToken('') does not throw and returns a 64-char hex string (SHA-256)", async () => {
    const hash = await hashToken("");
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  test("hashToken returns different digests for different inputs", async () => {
    const h1 = await hashToken("abc");
    const h2 = await hashToken("def");
    expect(h1).not.toBe(h2);
  });

  test("hashToken SHA-512 returns 128-char hex string", async () => {
    const hash = await hashToken("test", "SHA-512");
    expect(hash).toHaveLength(128);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });
});
