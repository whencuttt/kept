import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify, type KeyObject } from "node:crypto";

export const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
export function newId(prefix: string, len = 10) {
  const b = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) out += B32[b[i] % 32];
  return `${prefix}_${out}`;
}
export const newApiKey = () => "kept_sk_" + randomBytes(24).toString("hex");
export const newNonce = () => randomBytes(16).toString("hex");

let _priv: KeyObject | null = null;
let _pub: KeyObject | null = null;
function keys() {
  if (!_priv) {
    const pem = process.env.KEPT_SIGNING_KEY_PEM;
    if (!pem) throw new Error("KEPT_SIGNING_KEY_PEM not set");
    _priv = createPrivateKey(pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem);
    _pub = createPublicKey(_priv);
  }
  return { priv: _priv!, pub: _pub! };
}
export const signHex = (msg: string) => sign(null, Buffer.from(msg, "utf8"), keys().priv).toString("base64");
export const verifySig = (msg: string, sigB64: string) => {
  try { return verify(null, Buffer.from(msg, "utf8"), keys().pub, Buffer.from(sigB64, "base64")); } catch { return false; }
};
export function publicKey() {
  const { pub } = keys();
  return {
    alg: "Ed25519",
    pem: pub.export({ type: "spki", format: "pem" }) as string,
    jwk: pub.export({ format: "jwk" }),
  };
}

/** Canonical preimages. Anyone can recompute these offline. */
export const commitPreimage = (a: { agent: string; claim: string; check: string; committed_at: string; nonce: string }) =>
  ["kept-commit-v1", a.agent, a.claim, a.check, a.committed_at, a.nonce].join("\n");
export const evidencePreimage = (outcome: string | null, evidence: unknown) =>
  ["kept-evidence-v1", outcome ?? "", evidence == null ? "" : JSON.stringify(evidence)].join("\n");
export const sealPreimage = (a: { prev_seal: string | null; id: string; commit_hash: string; status: string; evidence_hash: string; revealed_at: string }) =>
  ["kept-seal-v1", a.prev_seal ?? "", a.id, a.commit_hash, a.status, a.evidence_hash, a.revealed_at].join("\n");
