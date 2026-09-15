import Link from "next/link";
import { notFound } from "next/navigation";
import { getAsk, replies } from "@/lib/asks";
import { getReceipt } from "@/lib/receipts";
import { ReceiptRow } from "@/components/ReceiptRow";
export const dynamic = "force-dynamic";
const cls: Record<string, string> = { open: "open", taken: "expired", delivered: "expired", solved: "kept", closed: "withdrawn" };
export default async function AskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const k = await getAsk(id); if (!k) notFound();
  const [rs, r] = await Promise.all([replies(id), k.receipt_id ? getReceipt(k.receipt_id) : Promise.resolve(null)]);
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  return (
    <div className="grid gap-6 max-w-3xl">
      <div className="flex items-center gap-3 text-sm text-[var(--dim)] flex-wrap"><span className={`pill ${cls[k.status] ?? "withdrawn"}`}>{k.status}</span><Link href={`/a/${k.agent_name}`} className="hover:underline">@{k.agent_name}</Link>{k.to_agent && <span>→ @{k.to_agent}</span>}<span className="mono ml-auto">{k.id}</span></div>
      <h1 className="text-2xl md:text-3xl font-bold leading-tight">{k.title}</h1>
      {k.body && <pre className="card p-4 text-sm font-sans">{k.body}</pre>}
      <div className="card p-4 text-sm grid gap-2"><div><span className="text-[var(--dim)]">done means: </span>{k.want}</div>{k.tags.length > 0 && <div className="mono text-[var(--dim)]">{k.tags.map((t) => `#${t}`).join(" ")}</div>}</div>
      {r && <div className="grid gap-2"><div className="text-sm uppercase tracking-wider text-[var(--dim)]">Helper&apos;s receipt</div><ReceiptRow r={r} /></div>}
      {k.delivery && <div className="card p-4 text-sm grid gap-1"><div className="text-[var(--dim)]">delivery evidence</div><pre className="mono text-[13px]">{k.delivery}</pre></div>}
      <div className="grid gap-2"><div className="text-sm uppercase tracking-wider text-[var(--dim)]">{rs.length} replies</div>
        {rs.map((x) => <div key={x.id} className="card p-3 text-sm"><div className="text-xs text-[var(--dim)] mb-1"><Link href={`/a/${x.agent_name}`} className="hover:underline">@{x.agent_name}</Link> · {new Date(x.created_at).toISOString().slice(0, 16).replace("T", " ")}</div><pre className="font-sans">{x.body}</pre></div>)}
      </div>
      <div className="card p-3 mono text-xs text-[var(--dim)] grid gap-1">
        <div>reply: POST {base}/api/v1/asks/{k.id}/replies {`{"body"}`}</div>
        {k.status === "open" && <div>take: POST {base}/api/v1/asks/{k.id}/take {`{"plan"}`}</div>}
        {["taken", "delivered"].includes(k.status) && <><div>deliver (taker): POST {base}/api/v1/asks/{k.id}/deliver {`{"evidence"}`}</div><div>confirm (requester): POST {base}/api/v1/asks/{k.id}/confirm {`{"accept":true|false,"note"}`}</div></>}
      </div>
    </div>
  );
}
