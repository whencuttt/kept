// bound-authz — authorization that carries its own parameters, and dies on the first deviation.
// No dependencies. Node 18+. Import { createGrant, authorize, revoke, incidents } and wrap every spend call.
//
// A grant binds a narrow policy to a token:
//   { max_amount, currency, allowed_to: [...], expires_at, max_calls?, strict?: ["currency", ...] }
// authorize(token, call) checks the call against the policy. Any deviation revokes the token immediately
// (so the *next* perfectly valid call is refused too) and records an incident with the offending call.
// A zero, missing, negative or non-numeric max_amount ALWAYS denies. There is no "0 means unlimited".
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const grants = new Map();      // token -> { policy, calls, spent, revoked, revoked_reason }
const incidentLog = [];

const b64 = (s) => Buffer.from(s).toString("base64url");
const sign = (secret, body) => createHmac("sha256", secret).update(body).digest("base64url");

export function createGrant(policy, secret) {
  const p = { ...policy };
  if (!(typeof p.max_amount === "number" && Number.isFinite(p.max_amount) && p.max_amount > 0)) {
    // deny at creation time: a grant with no positive budget is not a grant
    throw new Error("max_amount must be a positive finite number (0/undefined never means unlimited)");
  }
  if (!Array.isArray(p.allowed_to) || p.allowed_to.length === 0) throw new Error("allowed_to must be a non-empty allowlist");
  if (typeof p.currency !== "string" || !p.currency) throw new Error("currency required");
  if (!p.expires_at || Number.isNaN(Date.parse(p.expires_at))) throw new Error("expires_at (ISO) required");
  const id = randomBytes(12).toString("base64url");
  const body = b64(JSON.stringify({ id, policy: p }));
  const token = `${body}.${sign(secret, body)}`;
  grants.set(token, { id, policy: p, calls: 0, spent: 0, revoked: false, revoked_reason: null });
  return token;
}

function verifyToken(token, secret) {
  const [body, sig] = String(token).split(".");
  if (!body || !sig) return null;
  const expect = sign(secret, body);
  if (expect.length !== sig.length || !timingSafeEqual(Buffer.from(expect), Buffer.from(sig))) return null;
  return grants.get(token) ?? null;
}

export function revoke(token, reason, call = null) {
  const g = grants.get(token);
  if (!g) return;
  g.revoked = true; g.revoked_reason = reason;
  incidentLog.push({ at: new Date().toISOString(), grant: g.id, reason, call, policy: g.policy, for_human: `Grant ${g.id} revoked: ${reason}` });
}

/** Returns { ok: true, remaining } or { ok: false, reason, revoked: true|false }. Deviation => revoked. */
export function authorize(token, call, secret, now = new Date()) {
  const g = verifyToken(token, secret);
  if (!g) return { ok: false, reason: "invalid or unknown token", revoked: false };
  if (g.revoked) return { ok: false, reason: `token revoked earlier: ${g.revoked_reason}`, revoked: true };
  const p = g.policy;
  const strict = new Set(p.strict ?? []);
  const deny = (reason) => { revoke(token, reason, call); return { ok: false, reason, revoked: true }; };

  if (now.getTime() >= Date.parse(p.expires_at)) return deny(`grant expired at ${p.expires_at}`);
  if (!(typeof call.amount === "number" && Number.isFinite(call.amount) && call.amount > 0)) return deny(`amount must be a positive number, got ${JSON.stringify(call.amount)}`);
  if (call.currency !== p.currency) return deny(`currency ${call.currency} not bound currency ${p.currency}`);
  if (!p.allowed_to.includes(call.to)) return deny(`counterparty ${call.to} not in allowlist`);
  if (strict.has("amount") ? call.amount !== p.max_amount : call.amount > p.max_amount) return deny(`amount ${call.amount} exceeds bound ${p.max_amount}`);
  if (g.spent + call.amount > p.max_amount) return deny(`cumulative spend ${g.spent + call.amount} would exceed bound ${p.max_amount}`);
  if (p.max_calls != null && g.calls + 1 > p.max_calls) return deny(`call count would exceed max_calls ${p.max_calls}`);
  for (const k of Object.keys(call)) if (!["amount", "currency", "to", "memo"].includes(k)) return deny(`unexpected parameter '${k}' on a bound call`);

  g.calls += 1; g.spent += call.amount;
  return { ok: true, remaining: p.max_amount - g.spent, calls_left: p.max_calls == null ? null : p.max_calls - g.calls };
}

export const incidents = () => incidentLog.slice();
