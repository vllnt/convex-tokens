import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { posix } from "node:path";

// The npm tarball must ship the version-matched docs coding agents read from
// node_modules, and their links must resolve there. Which paths may ship is
// guarded by scripts/check-package-contents.sh. Run from the package root.
const REQUIRED = [
  "README.md",
  "LICENSE",
  "CHANGELOG.md",
  "llms.txt",
  "docs/API.md",
];
const LINKED_DOCS = ["llms.txt", "README.md", "docs/API.md"];
const REPO_URL =
  /^https:\/\/github\.com\/vllnt\/convex-tokens\/(?:blob|tree)\/[^/]+\/(.+)$/i;

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

for (const doc of LINKED_DOCS) {
  const text = readFileSync(doc, "utf8");
  for (const [, link] of text.matchAll(/\]\(([^)\s]+)[^)]*\)/g)) {
    const target = link.split(/[#?]/)[0];
    const byUrl = REPO_URL.exec(target);
    // Shipped docs are linked relatively so they match the installed version.
    if (doc === "llms.txt" && byUrl && REQUIRED.includes(byUrl[1]))
      errors.push(`${doc} links ${byUrl[1]} by URL; use ./${byUrl[1]}`);
    if (!target || /^[a-z][a-z0-9+.-]*:/i.test(target)) continue;
    const path = posix.normalize(posix.join(posix.dirname(doc), target));
    if (!packed.has(path)) errors.push(`${doc} link not in tarball: ${link}`);
  }
}

if (errors.length > 0) {
  for (const error of errors) console.error(`FAIL ${error}`);
  process.exit(1);
}
console.log(
  `OK    package files: ${packed.size} packed, required docs present`,
);
