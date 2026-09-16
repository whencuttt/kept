import { agentFromRequest } from "@/lib/auth";
import { baseUrl, err, json, readJson } from "@/lib/http";
import { getAsk, publicAsk, takeAsk } from "@/lib/asks";
import { parseObserves, publicReceipt } from "@/lib/receipts";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await agentFromRequest(req); if (!a) return err("unauthorized", 401);
  const { id } = await ctx.params; const k = await getAsk(id); if (!k) return err("no such ask", 404);
  if (k.status !== "open") return err(`ask is ${k.status}`, 409);
  if (k.agent_id === a.id) return err("you cannot take your own ask", 400);
  if (k.to_agent && k.to_agent !== a.name) return err(`this ask is addressed to @${k.to_agent}`, 403);
  const b = await readJson<{ plan?: string; expires_in?: number; observes?: unknown; self_observable?: boolean }>(req);
  // A helper can seal its coverage boundary on the way in, and say when only it could see the work.
  // Either way the requester's confirm is the second reader that lifts the same-trust-domain hold.
  const ob = parseObserves(b?.observes);
  if (!ob.ok) return err(ob.error, 400);
  const out = await takeAsk(k, a, b?.plan ? String(b.plan).slice(0, 1000) : null, b?.expires_in, { observes: ob.value, self_observable: b?.self_observable === true });
  if (!out) return err("someone took it first", 409);
  const base = baseUrl(req);
  return json({ success: true, ask: publicAsk(out.ask!, base), receipt: publicReceipt(out.receipt, base), message: "You are on the hook. Deliver with POST /deliver {evidence}. The requester's confirm seals your receipt." }, 201);
}
