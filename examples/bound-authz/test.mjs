import { createGrant, authorize, incidents } from "./guard.mjs";
const secret = "test-secret";
let pass = 0, fail = 0;
const check = (name, cond, detail) => { (cond ? pass++ : fail++); console.log(`${cond ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`); };

// 1. a bound grant: 10 USDC, only to two counterparties, 1 hour
const t = createGrant({ max_amount: 10, currency: "USDC", allowed_to: ["agent_a", "agent_b"], expires_at: new Date(Date.now() + 3600e3).toISOString(), max_calls: 5 }, secret);
let r = authorize(t, { amount: 4, currency: "USDC", to: "agent_a" }, secret);
check("in-policy call allowed", r.ok, JSON.stringify(r));
r = authorize(t, { amount: 3, currency: "USDC", to: "agent_c" }, secret);
check("deviation (counterparty) rejected AND revokes", !r.ok && r.revoked, r.reason);
r = authorize(t, { amount: 1, currency: "USDC", to: "agent_a" }, secret);
check("next in-policy call refused because token is revoked", !r.ok && r.revoked, r.reason);

// 2. amount deviation revokes
const t2 = createGrant({ max_amount: 5, currency: "USDC", allowed_to: ["agent_a"], expires_at: new Date(Date.now() + 3600e3).toISOString() }, secret);
r = authorize(t2, { amount: 6, currency: "USDC", to: "agent_a" }, secret);
check("amount over bound rejected AND revokes", !r.ok && r.revoked, r.reason);

// 3. cumulative spend cannot exceed bound
const t3 = createGrant({ max_amount: 5, currency: "USDC", allowed_to: ["agent_a"], expires_at: new Date(Date.now() + 3600e3).toISOString() }, secret);
authorize(t3, { amount: 3, currency: "USDC", to: "agent_a" }, secret);
r = authorize(t3, { amount: 3, currency: "USDC", to: "agent_a" }, secret);
check("cumulative overspend rejected AND revokes", !r.ok && r.revoked, r.reason);

// 4. zero / missing budget never means unlimited
for (const bad of [0, undefined, -1, "10", NaN, Infinity]) {
  let threw = false; try { createGrant({ max_amount: bad, currency: "USDC", allowed_to: ["agent_a"], expires_at: new Date(Date.now() + 3600e3).toISOString() }, secret); } catch { threw = true; }
  check(`budget ${String(bad)} denied at grant creation`, threw);
}

// 5. expiry revokes, extra parameter revokes, forged token refused
const t4 = createGrant({ max_amount: 5, currency: "USDC", allowed_to: ["agent_a"], expires_at: new Date(Date.now() - 1000).toISOString() }, secret);
r = authorize(t4, { amount: 1, currency: "USDC", to: "agent_a" }, secret);
check("expired grant rejected AND revokes", !r.ok && r.revoked, r.reason);
const t5 = createGrant({ max_amount: 5, currency: "USDC", allowed_to: ["agent_a"], expires_at: new Date(Date.now() + 3600e3).toISOString() }, secret);
r = authorize(t5, { amount: 1, currency: "USDC", to: "agent_a", gas_override: true }, secret);
check("unexpected parameter on a bound call rejected AND revokes", !r.ok && r.revoked, r.reason);
r = authorize(t5.slice(0, -2) + "xx", { amount: 1, currency: "USDC", to: "agent_a" }, secret);
check("forged token refused", !r.ok && !r.revoked, r.reason);

// 6. incidents are recorded for the human, with the offending call
const inc = incidents();
check("incidents recorded with offending call", inc.length >= 5 && inc.every((i) => i.for_human && "call" in i), `${inc.length} incidents; first: ${inc[0].for_human} | call ${JSON.stringify(inc[0].call)}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
