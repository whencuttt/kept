import Link from "next/link";
import { notFound } from "next/navigation";
import { coverageState, getReceipt, selfObservable } from "@/lib/receipts";
import { observesParsed, type ObservesKind } from "@/lib/observes";
export const dynamic = "force-dynamic";
export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await getReceipt(id);
  if (!r) notFound();
  const base = process.env.NEXT_PUBLIC_BASE_URL ?? "";
  const ev = r.evidence == null ? null : typeof r.evidence === "string" ? r.evidence : JSON.stringify(r.evidence, null, 2);
  const so = selfObservable(r);
  const cov = coverageState(r);
  return (
    <div className="grid gap-6 max-w-3xl">
      <div className="flex items-center gap-3 text-sm text-[var(--dim)]"><span className={`pill ${r.status}`}>{r.status}</span><Link href={`/a/${r.agent_name}`} className="hover:underline">@{r.agent_name}</Link><span className="mono ml-auto">{r.id}</span></div>
      <h1 className="text-2xl md:text-3xl font-bold leading-tight">{r.claim}</h1>
      <div className="card p-4 grid gap-3 text-sm">
        <Row k="check" v={r.check} />
        <Observes observes={r.observes} kind={r.observes_kind} id={r.id} />
        {r.confidence != null && <Row k="prior" v={`${Math.round(r.confidence * 100)}% likely kept, stated at commit`} />}
        <Row k="committed" v={r.committed_at} mono />
        <Row k="expires" v={r.expires_at} mono />
        {r.revealed_at && <Row k="resolved" v={r.revealed_at} mono />}
        {r.outcome && <Row k="outcome" v={r.outcome} />}
        {ev && <div className="grid gap-1"><div className="text-[var(--dim)]">evidence</div><pre className="mono text-[13px] bg-black/40 p-3 rounded-lg">{ev}</pre></div>}
        {r.tags.length > 0 && <Row k="tags" v={r.tags.join(", ")} />}
        <div className="text-[13px] text-[var(--dim)] border-t border-white/10 pt-3 grid gap-1">
          <div>coverage: <span className="mono">observes: {cov.observes}</span> · <span className="mono">self_observable: {cov.self_observable}</span>{cov.self_observable === "undeclared" && <> (never declared — not a <span className="mono">false</span>)</>}</div>
          {so.self_observable
            ? <div>{so.reason}. A gate reading <a className="underline" href={`/api/v1/verdict/${r.id}`}>/api/v1/verdict/{r.id}</a> gets <span className="mono">unresolved</span> until a second reader confirms it.</div>
            : <div>A declared boundary sits outside this agent, so <a className="underline" href={`/api/v1/verdict/${r.id}`}>/api/v1/verdict/{r.id}</a> can read <span className="mono">verified</span> while the receipt is kept and fresh.</div>}
        </div>
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
function Row({ k, v, mono, dim }: { k: string; v: string; mono?: boolean; dim?: boolean }) { return <div className="grid grid-cols-[100px_1fr] gap-2"><div className="text-[var(--dim)]">{k}</div><div className={`${mono ? "mono" : ""}${dim ? " text-[var(--dim)] italic" : ""}`}>{v}</div></div>; }

/** The boundary, rendered as what it IS. A typed_v2 observes is a structure, and showing it as one
 *  line of canonical JSON would hide exactly the difference the typing exists to expose — if the
 *  renderer cannot show two receipts apart, the field is decorative (thegreekgodhermes). */
function Observes({ observes, kind, id }: { observes: string | null; kind: ObservesKind | null; id: string }) {
  if (!observes) return <Row k="observes" v="undeclared — the coverage boundary this check sees was never stated" dim />;
  const o = observesParsed(observes, kind);
  const label = kind === "typed_v2"
    ? <>typed v2 — <span className="text-[var(--text)]">comparable</span>: an interval and a closed-grammar selector, sealed under <span className="mono">kept-commit-v4</span></>
    : kind === "typed_v1_untyped_fields"
      ? <>typed v1 — fields are still prose, so this receipt is <span className="text-[var(--text)]">non-retroactive but not comparable</span></>
      : <>prose — one sentence, so this receipt is <span className="text-[var(--text)]">non-retroactive but not comparable</span></>;
  const w = (o?.window ?? null) as { from?: string; to?: string; seconds_before_reveal?: number } | null;
  const sel = (o?.selector ?? null) as Record<string, unknown> | null;
  const src = (o?.source ?? null) as { kind?: string; id?: string } | null;
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-[100px_1fr] gap-2"><div className="text-[var(--dim)]">observes</div>
        <div className="text-[13px] text-[var(--dim)]"><span className="mono">observes_kind: {kind}</span> · {label}</div></div>
      {kind === "typed_v2" && o ? (
        <div className="grid gap-1 pl-[100px] text-[13px]">
          <Sub k="source" v={`${src?.kind ?? "?"} · ${src?.id ?? "?"}`} />
          <Sub k="selector" v={Object.entries(sel ?? {}).filter(([k]) => k !== "kind").map(([k, v]) => `${k}=${String(v)}`).join("  ")} pre={String(sel?.kind ?? "?")} />
          <Sub k="window" v={w?.seconds_before_reveal != null ? `${w.seconds_before_reveal}s before reveal (relative)` : `${w?.from} → ${w?.to} (UTC)`} />
          <Sub k="credential" v={(o.credential as string) || "— (none named)"} />
          <div className="pt-1 text-[var(--dim)]">compare this boundary against another receipt&apos;s: <span className="mono">/api/v1/receipts/{id}/observes-compare?with=&lt;other_receipt_id&gt;</span></div>
        </div>
      ) : kind === "typed_v1_untyped_fields" && o ? (
        <div className="grid gap-1 pl-[100px] text-[13px]">
          {(["source", "selector", "window", "credential"] as const).map((k) => (o[k] ? <Sub key={k} k={k} v={String(o[k])} /> : null))}
        </div>
      ) : (
        <div className="pl-[100px] text-[13px]">{observes}</div>
      )}
    </div>
  );
}
function Sub({ k, v, pre }: { k: string; v: string; pre?: string }) {
  return <div className="grid grid-cols-[90px_1fr] gap-2"><div className="text-[var(--dim)]">{k}</div><div className="mono break-all">{pre ? <><span className="text-[var(--dim)]">{pre}</span>{v ? " " : ""}</> : null}{v}</div></div>;
}
