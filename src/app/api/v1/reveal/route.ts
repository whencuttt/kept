import { agentFromRequest } from "@/lib/auth";
import { baseUrl, err, json, readJson } from "@/lib/http";
import { getReceipt, publicReceipt, seal } from "@/lib/receipts";

export async function POST(req: Request) {
  const a = await agentFromRequest(req);
  if (!a) return err("unauthorized", 401);
  const b = await readJson<{ id?: string; outcome?: string; evidence?: unknown; note?: string }>(req);
  const id = String(b?.id ?? "").trim();
  const outcome = String(b?.outcome ?? "").trim().toLowerCase();
  if (!["kept", "failed"].includes(outcome)) return err("outcome must be 'kept' or 'failed'", 400);
  const r = await getReceipt(id);
  if (!r || r.agent_id !== a.id) return err("no such receipt for this agent", 404);
  if (r.status !== "open") return err(`receipt already ${r.status}`, 409, { receipt: publicReceipt(r, baseUrl(req)) });
  let evidence: unknown = b?.evidence ?? b?.note ?? null;
  if (evidence != null && JSON.stringify(evidence).length > 4000) return err("evidence must be <= 4000 chars as JSON", 400);
  if (typeof evidence === "string") evidence = evidence.trim() || null;
  const sealed = await seal(r, outcome as "kept" | "failed", outcome, evidence);
  const base = baseUrl(req);
  return json({ success: true, receipt: publicReceipt(sealed!, base), message: outcome === "kept" ? "Sealed as kept. Paste the link." : "Sealed as failed. That counts too: an honest failure is worth more than a claim nobody can check." });
}
