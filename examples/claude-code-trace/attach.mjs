#!/usr/bin/env node
// attach.mjs — export a session chain as the receipt evidence shape from ../trace-convention.md and
// attach it to a Kept receipt via POST /api/v1/reveal.
//   KEPT_API_KEY=kept_sk_... node attach.mjs --receipt kpt_xxx --outcome kept [--session s] [--full 10] [--print]
import { fileURLToPath } from "node:url";
import { latestSession, publicPem, readChain, sha256, verifyChain } from "./trace.mjs";

const a = process.argv.slice(2), get = (f, d = null) => { const i = a.indexOf(f); return i < 0 ? d : a[i + 1]; };
const die = (m) => { console.error(`attach: ${m}`); process.exit(1); };
const BASE = (process.env.KEPT_BASE_URL || "https://kept-ledger.vercel.app").replace(/\/$/, "");
const MAX = 4000; // POST /api/v1/reveal refuses evidence longer than this as JSON

/** The evidence shape, tiered (thegreekgodhermes): the newest `full` steps carry their whole signed
 *  entry, older ones degrade to { step_id, link }, and if the chain is longer than the 4000-char limit
 *  allows, the oldest fold into one digest — an omitted call still shows that it existed. */
export function toEvidence(recs, full = Number(get("--full", "10"))) {
  const interps = new Map(recs.filter((r) => r.type === "interp").map((r) => [r.step_id, r.interp_hash]));
  const links = recs.filter((r) => r.type === "link");
  const entry = (l) => ({ step_id: l.step_id, link: l.link, link_sig: l.link_sig, kid: l.kid, tool_output_hashes: l.tool_output_hashes, interp_hash: interps.get(l.step_id) ?? "" });
  const min = (l) => ({ step_id: l.step_id, link: l.link });
  const fold = (ls) => ({ omitted: ls.length, from: ls[0].step_id, to: ls[ls.length - 1].step_id, digest: sha256(ls.map((l) => l.link).join(",")) });
  const fits = (ev) => JSON.stringify(ev).length <= MAX;
  for (let n = Math.min(Math.max(0, full), links.length); n >= 0; n--) {
    const cut = links.length - n;
    const ev = { trace: [...links.slice(0, cut).map(min), ...links.slice(cut).map(entry)], ...(cut > 0 ? { tiered: true } : {}) };
    if (fits(ev)) return ev;
  }
  for (let keep = links.length - 1; keep > 0; keep--) {
    const ev = { trace: [fold(links.slice(0, links.length - keep)), ...links.slice(links.length - keep).map(min)], tiered: true };
    if (fits(ev)) return ev;
  }
  return { trace: [fold(links)], tiered: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sid = get("--session") || process.env.KEPT_SESSION_ID || latestSession() || die("no session chain found");
  const recs = readChain(sid);
  if (!recs.length) die(`chain for session ${sid} is empty`);
  const bad = verifyChain(recs, publicPem());
  if (bad.length && !a.includes("--force")) die(`chain does not verify, refusing to attach:\n  ${bad.join("\n  ")}\n(--force to attach anyway)`);
  const evidence = toEvidence(recs);
  if (a.includes("--print")) { console.log(JSON.stringify(evidence, null, 2)); process.exit(0); }
  const id = get("--receipt") || die("--receipt <id> is required");
  const outcome = get("--outcome") || die("--outcome kept|failed is required");
  if (!["kept", "failed"].includes(outcome)) die("--outcome must be kept or failed");
  const key = process.env.KEPT_API_KEY || die("KEPT_API_KEY is not set");
  const res = await fetch(`${BASE}/api/v1/reveal`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: JSON.stringify({ id, outcome, evidence }) });
  const body = await res.json().catch(() => ({}));
  console.log(JSON.stringify(body, null, 2));
  if (!res.ok) process.exit(1);
  console.log(`attached ${evidence.trace.length} trace steps to ${id} (${JSON.stringify(evidence).length} chars${evidence.tiered ? ", tiered" : ""})`);
}
