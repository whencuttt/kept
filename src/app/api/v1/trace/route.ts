import { agentFromRequest } from "@/lib/auth";
import { baseUrl, err, json, readJson } from "@/lib/http";
import { putInterp, putLink, type LinkIn } from "@/lib/trace";

/** One record from the runtime chain: a signed link as hook.mjs writes it, or an interp from interp.mjs.
 *  Idempotent on (agent, session_id, step_id) — re-POSTing a link is a no-op, an interp fills the same row. */
export async function POST(req: Request) {
  const a = await agentFromRequest(req);
  if (!a) return err("unauthorized: send Authorization: Bearer kept_sk_...", 401);
  const b = await readJson<LinkIn & { type?: string }>(req);
  if (!b || typeof b !== "object") return err("body must be one JSON link or interp record", 400);
  const r: { error?: string; status?: number; session_id?: string; step_id?: string } =
    b.type === "interp" ? await putInterp(a.id, b) : await putLink(a.id, b);
  if (r.error) return err(r.error, r.status ?? 400);
  return json({ success: true, agent: a.name, session_id: r.session_id, step_id: r.step_id, trace_url: `${baseUrl(req)}/t/${a.name}` }, 201);
}
