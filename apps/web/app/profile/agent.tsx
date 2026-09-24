"use client";

import { useState } from "react";
import { executorAddress } from "@/lib/planRegistry";

const AGENT = process.env.NEXT_PUBLIC_AGENT_URL ?? "http://localhost:9000";
const MCP = `${AGENT}/mcp`;
const U_TOKEN = "0xcE24439F2D9C6a2289F741120FE202248B666666"; // U on BSC mainnet, what Pieverse LLM credits are bought with
const SWAP = `https://pancakeswap.finance/swap?outputCurrency=${U_TOKEN}&chain=bsc`;

const TOOLS = ["search_stock", "get_fair_price", "market_window", "quote_best_issuer", "get_news", "price_history", "get_portfolio", "list_plans", "prepare_buy", "prepare_dca_plan", "executor_status"];

const SNIPPETS = {
  "Claude Code": `claude mcp add portir --transport http ${MCP}`,
  "Claude Desktop / Cowork": JSON.stringify({ mcpServers: { portir: { type: "http", url: MCP } } }, null, 2),
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
      <div className="glass mt-4 grid grid-cols-3 rounded-full p-1 text-xs font-medium">
        {(Object.keys(SNIPPETS) as Client[]).map((c) => (
          <button key={c} onClick={() => setClient(c)} className={`truncate rounded-full px-2 py-1.5 ${c === client ? "bg-white text-black" : "text-muted"}`}>{c}</button>
        ))}
      </div>
      <Copy text={SNIPPETS[client]} />
      <p className="mt-3 text-xs text-muted">Then ask: “Is now a good time to buy TSLA on-chain?” or “Set up $30 weekly NVDA, only when fair.”</p>
      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer">Tools ({TOOLS.length})</summary>
        <p className="mt-2 font-mono leading-relaxed">{TOOLS.join(" · ")}</p>
        <p className="mt-2">Read tools are free. <code>prepare_*</code> return calldata for your wallet to sign.</p>
      </details>
    </section>
  );
}

/** What powers the in-app chat, who pays for it, and how to top it up. */
export function AgentFuel() {
  return (
    <section className="glass mt-4 rounded-3xl p-4">
      <h2 className="text-lg">Agent fuel</h2>
      <p className="mt-1 text-sm text-muted">
        “Ask the agent” on the Plans page runs a model on <b className="text-white">Pieverse</b> (BNB Agent Studio). Its credits are bought with the <b className="text-white">U</b> token on BSC mainnet from the agent’s own wallet, so the operator pays, not you. Your plans keep running without it: the executor’s Guard is code, not a model.
      </p>
      <ol className="mt-4 space-y-2 text-sm">
        <Step n={1}>
          Get U on BNB Chain: <a className="underline" href={SWAP} target="_blank" rel="noopener">swap on PancakeSwap ↗</a> (a few dollars is plenty).
        </Step>
        <Step n={2}>
          Send it to the agent wallet <Addr value={executorAddress} />.
        </Step>
        <Step n={3}>
          Operator: <code className="rounded bg-white/10 px-1">bag llm topup --amount 2</code>, then pick a paid model in <code className="rounded bg-white/10 px-1">studio.toml</code>. Auto-renew keeps the key funded from the wallet’s U.
        </Step>
      </ol>
      <dl className="mt-4 divide-y divide-line rounded-2xl border border-line text-xs">
        <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-muted">U token (BSC)</dt><dd><Addr value={U_TOKEN} /></dd></div>
        <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-muted">Prefer your own model?</dt><dd className="text-right">Use “Connect your Claude” above — no U needed.</dd></div>
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
    <div className="relative mt-3">
      <pre className="overflow-x-auto rounded-2xl border border-line bg-[#04070d] p-3 pr-20 font-mono text-[11px] leading-relaxed text-white/85">{text}</pre>
      <button onClick={() => navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); })} className="absolute right-2 top-2 rounded-full bg-white px-3 py-1 text-[11px] font-medium text-black">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
