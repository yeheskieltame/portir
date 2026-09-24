import { BASKETS, STOCK_NAMES } from "@/lib/catalog";
import { CADENCES } from "@/lib/planRegistry";

export const dynamic = "force-dynamic";

/** A plan the agent proposed; the user's wallet signs it in the app. */
export interface PlanProposal {
  target: string;
  usdt: number;
  intervalDays: (typeof CADENCES)[keyof typeof CADENCES];
  smartTiming: boolean;
}
export interface AgentReply {
  text: string;
  plan?: PlanProposal;
}

const AGENT = process.env.PORTIR_AGENT_URL ?? "http://127.0.0.1:9000"; // not "localhost": Node may resolve it to ::1 while the agent listens on IPv4
const TIMEOUT_MS = 90_000;

// POST /api/agent { prompt, wallet? } → the Portir agent's answer (its free x402 face), plus a plan proposal when it made one.
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { prompt?: string; wallet?: string };
  const prompt = String(body.prompt ?? "").trim().slice(0, 600);
  if (!prompt) return Response.json({ error: "prompt is required" }, { status: 400 });
  const context = body.wallet ? `The user's wallet is ${body.wallet}. ` : "";
  try {
    const res = await fetch(`${AGENT}/x402`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: `${context}${prompt}` }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error("agent api: agent answered", res.status, await res.text().catch(() => ""));
      // The agent runs on Pieverse's free model, which rate-limits bursts; the agent itself is fine.
      return Response.json({ error: "The agent is busy right now (its model rate-limited the request). Give it a minute and ask again." }, { status: 503 });
    }
    const { result } = (await res.json()) as { result?: string };
    return Response.json(parseReply(String(result ?? "")));
  } catch (e) {
    console.error("agent api:", e);
    return Response.json({ error: "The agent is not reachable right now. Run it with `bag dev` or set PORTIR_AGENT_URL." }, { status: 503 });
  }
}

/** The agent ends a plan suggestion with one line `PLAN {...}` (see its system prompt); lift it out and validate it. */
function parseReply(raw: string): AgentReply {
  const m = raw.match(/^\s*PLAN\s+(\{.*\})\s*$/m);
  const text = raw.replace(/^\s*PLAN\s+\{.*\}\s*$/m, "").trim();
  if (!m) return { text };
  try {
    const p = JSON.parse(m[1]) as Partial<PlanProposal>;
    const target = String(p.target ?? "").toUpperCase().startsWith("BASKET:")
      ? BASKETS.find((b) => b.name.toLowerCase() === String(p.target).slice(7).trim().toLowerCase())
        ? `BASKET:${BASKETS.find((b) => b.name.toLowerCase() === String(p.target).slice(7).trim().toLowerCase())!.name}`
        : null
      : STOCK_NAMES[String(p.target ?? "").toUpperCase()] || /^[A-Z.]{1,8}$/.test(String(p.target ?? "").toUpperCase())
        ? String(p.target).toUpperCase()
        : null;
    const usdt = Number(p.usdt);
    const days = Object.values(CADENCES).find((d) => d === Number(p.intervalDays));
    if (!target || !(usdt >= 1) || !days) return { text };
    return { text, plan: { target, usdt, intervalDays: days, smartTiming: p.smartTiming !== false } };
  } catch {
    return { text };
  }
}
