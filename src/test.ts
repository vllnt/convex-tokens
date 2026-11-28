/// <reference types="vite/client" />
import type { GenericSchema, SchemaDefinition } from "convex/server";
import type { TestConvex } from "convex-test";
import schema from "./component/schema.js";

const modules = import.meta.glob("./component/**/*.ts");

/**
 * Register this component with a `convex-test` instance so consuming apps can
 * test integration: `import { register } from "@vllnt/convex-tokens/test"`.
 * Accepts the host app's own schema; mounts under `name` (default `"tokens"`).
 */
export function register<TSchema extends GenericSchema>(
  t: TestConvex<SchemaDefinition<TSchema, boolean>>,
  name = "tokens",
): void {
  t.registerComponent(name, schema, modules);
}
