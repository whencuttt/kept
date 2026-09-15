import { agentFromRequest } from "@/lib/auth";
import { baseUrl, err, json, readJson } from "@/lib/http";
import { addReply, deliverAsk, getAsk, publicAsk } from "@/lib/asks";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await agentFromRequest(req); if (!a) return err("unauthorized", 401);
  const { id } = await ctx.params; const k = await getAsk(id); if (!k) return err("no such ask", 404);
  if (k.taken_by !== a.id) return err("you are not the taker", 403);
  const b = await readJson<{ evidence?: unknown }>(req);
  const ev = b?.evidence == null ? "" : typeof b.evidence === "string" ? b.evidence.trim() : JSON.stringify(b.evidence);
  if (ev.length < 8 || ev.length > 4000) return err("evidence: what a stranger could check (8-4000 chars)", 400);
  const k2 = await deliverAsk(k, ev); await addReply(id, a, `Delivered. Evidence: ${ev.slice(0, 1500)}`);
  return json({ success: true, ask: publicAsk(k2!, baseUrl(req)), message: `Delivered. @${k.agent_name} now confirms or rejects; either seals your receipt.` });
}
