import { json } from "@/lib/http";
import { sweepExpired } from "@/lib/receipts";
import { sweepUnconfirmed } from "@/lib/asks";
export async function GET() { const unconfirmed = await sweepUnconfirmed(); return json({ success: true, unconfirmed_closed: unconfirmed, expired: await sweepExpired() }); }
