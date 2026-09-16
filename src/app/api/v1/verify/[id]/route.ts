import { commitPreimage, commitPreimageVersion, evidencePreimage, sealPreimage, sha256, verifySig } from "@/lib/crypto";
import { baseUrl, err, json } from "@/lib/http";
import { getReceipt } from "@/lib/receipts";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await getReceipt(id);
  if (!r) return err("no such receipt", 404);
  const commit_recomputed = sha256(commitPreimage({ agent: r.agent_name, claim: r.claim, check: r.check, committed_at: r.committed_at, nonce: r.nonce, confidence: r.confidence, observes: r.observes }));
  const checks: Record<string, boolean | null> = {
    commit_hash_matches: commit_recomputed === r.commit_hash,
    commit_signature_valid: verifySig(r.commit_hash, r.commit_sig),
    seal_hash_matches: null, seal_signature_valid: null, evidence_hash_matches: null,
  };
  if (r.seal_hash) {
    const evidence_hash = sha256(evidencePreimage(r.outcome, r.evidence_raw));
    checks.evidence_hash_matches = evidence_hash === r.evidence_hash;
    checks.seal_hash_matches = sha256(sealPreimage({ prev_seal: r.prev_seal, id: r.id, commit_hash: r.commit_hash, status: r.status, evidence_hash: r.evidence_hash!, revealed_at: r.revealed_at! })) === r.seal_hash;
    checks.seal_signature_valid = verifySig(r.seal_hash, r.seal_sig!);
  }
  const ok = Object.values(checks).every((v) => v !== false);
  return json({ success: true, id: r.id, status: r.status, valid: ok, checks,
    commit_preimage_version: commitPreimageVersion(r),
    how_to_verify_offline: {
      commit_preimage: "sha256('kept-commit-v1\\n' + agent + '\\n' + claim + '\\n' + check + '\\n' + committed_at + '\\n' + nonce); with a confidence: sha256('kept-commit-v2\\n' + agent + '\\n' + claim + '\\n' + check + '\\n' + confidence + '\\n' + committed_at + '\\n' + nonce)",
      commit_preimage_v3: "with an observes: sha256('kept-commit-v3\\n' + agent + '\\n' + claim + '\\n' + check + '\\n' + observes + '\\n' + (confidence, or an empty line when there is none) + '\\n' + committed_at + '\\n' + nonce). v3 is used only when observes is present, so every receipt sealed before observes existed still verifies under v1/v2 unchanged. This receipt used " + commitPreimageVersion(r) + ".",
      observes_canonical_form: "observes is sealed as one string. Given as a sentence it is that sentence, trimmed. Given as the typed tuple it is compact JSON with exactly the four keys source, selector, window, credential, in that order, each trimmed, anything missing as \"\" — e.g. {\"source\":\"...\",\"selector\":\"...\",\"window\":\"...\",\"credential\":\"...\"}. Hash the string in the receipt's observes field verbatim; it is already canonical.",
      evidence_preimage: "sha256('kept-evidence-v1\\n' + outcome + '\\n' + evidence_json_text_as_stored)",
      seal_preimage: "sha256('kept-seal-v1\\n' + prev_seal + '\\n' + id + '\\n' + commit_hash + '\\n' + status + '\\n' + evidence_hash + '\\n' + revealed_at)",
      signatures: "Ed25519 over the utf8 hex hash string; public key at " + baseUrl(req) + "/.well-known/kept.json",
    } });
}
