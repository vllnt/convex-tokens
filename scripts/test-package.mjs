// Installs the packed tarball in a throwaway consumer on the low end of the peer
// range, checks the shipped docs (scripts/check-documentation.mjs), then
// imports every entry point, type-checks the README examples and a consumer, and
// runs the README's test example against the installed package. Run after
// `pnpm build`.
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

import {
  checkDocumentation,
  convexHost,
  writeHost,
} from "./check-documentation.mjs";

const root = process.cwd();
const { name, version } = JSON.parse(readFileSync("package.json", "utf8"));
if (typeof name !== "string" || typeof version !== "string")
  throw new Error("invalid package metadata");
const tarball = `${name.replace("@", "").replace("/", "-")}-${version}.tgz`;
const temporary = mkdtempSync(join(tmpdir(), "tokens-consumer-"));
/** @param {string} command @param {string[]} args @param {string} [cwd] */
const run = (command, args, cwd = temporary) =>
  execFileSync(command, args, { cwd, stdio: "inherit" });
/** @param {Record<string, string>} files */
const write = (files) => {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(temporary, path)), { recursive: true });
    writeFileSync(join(temporary, path), text);
  }
};
/** @param {string} module @param {string[]} files @param {string[]} [extra] */
const typecheck = (module, files, extra = []) =>
  run("pnpm", [
    "exec",
    "tsc",
    "--noEmit",
    "--strict",
    "--module",
    module,
    "--moduleResolution",
    module === "NodeNext" ? "NodeNext" : "Bundler",
    "--target",
    "ES2022",
    "--jsx",
    "react-jsx",
    ...extra,
    ...files,
  ]);

try {
  run("pnpm", ["pack", "--pack-destination", temporary], root);
  write({
    "package.json": JSON.stringify({
      pnpm: { ignoredBuiltDependencies: ["esbuild"] },
      private: true,
      type: "module",
    }),
    // pnpm 11 reads the build-script policy from the workspace file, pnpm 10 from package.json.
    // No lockfile here: the repo's 7-day minimumReleaseAge keeps floating transitive deps off
    // fresh releases. pnpm 10 and 11 read it from the workspace file, not from package.json.
    "pnpm-workspace.yaml": "allowBuilds:\n  esbuild: false\nminimumReleaseAge: 10080\n",
  });
  // Low end of the peer range (convex ^1.45.0, react >=18) and of the test toolchain.
  run("pnpm", [
    "add",
    join(temporary, tarball),
    "convex@1.45.0",
    "react@18.3.1",
    "@types/react@18.3.31",
    "typescript@5.9.3",
    "convex-test@0.0.71",
    "vite@8.2.2",
    "vitest@5.1.1",
    "@edge-runtime/vm@5.0.0",
    "@types/node@22.20.2",
  ]);

  // Agents read the bundled docs from node_modules, so they must ship.
  const installed = join(temporary, "node_modules", name);
  const docs = ["README.md", "CHANGELOG.md", "LICENSE", "llms.txt", "docs/API.md"];
  const missing = docs.filter((file) => !existsSync(join(installed, file)));
  if (missing.length > 0)
    throw new Error(`tarball is missing ${missing.join(", ")}`);

  // Runtime entry points (`./test` needs Vite and runs under vitest below).
  run("node", [
    "--input-type=module",
    "-e",
    `
const { Tokens } = await import("${name}");
const { useTokens } = await import("${name}/react");
const config = (await import("${name}/convex.config")).default;
const configJs = (await import("${name}/convex.config.js")).default;
if (typeof Tokens !== "function" || typeof useTokens !== "function" || !config || config !== configJs)
  throw new Error("missing export");
`,
  ]);

  // Docs contract on what consumers receive, then the README examples run in a
  // stub Convex host typed from those examples.
  const examples = checkDocumentation(installed, temporary);
  const readmeFiles = writeHost(
    temporary,
    convexHost(installed, examples),
    examples,
  );
  write({
    // Types the export surface the README does not exercise.
    "consumer.tsx": `
import { Tokens, type TokenMetadata, type ValidateResult } from "${name}";
import type { ComponentApi } from "${name}/_generated/component";
import config from "${name}/convex.config";
import { useTokens } from "${name}/react";
import { defineApp, type FunctionReference } from "convex/server";
declare const component: ComponentApi;
declare const listRef: FunctionReference<"query", "public", { scope?: string; resourceRef: string }, TokenMetadata[]>;
const client = new Tokens(component, { defaultScope: "invite" });
const app = defineApp();
app.use(config);
export function Count() { return <p>{useTokens(listRef, { resourceRef: "u" })?.length}</p>; }
export const isValid = (result: ValidateResult) => (result.valid ? result.resourceRef : undefined);
void client;
`,
    // register accepts a host schema with its own tables and a custom mount name.
    "registration.ts": `
import { register } from "${name}/test";
import { convexTest } from "convex-test";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
const host = defineSchema({ notes: defineTable({ body: v.string() }) });
register(convexTest(host, {}), "custom");
`,
  });
  typecheck("ESNext", [...readmeFiles, "consumer.tsx", "registration.ts"], [
    "--types",
    "vite/client,node",
  ]);
  // `./test` ships TypeScript source, so it must also compile for NodeNext consumers.
  typecheck("NodeNext", ["registration.ts"], ["--types", "vite/client,node"]);
  // The README's own vitest.config.mts runs its test example.
  run("pnpm", ["exec", "vitest", "run"]);
  console.log(`OK    package test: ${name}@${version} installs, imports, type-checks and runs`);
} finally {
  rmSync(temporary, { force: true, recursive: true });
}
