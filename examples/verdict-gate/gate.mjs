// verdict-gate — a reference action gate for Kept verdicts. Fails closed.
// A gate must: (1) verify the Ed25519 signature against Kept's published key, (2) enforce expires_at itself
// (small skew allowed), (3) require aud and nonce to equal what THIS gate sent, (4) act only when fresh.
// A cached verdict therefore cannot be replayed after expiry, for a different action, or once reconciliation is due.
import { createHash, createPublicKey, verify } from "node:crypto";

export function digestOf(v) {
  return createHash("sha256").update(["kept-verdict-v2", v.id, v.status, String(v.fresh), v.issued_at, v.expires_at, v.aud ?? "", v.nonce ?? "", v.seal_hash ?? ""].join("\n"), "utf8").digest("hex");
}
export function gate(verdict, { publicKeyPem, aud, nonce, now = Date.now(), skewMs = 5000 }) {
  const deny = (reason) => ({ allow: false, reason });
  if (!verdict || verdict.v !== 2) return deny("unsupported verdict version");
  const digest = digestOf(verdict);
  if (digest !== verdict.digest) return deny("digest mismatch: fields were altered");
  let ok = false;
  try { ok = verify(null, Buffer.from(digest, "utf8"), createPublicKey(publicKeyPem), Buffer.from(verdict.sig, "base64")); } catch { ok = false; }
  if (!ok) return deny("bad signature");
  const exp = Date.parse(verdict.expires_at); const iss = Date.parse(verdict.issued_at);
  if (Number.isNaN(exp) || Number.isNaN(iss)) return deny("unparseable timestamps");
  if (iss > now + skewMs) return deny("verdict issued in the future beyond skew");
  if (now > exp + skewMs) return deny("verdict expired");
  if ((verdict.aud ?? "") !== aud) return deny("audience mismatch: verdict was minted for a different action");
  if ((verdict.nonce ?? "") !== nonce) return deny("nonce mismatch: replayed verdict");
  if (verdict.fresh !== true) return deny(`not fresh: ${verdict.label ?? verdict.status}`);
  return { allow: true, id: verdict.id, owner: verdict.owner };
}
