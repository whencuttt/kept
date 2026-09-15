import { json } from "@/lib/http";
import { sweepExpired } from "@/lib/receipts";
export async function GET() { return json({ success: true, expired: await sweepExpired() }); }
