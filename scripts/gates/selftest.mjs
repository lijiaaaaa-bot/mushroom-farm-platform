#!/usr/bin/env node
/**
 * Isomorphic gate self-test: known bad classes must exit 1; clean fixture exit 0.
 * Fixtures live under scripts/gates/fixtures/* and are NOT scanned by normal make gates
 * (run-all skips scripts/gates/ when ROOT is the repo).
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const runner = path.join(__dirname, "run-all.mjs");
const fixturesRoot = path.join(__dirname, "fixtures");

const cases = [
  { id: "bad-meta-name", expect: 1, why: "forbidden 独立 in name/title" },
  { id: "bad-meta-name-2", expect: 1, why: "forbidden 好看 — isomorphic class, not one filename" },
  { id: "bad-fake-assume", expect: 1, why: "110 路 marked 假定" },
  { id: "bad-percent", expect: 1, why: "bare 完成 N%" },
  { id: "ok-facts", expect: 0, why: "facts written as facts" },
];

let failed = 0;
for (const c of cases) {
  const root = path.join(fixturesRoot, c.id);
  const r = spawnSync(process.execPath, [runner], {
    env: { ...process.env, GATES_ROOT: root },
    encoding: "utf8",
  });
  const code = r.status ?? 1;
  const pass = code === c.expect;
  const tag = pass ? "PASS" : "FAIL";
  if (!pass) failed++;
  console.log(`${tag}: ${c.id} expect=${c.expect} got=${code} (${c.why})`);
  if (!pass) {
    if (r.stdout) process.stdout.write(r.stdout);
    if (r.stderr) process.stderr.write(r.stderr);
  }
}

if (failed) {
  console.error(`\n${failed} selftest case(s) failed.`);
  process.exit(1);
}
console.log("\nAll gate selftests passed (isomorphic classes covered).");
process.exit(0);
