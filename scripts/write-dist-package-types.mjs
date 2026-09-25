// Marks each dist tree with the module system tsc emitted for it.
//
// The root package.json has no "type" field, so Node would treat
// dist/esm/*.js as CommonJS and choke on `import`/`export`. Bundlers do not
// care, but a Node ESM consumer (SSR frameworks, tests) does. A nested
// package.json is the standard way to scope "type" to a directory.
import { writeFileSync, mkdirSync } from "node:fs";

const targets = [
  ["dist/esm", "module"],
  ["dist/cjs", "commonjs"],
];

for (const [dir, type] of targets) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/package.json`, JSON.stringify({ type }, null, 2) + "\n");
}
