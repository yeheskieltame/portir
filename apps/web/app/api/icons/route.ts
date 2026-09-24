import { iconOf } from "@/lib/live";

export const dynamic = "force-dynamic";

// GET /api/icons?tickers=NVDA,AAPL → { NVDA: url | null, ... } for client pages (the Binance CDN is not reachable from browsers here).
export async function GET(req: Request) {
  const tickers = [...new Set((new URL(req.url).searchParams.get("tickers") ?? "").toUpperCase().split(",").filter((t) => /^[A-Z.]{1,8}$/.test(t)).slice(0, 60))];
  const icons = Object.fromEntries(await Promise.all(tickers.map(async (t) => [t, await iconOf(t)] as const)));
  return Response.json(icons, { headers: { "cache-control": "public, max-age=3600, stale-while-revalidate=86400" } });
}
