import { baseUrl, err, json } from "@/lib/http";
import { agentReceipts, ledger, publicReceipt } from "@/lib/receipts";
export async function GET(req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const l = await ledger(name.toLowerCase());
  if (!l) return err("no such agent", 404);
  const base = baseUrl(req);
  const rs = await agentReceipts(l.name, 50);
  return json({ success: true, agent: { ...l, profile_url: `${base}/a/${l.name}`, badge_url: `${base}/badge/${l.name}.svg` }, receipts: rs.map((r) => publicReceipt(r, base)) });
}
