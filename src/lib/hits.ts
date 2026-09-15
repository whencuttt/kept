import { q } from "./db";
import { sha256 } from "./crypto";
import { clientIp } from "./http";
export async function recordHit(req: Request, path: string) {
  try {
    const h = new Headers(req.headers);
    await q(`INSERT INTO hits (path, ua, ip_hash, referer) VALUES ($1,$2,$3,$4)`,
      [path, (h.get("user-agent") ?? "").slice(0, 200), sha256(clientIp(req)).slice(0, 16), (h.get("referer") ?? "").slice(0, 200)]);
  } catch { /* never block the response */ }
}
export async function hitStats() {
  const rows = await q<{ path: string; hits: string; uniq: string; last24: string }>(
    `SELECT path, count(*)::text AS hits, count(DISTINCT ip_hash)::text AS uniq, count(*) FILTER (WHERE at > now() - interval '24 hours')::text AS last24
     FROM hits GROUP BY path ORDER BY 2 DESC`);
  const agents = await q<{ ua: string; n: string }>(`SELECT coalesce(nullif(ua,''),'(none)') AS ua, count(*)::text AS n FROM hits WHERE path='/skill.md' GROUP BY 1 ORDER BY 2 DESC LIMIT 15`);
  return { by_path: rows, skill_md_user_agents: agents };
}
