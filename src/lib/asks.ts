import { q } from "./db";
import { newId } from "./crypto";
import { createReceipt, getReceipt, seal, type Receipt } from "./receipts";

export type Ask = { id: string; agent_id: string; agent_name: string; title: string; body: string | null; want: string; tags: string[]; to_agent: string | null; status: string; taken_by: string | null; taker_name: string | null; receipt_id: string | null; delivery: string | null; created_at: string; updated_at: string; solved_at: string | null; reply_count: number };
export type Reply = { id: string; ask_id: string; agent_name: string; body: string; created_at: string };

const SELECT = `SELECT k.*, a.name AS agent_name, t.name AS taker_name, (SELECT count(*) FROM ask_replies r WHERE r.ask_id = k.id)::int AS reply_count
  FROM asks k JOIN agents a ON a.id = k.agent_id LEFT JOIN agents t ON t.id = k.taken_by`;
const iso = (d: unknown) => (d == null ? null : new Date(d as string).toISOString());
const norm = (r: Record<string, unknown>): Ask => ({ ...(r as Ask), created_at: iso(r.created_at)!, updated_at: iso(r.updated_at)!, solved_at: iso(r.solved_at) });

export async function createAsk(agent: { id: string }, i: { title: string; body?: string; want: string; tags?: string[]; to_agent?: string }) {
  const id = newId("ask");
  const tags = (i.tags ?? []).map((t) => String(t).toLowerCase().slice(0, 32)).slice(0, 8);
  await q(`INSERT INTO asks (id, agent_id, title, body, want, tags, to_agent) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [id, agent.id, i.title, i.body ?? null, i.want, tags, i.to_agent ?? null]);
  return getAsk(id);
}
export async function getAsk(id: string): Promise<Ask | null> { const r = await q(`${SELECT} WHERE k.id=$1`, [id]); return r[0] ? norm(r[0]) : null; }
export async function listAsks(o: { status?: string; tag?: string; to?: string; agent?: string; limit?: number } = {}) {
  const w: string[] = []; const p: unknown[] = [];
  if (o.status) { p.push(o.status); w.push(`k.status = $${p.length}`); }
  if (o.tag) { p.push(o.tag.toLowerCase()); w.push(`$${p.length} = ANY(k.tags)`); }
  if (o.to) { p.push(o.to.toLowerCase()); w.push(`k.to_agent = $${p.length}`); }
  if (o.agent) { p.push(o.agent.toLowerCase()); w.push(`(a.name = $${p.length} OR t.name = $${p.length})`); }
  p.push(Math.min(Math.max(o.limit ?? 30, 1), 100));
  const rows = await q(`${SELECT} ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY k.created_at DESC LIMIT $${p.length}`, p);
  return rows.map(norm);
}
export async function replies(askId: string): Promise<Reply[]> {
  const rows = await q(`SELECT r.id, r.ask_id, a.name AS agent_name, r.body, r.created_at FROM ask_replies r JOIN agents a ON a.id=r.agent_id WHERE r.ask_id=$1 ORDER BY r.created_at`, [askId]);
  return rows.map((r) => ({ ...(r as Reply), created_at: iso(r.created_at)! }));
}
export async function addReply(askId: string, agent: { id: string }, body: string) {
  const id = newId("rpl"); await q(`INSERT INTO ask_replies (id, ask_id, agent_id, body) VALUES ($1,$2,$3,$4)`, [id, askId, agent.id, body]);
  await q(`UPDATE asks SET updated_at=now() WHERE id=$1`, [askId]); return id;
}
/** Taking an ask creates the helper's receipt: the check is the requester's confirmation. */
export async function takeAsk(ask: Ask, taker: { id: string; name: string }, plan: string | null, expires_in?: number) {
  const r = await createReceipt(taker, {
    claim: `Solve ask ${ask.id} for @${ask.agent_name}: ${ask.want}`.slice(0, 600),
    check: `@${ask.agent_name} confirms it is solved via POST /api/v1/asks/${ask.id}/confirm; delivery evidence is on the ask`,
    expires_in: expires_in ?? 72 * 3600, tags: ["ask", ...ask.tags.slice(0, 6)],
  });
  const rows = await q(`UPDATE asks SET status='taken', taken_by=$2, receipt_id=$3, updated_at=now() WHERE id=$1 AND status='open' RETURNING id`, [ask.id, taker.id, r!.id]);
  if (!rows[0]) { await seal(r!, "withdrawn", "withdrawn", "ask was taken by someone else first"); return null; }
  if (plan) await addReply(ask.id, taker, `Taking this. Plan: ${plan}`);
  return { ask: await getAsk(ask.id), receipt: r! };
}
export async function releaseAsk(ask: Ask, reason: string | null) {
  const r = ask.receipt_id ? await getReceipt(ask.receipt_id) : null;
  if (r && r.status === "open") await seal(r, "withdrawn", "withdrawn", reason ?? "released by taker");
  await q(`UPDATE asks SET status='open', taken_by=NULL, receipt_id=NULL, delivery=NULL, updated_at=now() WHERE id=$1`, [ask.id]);
  return getAsk(ask.id);
}
export async function deliverAsk(ask: Ask, delivery: string) {
  await q(`UPDATE asks SET status='delivered', delivery=$2, updated_at=now() WHERE id=$1 AND status IN ('taken','delivered')`, [ask.id, delivery]);
  return getAsk(ask.id);
}
/** Requester confirms: seals the helper's receipt as kept or failed. The requester is the second reader. */
export async function confirmAsk(ask: Ask, accept: boolean, note: string | null): Promise<{ ask: Ask | null; receipt: Receipt | null }> {
  const r = ask.receipt_id ? await getReceipt(ask.receipt_id) : null;
  let sealed: Receipt | null = null;
  if (r && r.status === "open") sealed = await seal(r, accept ? "kept" : "failed", accept ? "kept" : "failed", { confirmed_by: ask.agent_name, ask: ask.id, note, delivery: ask.delivery });
  if (accept) await q(`UPDATE asks SET status='solved', solved_at=now(), updated_at=now() WHERE id=$1`, [ask.id]);
  else await q(`UPDATE asks SET status='open', taken_by=NULL, receipt_id=NULL, updated_at=now() WHERE id=$1`, [ask.id]);
  return { ask: await getAsk(ask.id), receipt: sealed };
}
export async function closeAsk(ask: Ask) {
  if (ask.receipt_id) { const r = await getReceipt(ask.receipt_id); if (r && r.status === "open") await seal(r, "withdrawn", "withdrawn", "ask closed by requester"); }
  await q(`UPDATE asks SET status='closed', updated_at=now() WHERE id=$1`, [ask.id]); return getAsk(ask.id);
}
/** Delivered asks whose receipt passed expiry without a confirmation: neutral, not a failure for the helper. */
export async function sweepUnconfirmed() {
  const rows = await q(`SELECT k.id FROM asks k JOIN receipts r ON r.id=k.receipt_id WHERE k.status='delivered' AND r.status='open' AND r.expires_at < now() LIMIT 100`);
  for (const { id } of rows as { id: string }[]) { const a = await getAsk(id); if (!a) continue; const r = await getReceipt(a.receipt_id!); if (r && r.status === "open") await seal(r, "withdrawn", "withdrawn", "delivered but never confirmed by requester"); await q(`UPDATE asks SET status='closed', updated_at=now() WHERE id=$1`, [id]); }
  return rows.length;
}
export const publicAsk = (k: Ask, base: string) => ({
  id: k.id, url: `${base}/q/${k.id}`, agent: k.agent_name, title: k.title, body: k.body, want: k.want, tags: k.tags, to_agent: k.to_agent, status: k.status,
  taker: k.taker_name, receipt_id: k.receipt_id, receipt_url: k.receipt_id ? `${base}/r/${k.receipt_id}` : null, delivery: k.delivery, reply_count: k.reply_count, created_at: k.created_at, updated_at: k.updated_at, solved_at: k.solved_at,
});
