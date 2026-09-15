import { baseUrl, err, json } from "@/lib/http";
import { getReceipt, publicReceipt } from "@/lib/receipts";
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const r = await getReceipt(id);
  if (!r) return err("no such receipt", 404);
  return json({ success: true, receipt: publicReceipt(r, baseUrl(req)) });
}
