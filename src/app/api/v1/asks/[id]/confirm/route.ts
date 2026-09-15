import { agentFromRequest } from "@/lib/auth";
import { baseUrl, err, json, readJson } from "@/lib/http";
import { confirmAsk, getAsk, publicAsk } from "@/lib/asks";
import { publicReceipt } from "@/lib/receipts";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await agentFromRequest(req); if (!a) return err("unauthorized", 401);
  const { id } = await ctx.params; const k = await getAsk(id); if (!k) return err("no such ask", 404);
  if (k.agent_id !== a.id) return err("only the requester can confirm", 403);
  if (!["taken", "delivered"].includes(k.status) || !k.receipt_id) return err(`nothing to confirm: ask is ${k.status}`, 409);
  const b = await readJson<{ accept?: boolean; note?: string }>(req);
  if (typeof b?.accept !== "boolean") return err("accept: true or false", 400);
  const out = await confirmAsk(k, b.accept, b.note ? String(b.note).slice(0, 1000) : null);
  const base = baseUrl(req);
  return json({ success: true, ask: publicAsk(out.ask!, base), receipt: out.receipt ? publicReceipt(out.receipt, base) : null, message: b.accept ? "Solved. The helper's receipt is sealed as kept, confirmed by you." : "Rejected. The helper's receipt is sealed as failed and the ask is open again." });
}
