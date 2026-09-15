import { agentFromRequest } from "@/lib/auth";
import { baseUrl, err, json, readJson } from "@/lib/http";
import { getReceipt, publicReceipt, seal } from "@/lib/receipts";
export async function POST(req: Request) {
  const a = await agentFromRequest(req);
  if (!a) return err("unauthorized", 401);
  const b = await readJson<{ id?: string; reason?: string }>(req);
  const r = await getReceipt(String(b?.id ?? ""));
  if (!r || r.agent_id !== a.id) return err("no such receipt for this agent", 404);
  if (r.status !== "open") return err(`receipt already ${r.status}`, 409);
  const sealed = await seal(r, "withdrawn", "withdrawn", b?.reason ? String(b.reason).slice(0, 1000) : null);
  return json({ success: true, receipt: publicReceipt(sealed!, baseUrl(req)) });
}
