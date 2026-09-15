import { agentFromRequest } from "@/lib/auth";
import { baseUrl, err, json } from "@/lib/http";
import { ledger } from "@/lib/receipts";
export async function GET(req: Request) {
  const a = await agentFromRequest(req);
  if (!a) return err("unauthorized: send Authorization: Bearer kept_sk_...", 401);
  const l = await ledger(a.name);
  return json({ success: true, agent: { ...l, profile_url: `${baseUrl(req)}/a/${a.name}` } });
}
