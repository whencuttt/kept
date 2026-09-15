// Adversarial-cache test (umiXBT): a previously valid signed verdict must not be reusable after expiry,
// for a different action, or once reconciliation is required. Uses a local Ed25519 key so it runs offline.
import { generateKeyPairSync, sign } from "node:crypto";
import { gate, digestOf } from "./gate.mjs";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const pem = publicKey.export({ type: "spki", format: "pem" });
const mint = (o) => { const v = { v: 2, id: "kpt_test", status: "kept", fresh: true, issued_at: new Date().toISOString(), expires_at: new Date(Date.now() + 30_000).toISOString(), aud: "spend:agent_a:4USDC", nonce: "n1", seal_hash: "abc", label: "verified", owner: "sezo_field_researcher", ...o }; v.digest = digestOf(v); v.sig = sign(null, Buffer.from(v.digest, "utf8"), privateKey).toString("base64"); return v; };
let pass = 0, fail = 0; const t = (name, r, want) => { const ok = r.allow === want; ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name} :: ${r.allow ? "allow" : r.reason}`); };
const ctx = { publicKeyPem: pem, aud: "spend:agent_a:4USDC", nonce: "n1" };
const good = mint({});
t("valid fresh verdict for this action and nonce allows", gate(good, ctx), true);
t("same cached verdict reused after expiry is refused", gate(good, { ...ctx, now: Date.now() + 60_000 }), false);
t("same cached verdict reused for a different action is refused", gate(good, { ...ctx, aud: "spend:agent_b:4USDC" }), false);
t("same cached verdict reused with a different nonce is refused", gate(good, { ...ctx, nonce: "n2" }), false);
t("verdict that says reconciliation is required is refused", gate(mint({ fresh: false, label: "unverified pending reconciliation" }), ctx), false);
t("failed receipt verdict is refused even if fresh flag forged", gate(mint({ status: "failed", fresh: true }), ctx), false);
const tampered = { ...good, fresh: true, expires_at: new Date(Date.now() + 3_600_000).toISOString() };
t("tampered expiry (digest no longer matches) is refused", gate(tampered, ctx), false);
const resigned = { ...tampered, digest: digestOf(tampered) };
t("tampered expiry re-hashed but not re-signed is refused", gate(resigned, ctx), false);
t("verdict issued in the future beyond skew is refused", gate(mint({ issued_at: new Date(Date.now() + 60_000).toISOString() }), ctx), false);
t("verdict within 5s skew of expiry still allows", gate(good, { ...ctx, now: Date.parse(good.expires_at) + 2_000 }), true);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
