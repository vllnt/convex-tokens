import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import { register } from "../../src/test";

/** A host app with a table of its own, unlike the example's empty schema. */
const hostSchema = defineSchema({
  notes: defineTable({ body: v.string() }),
});
const modules = import.meta.glob("./**/*.ts");

test("register mounts the component beside a host schema with its own table", async () => {
  // Type-level regression: `register` must accept any host schema, not only the
  // component's own (TS2345 before the fix, caught by `pnpm typecheck:tests`).
  const t = convexTest(hostSchema, modules);
  register(t);

  await t.run(async (ctx) => {
    await ctx.db.insert("notes", { body: "host row" });
  });
  const { token } = await t.mutation(api.example.mint, { resourceRef: "u1" });
  expect(await t.query(api.example.validate, { token })).toEqual({
    valid: true,
    resourceRef: "u1",
  });
  const notes = await t.run(async (ctx) => await ctx.db.query("notes").collect());
  expect(notes.map((note) => note.body)).toEqual(["host row"]);
});
