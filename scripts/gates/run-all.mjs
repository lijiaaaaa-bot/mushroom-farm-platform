#!/usr/bin/env node
/**
 * Deliverable gates — exit 1 on any failure.
 * No LLM. No network. Agent cannot talk past this.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = process.env.GATES_ROOT
  ? path.resolve(process.env.GATES_ROOT)
  : path.resolve(__dirname, "../..");

const failures = [];
function fail(msg) {
  failures.push(msg);
  console.error("FAIL:", msg);
}
function ok(msg) {
  console.log("OK:", msg);
}

function loadConfig() {
  const candidates = [
    path.join(ROOT, "facts.json"),
    path.join(ROOT, "docs", "facts.json"),
    path.join(ROOT, "scripts", "gates", "facts.json"),
  ];
  const file = candidates.find((p) => fs.existsSync(p));
  if (!file) {
    fail(`找不到 facts.json（试过 ${candidates.join(", ")}）。Day-0 请从模板拷贝并填需求原文事实。`);
    return null;
  }
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf8"));
    ok(`loaded ${path.relative(ROOT, file)}`);
    return data;
  } catch (e) {
    fail(`facts.json 无法 JSON.parse: ${e.message}`);
    return null;
  }
}

function matchGlob(rel, pattern) {
  if (pattern === "*.md") return !rel.includes("/") && rel.endsWith(".md");
  if (pattern === "**/*.md") return rel.endsWith(".md");
  if (pattern.endsWith("/**/*.md")) {
    const prefix = pattern.slice(0, -"/**/*.md".length);
    return (prefix === "" || rel.startsWith(prefix + "/")) && rel.endsWith(".md");
  }
  const re = new RegExp(
    "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*/g, "§§")
        .replace(/\*/g, "[^/]*")
        .replace(/§§/g, ".*") +
      "$"
  );
  return re.test(rel);
}

function listDocs(globs) {
  const out = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
      if (name === "node_modules" || name === ".git") continue;
      const full = path.join(dir, name);
      let st;
      try {
        st = fs.statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) walk(full);
      else out.push(full);
    }
  }
  walk(ROOT);
  return out.filter((f) => {
    const rel = path.relative(ROOT, f).replaceAll("\\", "/");
    if (rel.includes("scripts/gates/")) return false;
    return (globs || ["**/*.md"]).some((g) => matchGlob(rel, g));
  });
}

function gateForbiddenNames(cfg, docs) {
  const subs = cfg.forbidden_name_substrings || [];
  for (const f of docs) {
    const base = path.basename(f);
    const lower = base.toLowerCase();
    for (const s of subs) {
      if (lower.includes(String(s).toLowerCase())) {
        fail(`文件名含禁用元词「${s}」: ${path.relative(ROOT, f)}`);
      }
    }
    const text = fs.readFileSync(f, "utf8");
    const m = text.match(/^#\s+(.+)$/m);
    if (m) {
      const title = m[1].toLowerCase();
      for (const s of subs) {
        if (title.includes(String(s).toLowerCase())) {
          fail(`标题含禁用元词「${s}」: ${path.relative(ROOT, f)} → ${m[1]}`);
        }
      }
    }
  }
  ok("forbidden name/title gate");
}

function gateFakeAssumptions(cfg, docs) {
  const facts = cfg.facts || [];
  const assumeRe = /(【\s*假定\s*】|【\s*假设\s*】|\b假定\b|\b假设\b)/;
  for (const f of docs) {
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!assumeRe.test(line)) return;
      for (const fact of facts) {
        for (const kw of fact.must_appear_as_fact_keywords || []) {
          if (line.includes(kw)) {
            fail(
              `需求事实被标成假定: ${path.relative(ROOT, f)}:${i + 1} 命中事实 ${fact.id}（关键词「${kw}」）\n  ${line.trim()}`
            );
          }
        }
      }
    });
  }
  ok("fake-assumption gate");
}

function gatePercentClaims(docs) {
  const re = /完成\s*\d+\s*%|\d+\s*%\s*完成|进度\s*\d+\s*%/;
  for (const f of docs) {
    const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (re.test(line) && !/无证据|不编造|禁止/.test(line)) {
        fail(`可疑完成百分比（需证据或删除）: ${path.relative(ROOT, f)}:${i + 1}\n  ${line.trim()}`);
      }
    });
  }
  ok("percent-claim gate");
}

function gateJsonSamples(cfg) {
  const samples = cfg.json_samples || [];
  if (!samples.length) {
    ok("json_samples empty (skip)");
    return;
  }
  for (const rel of samples) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) {
      fail(`json_samples 缺失: ${rel}`);
      continue;
    }
    try {
      JSON.parse(fs.readFileSync(p, "utf8"));
      ok(`json parse ${rel}`);
    } catch (e) {
      fail(`json_samples 无法 parse ${rel}: ${e.message}`);
    }
  }
}

function main() {
  console.log("GATES_ROOT=", ROOT);
  const cfg = loadConfig();
  if (!cfg) process.exit(1);
  const docs = listDocs(cfg.doc_globs);
  if (!docs.length) fail("未找到任何文稿（检查 doc_globs / 仓内是否有 md）");
  else ok(`scanning ${docs.length} doc files`);
  gateForbiddenNames(cfg, docs);
  gateFakeAssumptions(cfg, docs);
  gatePercentClaims(docs);
  gateJsonSamples(cfg);
  if (failures.length) {
    console.error(`\n${failures.length} gate(s) failed.`);
    process.exit(1);
  }
  console.log("\nAll deliverable gates passed.");
  process.exit(0);
}

main();
