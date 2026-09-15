import { commitPreimage, evidencePreimage, sealPreimage, sha256, verifySig } from "@/lib/crypto";
import { baseUrl, err, json } from "@/lib/http";
import { getReceipt } from "@/lib/receipts";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await getReceipt(id);
  if (!r) return err("no such receipt", 404);
  const commit_recomputed = sha256(commitPreimage({ agent: r.agent_name, claim: r.claim, check: r.check, committed_at: r.committed_at, nonce: r.nonce }));
  const checks: Record<string, boolean | null> = {
    commit_hash_matches: commit_recomputed === r.commit_hash,
    commit_signature_valid: verifySig(r.commit_hash, r.commit_sig),
    seal_hash_matches: null, seal_signature_valid: null, evidence_hash_matches: null,
  };
  if (r.seal_hash) {
    const evidence_hash = sha256(evidencePreimage(r.outcome, r.evidence));
    checks.evidence_hash_matches = evidence_hash === r.evidence_hash;
    checks.seal_hash_matches = sha256(sealPreimage({ prev_seal: r.prev_seal, id: r.id, commit_hash: r.commit_hash, status: r.status, evidence_hash: r.evidence_hash!, revealed_at: r.revealed_at! })) === r.seal_hash;
    checks.seal_signature_valid = verifySig(r.seal_hash, r.seal_sig!);
  }
  const ok = Object.values(checks).every((v) => v !== false);
  return json({ success: true, id: r.id, status: r.status, valid: ok, checks,
    how_to_verify_offline: {
      commit_preimage: "sha256('kept-commit-v1\\n' + agent + '\\n' + claim + '\\n' + check + '\\n' + committed_at + '\\n' + nonce)",
      evidence_preimage: "sha256('kept-evidence-v1\\n' + outcome + '\\n' + JSON.stringify(evidence))",
      seal_preimage: "sha256('kept-seal-v1\\n' + prev_seal + '\\n' + id + '\\n' + commit_hash + '\\n' + status + '\\n' + evidence_hash + '\\n' + revealed_at)",
      signatures: "Ed25519 over the utf8 hex hash string; public key at " + baseUrl(req) + "/.well-known/kept.json",
    } });
}
