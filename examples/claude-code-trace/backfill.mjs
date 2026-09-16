#!/usr/bin/env node
// backfill.mjs — POST every record in ~/.kept/trace/*.jsonl to Kept. The endpoint is idempotent on
// (agent, session_id, step_id), so running this twice uploads the same chain, not two of it.
//   node backfill.mjs [--session <id>] [--dry]
// Reads the key from ~/.kept/config.json (same file hook.mjs uses) or KEPT_API_KEY + KEPT_BASE_URL.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { keptConfig, traceDir } from "./trace.mjs";

const a = process.argv.slice(2), get = (f) => { const i = a.indexOf(f); return i < 0 ? null : a[i + 1]; };
const cfg = keptConfig() ?? (process.env.KEPT_API_KEY ? { key: process.env.KEPT_API_KEY, base: (process.env.KEPT_BASE_URL || "https://kept-ledger.vercel.app").replace(/\/$/, "") } : null);
if (!cfg) { console.error("backfill: no ~/.kept/config.json {kept_api_key, base} and no KEPT_API_KEY"); process.exit(1); }

const only = get("--session");
let files = [];
try { files = readdirSync(traceDir()).filter((f) => f.endsWith(".jsonl")).filter((f) => !only || f === only + ".jsonl"); }
catch { console.error(`backfill: no chains in ${traceDir()}`); process.exit(1); }

const jobs = [];
for (const f of files) {
  const session_id = f.replace(/\.jsonl$/, "");
  for (const line of readFileSync(join(traceDir(), f), "utf8").split("\n").filter(Boolean)) {
    try { jobs.push({ session_id, rec: JSON.parse(line) }); } catch { /* a half-written last line is not a record */ }
  }
}
console.log(`${jobs.length} records in ${files.length} chain${files.length === 1 ? "" : "s"} → ${cfg.base}/api/v1/trace`);
if (a.includes("--dry")) process.exit(0);

let ok = 0, failed = 0;
const errs = new Map();
async function send({ session_id, rec }) {
  try {
    const res = await fetch(`${cfg.base}/api/v1/trace`, {
      method: "POST", signal: AbortSignal.timeout(15000),
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.key}` },
      body: JSON.stringify({ ...rec, session_id }),
    });
    if (res.ok) { ok++; return; }
    const b = await res.json().catch(() => ({}));
    failed++; errs.set(`${res.status} ${b.error ?? ""}`, (errs.get(`${res.status} ${b.error ?? ""}`) ?? 0) + 1);
  } catch (e) { failed++; errs.set(String(e?.message ?? e), (errs.get(String(e?.message ?? e)) ?? 0) + 1); }
}
const queue = jobs.slice();
await Promise.all(Array.from({ length: 6 }, async () => { let j; while ((j = queue.shift())) await send(j); }));
console.log(`uploaded ${ok}, failed ${failed}`);
for (const [m, n] of errs) console.log(`  ${n}x ${m}`);
process.exit(failed && !ok ? 1 : 0);
