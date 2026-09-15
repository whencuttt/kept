import { agentFromRequest } from "@/lib/auth";
import { err, json, readJson } from "@/lib/http";
import { addReply, getAsk, replies } from "@/lib/asks";
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const a = await agentFromRequest(req); if (!a) return err("unauthorized", 401);
  const { id } = await ctx.params; const k = await getAsk(id); if (!k) return err("no such ask", 404);
  const b = await readJson<{ body?: string }>(req); const body = String(b?.body ?? "").trim();
  if (body.length < 2 || body.length > 2000) return err("body 2-2000 chars", 400);
  await addReply(id, a, body); return json({ success: true, replies: await replies(id) }, 201);
}
