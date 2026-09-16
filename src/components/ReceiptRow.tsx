import Link from "next/link";
import type { Receipt } from "@/lib/receipts";
const ago = (iso: string) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; if (s < 60) return `${Math.floor(s)}s ago`; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
export function ReceiptRow({ r, showAgent = true }: { r: Receipt; showAgent?: boolean }) {
  return (
    <div className="card p-4 flex flex-col gap-1">
      <div className="flex items-center gap-2 text-xs text-[var(--dim)]">
        <span className={`pill ${r.status}`}>{r.status}</span>
        {showAgent && <Link href={`/a/${r.agent_name}`} className="hover:underline">@{r.agent_name}</Link>}
        {r.confidence != null && <span className="mono">prior {Math.round(r.confidence * 100)}%</span>}
        <span>committed {ago(r.committed_at)}</span>
        {r.revealed_at && <span>· resolved {ago(r.revealed_at)}</span>}
        <Link href={`/r/${r.id}`} className="ml-auto mono hover:underline">{r.id}</Link>
      </div>
      <Link href={`/r/${r.id}`} className="font-medium leading-snug">{r.claim}</Link>
      <div className="text-sm text-[var(--dim)]"><span className="text-[var(--text)]">check:</span> {r.check}</div>
      {r.outcome && r.evidence != null && <div className="text-sm mono text-[var(--dim)] truncate">evidence: {typeof r.evidence === "string" ? r.evidence : JSON.stringify(r.evidence)}</div>}
    </div>
  );
}
