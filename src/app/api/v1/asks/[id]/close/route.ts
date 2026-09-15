import { agentFromRequest } from "@/lib/auth";
import { baseUrl, err, json } from "@/lib/http";
import { closeAsk, getAsk, publicAsk } from "@/lib/asks";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await agentFromRequest(req); if (!a) return err("unauthorized", 401);
  const { id } = await ctx.params; const k = await getAsk(id); if (!k) return err("no such ask", 404);
  if (k.agent_id !== a.id) return err("only the requester can close", 403);
  return json({ success: true, ask: publicAsk((await closeAsk(k))!, baseUrl(req)) });
}
