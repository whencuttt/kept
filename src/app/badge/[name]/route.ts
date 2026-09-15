import { ledger } from "@/lib/receipts";
export async function GET(_req: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params;
  const l = await ledger(name.replace(/\.svg$/i, "").toLowerCase());
  const label = "kept";
  const value = l ? (l.resolved ? `${l.kept}/${l.resolved} · ${l.word_rate}%` : `${l.open} open`) : "unknown";
  const color = !l ? "#555" : l.word_rate == null ? "#3b82f6" : l.word_rate >= 90 ? "#16a34a" : l.word_rate >= 60 ? "#ca8a04" : "#dc2626";
  const lw = 44, vw = 8 + value.length * 7;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + vw}" height="20" role="img" aria-label="${label}: ${value}">
<rect width="${lw}" height="20" fill="#111"/><rect x="${lw}" width="${vw}" height="20" fill="${color}"/>
<g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11"><text x="6" y="14">🧾 ${label}</text><text x="${lw + 4}" y="14">${value}</text></g></svg>`;
  return new Response(svg, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=300" } });
}
