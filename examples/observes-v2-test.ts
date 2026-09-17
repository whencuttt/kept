/** observes v2: the grammar, the canonical form, and the one property that must never break —
 *  a receipt sealed before v2 existed still hashes to exactly what it hashed before.
 *
 *  Run: npx tsx examples/observes-v2-test.ts
 *  No database, no signing key, no network: every case here is pure.
 */
import { commitPreimage, commitPreimageVersion } from "../src/lib/crypto";
import { sha256 } from "../src/lib/crypto";
import { canonicalObservesV2, compareWindows, observesKind, parseObservesV2 } from "../src/lib/observes";
import { parseObserves } from "../src/lib/receipts";

let pass = 0, fail = 0;
const ok = (name: string, cond: boolean, extra = "") => { if (cond) { pass++; console.log(`  ok   ${name}`); } else { fail++; console.log(`  FAIL ${name} ${extra}`); } };
const section = (s: string) => console.log(`\n${s}`);

// ---------------------------------------------------------------------------------------------
section("GOLDEN CANONICAL FORM — pin the bytes, so a change to the canonicaliser fails HERE");
// If this string ever changes, every typed_v2 receipt already on the ledger stops verifying.
// Changing it is a new preimage version, never an edit.
const golden = parseObservesV2({
  source: { kind: "db", id: "neon:kept/receipts" },
  selector: { kind: "sql", text: "select id from receipts where status = 'open'" },
  window: { from: "2026-09-17T09:30:00+05:30", to: "2026-09-17T10:00:00.000Z" },
  credential: "role:readonly",
});
ok("golden parses", golden.ok);
if (golden.ok) {
  const bytes = canonicalObservesV2(golden.value);
  ok("golden canonical bytes are exactly the pinned string", bytes ===
    '{"credential":"role:readonly","selector":{"kind":"sql","text":"select id from receipts where status = \'open\'"},"source":{"id":"neon:kept/receipts","kind":"db"},"window":{"from":"2026-09-17T04:00:00.000Z","to":"2026-09-17T10:00:00.000Z"}}',
    `\n       got ${bytes}`);
  ok("keys are sorted at every level", bytes.startsWith('{"credential":'));
  ok("+05:30 was normalised to UTC", bytes.includes('"from":"2026-09-17T04:00:00.000Z"'));
  ok("the canonical form round-trips to typed_v2", observesKind(bytes) === "typed_v2");
}

// ---------------------------------------------------------------------------------------------
section("OLD RECEIPTS SEAL EXACTLY AS BEFORE — the hard constraint");
const base = { agent: "a", claim: "c", check: "k", committed_at: "2026-09-01T00:00:00.000Z", nonce: "n" };
ok("no observes, no confidence -> v1", commitPreimageVersion({ confidence: null, observes: null }) === "kept-commit-v1");
ok("no observes, a confidence  -> v2", commitPreimageVersion({ confidence: 0.9, observes: null }) === "kept-commit-v2");
const prose = "rows in listings visible to the job's own DB role, at the moment of the after-snapshot";
ok("prose observes            -> v3", commitPreimageVersion({ confidence: 0.9, observes: prose }) === "kept-commit-v3");
const v1tuple = JSON.stringify({ source: "postgres listings table", selector: "rows visible to the job's own DB role", window: "the moment of the after-snapshot", credential: "nightly_job" });
ok("v1 tuple observes         -> v3", commitPreimageVersion({ confidence: 0.9, observes: v1tuple }) === "kept-commit-v3");
ok("v1 tuple is NOT mistaken for typed_v2", observesKind(v1tuple) === "typed_v1_untyped_fields");
ok("prose is prose", observesKind(prose) === "prose");
ok("no observes has no kind", observesKind(null) === null);
// The bytes themselves, not just the version tag.
ok("v1 preimage byte-identical to the pre-v2 formula",
  commitPreimage({ ...base, confidence: null, observes: null }) === ["kept-commit-v1", "a", "c", "k", "2026-09-01T00:00:00.000Z", "n"].join("\n"));
ok("v3 preimage byte-identical to the pre-v2 formula",
  commitPreimage({ ...base, confidence: 0.9, observes: v1tuple }) === ["kept-commit-v3", "a", "c", "k", v1tuple, "0.9", "2026-09-01T00:00:00.000Z", "n"].join("\n"));
ok("a stored kind never overrides the derivation into breaking a v3 row",
  commitPreimageVersion({ confidence: 0.9, observes: v1tuple, observes_kind: "typed_v1_untyped_fields" }) === "kept-commit-v3");

// ---------------------------------------------------------------------------------------------
section("v4 — used only for typed_v2");
if (golden.ok) {
  const bytes = canonicalObservesV2(golden.value);
  ok("typed_v2 -> v4", commitPreimageVersion({ confidence: 0.85, observes: bytes, observes_kind: "typed_v2" }) === "kept-commit-v4");
  ok("v4 preimage is v3's field order with the v4 tag",
    commitPreimage({ ...base, confidence: 0.85, observes: bytes, observes_kind: "typed_v2" }) === ["kept-commit-v4", "a", "c", "k", bytes, "0.85", "2026-09-01T00:00:00.000Z", "n"].join("\n"));
  ok("and it hashes", /^[0-9a-f]{64}$/.test(sha256(commitPreimage({ ...base, confidence: 0.85, observes: bytes, observes_kind: "typed_v2" }))));
}

// ---------------------------------------------------------------------------------------------
section("WINDOW VALIDATION");
const wbad = (w: unknown) => parseObserves({ source: { kind: "db", id: "x" }, selector: { kind: "sql", text: "select 1" }, window: w });
ok("offset-less from is rejected", wbad({ from: "2026-09-17T00:00:00", to: "2026-09-17T06:00:00Z" }).ok === false);
ok("offset-less to is rejected", wbad({ from: "2026-09-17T00:00:00Z", to: "2026-09-17T06:00:00" }).ok === false);
ok("to < from is rejected", wbad({ from: "2026-09-17T06:00:00Z", to: "2026-09-17T00:00:00Z" }).ok === false);
ok("to == from is accepted (an instant IS a window)", wbad({ from: "2026-09-17T06:00:00Z", to: "2026-09-17T06:00:00Z" }).ok === true);
ok("both shapes at once is rejected", wbad({ from: "2026-09-17T00:00:00Z", to: "2026-09-17T06:00:00Z", seconds_before_reveal: 60 }).ok === false);
ok("relative duration is accepted", wbad({ seconds_before_reveal: 3600 }).ok === true);
ok("non-integer duration is rejected", wbad({ seconds_before_reveal: 1.5 }).ok === false);
ok("zero duration is rejected", wbad({ seconds_before_reveal: 0 }).ok === false);
ok("a missing window is rejected", parseObserves({ source: { kind: "db", id: "x" }, selector: { kind: "sql", text: "select 1" } }).ok === false);
ok("sub-millisecond precision is rejected", wbad({ from: "2026-09-17T00:00:00.1234Z", to: "2026-09-17T06:00:00Z" }).ok === false);

// ---------------------------------------------------------------------------------------------
section("SELECTOR GRAMMAR — closed");
const sel = (s: unknown) => parseObserves({ source: { kind: "db", id: "x" }, selector: s, window: { seconds_before_reveal: 60 } });
ok("sql needs text", sel({ kind: "sql" }).ok === false);
ok("sql with text", sel({ kind: "sql", text: "select 1" }).ok === true);
ok("path with glob", sel({ kind: "path", glob: "src/**/*.ts" }).ok === true);
ok("http with method+url_pattern", sel({ kind: "http", method: "get", url_pattern: "https://x/y/*" }).ok === true);
ok("http method is normalised to upper case", (() => { const r = sel({ kind: "http", method: "get", url_pattern: "https://x/y/*" }); return r.ok && r.value!.canonical.includes('"method":"GET"'); })());
ok("table with name+predicate", sel({ kind: "table", name: "public.receipts", predicate: "status = 'open'" }).ok === true);
ok("table without predicate is rejected (free text, but NAMED)", sel({ kind: "table", name: "public.receipts" }).ok === false);
ok("an unknown selector kind is rejected", sel({ kind: "regex", pattern: ".*" }).ok === false);
ok("extra keys inside a selector are rejected", sel({ kind: "sql", text: "select 1", limit: "10" }).ok === false);

// ---------------------------------------------------------------------------------------------
section("SOURCE + CREDENTIAL");
const src = (s: unknown) => parseObserves({ source: s, selector: { kind: "sql", text: "select 1" }, window: { seconds_before_reveal: 60 } });
ok("an unknown source kind is rejected", src({ kind: "kafka", id: "x" }).ok === false);
for (const k of ["db", "fs", "http", "api", "other"]) ok(`source kind ${k}`, src({ kind: k, id: "x" }).ok === true);
ok("source without an id is rejected", src({ kind: "db" }).ok === false);
// The one that matters for the gate: observesCredential() reads this slot as a string. An object here
// would read as "no credential" and silently open every typed_v2 receipt's same-trust-domain hold.
ok("an object credential is rejected", parseObserves({ source: { kind: "db", id: "x" }, selector: { kind: "sql", text: "select 1" }, window: { seconds_before_reveal: 60 }, credential: { agent: "me" } }).ok === false);
ok("a string credential is kept verbatim", (() => { const r = parseObserves({ source: { kind: "db", id: "x" }, selector: { kind: "sql", text: "select 1" }, window: { seconds_before_reveal: 60 }, credential: "nightly_job" }); return r.ok && r.value!.canonical.includes('"credential":"nightly_job"'); })());

// ---------------------------------------------------------------------------------------------
section("BACK-COMPAT OF THE PARSER");
ok("a sentence still parses as prose", (() => { const r = parseObserves(prose); return r.ok && r.value!.kind === "prose"; })());
ok("the v1 tuple still parses, labelled", (() => { const r = parseObserves({ source: "postgres listings table", selector: "rows visible to the job's own DB role", window: "at the after-snapshot", credential: "nightly_job" }); return r.ok && r.value!.kind === "typed_v1_untyped_fields"; })());
ok("the v1 tuple still canonicalises in FIXED key order", (() => { const r = parseObserves({ source: "s-source", selector: "s-selector", window: "s-window", credential: "s-cred" }); return r.ok && r.value!.canonical === '{"source":"s-source","selector":"s-selector","window":"s-window","credential":"s-cred"}'; })());
ok("a structured member routes to v2 and gives a v2 error", (() => { const r = parseObserves({ source: "a sentence", selector: { kind: "sql", text: "select 1" }, window: { seconds_before_reveal: 60 } }); return !r.ok && r.error.includes("observes.source must be an object"); })());
ok("null observes stays null", (() => { const r = parseObserves(null); return r.ok && r.value === null; })());

// ---------------------------------------------------------------------------------------------
section("COMPARE");
const W = (from: string, to: string) => ({ from, to });
ok("overlapping windows overlap", compareWindows(W("2026-09-17T00:00:00.000Z", "2026-09-17T06:00:00.000Z"), W("2026-09-17T05:00:00.000Z", "2026-09-17T09:00:00.000Z")).overlap === true);
ok("disjoint windows do not", compareWindows(W("2026-09-17T00:00:00.000Z", "2026-09-17T06:00:00.000Z"), W("2026-09-17T07:00:00.000Z", "2026-09-17T09:00:00.000Z")).overlap === false);
ok("windows touching at one instant overlap (closed intervals)", compareWindows(W("2026-09-17T00:00:00.000Z", "2026-09-17T06:00:00.000Z"), W("2026-09-17T06:00:00.000Z", "2026-09-17T09:00:00.000Z")).overlap === true);
ok("the intersection is reported", (() => { const c = compareWindows(W("2026-09-17T00:00:00.000Z", "2026-09-17T06:00:00.000Z"), W("2026-09-17T05:00:00.000Z", "2026-09-17T09:00:00.000Z")); return c.comparable && c.overlap_from === "2026-09-17T05:00:00.000Z" && c.overlap_to === "2026-09-17T06:00:00.000Z"; })());
ok("a relative window is not comparable against an interval", compareWindows({ seconds_before_reveal: 60 }, W("2026-09-17T00:00:00.000Z", "2026-09-17T06:00:00.000Z")).comparable === false);
ok("two relative windows are not comparable either", compareWindows({ seconds_before_reveal: 60 }, { seconds_before_reveal: 60 }).comparable === false);

console.log(`\n${fail === 0 ? "PASS" : "FAIL"}  ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
