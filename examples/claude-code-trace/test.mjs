// Offline test: three fake PostToolUse payloads through the real hook, interpretations through the real
// CLI, then the verifier's checks 1-4 plus the two attacks the convention exists to catch — a tampered
// output hash and a ghost step. Uses a throwaway KEPT_TRACE_HOME, so it never touches ~/.kept.
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const HOME = mkdtempSync(join(tmpdir(), "kept-trace-"));
process.env.KEPT_TRACE_HOME = HOME;
const { publicPem, readChain, verifyChain, verifyHex } = await import("./trace.mjs");
const { toEvidence } = await import("./attach.mjs");

const here = new URL(".", import.meta.url).pathname;
const sha = (s) => createHash("sha256").update(s, "utf8").digest("hex");
let pass = 0, fail = 0;
const t = (name, ok, detail = "") => { ok ? pass++ : fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " :: " + detail : ""}`); };
const run = (script, args, input = "") => spawnSync(process.execPath, [join(here, script), ...args], { input, encoding: "utf8", env: { ...process.env, KEPT_TRACE_HOME: HOME } });

const SID = "sess-test-1";
const payload = (tool_name, tool_response, tool_input = {}) => JSON.stringify({ session_id: SID, transcript_path: "/tmp/t.jsonl", cwd: "/tmp", permission_mode: "default", hook_event_name: "PostToolUse", tool_name, tool_input, tool_response, tool_use_id: "toolu_" + tool_name });
const steps = [
  ["Bash", { stdout: "42\n", stderr: "", interrupted: false }, "rows_changed is 42, above zero", "proceed to publish", "stdout"],
  ["Read", { file: "/tmp/a.txt", content: "hello" }, "the file exists and is non-empty", "use the file as input", "content"],
  ["Bash", { stdout: "ok\n", stderr: "", interrupted: false }, "publish returned ok", "stop here", "stdout"],
];
for (const [tool, resp, because, decision, field] of steps) {
  const h = run("hook.mjs", [], payload(tool, resp));
  t(`hook exits 0 after a ${tool} call`, h.status === 0, h.stderr.trim());
  const i = run("interp.mjs", ["--relied-on", `tool=${tool},field=${field}`, "--decision", decision, "--because", because]);
  t(`interp.mjs records an interpretation for the ${tool} step`, i.status === 0, (i.stdout || i.stderr).trim());
}
t("hook exits 0 on an unparseable payload and writes nothing", run("hook.mjs", [], "not json").status === 0);

const recs = readChain(SID), links = recs.filter((r) => r.type === "link"), interps = recs.filter((r) => r.type === "interp");
const pem = publicPem();
t("chain has three signed links and three interpretations", links.length === 3 && interps.length === 3, `${links.length} links, ${interps.length} interps`);
t("verifier accepts the honest chain", verifyChain(recs, pem).length === 0, verifyChain(recs, pem).join("; "));

// The preimages, spelled out from ../trace-convention.md rather than imported, so a typo in trace.mjs cannot pass.
const h1 = sha('{"interrupted":false,"stderr":"","stdout":"42\\n"}'); // the whole tool_response
const hOut = sha('"42\\n"'); // the stdout field alone, the value an interpretation may cite
const link1 = sha("kept-trace-v1" + "\n" + "s1" + "\n" + h1 + "\n" + "");
t("link_1 equals the spec preimage over the canonical tool output and an empty prior interp", links[0].link === link1, links[0].link);
const i1 = `{"because":"rows_changed is 42, above zero","decision":"proceed to publish","relied_on":[{"field":"stdout","tool":"Bash","value_hash":"${hOut}"}]}`;
const ih1 = sha("kept-interp-v1" + "\n" + link1 + "\n" + i1);
t("interp_hash_1 equals the spec preimage and covers link_1", interps[0].interp_hash === ih1, interps[0].interp_hash);
t("relied_on value_hash is the runtime's own hash of that field, not one the agent chose", interps[0].interp.relied_on[0].value_hash === hOut);
t("link_2 covers interp_hash_1 (chain: each link covers the previous interpretation)", links[1].prev_interp_hash === ih1 && links[1].link === sha("kept-trace-v1\ns2\n" + links[1].tool_output_hashes[0] + "\n" + ih1));

// Check 1, provenance: every link signature verifies against the runtime public key.
t("every link signature verifies against the runtime key", links.every((l) => verifyHex(l.link, l.link_sig, pem)));
t("no link verifies against a different key", !links.some((l) => verifyHex(l.link, l.link_sig, generateKeyPairSync("ed25519").publicKey.export({ type: "spki", format: "pem" }))));

const clone = () => JSON.parse(JSON.stringify(recs));
// Attack 1: rewrite a tool output hash so the interpretation looks justified by an output that never happened.
const tampered = clone(); tampered[0].tool_output_hashes[0] = sha("a lie about what the tool returned");
t("tampered output hash is detected (link no longer covers it)", verifyChain(tampered, pem).some((m) => m.includes("tampered output hash")), verifyChain(tampered, pem)[0]);
// ...and re-hashing the link to match does not help, because the signature is over the old link.
const resigned = clone(); resigned[0].tool_output_hashes[0] = sha("a lie"); resigned[0].link = sha("kept-trace-v1\ns1\n" + resigned[0].tool_output_hashes[0] + "\n");
t("tampered output hash re-hashed but not re-signed is detected (bad signature)", verifyChain(resigned, pem).some((m) => m.includes("signature does not verify")), verifyChain(resigned, pem)[0]);
// Attack 2, ghost step: an interpretation claiming a tool call the runtime never signed.
const ghost = clone(); ghost.push({ type: "interp", step_id: "s9", ts: new Date().toISOString(), link: "0".repeat(64), interp: { relied_on: [{ tool: "Bash", field: "stdout", value_hash: sha("invented") }], decision: "ship", because: "a call that never ran said so" }, interp_hash: sha("whatever") });
t("ghost step is detected (interpretation with no signed link)", verifyChain(ghost, pem).some((m) => m.includes("ghost step")), verifyChain(ghost, pem)[0]);
const ghostTool = clone(); ghostTool[1].interp.relied_on[0].tool = "WebFetch";
t("ghost tool call is detected (interpretation cites a tool this step did not run)", verifyChain(ghostTool, pem).some((m) => m.includes("ghost tool call")));
const stale = clone(); stale[1].interp.relied_on[0].value_hash = sha("the value at an earlier epoch");
t("stale or invented value_hash is detected (epoch invariant)", verifyChain(stale, pem).some((m) => m.includes("not the runtime's hash")));
const broken = clone(); broken[2].prev_interp_hash = "0".repeat(64);
t("a link that does not cover the interpretation before it is detected", verifyChain(broken, pem).some((m) => m.includes("does not cover the interpretation")));
const reworded = clone(); reworded[1].interp.because = "a different reason, same hash?";
t("an interpretation reworded after the fact no longer matches its interp_hash", verifyChain(reworded, pem).some((m) => m.includes("interp_hash does not cover")));

const ev = toEvidence(recs, 10);
t("evidence exports the shape from the convention", Array.isArray(ev.trace) && ev.trace.length === 3 && ["step_id", "link", "link_sig", "kid", "tool_output_hashes", "interp_hash"].every((k) => k in ev.trace[0]));
t("evidence fits the 4000-char limit POST /api/v1/reveal enforces", JSON.stringify(ev).length <= 4000, `${JSON.stringify(ev).length} chars`);
const big = Array.from({ length: 60 }, (_, i) => links[i % 3]).map((l, i) => ({ ...l, step_id: "s" + (i + 1) }));
const tiered = toEvidence(big, 10);
const accounted = tiered.trace.reduce((n, e) => n + (e.omitted ?? 1), 0);
t("a long chain tiers down to fit and every omitted call is still accounted for", tiered.tiered === true && accounted === 60 && JSON.stringify(tiered).length <= 4000, `${JSON.stringify(tiered).length} chars, ${accounted} steps accounted`);

// Real Claude Code batches independent calls and the agent runs interp.mjs through Bash. Both are traps.
run("hook.mjs", [], payload("Bash", { stdout: "s1 interp_hash abc\n" }, { command: "node /x/claude-code-trace/interp.mjs --decision d --because b" }));
t("the hook does not trace the agent's own interp.mjs call", readChain(SID).filter((r) => r.type === "link").length === 3);
run("hook.mjs", [], payload("Bash", { stdout: "parallel a\n" }));
run("hook.mjs", [], payload("Bash", { stdout: "parallel b\n" }));
run("interp.mjs", ["--step", "s4", "--relied-on", "tool=Bash,field=stdout", "--decision", "d", "--because", "relied on the first of two parallel calls"]);
const named = readChain(SID).filter((r) => r.type === "interp").pop();
t("--step binds to a named earlier step, not the newest link (parallel tool calls)", named.step_id === "s4" && named.interp.relied_on[0].value_hash === sha('"parallel a\\n"'), named.step_id);
t("the chain with a parallel batch and a named interpretation still verifies", verifyChain(readChain(SID), pem).length === 0, verifyChain(readChain(SID), pem).join("; "));

rmSync(HOME, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
