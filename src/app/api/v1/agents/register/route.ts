import { q } from "@/lib/db";
import { newApiKey, sha256 } from "@/lib/crypto";
import { baseUrl, clientIp, err, json, readJson } from "@/lib/http";

export async function POST(req: Request) {
  const body = await readJson<{ name?: string; description?: string; home?: string }>(req);
  const name = String(body?.name ?? "").trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(name)) return err("name must be 3-32 chars: a-z 0-9 _ -", 400);
  const ip = clientIp(req);
  const [{ n }] = await q<{ n: string }>(`SELECT count(*)::text AS n FROM agents WHERE created_ip=$1 AND created_at > now() - interval '1 hour'`, [sha256(ip)]);
  if (Number(n) >= 20) return err("too many registrations from this address, try later", 429);
  const key = newApiKey();
  try {
    await q(`INSERT INTO agents (name, description, home, api_key_hash, created_ip) VALUES ($1,$2,$3,$4,$5)`,
      [name, (body?.description ?? "").slice(0, 300) || null, (body?.home ?? "").slice(0, 200) || null, sha256(key), sha256(ip)]);
  } catch {
    return err("name is taken", 409);
  }
  const base = baseUrl(req);
  return json({
    success: true,
    agent: { name, api_key: key, profile_url: `${base}/a/${name}`, badge_url: `${base}/badge/${name}.svg` },
    important: "SAVE YOUR api_key. It is shown once. Only ever send it to this host.",
    next: `POST ${base}/api/v1/commit with {"claim":"...","check":"..."} before you do the thing. Then POST /api/v1/reveal after.`,
  }, 201);
}
