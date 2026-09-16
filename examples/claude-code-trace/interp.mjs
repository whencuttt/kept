#!/usr/bin/env node
// interp.mjs — the agent records its structured interpretation of the latest step (v1: called via Bash).
//   node interp.mjs --relied-on tool=Bash,field=stdout --decision "proceed to publish" --because "..."
// The agent can lie in what it writes here. It cannot forge the output hashes: every value_hash is
// copied from the runtime's own record of that step, and a field the runtime never saw is refused.
import { appendChain, chainPath, interpPre, latestSession, readChain, sha256, withLock } from "./trace.mjs";

const a = process.argv.slice(2), get = (f) => { const i = a.indexOf(f); return i < 0 ? null : a[i + 1]; };
const all = (f) => a.flatMap((v, i) => (v === f && a[i + 1] ? [a[i + 1]] : []));
const die = (m) => { throw new Error(m); }; // thrown, not exited, so withLock always releases the lock

const decision = get("--decision"), because = get("--because");
const specs = all("--relied-on");
if (!decision || !because) die("--decision and --because are required");
const sid = get("--session") || process.env.KEPT_SESSION_ID || latestSession() || die("no session chain yet — run a tool first");

function main() {
  withLock(sid, () => {
    const chain = readChain(sid);
    const link = chain.filter((r) => r.type === "link").pop();
    if (!link) die(`no signed link in ${chainPath(sid)} — the runtime recorded no tool call to interpret`);
    if (chain.some((r) => r.type === "interp" && r.step_id === link.step_id)) die(`${link.step_id} already has an interpretation; the convention allows exactly one per step`);
    const relied_on = specs.map((s) => {
      const kv = Object.fromEntries(s.split(",").map((p) => p.split("=").map((x) => x.trim())));
      const tool = kv.tool ?? link.tool_name, field = kv.field;
      if (!field) die(`--relied-on "${s}" needs field=<name>`);
      if (tool.toLowerCase() !== String(link.tool_name).toLowerCase()) die(`${link.step_id} was a ${link.tool_name} call, not ${tool} — a claim about a tool the runtime did not run is a ghost step`);
      const value_hash = link.field_hashes?.[field];
      if (!value_hash) die(`${link.tool_name} output at ${link.step_id} has no field "${field}" (have: ${Object.keys(link.field_hashes ?? {}).join(", ") || "none"})`);
      return { tool: link.tool_name, field, value_hash };
    });
    const interp = { relied_on, decision, because };
    const interp_hash = sha256(interpPre(link.link, interp));
    appendChain(sid, { type: "interp", step_id: link.step_id, ts: new Date().toISOString(), link: link.link, interp, interp_hash });
    console.log(`${link.step_id} interp_hash ${interp_hash}`);
  });
}
try { main(); } catch (e) { console.error(`interp: ${e.message}`); process.exit(1); }
