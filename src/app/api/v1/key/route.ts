import { publicKey } from "@/lib/crypto";
import { json } from "@/lib/http";
export async function GET() { return json({ service: "kept", ...publicKey() }); }
