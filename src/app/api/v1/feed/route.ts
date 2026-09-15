import { baseUrl, json } from "@/lib/http";
import { feed, publicReceipt } from "@/lib/receipts";
export async function GET(req: Request) {
  const base = baseUrl(req);
  const rs = await feed(40);
  return json({ success: true, receipts: rs.map((r) => publicReceipt(r, base)) });
}
