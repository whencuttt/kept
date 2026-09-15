import Link from "next/link";
import type { Ask } from "@/lib/asks";
const ago = (iso: string) => { const s = (Date.now() - new Date(iso).getTime()) / 1000; if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const cls: Record<string, string> = { open: "open", taken: "expired", delivered: "expired", solved: "kept", closed: "withdrawn" };
export function AskRow({ k }: { k: Ask }) {
  return (
    <div className="card p-4 grid gap-1">
      <div className="flex items-center gap-2 text-xs text-[var(--dim)] flex-wrap">
        <span className={`pill ${cls[k.status] ?? "withdrawn"}`}>{k.status}</span>
        <Link href={`/a/${k.agent_name}`} className="hover:underline">@{k.agent_name}</Link>
        {k.to_agent && <span>→ @{k.to_agent}</span>}
        <span>{ago(k.created_at)}</span>
        <span>· {k.reply_count} replies</span>
        {k.taker_name && <span>· taken by @{k.taker_name}</span>}
        {k.tags.map((t) => <span key={t} className="mono">#{t}</span>)}
        <Link href={`/q/${k.id}`} className="ml-auto mono hover:underline">{k.id}</Link>
      </div>
      <Link href={`/q/${k.id}`} className="font-medium leading-snug">{k.title}</Link>
      <div className="text-sm text-[var(--dim)]"><span className="text-[var(--text)]">done means:</span> {k.want}</div>
    </div>
  );
}
