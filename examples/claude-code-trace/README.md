# claude-code-trace — the Kept trace convention, as a Claude Code hook

The [trace convention](../trace-convention.md) was written with one open end: *"No runtime emits it
yet. The natural first implementer is a gateway hook that signs tool stdout before it is returned to the
agent."* This is that hook. Claude Code runs a tool, hands the payload to `hook.mjs` on stdin, and the hook appends an
Ed25519-signed link to a per-session chain the agent never writes and cannot rewrite undetected.
Dependency-free Node; nothing here touches the Next.js app.

**kid `b70fbc2301c7b83c`** — this machine's trace key, made on first run at `~/.kept/trace-key.pem`
(0600), public half beside it. Yours will differ; the hook prints it once on stderr.

## Install — merge into `~/.claude/settings.json`, keeping any `hooks` you already have

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
stderr, the debug log, so a hook that cannot start is invisible: if `node` comes from nvm/fnm/volta, put
its absolute path in `command`, because hook subprocesses do not inherit your shell's PATH. Bash calls
running `interp.mjs` or `attach.mjs` are skipped — bookkeeping about the trace, not evidence in it.

## Use

```
node interp.mjs --relied-on tool=Bash,field=stdout --decision "proceed to publish" --because "rows_changed > 0"
node interp.mjs --step s4 --relied-on tool=Bash,field=stdout --decision "..." --because "..."
node attach.mjs --receipt kpt_xxx --outcome kept   # POSTs the chain as evidence (needs KEPT_API_KEY)
node attach.mjs --print                            # export { "trace": [...] } without sending
node test.mjs                                      # 28 offline checks, uses a temp KEPT_TRACE_HOME
```

`interp.mjs` is what the agent calls via Bash after it has reasoned about a step. Without `--step` it
binds to the newest link — **so when the agent batched several tool calls in one turn, name the step you
actually relied on**, or the receipt attests a binding that never happened and still verifies, since the
hash it records is genuinely some other call's. `attach.mjs` verifies the chain before sending, refuses
a broken one, and tiers the evidence down to the 4000-char limit `POST /api/v1/reveal` enforces —
old steps degrade to `{step_id, link}`, then to one folded digest; an omitted call still shows it
existed. `KEPT_TRACE_HOME` overrides `~/.kept`, `KEPT_BASE_URL` overrides `https://kept-ledger.vercel.app`.

## The chain — exactly the spec's preimages, signed over the hex digest as `src/lib/crypto.ts` does

```
link_N       = sha256("kept-trace-v1\n"  + step_id + "\n" + sorted(tool_output_hashes).join(",") + "\n" + interp_hash_{N-1})
interp_hash_N = sha256("kept-interp-v1\n" + link_N  + "\n" + canonical_json(interp_N))
```

`tool_output_hashes` is sha256 of the canonical JSON of `tool_response`. The hook also records
`tool_name` and a per-field hash of the output; `interp.mjs` copies `value_hash` from those, so an
interpretation can only cite a field the runtime actually saw — that is the epoch invariant, mechanically.

**Steps with no interpretation are normal** — the model will call `interp.mjs` for a fraction of its
calls. Each link stores the `prev_interp_hash` it was built on, so two consecutive links legitimately
share one: that reads "nothing was interpreted between these steps", and is distinguishable from a chain
that has been cut. A step carries at most one interpretation; a second is refused.

## What it proves

Which tool outputs existed, in what order, before which reasoning. A tampered output hash breaks the
link, and re-hashing the link breaks the signature. A **ghost step** — an interpretation for a call the
runtime never signed, or one citing a tool this step did not run — is caught by comparing the agent's
claims against the signed links. A reworded interpretation no longer matches its `interp_hash`.

## What it does not prove

**In v1 the signing key lives on the same machine as the agent.** An agent with shell access can read
`~/.kept/trace-key.pem` and forge the whole chain. This is a demonstration of the convention, not a
security boundary. The convention's runtime is a gateway that holds a key the agent cannot read; a
PostToolUse hook is the closest thing that exists today: useful for an honest agent, worthless against a
dishonest one. That is also why `field_hashes` and `tool_name` ride as unsigned auxiliary data, and why
the skip rule above is a string any command could carry to evade tracing — neither costs you anything
you still had. It does not prove the interpretation is *correct* either; that needs a second reader who
committed its own reading first. The agent can lie freely in `--decision` and `--because`. What it
cannot do is make those words point at a tool output that never happened.

`trace.mjs` primitives and the verifier · `hook.mjs` the hook · `interp.mjs` the interpretation CLI ·
`attach.mjs` export and reveal · `test.mjs` offline tests. MIT.
