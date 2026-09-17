/** The typed `observes` grammar, v2.
 *
 *  WHY THIS FILE EXISTS. `observes` shipped as four free-prose fields — {source, selector, window,
 *  credential} — and the canonicalisation faithfully sealed whatever sentence was typed. That buys
 *  NON-RETROACTIVITY (the boundary cannot be reworded after the sample is drawn) and buys nothing a
 *  second party can compare one receipt against another with: `window` was not an interval and
 *  `selector` was not a selector, they were English descriptions of one. Two receipts with genuinely
 *  identical windows are two different strings; two with the same scope worded differently are also two
 *  different strings; string inequality carries no information in either direction.
 *  thegreekgodhermes' name for that shape is the one to keep: "non-retroactivity without comparability
 *  is an audit log, not a receipt."
 *
 *  v2 closes it by typing the two fields a reader actually has to compare. `window` is an interval or a
 *  named relative duration. `selector` is one of four shapes from a CLOSED grammar — a reader can
 *  enumerate every form it will ever have to understand. `source` names a kind and an id. `credential`
 *  stays a plain string, unchanged from v1, because `observesCredential()` reads it to decide the
 *  same-trust-domain hold and an object there would silently open every typed_v2 receipt.
 *
 *  NOTHING ALREADY SEALED CHANGES. Prose is still accepted and is labelled `prose`. The v1 four-string
 *  tuple is still accepted and is labelled `typed_v1_untyped_fields` — accepted, and visibly not
 *  comparable, which is the honest label for what it is. Only `typed_v2` seals under `kept-commit-v4`.
 */

/** A fully-qualified ISO-8601 instant: date, time, and an EXPLICIT offset (Z, +HH:MM or +HHMM). */
export const ISO_INSTANT = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d+))?(Z|z|[+-]\d{2}:\d{2}|[+-]\d{4})$/;
/** ISO-8601-shaped but with no offset at all — a local wall-clock reading, not an instant. Matched
 *  separately only so the 400 can say what is missing instead of "not a date". */
export const ISO_NO_OFFSET = /^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)?$/;

/** Date.parse ROLLS impossible calendar fields forward instead of failing: "2026-02-30" becomes
 *  2026-03-02 and "2026-04-31" becomes 2026-05-01. A value about to be sealed must never be moved to a
 *  date the caller did not write, so the fields are checked here and an impossible one is refused.
 *  "24:00:00" with no fraction is allowed: it is the same instant as 00:00 of the next day, not a move.
 *  Returns null when the fields name a real moment, else the reason. */
export function calendarError(date: string, hh: string, mm: string, ss: string | undefined, frac: string | undefined): string | null {
  const [y, mo, d] = date.split("-").map(Number);
  if (mo < 1 || mo > 12) return `month ${String(mo).padStart(2, "0")} does not exist`;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const dim = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][mo - 1];
  if (d < 1 || d > dim) return `${date} does not exist (${y}-${String(mo).padStart(2, "0")} has ${dim} days)`;
  const h = Number(hh), mi = Number(mm), sec = Number(ss ?? "0");
  if (mi > 59) return `minute ${mm} is out of range`;
  if (sec > 59) return `second ${ss} is out of range (a leap second cannot be represented or sealed)`;
  if (h > 24 || (h === 24 && (mi !== 0 || sec !== 0 || /[^0]/.test(frac ?? "")))) return `hour ${hh} is out of range`;
  return null;
}

/** Parse one fully-qualified ISO instant to epoch ms. Rejects an offset-less string by name, and
 *  rejects sub-millisecond precision rather than truncate a value that is about to be sealed. */
export function instantMs(raw: string, what: string): { ok: true; ms: number } | { ok: false; error: string } {
  const s = raw.trim();
  const m = ISO_INSTANT.exec(s);
  if (!m) {
    if (ISO_NO_OFFSET.test(s))
      return { ok: false, error: `${what} ${JSON.stringify(s)} has no timezone offset, so it names no instant — the same string would seal a different moment on a differently-configured server. Add Z or an offset such as +05:30.` };
    return { ok: false, error: `${what} ${JSON.stringify(s)} is not a fully-qualified ISO-8601 instant such as "2026-09-17T04:00:00Z" or "2026-09-17T09:30:00+05:30".` };
  }
  const [, date, hh, mm, ss, frac, offRaw] = m;
  const cal = calendarError(date, hh, mm, ss, frac);
  if (cal) return { ok: false, error: `${what} ${JSON.stringify(s)} is not a real date: ${cal}. Kept refuses it rather than seal a date you did not write.` };
  if (frac && frac.length > 3 && /[^0]/.test(frac.slice(3)))
    return { ok: false, error: `${what} ${JSON.stringify(s)} carries sub-millisecond precision (.${frac}); Kept seals milliseconds and will not truncate a value you cannot amend. Round it to at most 3 fractional digits.` };
  const ms3 = (frac ?? "").slice(0, 3).padEnd(3, "0");
  const off = offRaw.toUpperCase() === "Z" ? "Z" : offRaw.length === 5 ? `${offRaw.slice(0, 3)}:${offRaw.slice(3)}` : offRaw;
  if (off !== "Z" && (Number(off.slice(1, 3)) > 23 || Number(off.slice(4, 6)) > 59))
    return { ok: false, error: `${what} ${JSON.stringify(s)} has an out-of-range timezone offset.` };
  const ms = Date.parse(`${date}T${hh}:${mm}:${ss ?? "00"}.${ms3}${off}`);
  if (!Number.isFinite(ms)) return { ok: false, error: `${what} ${JSON.stringify(s)} is not a real date.` };
  return { ok: true, ms };
}

export const SOURCE_KINDS = ["db", "fs", "http", "api", "other"] as const;
export const SELECTOR_KINDS = ["sql", "path", "http", "table"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export type ObservesSource = { kind: SourceKind; id: string };
export type ObservesSelector =
  | { kind: "sql"; text: string }
  | { kind: "path"; glob: string }
  | { kind: "http"; method: string; url_pattern: string }
  | { kind: "table"; name: string; predicate: string };
/** Either a real interval, normalised to UTC, or a duration measured back from the reveal. */
export type ObservesWindow = { from: string; to: string } | { seconds_before_reveal: number };
export type ObservesV2 = { credential: string; selector: ObservesSelector; source: ObservesSource; window: ObservesWindow };

/** How the boundary was expressed. It decides which commit preimage seals the receipt, and it is the
 *  one field a reader checks before believing that two receipts can be compared at all. */
export type ObservesKind = "prose" | "typed_v1_untyped_fields" | "typed_v2";

/** A window that is a real interval and not a duration. */
export const isInterval = (w: ObservesWindow): w is { from: string; to: string } => "from" in w;
/** The longest relative window a v2 receipt may declare: one year. Longer coverage is an interval. */
export const MAX_WINDOW_SECONDS = 365 * 24 * 3600;
/** The v2 canonical form carries its own structure, so it is longer than a prose boundary for the same
 *  content. The cap is raised for v2 ONLY: no receipt on the ledger is typed_v2, so a v2-only cap
 *  cannot change what any sealed receipt was allowed to say. */
export const MAX_OBSERVES_V2 = 1200;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const extraKeys = (o: Record<string, unknown>, allowed: readonly string[]) => Object.keys(o).filter((k) => !allowed.includes(k));

type V2Result = { ok: true; value: ObservesV2 } | { ok: false; error: string };

function parseSource(raw: unknown): { ok: true; value: ObservesSource } | { ok: false; error: string } {
  if (!isObj(raw)) return { ok: false, error: `observes.source must be an object {kind, id} with kind one of ${SOURCE_KINDS.join(" | ")} — e.g. {"kind":"db","id":"neon:kept/receipts"}` };
  const x = extraKeys(raw, ["kind", "id"]);
  if (x.length) return { ok: false, error: `observes.source takes only kind and id; remove ${x.join(", ")}` };
  const kind = str(raw.kind);
  if (!(SOURCE_KINDS as readonly string[]).includes(kind)) return { ok: false, error: `observes.source.kind must be one of ${SOURCE_KINDS.join(" | ")}; got ${JSON.stringify(raw.kind ?? null)}` };
  const id = str(raw.id);
  if (!id) return { ok: false, error: 'observes.source.id must name the specific source, e.g. "neon:kept/receipts" or "github:whencuttt/kept@main"' };
  if (id.length > 300) return { ok: false, error: "observes.source.id must be <= 300 chars" };
  return { ok: true, value: { kind: kind as SourceKind, id } };
}

function parseSelector(raw: unknown): { ok: true; value: ObservesSelector } | { ok: false; error: string } {
  const grammar = `observes.selector is a CLOSED grammar — exactly one of {"kind":"sql","text":...} | {"kind":"path","glob":...} | {"kind":"http","method":...,"url_pattern":...} | {"kind":"table","name":...,"predicate":...}`;
  if (!isObj(raw)) return { ok: false, error: `observes.selector must be an object. ${grammar}` };
  const kind = str(raw.kind);
  if (!(SELECTOR_KINDS as readonly string[]).includes(kind)) return { ok: false, error: `observes.selector.kind must be one of ${SELECTOR_KINDS.join(" | ")}; got ${JSON.stringify(raw.kind ?? null)}. ${grammar}` };
  const need = (k: string, hint: string): { ok: true; v: string } | { ok: false; error: string } => {
    const v = str(raw[k]);
    if (!v) return { ok: false, error: `observes.selector.${k} is required for kind "${kind}" and must be a non-empty string — ${hint}` };
    if (v.length > 400) return { ok: false, error: `observes.selector.${k} must be <= 400 chars` };
    return { ok: true, v };
  };
  const allowed = kind === "sql" ? ["kind", "text"] : kind === "path" ? ["kind", "glob"] : kind === "http" ? ["kind", "method", "url_pattern"] : ["kind", "name", "predicate"];
  const x = extraKeys(raw, allowed);
  if (x.length) return { ok: false, error: `observes.selector of kind "${kind}" takes only ${allowed.join(", ")}; remove ${x.join(", ")}. ${grammar}` };
  if (kind === "sql") { const t = need("text", "the query the check actually runs"); return t.ok ? { ok: true, value: { kind: "sql", text: t.v } } : t; }
  if (kind === "path") { const g = need("glob", 'a path glob such as "src/lib/**/*.ts"'); return g.ok ? { ok: true, value: { kind: "path", glob: g.v } } : g; }
  if (kind === "http") {
    const m = need("method", 'an HTTP method such as "GET", or "*" for any');
    if (!m.ok) return m;
    const method = m.v.toUpperCase();
    if (!/^(\*|[A-Z]{3,10})$/.test(method)) return { ok: false, error: `observes.selector.method must be an HTTP method such as GET, POST or PATCH, or "*" for any; got ${JSON.stringify(m.v)}` };
    const u = need("url_pattern", 'the URL shape the check reads, e.g. "https://kept-ledger.vercel.app/api/v1/receipts/*"');
    return u.ok ? { ok: true, value: { kind: "http", method, url_pattern: u.v } } : u;
  }
  const n = need("name", 'the table name, e.g. "public.receipts"');
  if (!n.ok) return n;
  const p = need("predicate", 'which rows — free text, but NAMED, e.g. "status = \'open\' and agent_id = mine"');
  return p.ok ? { ok: true, value: { kind: "table", name: n.v, predicate: p.v } } : p;
}

function parseWindow(raw: unknown): { ok: true; value: ObservesWindow } | { ok: false; error: string } {
  const grammar = `observes.window is either an ISO-8601 interval {"from":"2026-09-17T00:00:00Z","to":"2026-09-17T06:00:00Z"} — both fully qualified, both normalised to UTC when sealed — or a relative duration {"seconds_before_reveal":3600}`;
  if (!isObj(raw)) return { ok: false, error: `observes.window must be an object. ${grammar}` };
  const hasInterval = "from" in raw || "to" in raw;
  const hasRelative = "seconds_before_reveal" in raw;
  if (hasInterval && hasRelative) return { ok: false, error: `observes.window is one shape or the other, never both. ${grammar}` };
  if (hasRelative) {
    const x = extraKeys(raw, ["seconds_before_reveal"]);
    if (x.length) return { ok: false, error: `observes.window of the relative shape takes only seconds_before_reveal; remove ${x.join(", ")}` };
    const n = raw.seconds_before_reveal;
    if (typeof n !== "number" || !Number.isFinite(n) || !Number.isInteger(n) || n < 1)
      return { ok: false, error: `observes.window.seconds_before_reveal must be a whole number of seconds, 1 or more; got ${JSON.stringify(n ?? null)}` };
    if (n > MAX_WINDOW_SECONDS) return { ok: false, error: `observes.window.seconds_before_reveal is over the ${MAX_WINDOW_SECONDS}s (one year) maximum; a longer coverage window should be stated as an interval` };
    return { ok: true, value: { seconds_before_reveal: n } };
  }
  if (!hasInterval) return { ok: false, error: `observes.window must say which one it is. ${grammar}` };
  const x = extraKeys(raw, ["from", "to"]);
  if (x.length) return { ok: false, error: `observes.window of the interval shape takes only from and to; remove ${x.join(", ")}` };
  if (typeof raw.from !== "string" || typeof raw.to !== "string") return { ok: false, error: `observes.window needs both from and to as ISO-8601 strings. ${grammar}` };
  const a = instantMs(raw.from, "observes.window.from");
  if (!a.ok) return a;
  const b = instantMs(raw.to, "observes.window.to");
  if (!b.ok) return b;
  if (b.ms < a.ms) return { ok: false, error: `observes.window ends before it starts (to ${JSON.stringify(raw.to)} is earlier than from ${JSON.stringify(raw.from)}); a window that runs backwards covers nothing` };
  // Normalised to UTC with millisecond precision, so two agents naming the same interval in different
  // zones seal the same bytes. That equality is the whole point of typing the field.
  return { ok: true, value: { from: new Date(a.ms).toISOString(), to: new Date(b.ms).toISOString() } };
}

/** Validate a candidate typed_v2 observes. Returns the normalised object, never the input. */
export function parseObservesV2(raw: unknown): V2Result {
  if (!isObj(raw)) return { ok: false, error: "observes: a sentence, the v1 tuple of four strings, or the typed v2 object {source, selector, window, credential}" };
  const x = extraKeys(raw, ["source", "selector", "window", "credential"]);
  if (x.length) return { ok: false, error: `observes: only source, selector, window, credential are sealed; remove ${x.join(", ")}` };
  const s = parseSource(raw.source);
  if (!s.ok) return s;
  const sel = parseSelector(raw.selector);
  if (!sel.ok) return sel;
  if (raw.window == null) return { ok: false, error: 'observes.window is required in the typed v2 shape: an interval {"from","to"} or {"seconds_before_reveal"}. A boundary with no window is not a boundary.' };
  const w = parseWindow(raw.window);
  if (!w.ok) return w;
  // Unchanged from v1 on purpose: observesCredential() reads this slot as a string to decide the
  // same-trust-domain hold. An object here would read as "no credential" and silently open the gate.
  if (raw.credential != null && typeof raw.credential !== "string") return { ok: false, error: 'observes.credential stays a plain string naming the agent, role or token_id the check reads as — e.g. "nightly_job" or "role:readonly"' };
  const credential = str(raw.credential);
  if (credential.length > 200) return { ok: false, error: "observes.credential must be <= 200 chars" };
  return { ok: true, value: { credential, selector: sel.value, source: s.value, window: w.value } };
}

/** Deterministic canonical form: every object's keys sorted, compact JSON, timestamps already
 *  normalised to UTC by the parser. A stranger with the parsed object recomputes these exact bytes. */
const sortDeep = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(sortDeep) : isObj(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortDeep(v[k])])) : v;
export const canonicalObservesV2 = (o: ObservesV2): string => JSON.stringify(sortDeep(o));

const V1_KEYS = ["source", "selector", "window", "credential"];

/** Which shape a SEALED observes string is in. Pure: the same string always answers the same way, so a
 *  reader offline can tell which preimage version sealed the receipt from the receipt alone.
 *  The stored `observes_kind` column is the authority for rows that have one; this is the fallback for
 *  rows sealed before the column existed, none of which can be typed_v2 (the v1 canonical form carries
 *  four STRING fields and v2 requires objects, so the two shapes cannot collide). */
export function observesKind(observes: string | null | undefined): ObservesKind | null {
  const t = (observes ?? "").trim();
  if (!t) return null;
  if (!t.startsWith("{")) return "prose";
  let p: unknown;
  try { p = JSON.parse(t); } catch { return "prose"; }
  if (!isObj(p)) return "prose";
  const v2 = parseObservesV2(p);
  if (v2.ok && canonicalObservesV2(v2.value) === t) return "typed_v2";
  const keys = Object.keys(p);
  if (keys.length > 0 && keys.every((k) => V1_KEYS.includes(k)) && keys.every((k) => typeof p[k] === "string")) return "typed_v1_untyped_fields";
  return "prose";
}

/** The sealed boundary as an object, for readers. `prose` has none — that is the point of the label. */
export function observesParsed(observes: string | null | undefined, kind: ObservesKind | null): Record<string, unknown> | null {
  if (!observes || kind === "prose" || kind == null) return null;
  try { const p: unknown = JSON.parse(observes.trim()); return isObj(p) ? p : null; } catch { return null; }
}

/** What one typed_v2 receipt can be said about another. The FIRST comparability primitive: do the two
 *  windows overlap, and are the two selectors the same selector. Deliberately narrow — a relative
 *  window is anchored to each receipt's own reveal, so comparing one against an interval would be a
 *  time-dependent answer, and a time-dependent answer is the ambiguity this whole change removes. */
export type WindowComparison =
  | { comparable: true; basis: "absolute"; overlap: boolean; overlap_from: string | null; overlap_to: string | null }
  | { comparable: false; basis: string; overlap: null; reason: string };

export function compareWindows(a: ObservesWindow, b: ObservesWindow): WindowComparison {
  const basisOf = (w: ObservesWindow) => (isInterval(w) ? "absolute" : "relative");
  if (!isInterval(a) || !isInterval(b))
    return {
      comparable: false, basis: `${basisOf(a)} vs ${basisOf(b)}`, overlap: null,
      reason: "a relative window (seconds_before_reveal) is anchored to its own receipt's reveal, not to a clock, so it names no interval two receipts can be laid against each other. Overlap is reported only when both windows are absolute intervals.",
    };
  const af = Date.parse(a.from), at = Date.parse(a.to), bf = Date.parse(b.from), bt = Date.parse(b.to);
  // Closed intervals: two windows that touch at a single instant did observe that instant in common.
  const overlap = af <= bt && bf <= at;
  return {
    comparable: true, basis: "absolute", overlap,
    overlap_from: overlap ? new Date(Math.max(af, bf)).toISOString() : null,
    overlap_to: overlap ? new Date(Math.min(at, bt)).toISOString() : null,
  };
}

/** Selector identity over the canonical form: same kind, same fields, byte for byte. */
export const sameCanonical = (a: unknown, b: unknown) => JSON.stringify(sortDeep(a)) === JSON.stringify(sortDeep(b));
