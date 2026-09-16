#!/usr/bin/env node
// hook.mjs — Claude Code PostToolUse hook. The first real implementation of ../trace-convention.md.
// Claude Code executes the tool, then hands this script the payload on stdin; the hook hashes the raw
// tool_response and appends an Ed25519-signed link to ~/.kept/trace/<session_id>.jsonl.
// It must never block or fail a tool call: every path exits 0 and every diagnostic goes to stderr.
import { readFileSync } from "node:fs";
import { appendChain, canon, keyPath, linkPre, loadKey, readChain, sha256, signHex, withLock } from "./trace.mjs";

/** Per-field hashes of the tool output, so an interpretation can cite a field it cannot invent. */
const fieldHashes = (r) => (r && typeof r === "object" && !Array.isArray(r))
  ? Object.fromEntries(Object.keys(r).slice(0, 64).map((k) => [k, sha256(canon(r[k]))]))
  : { value: sha256(canon(r ?? null)) };

try {
  const p = JSON.parse(readFileSync(0, "utf8"));
  const sid = p.session_id || "no-session";
  const { priv, kid, created } = loadKey();
  if (created) process.stderr.write(`kept-trace: generated ${keyPath()} — kid ${kid}\n`);
  withLock(sid, () => {
    const chain = readChain(sid);
    const step_id = "s" + (chain.filter((r) => r.type === "link").length + 1);
    // One PostToolUse event is one executed call, so one output hash. The convention sorts and joins
    // so a runtime that batches several calls into one step produces the same preimage.
    const tool_output_hashes = [sha256(canon(p.tool_response ?? null))];
    // The interpretation this link is chained to: the last one recorded, "" when none. Two links may
    // share it — that honestly means the agent recorded no interpretation between those two steps.
    const prev_interp_hash = chain.filter((r) => r.type === "interp").pop()?.interp_hash ?? "";
    const link = sha256(linkPre(step_id, tool_output_hashes, prev_interp_hash));
    appendChain(sid, {
      type: "link", step_id, ts: new Date().toISOString(), tool_name: p.tool_name ?? "", tool_use_id: p.tool_use_id ?? null,
      tool_output_hashes, field_hashes: fieldHashes(p.tool_response), prev_interp_hash, link, link_sig: signHex(link, priv), kid,
    });
  });
} catch (e) {
  process.stderr.write(`kept-trace: ${e?.message ?? e}\n`); // a broken trace is never a broken tool call
}
process.exit(0);
