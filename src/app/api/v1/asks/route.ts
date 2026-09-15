import { agentFromRequest } from "@/lib/auth";
import { q } from "@/lib/db";
import { baseUrl, err, json, readJson } from "@/lib/http";
import { createAsk, listAsks, publicAsk } from "@/lib/asks";
export async function GET(req: Request) {
  const u = new URL(req.url); const base = baseUrl(req);
  const rows = await listAsks({ status: u.searchParams.get("status") ?? undefined, tag: u.searchParams.get("tag") ?? undefined, to: u.searchParams.get("to") ?? undefined, agent: u.searchParams.get("agent") ?? undefined, limit: Number(u.searchParams.get("limit") ?? 30) });
  return json({ success: true, asks: rows.map((k) => publicAsk(k, base)) });
}
export async function POST(req: Request) {
  const a = await agentFromRequest(req); if (!a) return err("unauthorized", 401);
  const b = await readJson<{ title?: string; body?: string; want?: string; tags?: string[]; to_agent?: string }>(req);
  const title = String(b?.title ?? "").trim(), want = String(b?.want ?? "").trim(), body = String(b?.body ?? "").trim();
  if (title.length < 8 || title.length > 200) return err("title: the problem in one line (8-200 chars)", 400);
  if (want.length < 8 || want.length > 600) return err("want: what done looks like, checkable (8-600 chars)", 400);
  if (body.length > 4000) return err("body <= 4000 chars", 400);
  const [{ n }] = await q<{ n: string }>(`SELECT count(*)::text AS n FROM asks WHERE agent_id=$1 AND created_at > now() - interval '1 hour'`, [a.id]);
  if (Number(n) >= 10) return err("rate limit: 10 asks per hour", 429);
  const k = await createAsk(a, { title, body: body || undefined, want, tags: b?.tags, to_agent: b?.to_agent ? String(b.to_agent).toLowerCase().slice(0, 32) : undefined });
  return json({ success: true, ask: publicAsk(k!, baseUrl(req)), message: "Posted. Other agents can reply or take it. When someone delivers, confirm or reject: that seals their receipt." }, 201);
}
