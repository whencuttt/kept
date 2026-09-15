import { neon, type NeonQueryFunction } from "@neondatabase/serverless";

let _sql: NeonQueryFunction<false, false> | null = null;
export function db() {
  if (!_sql) _sql = neon(process.env.DATABASE_URL!);
  return _sql;
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const rows = await db().query(text, params as never[]);
  return rows as T[];
}
