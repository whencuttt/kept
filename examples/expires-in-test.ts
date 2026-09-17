/**
 * Offline test for parseExpiresIn — the sealed-deadline parser.
 *
 *   npx tsx examples/expires-in-test.ts
 *
 * No network, no database, no signing key: parseExpiresIn is pure, and both db() and the signing
 * keys are lazy, so importing src/lib/receipts.ts costs nothing.
 *
 * What it pins, and why each case exists:
 *   - an ISO string with NO timezone offset is REJECTED (it names no instant; reading it in the
 *     server's local zone seals a different moment on a differently-configured deployment);
 *   - an accepted instant is carried as ABSOLUTE MILLISECONDS, equal to Date.parse of what was sent,
 *     so createReceipt seals it exactly instead of flooring it into a whole-second duration
 *     (the old path sealed up to 1s early: kpt_4jneaf347p asked 12:00:00.000Z, sealed 11:59:59.912Z);
 *   - +05:30 converts correctly, i.e. to the same instant as the equivalent Z string;
 *   - numeric seconds are unchanged — still a duration measured from commit time;
 *   - absence reaches each caller's own default (24h on /commit, 72h on an ask take), never a shared one;
 *   - `null` is treated exactly as an omitted key. That is a DESIGN CHOICE, not an oversight, and
 *     this test asserts the two are identical so nobody "fixes" it by accident. It is also why
 *     receipt kpt_6t4nnwnssd resolved `failed`: its sealed check demanded a 400 here, and the check
 *     governs. See src/lib/receipts.ts.
 */
import { DEFAULT_TTL, MAX_TTL, parseExpiresIn, secondsExpiresIn, type ExpiresIn } from "../src/lib/receipts";

let pass = 0;
const fails: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else { fails.push(name); console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`); }
}
/** A timestamp far enough out to clear the 60s floor and stay inside the 30d ceiling. */
const plusDays = (d: number) => new Date(Date.now() + d * 86400_000);
const ok = (v: unknown) => { const r = parseExpiresIn(v); return r.ok ? r.value : null; };
const rejected = (v: unknown) => { const r = parseExpiresIn(v); return r.ok ? null : r.error; };

console.log("\n1. an ISO string with no explicit timezone offset is rejected with a reason");
for (const s of ["2026-09-20T12:00:00", "2026-09-20T12:00", "2026-09-20T12:00:00.500", "2026-09-20", "2026-09-20 12:00:00"]) {
  const e = rejected(s);
  check(`rejected ${JSON.stringify(s)}`, e != null, "was accepted — it would be read in the server's local zone");
  if (e) check(`  ...and the error says what is missing`, /no timezone offset|ISO-8601/.test(e), e);
}

console.log("\n2. a fully-qualified ISO instant with Z is accepted and kept to the millisecond");
{
  const d = plusDays(3);
  d.setUTCMilliseconds(250);
  const s = d.toISOString(); // ...T..:..:..250Z
  const v = ok(s) as ExpiresIn | null;
  check(`accepted ${s}`, v != null);
  check("  ...as an absolute instant, not a duration", v?.kind === "instant", `kind=${v?.kind}`);
  check("  ...equal to Date.parse of the string, to the ms", v?.kind === "instant" && v.atMs === Date.parse(s), `${v?.kind === "instant" ? v.atMs : "n/a"} vs ${Date.parse(s)}`);
  check("  ...carrying the .250 milliseconds", v?.kind === "instant" && new Date(v.atMs).getUTCMilliseconds() === 250);
  // The defect this replaces: flooring to whole seconds of duration lost up to 999ms.
  const floored = Math.floor((Date.parse(s) - Date.now()) / 1000) * 1000 + Date.now();
  check("  ...and is NOT the old whole-second-floored value", v?.kind === "instant" && v.atMs !== Math.floor(floored), "");
}

console.log("\n3. an ISO instant with +05:30 is accepted and converted correctly");
{
  const day = plusDays(5).toISOString().slice(0, 10);
  const ist = `${day}T19:30:00.125+05:30`;
  const utc = `${day}T14:00:00.125Z`;
  const a = ok(ist) as ExpiresIn | null, b = ok(utc) as ExpiresIn | null;
  check(`accepted ${ist}`, a != null);
  check("  ...to the same instant as the equivalent Z string", a?.kind === "instant" && b?.kind === "instant" && a.atMs === b.atMs, `${a?.kind === "instant" ? new Date(a.atMs).toISOString() : "n/a"} vs ${utc}`);
  check("  ...keeping the .125 milliseconds", a?.kind === "instant" && new Date(a.atMs).getUTCMilliseconds() === 125);
  // The compact +HHMM spelling is the same instant.
  const compact = ok(`${day}T19:30:00.125+0530`) as ExpiresIn | null;
  check("  ...and +0530 without the colon agrees", compact?.kind === "instant" && a?.kind === "instant" && compact.atMs === a.atMs);
}

console.log("\n4. numeric seconds are unchanged — still a duration from commit time");
{
  const v = ok(3600) as ExpiresIn | null;
  check("3600 accepted as seconds", v?.kind === "seconds" && v.seconds === 3600, JSON.stringify(v));
  const str = ok("3600") as ExpiresIn | null;
  check('"3600" (numeric string) accepted as seconds', str?.kind === "seconds" && str.seconds === 3600);
  check("60 (the floor) accepted", (ok(60) as ExpiresIn | null)?.kind === "seconds");
  check(`${MAX_TTL} (the ceiling) accepted`, (ok(MAX_TTL) as ExpiresIn | null)?.kind === "seconds");
  check("59 rejected, not clamped up", rejected(59) != null);
  check(`${MAX_TTL + 1} rejected, not clamped down`, rejected(MAX_TTL + 1) != null);
  check("3600.9 floored to 3600", (ok(3600.9) as ExpiresIn | null)?.kind === "seconds" && (ok(3600.9) as { kind: "seconds"; seconds: number }).seconds === 3600);
}

console.log("\n5. null is treated as an omitted key — by design, asserted so it cannot drift");
{
  const n = parseExpiresIn(null), u = parseExpiresIn(undefined);
  check("null is accepted", n.ok);
  check("undefined is accepted", u.ok);
  check("null and undefined produce the IDENTICAL value", JSON.stringify(n) === JSON.stringify(u) && (n.ok ? n.value : 0) === (u.ok ? u.value : 1), `${JSON.stringify(n)} vs ${JSON.stringify(u)}`);
  check("both mean 'nothing was asked for' (undefined, not a third variant)", n.ok && n.value === undefined);
  console.log(`       (/commit then applies ${DEFAULT_TTL}s; null carries no value to destroy, unlike the ISO-string bug that started this)`);
}

console.log("\n5b. absence must reach each caller's OWN default, not a shared one");
{
  // Regression guard. parseExpiresIn briefly returned a {kind:"default"} member instead of undefined.
  // It type-checked, /commit was unaffected, and every live probe passed -- but it is not nullish, so
  // takeAsk's `expires_in ?? secondsExpiresIn(72 * 3600)` stopped firing and an ask taken without an
  // expires_in would have sealed 24h instead of 72h: a deadline nobody asked for, which is the exact
  // defect class this whole file is about. Absence is undefined so every `??` fallback keeps working.
  const absent = parseExpiresIn(undefined);
  const viaTakeAsk = (absent.ok ? absent.value : null) ?? secondsExpiresIn(72 * 3600); // takeAsk, src/lib/asks.ts
  check("an ask taken with no expires_in still gets 72h", viaTakeAsk.kind === "seconds" && viaTakeAsk.seconds === 259200, JSON.stringify(viaTakeAsk));
  // createReceipt's own branch: undefined falls through to DEFAULT_TTL, an explicit duration does not.
  const commitTtl = (e?: ExpiresIn) => (e?.kind === "seconds" ? e.seconds : DEFAULT_TTL);
  check("/commit with no expires_in still gets 24h", commitTtl(absent.ok ? absent.value : undefined) === DEFAULT_TTL);
  check("/commit with an explicit 3600 is not overridden by the default", commitTtl(secondsExpiresIn(3600)) === 3600);
}

console.log("\n5c. an impossible calendar date is REFUSED, never rolled forward");
{
  // Date.parse turns 2026-02-30 into 2026-03-02 and 2026-04-31 into 2026-05-01 without complaint.
  // Sealing that would seal a deadline the caller never wrote. Found live on 2026-09-17.
  const soon = new Date(Date.now() + 3 * 86400_000);
  const y = soon.getUTCFullYear(), mo = String(soon.getUTCMonth() + 1).padStart(2, "0");
  for (const v of [`${y}-02-30T00:00:00Z`, `${y}-04-31T00:00:00Z`, `${y}-06-31T12:00:00+05:30`, "2027-02-29T00:00:00Z", `${y}-${mo}-10T23:59:60Z`, `${y}-${mo}-10T24:00:01Z`]) {
    const e = rejected(v);
    check(`refused by name: ${v}`, e != null && e.includes("is not a real date"), String(e));
  }
  // A real leap day is a real date: whatever refuses it must not be the calendar check.
  const leap = rejected("2028-02-29T00:00:00Z");
  check("2028-02-29 is a real date (refused only for being >30 days away)", leap != null && !leap.includes("not a real date") && leap.includes("30 days"), String(leap));
  // 24:00:00 is the same instant as 00:00 the next day, so it is accepted and sealed exactly.
  const d = String(soon.getUTCDate()).padStart(2, "0");
  const midnight = parseExpiresIn(`${y}-${mo}-${d}T24:00:00Z`);
  const next = Date.UTC(y, soon.getUTCMonth(), soon.getUTCDate() + 1);
  check("T24:00:00Z is accepted as 00:00 of the next day", midnight.ok && midnight.value?.kind === "instant" && midnight.value.atMs === next, JSON.stringify(midnight));
}

console.log("\n6. everything else is still refused rather than substituted");
for (const v of ["", "7d", "not a date", "2026-13-45T00:00:00Z", "1970-01-01T00:00:00Z", [], {}, false, [3600], -1, NaN, Infinity])
  check(`rejected ${typeof v === "number" && !Number.isFinite(v) ? String(v) : JSON.stringify(v)}`, rejected(v) != null);

console.log(`\n${fails.length ? `FAILED ${fails.length}` : "PASSED"} — ${pass} assertions ok${fails.length ? `, failures: ${fails.join("; ")}` : ""}\n`);
process.exit(fails.length ? 1 : 0);
