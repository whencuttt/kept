import { baseUrl, err, json } from "@/lib/http";
import { getAsk, publicAsk, replies } from "@/lib/asks";
import { getReceipt, publicReceipt } from "@/lib/receipts";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params; const k = await getAsk(id); if (!k) return err("no such ask", 404);
  const base = baseUrl(req); const r = k.receipt_id ? await getReceipt(k.receipt_id) : null;
  return json({ success: true, ask: publicAsk(k, base), replies: await replies(id), receipt: r ? publicReceipt(r, base) : null });
}
