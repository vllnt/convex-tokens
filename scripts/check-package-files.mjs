import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// The npm tarball must ship the version-matched docs coding agents read from
// node_modules, and nothing contributor-only. Run from the package root.
const REQUIRED = [
  "package.json",
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "llms.txt",
  "docs/API.md",
];
const FORBIDDEN = [
  /^(AGENTS|CLAUDE|CONTRIBUTING|ROADMAP)\.md$/,
  /^(\.claude|\.github|example|scripts|coverage)\//,
  /\.(test|spec)\.[cm]?[jt]sx?$/,
];
const REPO_BLOB = "https://github.com/vllnt/convex-tokens/blob/";

const [pack] = JSON.parse(
  execFileSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
    encoding: "utf8",
  }),
);
const packed = new Set(pack.files.map((f) => f.path));
const errors = [];

for (const path of REQUIRED) {
  if (!packed.has(path)) errors.push(`missing from tarball: ${path}`);
}
for (const path of packed) {
  if (FORBIDDEN.some((re) => re.test(path)))
    errors.push(`must not ship: ${path}`);
}

// Links to shipped files stay relative so they match the installed version.
const llms = readFileSync("llms.txt", "utf8");
for (const [, target] of llms.matchAll(/\]\(([^)]+)\)/g)) {
  if (target.startsWith(REPO_BLOB)) {
    const path = target.slice(REPO_BLOB.length).split("/").slice(1).join("/");
    if (packed.has(path.split("#")[0]))
      errors.push(`llms.txt links shipped ${path} by URL; use ./${path}`);
    continue;
  }
  if (/^(?:[a-z]+:|#)/.test(target)) continue;
  const path = target.split("#")[0].replace(/^\.\//, "");
  if (!packed.has(path)) errors.push(`llms.txt link not in tarball: ${target}`);
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exit(1);
}
console.log(
  `OK    package files: ${packed.size} packed, required docs present`,
);
