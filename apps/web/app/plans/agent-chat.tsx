"use client";

import { useRef, useState } from "react";
import type { AgentReply, PlanProposal } from "@/app/api/agent/route";
import { usd } from "@/app/verdict";
import { BASKETS, STOCK_NAMES } from "@/lib/catalog";

type Msg = { role: "you" | "agent"; text: string; plan?: PlanProposal; error?: boolean };

const SUGGESTIONS = ["Is now a good time to buy TSLA?", "Invest $50 in AI & Semis every Monday, only when fair", "What did my plans do this week?"];
const cadence = (days: number) => (days === 7 ? "weekly" : days === 14 ? "every 2 weeks" : "monthly");
const name = (target: string) => (target.startsWith("BASKET:") ? `${target.slice(7)} basket` : (STOCK_NAMES[target] ?? target));

/** Talk to the Portir agent (its free x402 face). A plan it proposes is confirmed here, in the user's wallet. */
export function AgentChat({ wallet, onStart, busy }: { wallet: `0x${string}`; onStart: (p: PlanProposal) => void; busy: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  async function ask(prompt: string) {
    if (!prompt.trim() || thinking) return;
    setInput("");
    setMsgs((m) => [...m, { role: "you", text: prompt }]);
    setThinking(true);
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, wallet }) });
      const r = (await res.json()) as AgentReply & { error?: string };
      setMsgs((m) => [...m, r.error ? { role: "agent", text: r.error, error: true } : { role: "agent", text: r.text, plan: r.plan }]);
    } catch {
      setMsgs((m) => [...m, { role: "agent", text: "Could not reach the agent.", error: true }]);
    } finally {
      setThinking(false);
      setTimeout(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
    }
  }

  return (
    <section className="glass mt-4 rounded-3xl p-4">
      <div className="flex items-center gap-2">
        <span aria-hidden className="size-2 rounded-full bg-go shadow-[0_0_10px_var(--color-go)]" />
        <h3 className="text-sm font-medium">Ask the agent</h3>
        <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.12em] text-muted">BNB Agent Studio</span>
      </div>
      <p className="mt-1 text-xs text-muted">The same agent that runs your plans. Ask about timing, or describe a plan in plain words.</p>

      {msgs.length === 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {SUGGESTIONS.map((s) => (
            <button key={s} onClick={() => ask(s)} className="rounded-full border border-line px-3 py-1.5 text-left text-xs text-muted hover:text-white">{s}</button>
          ))}
        </div>
      ) : (
        <ol className="mt-3 max-h-80 space-y-3 overflow-y-auto pr-1 text-sm">
          {msgs.map((m, i) => (
            <li key={i} className={m.role === "you" ? "flex justify-end" : ""}>
              <div className={`max-w-[92%] rounded-2xl px-3.5 py-2.5 ${m.role === "you" ? "bg-white text-black" : m.error ? "border border-warn/40 bg-warn/10 text-warn" : "bg-white/5"}`}>
                <p className="whitespace-pre-wrap">{m.text}</p>
                {m.plan && (
                  <div className="mt-3 rounded-xl border border-line bg-[#04070d]/60 p-3">
                    <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Proposed plan</p>
                    <p className="mt-1 font-medium">{usd.format(m.plan.usdt)} of {name(m.plan.target)}, {cadence(m.plan.intervalDays)}</p>
                    <p className="text-xs text-muted">{m.plan.smartTiming ? "Smart timing on · waits for the market to open and a fair price" : "Buys at the scheduled time"}</p>
                    <button disabled={busy} onClick={() => onStart(m.plan!)} className="mt-3 w-full rounded-full bg-white py-2 text-xs font-medium text-black disabled:opacity-50">
                      {busy ? "Confirming…" : "Start this plan"}
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
          {thinking && <li className="animate-pulse text-xs text-muted">Checking the market…</li>}
          <div ref={bottom} />
        </ol>
      )}

      <form onSubmit={(e) => { e.preventDefault(); void ask(input); }} className="mt-3 flex items-center gap-2 rounded-full border border-line pl-4 pr-1">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Invest $50 in NVDA every week when fair…" className="w-full bg-transparent py-2.5 text-sm outline-none placeholder:text-muted" />
        <button disabled={thinking || !input.trim()} className="rounded-full bg-white px-3 py-1.5 text-xs font-medium text-black disabled:opacity-50">Send</button>
      </form>
      <p className="mt-2 text-[11px] text-muted">Baskets: {BASKETS.map((b) => b.name).join(", ")}.</p>
    </section>
  );
}
