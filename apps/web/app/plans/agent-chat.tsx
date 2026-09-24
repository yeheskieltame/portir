"use client";

import { useEffect, useRef, useState } from "react";
import type { AgentReply, PlanProposal } from "@/app/api/agent/route";
import { usd } from "@/app/verdict";
import { STOCK_NAMES } from "@/lib/catalog";

type Msg = { role: "you" | "agent"; text: string; plan?: PlanProposal; error?: boolean };

const SUGGESTIONS = [
  { icon: "◎", text: "Is now a good time to buy TSLA?" },
  { icon: "↻", text: "Invest $50 in AI & Semis every Monday, only when fair" },
  { icon: "≡", text: "What did my plans do this week?" },
];
const cadence = (days: number) => (days === 7 ? "weekly" : days === 14 ? "every 2 weeks" : "monthly");
const name = (target: string) => (target.startsWith("BASKET:") ? `${target.slice(7)} basket` : (STOCK_NAMES[target] ?? target));
const GRADIENT = "linear-gradient(90deg, #61a6f6 0%, #7ef0b0 100%)";

/** The agent's composer: describe a plan or ask about timing; a plan it proposes is confirmed in the user's wallet. */
export function AgentChat({ wallet, onStart, busy }: { wallet: `0x${string}`; onStart: (p: PlanProposal) => void; busy: boolean }) {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [msgs.length, thinking]);

  async function ask(prompt: string) {
    const q = prompt.trim();
    if (!q || thinking) return;
    setInput("");
    setMsgs((m) => [...m, { role: "you", text: q }]);
    setThinking(true);
    try {
      const res = await fetch("/api/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: q, wallet }) });
      const r = (await res.json()) as AgentReply & { error?: string };
      setMsgs((m) => [...m, r.error ? { role: "agent", text: r.error, error: true } : { role: "agent", text: r.text, plan: r.plan }]);
    } catch {
      setMsgs((m) => [...m, { role: "agent", text: "Could not reach the agent.", error: true }]);
    } finally {
      setThinking(false);
    }
  }

  return (
    <section className="mt-6">
      {/* Composer */}
      <form
        onSubmit={(e) => { e.preventDefault(); void ask(input); }}
        className="relative isolate flex min-h-40 flex-col rounded-[22px] border border-line p-4 shadow-[0_2px_40px_rgba(0,0,0,.45),inset_0_1px_0_rgba(255,255,255,.04)] lg:min-h-44 lg:p-6"
        style={{ background: "linear-gradient(180deg, rgba(255,255,255,.035), rgba(255,255,255,0) 42%), #0b111c" }}
      >
        {/* Underglow hugging the bottom edge */}
        <span aria-hidden className="absolute inset-x-0 -bottom-[3px] -z-10 rounded-[inherit] opacity-90" style={{ top: 0, background: GRADIENT, filter: "blur(.5px)" }} />
        <span aria-hidden className="absolute inset-0 -z-10 rounded-[inherit]" style={{ background: "#0b111c" }} />
        <span aria-hidden className="pointer-events-none absolute inset-x-8 -bottom-3 -z-10 h-6 opacity-35 blur-xl" style={{ background: GRADIENT }} />

        <textarea
          ref={box}
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(input); } }}
          placeholder="Tell the agent what to do — “invest $50 in NVDA every week, only when the price is fair”"
          className="w-full resize-none bg-transparent text-base outline-none placeholder:text-muted lg:text-lg"
        />

        <div className="mt-auto flex items-center gap-2 pt-3">
          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto [scrollbar-width:none]">
            {SUGGESTIONS.map((s) => (
              <button
                key={s.text}
                type="button"
                onClick={() => (msgs.length ? void ask(s.text) : setInput(s.text))}
                className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/20 bg-white/[0.03] px-3 py-1.5 text-xs text-white/85 transition-colors hover:bg-white/[0.07]"
              >
                <span aria-hidden className="text-go">{s.icon}</span>
                <span className="max-w-48 truncate lg:max-w-none">{s.text}</span>
              </button>
            ))}
          </div>
          <button
            type="submit"
            disabled={thinking || !input.trim()}
            aria-label="Send"
            className="relative size-11 shrink-0 rounded-full p-[1.5px] transition-[filter,transform] hover:brightness-110 active:scale-95 disabled:opacity-50"
            style={{ background: GRADIENT }}
          >
            <span aria-hidden className="absolute inset-0 animate-spin rounded-full [animation-duration:10s]" style={{ background: "conic-gradient(from 0deg, #61a6f6, #7ef0b0, #61a6f6)" }} />
            <span className="relative grid size-full place-items-center rounded-full bg-[#0b111c] text-white">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 19V5M5 12l7-7 7 7" /></svg>
            </span>
          </button>
        </div>
      </form>
      <p className="mt-2 px-1 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Portir agent · BNB Agent Studio · reads the market, never holds your keys</p>

      {/* Conversation */}
      {msgs.length > 0 && (
        <div className="animate-rise mt-4 rounded-3xl p-px" style={{ background: "linear-gradient(135deg, rgba(97,166,246,.55), rgba(126,240,176,.45) 60%, rgba(255,255,255,.08))" }}>
          <div className="rounded-[23px] bg-[#070c15] p-4 lg:p-5">
            <div className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
              <span aria-hidden className={`size-1.5 rounded-full bg-go ${thinking ? "animate-pulse shadow-[0_0_8px_var(--color-go)]" : ""}`} />
              {thinking ? "Live reasoning" : "Conversation"}
              <button type="button" onClick={() => setMsgs([])} className="ml-auto normal-case tracking-normal underline">clear</button>
            </div>
            <ol className="mt-3 max-h-[28rem] space-y-3 overflow-y-auto pr-1 text-sm">
              {msgs.map((m, i) => (
                <li key={i} className={`flex items-end gap-2 ${m.role === "you" ? "justify-end" : ""}`}>
                  {m.role === "agent" && <span aria-hidden className="mb-1 size-6 shrink-0 rounded-full" style={{ background: "linear-gradient(105deg, #61a6f6 0%, #7ef0b0 100%)" }} />}
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 leading-relaxed ${m.role === "you" ? "bg-white text-black" : m.error ? "border border-warn/30 bg-warn/[0.07] text-warn" : "bg-white/[0.06]"}`}>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                    {m.plan && (
                      <div className="mt-3 rounded-xl border border-line bg-[#04070d]/70 p-3">
                        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted">Proposed plan</p>
                        <p className="mt-1 text-base font-medium">{usd.format(m.plan.usdt)} of {name(m.plan.target)}, {m.plan.once ? "once, when the price is fair" : cadence(m.plan.intervalDays)}</p>
                        <p className="mt-0.5 text-xs text-muted">{m.plan.once ? "Watches up to 7 days, buys one time, then stops" : m.plan.smartTiming ? "Smart timing · waits for the market to open and a fair price" : "Buys at the scheduled time"}</p>
                        <button type="button" disabled={busy} onClick={() => onStart(m.plan!)} className="mt-3 w-full rounded-full py-2 text-xs font-medium text-black disabled:opacity-50" style={{ background: GRADIENT }}>
                          {busy ? "Confirming in your wallet…" : m.plan.once ? "Start watching" : "Start this plan"}
                        </button>
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {thinking && (
                <li className="flex items-end gap-2">
                  <span aria-hidden className="mb-1 size-6 shrink-0 rounded-full" style={{ background: "linear-gradient(105deg, #61a6f6 0%, #7ef0b0 100%)" }} />
                  <span className="flex gap-1 rounded-2xl bg-white/[0.06] px-3.5 py-3">
                    {[0, 1, 2].map((d) => <span key={d} className="size-1.5 animate-bounce rounded-full bg-white/60" style={{ animationDelay: `${d * 150}ms` }} />)}
                  </span>
                </li>
              )}
              <div ref={bottom} />
            </ol>
          </div>
        </div>
      )}
    </section>
  );
}
