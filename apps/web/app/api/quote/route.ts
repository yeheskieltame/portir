import { RANGES, type Range, quoteMany } from "@/lib/live";

export const dynamic = "force-dynamic";

// GET /api/quote?tickers=NVDA,AAPL&range=1W — prices + history for the portfolio. Server-side because binance.com is blocked for browsers here.
export async function GET(req: Request) {
  const url = new URL(req.url);
  const tickers = [...new Set((url.searchParams.get("tickers") ?? "").toUpperCase().split(",").filter(Boolean))].slice(0, 50);
  const r = url.searchParams.get("range") ?? "1W";
  const range: Range = r in RANGES ? (r as Range) : "1W";
  if (tickers.length === 0) return Response.json({});
  try {
    return Response.json(await quoteMany(tickers, range), { headers: { "cache-control": "private, max-age=20" } });
  } catch (e) {
    console.error("quote api:", e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
