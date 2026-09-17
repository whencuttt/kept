import { commitPreimage, commitPreimageVersion, evidencePreimage, sealPreimage, sha256, verifySig } from "@/lib/crypto";
import { baseUrl, err, json } from "@/lib/http";
import { getReceipt } from "@/lib/receipts";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await getReceipt(id);
  if (!r) return err("no such receipt", 404);
  const commit_recomputed = sha256(commitPreimage({ agent: r.agent_name, claim: r.claim, check: r.check, committed_at: r.committed_at, nonce: r.nonce, confidence: r.confidence, observes: r.observes, observes_kind: r.observes_kind }));
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
    observes_kind: r.observes_kind,
    how_to_verify_offline: {
      commit_preimage: "sha256('kept-commit-v1\\n' + agent + '\\n' + claim + '\\n' + check + '\\n' + committed_at + '\\n' + nonce); with a confidence: sha256('kept-commit-v2\\n' + agent + '\\n' + claim + '\\n' + check + '\\n' + confidence + '\\n' + committed_at + '\\n' + nonce)",
      commit_preimage_v3: "with an observes that is prose or the v1 tuple: sha256('kept-commit-v3\\n' + agent + '\\n' + claim + '\\n' + check + '\\n' + observes + '\\n' + (confidence, or an empty line when there is none) + '\\n' + committed_at + '\\n' + nonce). v3 is used only when observes is present, so every receipt sealed before observes existed still verifies under v1/v2 unchanged.",
      commit_preimage_v4: "with a typed_v2 observes: the SAME field order as v3 with the version tag 'kept-commit-v4' — sha256('kept-commit-v4\\n' + agent + '\\n' + claim + '\\n' + check + '\\n' + observes + '\\n' + (confidence, or an empty line when there is none) + '\\n' + committed_at + '\\n' + nonce). The tag is what tells you the observes line is a structure you can compare rather than a sentence you can only re-read. v4 is used only when observes_kind is \"typed_v2\", so every prose and typed_v1 receipt still verifies under v3 unchanged.",
      which_version: "Read `observes_kind` on this response and on /api/v1/receipts/:id: null (no observes) -> v1 or v2 by whether a confidence is present; \"prose\" or \"typed_v1_untyped_fields\" -> v3; \"typed_v2\" -> v4. This receipt used " + commitPreimageVersion(r) + " and its observes_kind is " + JSON.stringify(r.observes_kind) + ".",
      observes_canonical_form: "observes is sealed as one string, and the string in the receipt's observes field is already canonical — hash it verbatim. Given as a sentence it is that sentence, trimmed (observes_kind \"prose\"). Given as the v1 tuple it is compact JSON with exactly the four keys source, selector, window, credential, in FIXED order, each trimmed, anything missing as \"\" (observes_kind \"typed_v1_untyped_fields\").",
      observes_canonical_form_v2: "The typed v2 object canonicalises differently on purpose: compact JSON with every object's keys SORTED lexicographically at every level, so the top level reads credential, selector, source, window; every window timestamp normalised to UTC with millisecond precision (Z), so two agents naming the same interval in different offsets seal identical bytes. window is {\"from\",\"to\"} or {\"seconds_before_reveal\"}; selector is one of {\"kind\":\"sql\",\"text\"} | {\"kind\":\"path\",\"glob\"} | {\"kind\":\"http\",\"method\",\"url_pattern\"} | {\"kind\":\"table\",\"name\",\"predicate\"}; source is {\"kind\":\"db\"|\"fs\"|\"http\"|\"api\"|\"other\",\"id\"}; credential is a plain string, \"\" when absent.",
      what_the_kinds_buy: "All three kinds are non-retroactive: the boundary is sealed before the sample is drawn. Only typed_v2 is COMPARABLE — a prose or typed_v1 window is a description of an interval rather than an interval, and a prose selector is a description of a selector, so string inequality between two of them carries no information in either direction. See /api/v1/receipts/:id/observes-compare?with=<other_id>.",
      evidence_preimage: "sha256('kept-evidence-v1\\n' + outcome + '\\n' + evidence_json_text_as_stored)",
      seal_preimage: "sha256('kept-seal-v1\\n' + prev_seal + '\\n' + id + '\\n' + commit_hash + '\\n' + status + '\\n' + evidence_hash + '\\n' + revealed_at)",
      signatures: "Ed25519 over the utf8 hex hash string; public key at " + baseUrl(req) + "/.well-known/kept.json",
    } });
}
