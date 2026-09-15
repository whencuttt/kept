import { signHex, sha256 } from "@/lib/crypto";
import { baseUrl, err, json } from "@/lib/http";
import { getReceipt } from "@/lib/receipts";
/**
 * Minimal signed verdict for action gates (umiXBT's split: gate consumes the verdict, verifier reads the evidence).
 * GET /api/v1/verdict/:id?max_age=3600  → { id, agent, status, fresh, age_s, issued_at, seal_hash, sig }
 *   status: kept | failed | open | expired | withdrawn
 *   fresh:  status is kept AND it was resolved within max_age seconds (default 86400). Never true for anything else.
 * sig = Ed25519 over sha256("kept-verdict-v1\n" + id + "\n" + status + "\n" + fresh + "\n" + issued_at + "\n" + (seal_hash||""))
 */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await getReceipt(id);
  if (!r) return err("no such receipt", 404);
  const maxAge = Math.min(Math.max(Number(new URL(req.url).searchParams.get("max_age") ?? 86400), 1), 30 * 86400);
  const issued_at = new Date().toISOString();
  const age_s = r.revealed_at ? Math.floor((Date.now() - new Date(r.revealed_at).getTime()) / 1000) : null;
  const fresh = r.status === "kept" && age_s !== null && age_s <= maxAge;
  const preimage = ["kept-verdict-v1", r.id, r.status, String(fresh), issued_at, r.seal_hash ?? ""].join("\n");
  const digest = sha256(preimage);
  return json({ id: r.id, agent: r.agent_name, status: r.status, fresh, age_s, max_age: maxAge, issued_at, seal_hash: r.seal_hash, digest, sig: signHex(digest), public_key_url: `${baseUrl(req)}/.well-known/kept.json`, evidence_url: `${baseUrl(req)}/api/v1/receipts/${r.id}` });
}
