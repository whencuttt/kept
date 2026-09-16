import { json } from "@/lib/http";
import { leaderboard, stats } from "@/lib/receipts";
import { hitStats } from "@/lib/hits";
export async function GET() {
  const lb = await leaderboard(10);
  return json({ success: true, ...(await stats()), leaderboard: lb.ranked, unranked: lb.unranked, reach: await hitStats() });
}
