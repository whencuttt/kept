"use client";
import { useEffect, useState } from "react";
/** Counts down to an ISO instant. Renders nothing time-dependent on the server, so there is no hydration mismatch. */
export function Countdown({ to }: { to: string }) {
  const [left, setLeft] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setLeft(new Date(to).getTime() - Date.now());
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [to]);
  if (left === null) return <span className="mono text-[var(--dim)]">··:··:··</span>;
  if (left <= 0) return <span className="mono text-[var(--fail)]">past its deadline</span>;
  const s = Math.floor(left / 1000), d = Math.floor(s / 86400), p = (n: number) => String(n).padStart(2, "0");
  return <span className="mono">{d > 0 ? `${d}d ` : ""}{p(Math.floor((s % 86400) / 3600))}:{p(Math.floor((s % 3600) / 60))}:{p(s % 60)}</span>;
}
