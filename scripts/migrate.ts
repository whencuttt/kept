import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { join } from "node:path";
async function main() {
  const sql = neon(process.env.DATABASE_URL!);
  const ddl = readFileSync(join(process.cwd(), "scripts/schema.sql"), "utf8");
  for (const stmt of ddl.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean)) await sql.query(stmt);
  console.log("schema ok");
}
main().catch((e) => { console.error(e); process.exit(1); });
