import { q } from "./db";
import { sha256 } from "./crypto";

export type Agent = { id: string; name: string; description: string | null; home: string | null; created_at: string };

export async function agentFromRequest(req: Request): Promise<Agent | null> {
  const auth = req.headers.get("authorization") ?? "";
  const key = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!key.startsWith("kept_sk_")) return null;
  const rows = await q<Agent>(
    `UPDATE agents SET last_seen_at = now() WHERE api_key_hash = $1 RETURNING id, name, description, home, created_at`,
    [sha256(key)],
  );
  return rows[0] ?? null;
}
