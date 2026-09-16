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
export function keyId() {
  const { pub } = keys();
  return sha256(pub.export({ type: "spki", format: "pem" }) as string).slice(0, 16);
}
export function publicKey() {
  const { pub } = keys();
  return {
    alg: "Ed25519",
    kid: keyId(),
    pem: pub.export({ type: "spki", format: "pem" }) as string,
    jwk: pub.export({ format: "jwk" }),
  };
}

/** The coverage boundary a check actually sees, in the one form that gets sealed.
 *  A string is its own canonical form (trimmed). The typed tuple canonicalises to compact JSON with
 *  exactly the four keys source, selector, window, credential, in that order, each a trimmed string,
 *  anything missing as "". Fixed key order is what lets a stranger recompute the hash offline. */
export type ObservesTuple = { source?: string; selector?: string; window?: string; credential?: string };
export const OBSERVES_KEYS = ["source", "selector", "window", "credential"] as const;
export const canonicalObserves = (o: string | ObservesTuple): string =>
  typeof o === "string"
    ? o.trim()
    : JSON.stringify(Object.fromEntries(OBSERVES_KEYS.map((k) => [k, String(o?.[k] ?? "").trim()])));
/** The credential slot of a sealed observes, or null when observes is absent or in string form. */
export function observesCredential(observes: string | null | undefined): string | null {
  const t = (observes ?? "").trim();
  if (!t.startsWith("{")) return null;
  try { const o = JSON.parse(t) as ObservesTuple; return typeof o?.credential === "string" && o.credential.trim() ? o.credential.trim() : null; } catch { return null; }
}

/** Canonical preimages. Anyone can recompute these offline. */
export const commitPreimage = (a: { agent: string; claim: string; check: string; committed_at: string; nonce: string; confidence?: number | null; observes?: string | null }) =>
  a.observes
    ? ["kept-commit-v3", a.agent, a.claim, a.check, a.observes, a.confidence == null ? "" : String(a.confidence), a.committed_at, a.nonce].join("\n")
    : a.confidence == null
      ? ["kept-commit-v1", a.agent, a.claim, a.check, a.committed_at, a.nonce].join("\n")
      : ["kept-commit-v2", a.agent, a.claim, a.check, String(a.confidence), a.committed_at, a.nonce].join("\n");
/** Which preimage version sealed a given receipt. v3 is used only when observes is present, so every
 *  receipt committed before observes existed still verifies under v1/v2 exactly as it did. */
export const commitPreimageVersion = (a: { confidence?: number | null; observes?: string | null }) =>
  a.observes ? "kept-commit-v3" : a.confidence == null ? "kept-commit-v1" : "kept-commit-v2";
/** evidence_raw is the exact JSON text stored (JSON.stringify of what the agent sent), or null. */
export const evidencePreimage = (outcome: string | null, evidence_raw: string | null) =>
  ["kept-evidence-v1", outcome ?? "", evidence_raw ?? ""].join("\n");
export const sealPreimage = (a: { prev_seal: string | null; id: string; commit_hash: string; status: string; evidence_hash: string; revealed_at: string }) =>
  ["kept-seal-v1", a.prev_seal ?? "", a.id, a.commit_hash, a.status, a.evidence_hash, a.revealed_at].join("\n");
