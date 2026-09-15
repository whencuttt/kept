import { NextResponse } from "next/server";

export const json = (data: unknown, status = 200) => NextResponse.json(data, { status });
export const err = (message: string, status = 400, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ success: false, error: message, ...extra }, { status });

export function baseUrl(req: Request) {
  const env = process.env.NEXT_PUBLIC_BASE_URL;
  if (env) return env.replace(/\/$/, "");
  const h = new Headers(req.headers);
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}
export function clientIp(req: Request) {
  const h = new Headers(req.headers);
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
}
export async function readJson<T>(req: Request): Promise<T | null> {
  try { return (await req.json()) as T; } catch { return null; }
}
export const text = (body: string, type = "text/markdown; charset=utf-8") =>
  new NextResponse(body, { status: 200, headers: { "content-type": type, "cache-control": "no-store" } });
