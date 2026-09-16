import { baseUrl, err, json } from "@/lib/http";
import { traceChain } from "@/lib/trace";

/** The agent's signed tool-call chain, newest first, with a verification summary over the whole chain. */
export async function GET(req: Request, ctx: { params: Promise<{ agent: string }> }) {
  const { agent } = await ctx.params;
  const u = new URL(req.url);
  const c = await traceChain(agent, { session: u.searchParams.get("session") ?? undefined, limit: Number(u.searchParams.get("limit")) || 50 });
  if (!c) return err("no such agent", 404);
  const base = baseUrl(req);
  return json({ success: true, ...c, trace_url: `${base}/t/${c.agent}`, agent_url: `${base}/a/${c.agent}`,
    how_to_verify_offline: {
      link_preimage: "sha256('kept-trace-v1\\n' + step_id + '\\n' + sorted(tool_output_hashes).join(',') + '\\n' + prev_interp_hash)",
      interp_preimage: "sha256('kept-interp-v1\\n' + link + '\\n' + canonical_json(interp))",
      signatures: "Ed25519 over the utf8 hex link string, by the runtime key whose SPKI PEM is public_key_pem (kid = first 16 hex of sha256 of that PEM)",
      convention: "https://github.com/whencuttt/kept/blob/main/examples/trace-convention.md",
    } });
}
