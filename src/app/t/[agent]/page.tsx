import Link from "next/link";
import { notFound } from "next/navigation";
import { traceChain, type TraceLink } from "@/lib/trace";
export const dynamic = "force-dynamic";

const short = (h: string | null | undefined) => (h ? h.slice(0, 10) : "—");
const time = (iso: string) => new Date(iso).toISOString().replace("T", " ").slice(0, 19) + "Z";

export default async function TracePage({ params, searchParams }: { params: Promise<{ agent: string }>; searchParams: Promise<{ session?: string }> }) {
  const { agent } = await params;
  const { session } = await searchParams;
  const c = await traceChain(agent, { session, limit: 50 });
  if (!c) notFound();
  const s = c.summary;
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-3xl font-bold">Live trace of <Link href={`/a/${c.agent}`} className="hover:underline">@{c.agent}</Link></h1>
        <p className="mono text-sm text-[var(--acc)]">
          {s.total.toLocaleString()} tool calls signed by key {c.kid ?? "(none registered)"}
          {s.signed_from ? `, chain verified from ${s.signed_from} to ${s.signed_to}` : ", no run of links verifies"}
          {s.signature_verified < s.total && c.kid ? ` · ${s.total - s.signature_verified} unverified` : ""}
          {s.interpretations > 0 ? ` · ${s.interpretations} interpretations` : " · 0 interpretations"}
        </p>
      </div>

      <div className="card p-4 text-sm text-[var(--dim)] grid gap-2 max-w-3xl">
        <p>
          <b className="text-[var(--text)]">What you are looking at.</b> Every time this agent&apos;s runtime finished a tool call, a
          hook hashed the raw output and signed that hash — <i>before</i> the agent was allowed to read it. Each row below is one
          such call. The output hash fixes what came back; the link hash covers the step id, the output hashes and the previous
          interpretation; the signature is Ed25519 over the link hash by the key <span className="mono">{c.kid ?? "—"}</span>.
          Change a recorded output and the link hash stops matching; re-hash the link and the signature stops verifying.
        </p>
        <p>
          <b className="text-[var(--text)]">What it proves.</b> That the runtime recorded these outputs, in this order, before the
          agent reasoned about them. A claim about a tool call the runtime never signed has no row here, and an interpretation can
          only cite a field the runtime actually saw, because it copies the runtime&apos;s own hash of that field.
        </p>
        <p>
          <b className="text-[var(--text)]">What it does not prove.</b> Not that the interpretation is correct — the agent can write
          anything in a decision, it just cannot point it at an output that never happened. Not that the trace is complete: nothing
          here says what was <i>not</i> recorded. And in v1 the signing key lives on the same machine as the agent, so an agent with
          shell access could read it and forge the chain. This is the convention demonstrated, not a security boundary; the runtime
          it is written for is a gateway holding a key the agent cannot read.
          {s.interpretations === 0 && <> This chain carries <b className="text-[var(--text)]">no interpretations</b>, which is itself
          information: the runtime recorded the outputs and the agent recorded no structured reading of them, so ordering across
          steps rests on the runtime&apos;s timestamps rather than on the hashes.</>}
        </p>
        <p className="font-sans">
          <a className="underline" href={`/api/v1/trace/${c.agent}`}>the chain as JSON</a>
          {" · "}<a className="underline" href="https://github.com/whencuttt/kept/blob/main/examples/trace-convention.md">the convention</a>
          {" · "}<a className="underline" href="https://github.com/whencuttt/kept/blob/main/examples/claude-code-trace/README.md">the hook</a>
        </p>
        {c.public_key_pem && <pre className="mono text-[11px] bg-black/40 p-3 rounded-lg overflow-x-auto">{c.public_key_pem.trim()}</pre>}
      </div>

      <div className="grid gap-2">
        <h2 className="text-sm uppercase tracking-wider text-[var(--dim)]">Newest {c.links.length} signed calls{session ? ` · session ${session}` : ""}</h2>
        {c.links.length === 0 && <div className="card p-6 text-[var(--dim)]">No trace links uploaded yet. The hook posts them from <span className="mono">examples/claude-code-trace/hook.mjs</span>.</div>}
        {c.links.length > 0 && (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm mono">
              <thead><tr className="text-left text-xs uppercase tracking-wider text-[var(--dim)]">
                <Th>time (utc)</Th><Th>step</Th><Th>tool</Th><Th>output hash</Th><Th>link hash</Th><Th>sig</Th>
              </tr></thead>
              <tbody>{c.links.map((l) => <Row key={l.session_id + l.step_id} l={l} />)}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) { return <th className="font-normal px-3 py-2 border-b border-[var(--line)]">{children}</th>; }
function Td({ children, className = "", title }: { children?: React.ReactNode; className?: string; title?: string }) { return <td title={title} className={`px-3 py-2 align-top ${className}`}>{children}</td>; }

function Row({ l }: { l: TraceLink }) {
  const i = l.interp as { decision?: string; because?: string; relied_on?: { tool: string; field: string; value_hash: string }[] } | null;
  return (
    <>
      <tr className="border-t border-[var(--line)]">
        <Td className="text-[var(--dim)] whitespace-nowrap">{time(l.ts)}</Td>
        <Td className="text-[var(--dim)]">{l.step_id}</Td>
        <Td className="font-sans">{l.tool_name || "—"}</Td>
        <Td className="text-[var(--dim)]" >{short(l.tool_output_hashes[0])}</Td>
        <Td className="text-[var(--dim)]">{short(l.link)}</Td>
        <Td title={l.verified === null ? "no trace key registered for this agent" : l.kid_known === false ? `unknown or rotated key ${l.kid}` : l.verified ? "signature verifies against the registered key" : "signature does not verify"}>
          {l.verified === null ? <span className="text-[var(--dim)]">—</span> : l.verified ? <span className="text-[var(--kept)]">✓</span> : <span className="text-[var(--fail)]">✗</span>}
        </Td>
      </tr>
      {i && (
        <tr>
          <Td /><Td />
          <td colSpan={4} className="px-3 pb-3 font-sans text-sm">
            <div className="text-[var(--text)]">{i.decision}</div>
            <div className="text-[var(--dim)]">because {i.because}</div>
            {(i.relied_on ?? []).map((d, n) => <div key={n} className="mono text-xs text-[var(--dim)]">relied on {d.tool}.{d.field} = {short(d.value_hash)}{l.interp_hash_ok === false ? " (interp_hash does not cover this)" : ""}</div>)}
          </td>
        </tr>
      )}
    </>
  );
}
