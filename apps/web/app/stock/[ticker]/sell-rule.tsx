"use client";

import Link from "next/link";
import { useState } from "react";
import { encodeFunctionData, erc20Abi, formatUnits, parseUnits } from "viem";
import { useConnection, useReadContracts } from "wagmi";
import { useMode, useRegistryChain } from "@/app/mode";
import { usd } from "@/app/verdict";
import { encodeTarget, executorAddress, planRegistryAbi, planRegistryAddress } from "@/lib/planRegistry";
import { TESTNET } from "@/lib/testnet";
import { sendBatch } from "@/lib/wallet-batch";

/** Take-profit / stop-loss: the agent sells the shares once the real price crosses the trigger in market hours. */
export function SellRule({ ticker, price }: { ticker: string; price: number }) {
  const chain = useRegistryChain();
  const mode = useMode();
  const { address } = useConnection();
  const token = TESTNET.stocks[ticker];
  const reads = useReadContracts({
    contracts: token && address && planRegistryAddress ? [
      { address: token, abi: erc20Abi, functionName: "balanceOf", args: [address], chainId: chain.id },
      { address: token, abi: erc20Abi, functionName: "allowance", args: [address, planRegistryAddress], chainId: chain.id },
    ] : [],
    allowFailure: false,
    query: { enabled: mode === "testnet" && !!token && !!address },
  });
  const [below, setBelow] = useState(false);
  const [trigger, setTrigger] = useState("");
  const [shares, setShares] = useState("");
  const [state, setState] = useState<{ busy?: string; done?: boolean; error?: string }>({});

  const [balance, allowance] = (reads.data ?? []) as bigint[];
  if (mode !== "testnet" || !token || !address || !planRegistryAddress || !balance) return null;

  const held = Number(formatUnits(balance, 18));
  const suggested = (below ? price * 0.9 : price * 1.15).toFixed(2);
  const t = Number(trigger || suggested);
  const n = Math.min(Number(shares || held), held);
  const valid = t > 0 && n > 0 && (below ? t < price : t > price);
  const registry = planRegistryAddress;

  async function save() {
    const amount = parseUnits(n.toFixed(18), 18);
    setState({ busy: "Confirm in your wallet" });
    try {
      await sendBatch([
        // Adds to what other rules on this stock may already take, instead of overwriting it.
        { to: token, label: "Let the rule take these shares", data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [registry, (allowance ?? 0n) + amount] }) },
        { to: registry, label: "Save the sell rule", data: encodeFunctionData({ abi: planRegistryAbi, functionName: "createSellRule", args: [encodeTarget(ticker), token, amount, parseUnits(t.toFixed(6), 18), below, executorAddress] }) },
      ], { chainId: chain.id, account: address!, onProgress: (_i, _n, label) => setState({ busy: label }) });
      setState({ done: true });
      void reads.refetch();
    } catch (e) {
      setState({ error: e instanceof Error ? e.message.split("\n")[0] : String(e) });
    }
  }

  if (state.done) {
    return (
      <section className="glass mt-3 rounded-3xl p-4 text-sm">
        <p>Sell rule saved. The agent checks {ticker} every 15 minutes and sells when it crosses {usd.format(t)} while the market is open.</p>
        <Link href="/plans" className="mt-2 inline-block text-brand underline">See it in Plans</Link>
      </section>
    );
  }
  return (
    <section className="glass mt-3 rounded-3xl p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium">Sell automatically</h2>
        <span className="font-mono text-xs text-muted">you hold {held.toFixed(4)}</span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-1 rounded-full border border-line p-1 text-xs">
        {[["Take profit", false], ["Stop loss", true]].map(([label, b]) => (
          <button key={String(label)} onClick={() => { setBelow(b as boolean); setTrigger(""); }} className={`rounded-full py-1.5 font-medium ${below === b ? "bg-white text-black" : "text-muted"}`}>{label as string}</button>
        ))}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <label className="text-xs text-muted">
          Sell when price {below ? "falls to" : "reaches"}
          <span className="mt-1 flex items-baseline gap-1 border-b border-line pb-1 font-mono text-lg text-white">
            <span className="text-muted">$</span>
            <input inputMode="decimal" placeholder={suggested} value={trigger} onChange={(e) => setTrigger(e.target.value.replace(/[^\d.]/g, ""))} className="w-full bg-transparent outline-none placeholder:text-white/40" />
          </span>
        </label>
        <label className="text-xs text-muted">
          Shares
          <span className="mt-1 flex items-baseline gap-1 border-b border-line pb-1 font-mono text-lg text-white">
            <input inputMode="decimal" placeholder={held.toFixed(4)} value={shares} onChange={(e) => setShares(e.target.value.replace(/[^\d.]/g, ""))} className="w-full bg-transparent outline-none placeholder:text-white/40" />
          </span>
        </label>
      </div>
      <p className="mt-3 text-xs text-muted">
        {valid
          ? `Now ${usd.format(price)}. When ${ticker} ${below ? "drops to" : "rises to"} ${usd.format(t)} (${(((t - price) / price) * 100).toFixed(1)}%) during market hours, the agent sells ${n.toFixed(4)} shares, about ${usd.format(n * t)}, and sends the tUSDT to your wallet.`
          : below ? `A stop loss must be below today's ${usd.format(price)}.` : `A take profit must be above today's ${usd.format(price)}.`}
      </p>
      {state.error && <p role="alert" className="mt-2 text-xs text-block">{state.error}</p>}
      <button disabled={!valid || !!state.busy} onClick={save} className="mt-3 w-full rounded-full bg-white py-2.5 text-sm font-medium text-black disabled:opacity-50">
        {state.busy ?? "Set sell rule"}
      </button>
    </section>
  );
}
