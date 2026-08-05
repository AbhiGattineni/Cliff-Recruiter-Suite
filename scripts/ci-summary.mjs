// Turn Vitest's JSON output into a table on the GitHub Actions run page, so a
// test run can be read at a glance without opening the raw log.
//
//   node scripts/ci-summary.mjs test-results.json
//
// Outside Actions (no GITHUB_STEP_SUMMARY) it prints to stdout, which makes it
// runnable locally too.

import { readFileSync, appendFileSync } from "node:fs";

const file = process.argv[2] ?? "test-results.json";
const out = process.env.GITHUB_STEP_SUMMARY;

const write = (md) => (out ? appendFileSync(out, md + "\n") : process.stdout.write(md + "\n"));

let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  write(`## Tests\n\nCould not read \`${file}\` — the run probably failed before tests started.\n`);
  write(`\`\`\`\n${err.message}\n\`\`\``);
  process.exit(0); // reporting must never be the thing that fails the build
}

const total = data.numTotalTests ?? 0;
const passed = data.numPassedTests ?? 0;
const failed = data.numFailedTests ?? 0;
const skipped = (data.numPendingTests ?? 0) + (data.numTodoTests ?? 0);
const files = data.testResults ?? [];
const ms = Number(data.duration ?? 0);
const secs = ms > 0 ? (ms / 1000).toFixed(1) : null;

write(`## ${failed > 0 ? "❌" : "✅"} Tests — ${passed}/${total} passed`);
write("");
write(`| Result | Count |`);
write(`| --- | ---: |`);
write(`| Passed | ${passed} |`);
write(`| Failed | ${failed} |`);
if (skipped) write(`| Skipped | ${skipped} |`);
write(`| Test files | ${files.length} |`);
if (secs) write(`| Duration | ${secs}s |`);
write("");

// Per-file breakdown.
write(`### By file`);
write("");
write(`| File | Passed | Failed |`);
write(`| --- | ---: | ---: |`);
for (const f of files) {
  const asserts = f.assertionResults ?? [];
  const p = asserts.filter((a) => a.status === "passed").length;
  const x = asserts.filter((a) => a.status === "failed").length;
  const name = String(f.name ?? "").split(/[\\/]/).slice(-3).join("/");
  write(`| ${x > 0 ? "❌ " : ""}${name} | ${p} | ${x} |`);
}
write("");

// Name every failure so the cause is visible without opening the log.
const failures = files.flatMap((f) =>
  (f.assertionResults ?? [])
    .filter((a) => a.status === "failed")
    .map((a) => ({ file: String(f.name ?? ""), title: [...(a.ancestorTitles ?? []), a.title].join(" › "), msg: (a.failureMessages ?? []).join("\n") }))
);

if (failures.length) {
  write(`### Failures`);
  write("");
  for (const f of failures) {
    write(`**${f.title}**`);
    write("");
    write("```");
    write(f.msg.split("\n").slice(0, 12).join("\n"));
    write("```");
    write("");
  }
}
