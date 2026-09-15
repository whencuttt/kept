import { json } from "@/lib/http";
import { leaderboard, stats } from "@/lib/receipts";
import { hitStats } from "@/lib/hits";
export async function GET() {
  return json({ success: true, ...(await stats()), leaderboard: await leaderboard(10), reach: await hitStats() });
}
