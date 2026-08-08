// Guard against the dev-only design harness reaching production.
//
// /design-preview is registered behind `import.meta.env.DEV`, but that only
// keeps it out of the bundle while Rollup can prove the module has no side
// effects. A single module-level function call in DesignPreview.tsx has already
// silently pulled the whole harness (and its sample data) into the shipped
// bundle once, so CI checks the built output rather than trusting the guard.

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const DIR = "dist/assets";

// Strings that only exist in the dev harness.
const FORBIDDEN = [
  "Sample Recruiter",
  "Priya Raghavan",
  "Design preview",
  "designPreviewDemo",
  "Ask Anything preview recruiter",
];

let files;
try {
  files = readdirSync(DIR).filter((f) => f.endsWith(".js"));
} catch {
  console.error(`No build output at ${DIR} — run the build first.`);
  process.exit(1);
}

const hits = [];
for (const f of files) {
  const src = readFileSync(join(DIR, f), "utf8");
  for (const needle of FORBIDDEN) {
    if (src.includes(needle)) hits.push({ file: f, needle });
  }
}

if (hits.length) {
  console.error("Dev-only preview harness leaked into the production bundle:");
  for (const h of hits) console.error(`  ${h.file} contains ${JSON.stringify(h.needle)}`);
  console.error(
    "\nUsually caused by a module-level side effect in src/pages/DesignPreview.tsx —\n" +
      "compute sample data lazily (inside the component) so Rollup can drop the module."
  );
  process.exit(1);
}

console.log(`Bundle clean — checked ${files.length} chunk(s), none contain the dev harness.`);
