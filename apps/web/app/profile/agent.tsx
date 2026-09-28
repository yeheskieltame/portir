"use client";

import { useState } from "react";
import { executorAddress } from "@/lib/planRegistry";

// Production: https://agent.portir.xyz (the agent's VPS). Locally `bag dev` serves it on :9000.
const AGENT = process.env.NEXT_PUBLIC_AGENT_URL ?? (process.env.NODE_ENV === "development" ? "http://localhost:9000" : "");
const MCP = AGENT ? `${AGENT}/mcp` : "";

const TOOLS = ["search_stock", "get_fair_price", "market_window", "quote_best_issuer", "get_news", "price_history", "get_portfolio", "list_plans", "prepare_buy", "prepare_dca_plan", "executor_status"];

const SNIPPETS = {
  "Claude Code": `claude mcp add portir --transport http ${MCP}`,
  "Desktop · Cowork": JSON.stringify({ mcpServers: { portir: { type: "http", url: MCP } } }, null, 2),
  Cursor: JSON.stringify({ mcpServers: { portir: { url: MCP } } }, null, 2),
} as const;
type Client = keyof typeof SNIPPETS;

/** Bring your own Claude: the agent's MCP face exposes the same engine as tools; the LLM inside the agent is not involved. */
export function ConnectClaude() {
  const [client, setClient] = useState<Client>("Claude Code");
  return (
    <section className="glass mt-4 rounded-3xl p-4">
      <h2 className="text-lg">Connect your Claude</h2>
      <p className="mt-1 text-sm text-muted">
        Use your own Claude (or any MCP client) as the brain. The Portir agent serves the market data, the Guard and ready-to-sign transactions as tools; nothing is signed on your behalf.
      </p>
      {!MCP ? (
        <p className="mt-4 rounded-2xl border border-dashed border-line px-3 py-2 text-xs text-muted">The agent address is not configured on this deployment.</p>
      ) : (
      <>
      <div className="glass mt-4 grid grid-cols-3 rounded-full p-1 text-xs font-medium">
        {(Object.keys(SNIPPETS) as Client[]).map((c) => (
          <button key={c} onClick={() => setClient(c)} className={`truncate rounded-full px-2 py-1.5 ${c === client ? "bg-white text-black" : "text-muted"}`}>{c}</button>
        ))}
      </div>
      <Copy text={SNIPPETS[client]} />
      </>
      )}
      <p className="mt-3 text-xs text-muted">Then ask: “Is now a good time to buy TSLA on-chain?” or “Set up $30 weekly NVDA, only when fair.”</p>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">Tools ({TOOLS.length})</summary>
        <p className="mt-2 font-mono leading-relaxed">{TOOLS.join(" · ")}</p>
        <p className="mt-2">Read tools are free. <code>prepare_*</code> return calldata for your wallet to sign.</p>
      </details>
    </section>
  );
}

const SKILL = "npx skills add binance/binance-skills-hub/skills/binance-web3/binance-agentic-wallet";
const TASK = `Every weekday at 22:00 WIB: use the portir tools to check NVDA. If the market is open and get_fair_price says GO, quote $20 with quote_best_issuer and buy it with my Binance Agentic Wallet. If not, tell me why in one sentence.`;

/** Self-custody: the user's own Claude runs the schedule and signs with the user's own Agentic Wallet; Portir only advises. */
export function OwnAgent() {
  return (
    <section className="glass mt-4 rounded-3xl p-4">
      <h2 className="text-lg">Run your own agent</h2>
      <p className="mt-1 text-sm text-muted">
        Prefer to keep every key yourself? Let your Claude run the schedule and trade from <b className="text-white">your</b> Binance Agentic Wallet. Portir gives it the fair-price check, news and quotes; it never touches your money.
      </p>
      <ol className="mt-4 space-y-3 text-sm">
        <Step n={1}>Connect Portir to Claude (Cowork or Claude Code) with the snippet above.</Step>
        <Step n={2}>
          Add the Binance Agentic Wallet skill, then sign in with the QR code in the Binance App. Set the daily limit and allowed tokens there; the wallet enforces them.
          <Copy text={SKILL} />
        </Step>
        <Step n={3}>
          Create a scheduled task in Cowork with a prompt like:
          <Copy text={TASK} />
        </Step>
      </ol>
      <p className="mt-3 text-xs text-muted">Managed plans (this app) and your own agent can run side by side. Only the managed ones appear under Plans.</p>
    </section>
  );
}

/** What powers the in-app chat, who pays for it, and how to top it up. */
export function AgentFuel() {
  return (
    <section className="glass mt-4 rounded-3xl p-4">
      <h2 className="text-lg">Agent brain</h2>
      <p className="mt-1 text-sm text-muted">
        “Ask the agent” and the news check before every buy run on <b className="text-white">Groq</b> (<code>gpt-oss-120b</code>), plugged in through BNB Agent Studio’s model provider. The operator pays for it, not you, and it never moves money: it can only answer, or hold a buy back with a reason.
      </p>
      <dl className="mt-4 divide-y divide-line rounded-2xl border border-line text-xs">
        <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-muted">If the model is down</dt><dd className="text-right">Plans keep running on the Guard, which is code.</dd></div>
        <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-muted">Agent wallet</dt><dd><Addr value={executorAddress} /></dd></div>
        <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-muted">Prefer your own model?</dt><dd className="text-right">Connect your Claude above.</dd></div>
      </dl>
    </section>
  );
}

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="grid size-6 shrink-0 place-items-center rounded-full border border-line font-mono text-[11px]">{n}</span>
      <span className="text-muted">{children}</span>
    </li>
  );
}

function Addr({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => navigator.clipboard.writeText(value).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })} className="font-mono text-white underline decoration-white/30" title="Copy">
      {copied ? "copied" : `${value.slice(0, 6)}…${value.slice(-4)}`}
    </button>
  );
}

function Copy({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-3 rounded-2xl border border-line bg-[#04070d]">
      <pre className="whitespace-pre-wrap break-words p-3 font-mono text-[11px] leading-relaxed text-white/85">{text}</pre>
      <button onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })} className="m-2 mt-0 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
