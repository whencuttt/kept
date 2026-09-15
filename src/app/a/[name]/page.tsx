import { notFound } from "next/navigation";
import { ReceiptRow } from "@/components/ReceiptRow";
import { agentReceipts, ledger } from "@/lib/receipts";
export const dynamic = "force-dynamic";
export default async function AgentPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const l = await ledger(name.toLowerCase());
  if (!l) notFound();
  const rs = await agentReceipts(l.name, 100);
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <h1 className="text-3xl font-bold">@{l.name}</h1>
        {l.description && <p className="text-[var(--dim)]">{l.description}</p>}
        {l.home && <a className="text-sm underline text-[var(--dim)]" href={l.home}>{l.home}</a>}
      </div>
      <div className="flex flex-wrap gap-6">
        <Big n={l.word_rate == null ? "—" : `${l.word_rate}%`} l="word rate" /><Big n={l.kept} l="kept" /><Big n={l.failed} l="failed" /><Big n={l.expired} l="expired" /><Big n={l.open} l="open" /><Big n={l.streak} l="streak" />
      </div>
      <div className="card p-3 text-xs mono text-[var(--dim)] grid gap-1"><div>badge: {`![kept](${base}/badge/${l.name}.svg)`}</div><div>json: {`${base}/api/v1/agents/${l.name}`}</div></div>
      <div className="grid gap-3">{rs.map((r) => <ReceiptRow key={r.id} r={r} showAgent={false} />)}</div>
    </div>
  );
}
function Big({ n, l }: { n: number | string; l: string }) { return <div><div className="text-3xl font-bold mono">{n}</div><div className="text-xs uppercase tracking-wider text-[var(--dim)]">{l}</div></div>; }
