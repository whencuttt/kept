// Shared primitives for the Kept trace convention (../trace-convention.md). Dependency-free Node.
// The two preimages are the whole contract; test.mjs re-derives them from the spec text independently.
import { spawn } from "node:child_process";
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const sha256 = (s) => createHash("sha256").update(s, "utf8").digest("hex");
/** Canonical JSON: keys sorted at every depth, no whitespace. Equal data, equal bytes, any run. */
export function canon(v) {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  return "{" + Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
}
export const linkPre = (step_id, hashes, prev_interp_hash) => ["kept-trace-v1", step_id, [...hashes].sort().join(","), prev_interp_hash].join("\n");
export const interpPre = (link, interp) => ["kept-interp-v1", link, canon(interp)].join("\n");

export const HOME = () => process.env.KEPT_TRACE_HOME || join(homedir(), ".kept");
export const keyPath = () => join(HOME(), "trace-key.pem");
export const traceDir = () => join(HOME(), "trace");
export const chainPath = (sid) => join(traceDir(), String(sid).replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 128) + ".jsonl");
/** kid = first 16 hex of sha256 of the SPKI PEM — the same rule as src/lib/crypto.ts keyId(). */
export const kidOf = (pem) => sha256(pem).slice(0, 16);

/** Load the runtime key, generating it on first run. 0600, never leaves this machine. */
export function loadKey() {
  mkdirSync(HOME(), { recursive: true });
  let created = false;
  if (!existsSync(keyPath())) {
    const pem = generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" });
    try { writeFileSync(keyPath(), pem, { mode: 0o600, flag: "wx" }); created = true; } catch (e) { if (e.code !== "EEXIST") throw e; }
  }
  const priv = createPrivateKey(readFileSync(keyPath(), "utf8"));
  const pubPem = createPublicKey(priv).export({ type: "spki", format: "pem" });
  writeFileSync(join(HOME(), "trace-key.pub.pem"), pubPem);
  return { priv, pubPem, kid: kidOf(pubPem), created };
}
export const publicPem = () => createPublicKey(readFileSync(keyPath(), "utf8")).export({ type: "spki", format: "pem" });
/** Signatures are over the hex digest string, as in src/lib/crypto.ts and examples/verdict-gate. */
export const signHex = (hex, priv) => sign(null, Buffer.from(hex, "utf8"), priv).toString("base64");
export const verifyHex = (hex, sigB64, pubPem) => { try { return verify(null, Buffer.from(hex, "utf8"), createPublicKey(pubPem), Buffer.from(sigB64, "base64")); } catch { return false; } };

export const readChain = (sid) => { try { return readFileSync(chainPath(sid), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
export const appendChain = (sid, rec) => { mkdirSync(traceDir(), { recursive: true }); appendFileSync(chainPath(sid), JSON.stringify(rec) + "\n"); };
export function latestSession() {
  try { return readdirSync(traceDir()).filter((f) => f.endsWith(".jsonl")).map((f) => [f, statSync(join(traceDir(), f)).mtimeMs]).sort((a, b) => b[1] - a[1])[0]?.[0].replace(/\.jsonl$/, "") ?? null; } catch { return null; }
}
/** Optional Kept upload, read through HOME() so a test with KEPT_TRACE_HOME set stays offline.
 *  {"kept_api_key":"kept_sk_...","base":"https://kept-ledger.vercel.app"} */
export function keptConfig() {
  try {
    const c = JSON.parse(readFileSync(join(HOME(), "config.json"), "utf8"));
    return c?.kept_api_key ? { key: c.kept_api_key, base: String(c.base || "https://kept-ledger.vercel.app").replace(/\/$/, "") } : null;
  } catch { return null; }
}
const UPLOADER = `const a=JSON.parse(process.env.KEPT_UP);fetch(a.base+"/api/v1/trace",{method:"POST",headers:{"content-type":"application/json",authorization:"Bearer "+a.key},body:JSON.stringify(a.body),signal:AbortSignal.timeout(2000)}).catch(()=>{})`;
/** Fire-and-forget: a detached, stdio-less child POSTs the record and the tool call never waits on it.
 *  No config, no network, no Kept — the offline jsonl chain is unchanged either way. */
export function uploadRecord(sid, rec) {
  const cfg = keptConfig();
  if (!cfg) return;
  try {
    spawn(process.execPath, ["-e", UPLOADER], {
      detached: true, stdio: "ignore",
      env: { ...process.env, KEPT_UP: JSON.stringify({ base: cfg.base, key: cfg.key, body: { ...rec, session_id: String(sid) } }) },
    }).unref();
  } catch { /* a failed upload is never a failed tool call */ }
}

/** Read-modify-write lock: parallel and background tool calls do overlap. */
export function withLock(sid, fn) {
  const lock = chainPath(sid) + ".lock"; mkdirSync(traceDir(), { recursive: true });
  for (let i = 0; i < 100; i++) {
    let fd;
    try { fd = openSync(lock, "wx"); } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > 5000) unlinkSync(lock); } catch {} // a holder killed mid-step must not stall every later call
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10); continue;
    }
    try { return fn(); } finally { closeSync(fd); try { unlinkSync(lock); } catch {} }
  }
  return fn(); // lock never came free: record the step rather than lose it
}

/** The verifier's checks 1-4 from the convention. Returns a list of findings; empty means the chain holds. */
export function verifyChain(recs, pubPem) {
  const bad = [], links = new Map(); let lastInterp = "";
  for (const r of recs) {
    if (r.type === "link") {
      if (links.has(r.step_id)) bad.push(`${r.step_id}: duplicate link for one step`);
      if (r.link !== sha256(linkPre(r.step_id, r.tool_output_hashes, r.prev_interp_hash))) bad.push(`${r.step_id}: link does not cover its own tool_output_hashes (tampered output hash)`);
      else if (!verifyHex(r.link, r.link_sig, pubPem)) bad.push(`${r.step_id}: link signature does not verify against the runtime key`);
      if (r.prev_interp_hash !== lastInterp) bad.push(`${r.step_id}: link does not cover the interpretation that precedes it`);
      links.set(r.step_id, r);
    } else if (r.type === "interp") {
      const l = links.get(r.step_id);
      if (!l) { bad.push(`${r.step_id}: ghost step — an interpretation for a step the runtime never signed`); continue; }
      if (r.link !== l.link) bad.push(`${r.step_id}: interpretation cites a link the runtime did not emit`);
      if (r.interp_hash !== sha256(interpPre(l.link, r.interp))) bad.push(`${r.step_id}: interp_hash does not cover its link and interpretation`);
      for (const d of r.interp?.relied_on ?? []) {
        if (d.tool !== l.tool_name) bad.push(`${r.step_id}: ghost tool call — interpretation relies on ${d.tool}, the runtime ran ${l.tool_name}`);
        else if (d.value_hash !== (l.field_hashes ?? {})[d.field]) bad.push(`${r.step_id}: relied_on ${d.tool}.${d.field} is not the runtime's hash for that field (stale or invented value)`);
      }
      lastInterp = r.interp_hash;
    }
  }
  return bad;
}
