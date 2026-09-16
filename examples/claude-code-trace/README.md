# claude-code-trace — the Kept trace convention, as a Claude Code hook

The [trace convention](../trace-convention.md) ends with: *"No runtime emits it yet. The natural first
implementer is a gateway hook that signs tool stdout before it is returned to the agent."* This is that
hook. Claude Code runs a tool, hands the payload to `hook.mjs` on stdin, and the hook appends an
Ed25519-signed link to a per-session chain the agent never writes and cannot rewrite without detection.

Dependency-free Node. Nothing here touches the Next.js app.

**kid `b70fbc2301c7b83c`** — this machine's trace key, generated on first run at `~/.kept/trace-key.pem`
(0600), public half at `~/.kept/trace-key.pub.pem`. Yours will differ; the hook prints it once on stderr.

## Install

Merge into `~/.claude/settings.json` (keep any `hooks` you already have; add the `PostToolUse` key):

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          { "type": "command", "command": "node /absolute/path/to/kept/examples/claude-code-trace/hook.mjs", "timeout": 5 }
        ]
      }
    ]
  }
}
```

`matcher: "*"` traces every tool. The hook adds ~40ms, writes nothing to stdout, and **exits 0 on every
path**, including a malformed payload — a broken trace must never be a broken tool call. Errors go to
stderr, which Claude Code sends to the debug log.

## Use

```
node interp.mjs --relied-on tool=Bash,field=stdout --decision "proceed to publish" --because "rows_changed > 0"
node attach.mjs --receipt kpt_xxx --outcome kept          # POSTs the chain as evidence (needs KEPT_API_KEY)
node attach.mjs --print                                    # export { "trace": [...] } without sending
node test.mjs                                              # 25 offline checks, uses a temp KEPT_TRACE_HOME
```

`interp.mjs` is what the agent calls via Bash after it has reasoned about a step. `attach.mjs` verifies
the chain before sending and refuses a broken one; it tiers the evidence down to the 4000-char limit
`POST /api/v1/reveal` enforces, degrading old steps to `{step_id, link}` and finally to one folded
digest — an omitted call still shows that it existed.

`KEPT_TRACE_HOME` overrides `~/.kept`. `KEPT_BASE_URL` overrides `https://kept-ledger.vercel.app`.

## The chain

Exactly the spec's preimages, signed over the hex digest as `src/lib/crypto.ts` does:

```
link_N       = sha256("kept-trace-v1\n"  + step_id + "\n" + sorted(tool_output_hashes).join(",") + "\n" + interp_hash_{N-1})
interp_hash_N = sha256("kept-interp-v1\n" + link_N  + "\n" + canonical_json(interp_N))
```

`tool_output_hashes` is sha256 of the canonical JSON of `tool_response`. The hook also records
`tool_name` and a per-field hash of the output; `interp.mjs` copies `value_hash` from those, so an
interpretation can only cite a field the runtime actually saw — that is the epoch invariant, mechanically.

**Steps with no interpretation are normal.** The model will call `interp.mjs` for a fraction of its tool
calls. Each link stores the `prev_interp_hash` it was built on, so two consecutive links legitimately
share one: that reads "no interpretation was recorded between these steps", and is distinguishable from
a chain that has been cut. A step may carry at most one interpretation; a second is refused.

## What it proves

Which tool outputs existed, in what order, before which reasoning. A tampered output hash breaks the
link, and re-hashing the link breaks the signature. A **ghost step** — an interpretation for a call the
runtime never signed, or one citing a tool this step did not run — is caught by comparing the agent's
claims against the signed links. A reworded interpretation no longer matches its `interp_hash`.

## What it does not prove

**In v1 the signing key lives on the same machine as the agent.** An agent with shell access can read
`~/.kept/trace-key.pem` and forge the whole chain. This is a demonstration of the convention, not a
security boundary. The convention's runtime is a gateway that holds a key the agent cannot read; a
PostToolUse hook is the closest thing that exists today, and it is close enough to be useful for an
honest agent and worthless against a dishonest one. The `field_hashes` and `tool_name` the hook records
ride as unsigned auxiliary data for the same reason — on this trust model, signing them buys nothing.

It also does not prove the interpretation is *correct*. That needs a second reader who committed its own
reading first. And the agent can lie freely in `--decision` and `--because`; what it cannot do is make
those words point at a tool output that never happened.

## Files

`trace.mjs` primitives and the verifier · `hook.mjs` the PostToolUse hook · `interp.mjs` the agent's
interpretation CLI · `attach.mjs` evidence export and reveal · `test.mjs` offline tests. MIT.
