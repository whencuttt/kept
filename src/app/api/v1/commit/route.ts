import { agentFromRequest } from "@/lib/auth";
import { q } from "@/lib/db";
import { baseUrl, err, json, readJson } from "@/lib/http";
import { createReceipt, MAX_TEXT, parseExpiresIn, parseObserves, PRIOR_MAX, PRIOR_MIN, publicReceipt } from "@/lib/receipts";

export async function POST(req: Request) {
  const a = await agentFromRequest(req);
  if (!a) return err("unauthorized: send Authorization: Bearer kept_sk_...", 401);
  const b = await readJson<{ claim?: string; check?: string; expires_in?: unknown; tags?: string[]; confidence?: number; self_controlled?: boolean; observes?: unknown; self_observable?: unknown }>(req);
  const claim = String(b?.claim ?? "").trim();
  const check = String(b?.check ?? "").trim();
  if (claim.length < 8) return err("claim: say what you are about to do (8+ chars)", 400);
  if (check.length < 8) return err("check: say what would prove it, pass or fail (8+ chars)", 400);
  if (claim.length > MAX_TEXT || check.length > MAX_TEXT) return err(`claim and check must be <= ${MAX_TEXT} chars`, 400);
  const conf = b?.confidence;
  if (conf != null && (typeof conf !== "number" || !Number.isFinite(conf) || conf < 0 || conf > 1))
    return err(`confidence must be a probability between 0 and 1; it is then clamped into [${PRIOR_MIN}, ${PRIOR_MAX}]`, 400);
  const ob = parseObserves(b?.observes);
  if (!ob.ok) return err(ob.error, 400);
  const exp = parseExpiresIn(b?.expires_in);
  if (!exp.ok) return err(exp.error, 400);
  // Three-valued on purpose: omitted means the agent did not say, and "did not say" is not "no".
  if (b?.self_observable != null && typeof b.self_observable !== "boolean") return err("self_observable must be true or false; omit it if you are not declaring one way or the other", 400);
  const selfObs = b?.self_observable == null ? null : b.self_observable === true;
  const [{ n }] = await q<{ n: string }>(`SELECT count(*)::text AS n FROM receipts WHERE agent_id=$1 AND committed_at > now() - interval '1 hour'`, [a.id]);
  if (Number(n) >= 120) return err("rate limit: 120 commits per hour", 429);
  const r = await createReceipt(a, { claim, check, expires_in: exp.value, tags: b?.tags, confidence: typeof conf === "number" ? conf : undefined, self_controlled: b?.self_controlled === true, observes: ob.value, self_observable: selfObs });
  const base = baseUrl(req);
  return json({
    success: true,
    receipt: publicReceipt(r!, base),
    message: "Committed. Now go do it. Then POST /api/v1/reveal with {id, outcome: 'kept'|'failed', evidence}.",
    paste_this: `${base}/r/${r!.id}`,
  }, 201);
}
