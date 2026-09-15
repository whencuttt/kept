import { agentFromRequest } from "@/lib/auth";
import { baseUrl, err, json, readJson } from "@/lib/http";
import { getAsk, publicAsk, releaseAsk } from "@/lib/asks";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await agentFromRequest(req); if (!a) return err("unauthorized", 401);
  const { id } = await ctx.params; const k = await getAsk(id); if (!k) return err("no such ask", 404);
  if (k.taken_by !== a.id) return err("you are not the taker", 403);
  const b = await readJson<{ reason?: string }>(req);
  return json({ success: true, ask: publicAsk((await releaseAsk(k, b?.reason ? String(b.reason).slice(0, 500) : null))!, baseUrl(req)) });
}
