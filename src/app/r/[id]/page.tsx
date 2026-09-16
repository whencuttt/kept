import Link from "next/link";
import { notFound } from "next/navigation";
import { getReceipt, selfObservable } from "@/lib/receipts";
export const dynamic = "force-dynamic";
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getReceipt(id);
  if (!r) notFound();
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const ev = r.evidence == null ? null : typeof r.evidence === "string" ? r.evidence : JSON.stringify(r.evidence, null, 2);
  const so = selfObservable(r);
  return (
    <div className="grid gap-6 max-w-3xl">
      <div className="flex items-center gap-3 text-sm text-[var(--dim)]"><span className={`pill ${r.status}`}>{r.status}</span><Link href={`/a/${r.agent_name}`} className="hover:underline">@{r.agent_name}</Link><span className="mono ml-auto">{r.id}</span></div>
      <h1 className="text-2xl md:text-3xl font-bold leading-tight">{r.claim}</h1>
      <div className="card p-4 grid gap-3 text-sm">
        <Row k="check" v={r.check} />
        {r.observes && <Row k="observes" v={r.observes} />}
        {r.confidence != null && <Row k="prior" v={`${Math.round(r.confidence * 100)}% likely kept, stated at commit`} />}
        <Row k="committed" v={r.committed_at} mono />
        <Row k="expires" v={r.expires_at} mono />
        {r.revealed_at && <Row k="resolved" v={r.revealed_at} mono />}
        {r.outcome && <Row k="outcome" v={r.outcome} />}
        {ev && <div className="grid gap-1"><div className="text-[var(--dim)]">evidence</div><pre className="mono text-[13px] bg-black/40 p-3 rounded-lg">{ev}</pre></div>}
        {r.tags.length > 0 && <Row k="tags" v={r.tags.join(", ")} />}
        {so.self_observable && <div className="text-[13px] text-[var(--dim)] border-t border-white/10 pt-3">Self-observable: {so.reason}. A gate reading <a className="underline" href={`/api/v1/verdict/${r.id}`}>/api/v1/verdict/{r.id}</a> gets <span className="mono">unresolved</span> until a second reader confirms it.</div>}
      </div>
      <div className="card p-4 grid gap-2 text-xs mono text-[var(--dim)]">
        <div className="text-[var(--text)] text-sm font-sans font-medium">Proof</div>
        <div>commit_hash {r.commit_hash}</div>
        <div className="break-all">commit_sig {r.commit_sig}</div>
        {r.seal_hash && <><div>seq {r.seq} · prev_seal {r.prev_seal ?? "(genesis)"}</div><div>evidence_hash {r.evidence_hash}</div><div>seal_hash {r.seal_hash}</div><div className="break-all">seal_sig {r.seal_sig}</div></>}
        <div className="pt-2 font-sans text-sm"><a className="underline" href={`/api/v1/verify/${r.id}`}>verify now</a> · <a className="underline" href={`/api/v1/receipts/${r.id}`}>json</a> · <a className="underline" href="/.well-known/kept.json">public key</a></div>
      </div>
      <div className="card p-4 text-sm grid gap-2"><div className="text-[var(--dim)]">paste this</div><pre className="mono text-[13px]">{`${base}/r/${r.id}`}</pre></div>
    </div>
  );
}
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) { return <div className="grid grid-cols-[100px_1fr] gap-2"><div className="text-[var(--dim)]">{k}</div><div className={mono ? "mono" : ""}>{v}</div></div>; }
