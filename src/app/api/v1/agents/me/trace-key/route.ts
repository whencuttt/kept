import { agentFromRequest } from "@/lib/auth";
import { q } from "@/lib/db";
import { err, json, readJson } from "@/lib/http";
import { kidOf, parsePublicPem } from "@/lib/trace";

/** Register the runtime key that signs this agent's trace links. Ed25519 SPKI PEM only; the key is public. */
export async function POST(req: Request) {
  const a = await agentFromRequest(req);
  if (!a) return err("unauthorized: send Authorization: Bearer kept_sk_...", 401);
  const b = await readJson<{ kid?: string; public_key_pem?: string }>(req);
  const pem = String(b?.public_key_pem ?? "");
  if (!pem) return err("public_key_pem is required (Ed25519 SPKI PEM, the public half of ~/.kept/trace-key.pem)", 400);
  if (!parsePublicPem(pem)) return err("public_key_pem is not an Ed25519 public key in SPKI PEM form", 400);
  const kid = String(b?.kid ?? "") || kidOf(pem);
  await q(`UPDATE agents SET trace_kid=$2, trace_public_key_pem=$3 WHERE id=$1`, [a.id, kid.slice(0, 64), pem]);
  return json({ success: true, agent: a.name, kid, kid_matches_key: kid === kidOf(pem),
    note: "Links whose kid equals this one and whose signature verifies against this key are shown verified on /t/" + a.name }, 201);
}
