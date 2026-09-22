"use client";

import Link from "next/link";
import { useState } from "react";
import { erc20Abi, formatUnits } from "viem";
import { bsc } from "wagmi/chains";
import { useConnect, useConnection, useConnectors, useReadContract } from "wagmi";
import { sendTransaction, switchChain, waitForTransactionReceipt } from "wagmi/actions";
import type { BuyResponse } from "@/app/api/buy/route";
import { TONE, pct, usd } from "@/app/verdict";
import { recordBuy } from "@/lib/buys";
import { config } from "@/lib/wagmi";

const USDT = "0x55d398326f99059fF775485246999027B3197955";
const QUICK = [10, 25, 50, 100];

type Step = { at: "amount" } | { at: "quoting" } | { at: "confirm"; q: BuyResponse } | { at: "signing"; q: BuyResponse; note: string } | { at: "done"; q: BuyResponse; tx: string } | { at: "error"; message: string };

export function BuySheet({ ticker, name, onchain }: { ticker: string; name: string; onchain: number }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("10");
  const [step, setStep] = useState<Step>({ at: "amount" });
  const { address } = useConnection();
  const [connector] = useConnectors();
  const connect = useConnect();
  const balance = useReadContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [address!], chainId: bsc.id, query: { enabled: !!address } });
  const have = balance.data === undefined ? null : Number(formatUnits(balance.data, 18));
  const usdtIn = Number(amount);
  const valid = usdtIn >= 1 && (have === null || usdtIn <= have);

  const close = () => { setOpen(false); setStep({ at: "amount" }); };

  async function getQuote() {
    setStep({ at: "quoting" });
    const res = await fetch("/api/buy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker, usdt: usdtIn, wallet: address }) });
    const q = (await res.json()) as BuyResponse & { error?: string };
    if (!res.ok || q.error) return setStep({ at: "error", message: q.error ?? "Could not get a quote" });
    setStep({ at: "confirm", q });
  }

  async function sign(q: BuyResponse) {
    try {
      setStep({ at: "signing", q, note: "Switching to BNB Chain…" });
      await switchChain(config, { chainId: bsc.id });
      for (const a of q.approvals ?? []) {
        setStep({ at: "signing", q, note: "Approve USDT in your wallet…" });
        const hash = await sendTransaction(config, { chainId: bsc.id, to: a.to as `0x${string}`, data: a.data as `0x${string}` });
        await waitForTransactionReceipt(config, { chainId: bsc.id, hash });
      }
      setStep({ at: "signing", q, note: "Confirm the purchase in your wallet…" });
      const hash = await sendTransaction(config, { chainId: bsc.id, to: q.tx!.to as `0x${string}`, data: q.tx!.data as `0x${string}`, value: BigInt(q.tx!.value || "0") });
      setStep({ at: "signing", q, note: "Waiting for BNB Chain…" });
      const receipt = await waitForTransactionReceipt(config, { chainId: bsc.id, hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted. Nothing was spent except gas.");
      recordBuy({ ticker, shares: q.shares!, usdt: usdtIn, pricePerShare: q.pricePerShare!, issuer: q.issuer!, tx: hash, at: Date.now() });
      balance.refetch();
      setStep({ at: "done", q, tx: hash });
    } catch (e) {
      setStep({ at: "error", message: e instanceof Error && "shortMessage" in e ? String((e as { shortMessage: string }).shortMessage) : e instanceof Error ? e.message : String(e) });
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-full bg-white py-3 text-sm font-medium text-black active:scale-95">
        Buy
      </button>
      {open && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={close}>
          <div className="animate-rise w-full max-w-md rounded-t-3xl border border-line bg-[#0b111c] p-5 pb-8" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Buy ${name}`}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />

            {!address ? (
              <>
                <h2 className="text-xl">Connect to buy {name}</h2>
                <p className="mt-2 text-sm text-muted">Your wallet signs every transaction. Portir never holds funds.</p>
                <button className="mt-5 w-full rounded-full bg-white py-3 font-medium text-black" disabled={connect.isPending} onClick={() => connect.mutate({ connector })}>
                  {connect.isPending ? "Connecting…" : "Connect wallet"}
                </button>
              </>
            ) : step.at === "amount" || step.at === "quoting" ? (
              <>
                <h2 className="text-xl">Buy {name}</h2>
                <p className="mt-1 text-sm text-muted">{have === null ? "Reading your USDT…" : `You have ${usd.format(have)} USDT on BNB Chain`}</p>
                <label className="mt-5 block">
                  <span className="text-xs text-muted">Amount in USDT</span>
                  <span className="mt-1 flex items-baseline gap-1 border-b border-line pb-2 font-mono text-[40px] leading-none">
                    <span className="text-muted">$</span>
                    <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className="w-full bg-transparent outline-none" autoFocus />
                  </span>
                </label>
                <div className="mt-3 flex gap-2">
                  {QUICK.map((n) => (
                    <button key={n} onClick={() => setAmount(String(n))} className={`rounded-full px-3 py-1.5 font-mono text-xs ${amount === String(n) ? "bg-white text-black" : "glass"}`}>${n}</button>
                  ))}
                  {have !== null && have > 0 && <button onClick={() => setAmount(have.toFixed(2))} className="glass ml-auto rounded-full px-3 py-1.5 font-mono text-xs">Max</button>}
                </div>
                <p className="mt-4 font-mono text-sm text-muted tabular-nums">≈ {usdtIn > 0 ? (usdtIn / onchain).toFixed(4) : "0"} shares at {usd.format(onchain)}</p>
                <button disabled={!valid || step.at === "quoting"} onClick={getQuote} className="mt-5 w-full rounded-full bg-white py-3 font-medium text-black disabled:opacity-50">
                  {step.at === "quoting" ? "Asking the Guard…" : have !== null && usdtIn > have ? "Not enough USDT" : "Check price"}
                </button>
              </>
            ) : step.at === "confirm" || step.at === "signing" ? (
              <Confirm q={step.q} usdtIn={usdtIn} note={step.at === "signing" ? step.note : null} onSign={() => sign(step.q)} onBack={() => setStep({ at: "amount" })} ticker={ticker} />
            ) : step.at === "done" ? (
              <>
                <p className="text-go">✓ Done</p>
                <h2 className="mt-1 text-xl">You own {step.q.shares!.toFixed(4)} {ticker} shares</h2>
                <dl className="glass mt-4 divide-y divide-line rounded-2xl text-sm">
                  <Row k="Paid" v={`${usd.format(usdtIn)} USDT`} />
                  <Row k="Price per share" v={usd.format(step.q.pricePerShare!)} />
                  <Row k="Exchange price" v={step.q.reference === null ? "n/a" : usd.format(step.q.reference)} />
                  <Row k="Provider" v={`${step.q.issuer} via ${step.q.vendor}`} />
                </dl>
                <a className="mt-3 block font-mono text-xs text-muted underline" href={`https://bscscan.com/tx/${step.tx}`} target="_blank" rel="noopener">View on BscScan ↗</a>
                <Link href="/portfolio" className="mt-5 block w-full rounded-full bg-white py-3 text-center font-medium text-black">See portfolio</Link>
              </>
            ) : (
              <>
                <h2 className="text-xl">Something went wrong</h2>
                <p className="mt-2 break-words text-sm text-block">{step.message}</p>
                <button onClick={() => setStep({ at: "amount" })} className="mt-5 w-full rounded-full bg-white py-3 font-medium text-black">Try again</button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Confirm({ q, usdtIn, note, onSign, onBack, ticker }: { q: BuyResponse; usdtIn: number; note: string | null; onSign: () => void; onBack: () => void; ticker: string }) {
  const tone = TONE[q.verdict];
  const blocked = q.verdict === "BLOCK" || !q.tx;
  return (
    <>
      <div className="flex items-center gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tone.chip}`}>{tone.label}</span>
        {q.spreadBps !== null && <span className="font-mono text-xs text-muted tabular-nums">{pct(q.spreadBps / 100)} vs exchange</span>}
      </div>
      <p className="mt-3 text-sm">{q.reason}</p>
      {!blocked && (
        <dl className="glass mt-4 divide-y divide-line rounded-2xl text-sm">
          <Row k="You pay" v={`${usd.format(usdtIn)} USDT`} />
          <Row k="You get" v={`≈ ${q.shares!.toFixed(4)} shares`} />
          {q.minShares !== undefined && <Row k="At least" v={`${q.minShares.toFixed(4)} shares`} />}
          <Row k="Price per share" v={usd.format(q.pricePerShare!)} />
          <Row k="Exchange price" v={q.reference === null ? "n/a" : usd.format(q.reference)} />
          <Row k="Provider" v={`${q.issuer} · ${q.vendor}${q.impactBps ? ` · impact ${(q.impactBps / 100).toFixed(2)}%` : ""}`} />
        </dl>
      )}
      {note ? (
        <p className="mt-5 animate-pulse text-center text-sm text-muted">{note}</p>
      ) : blocked ? (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onBack} className="glass rounded-full py-3 text-sm font-medium">Back</button>
          <Link href={`/plans?target=${ticker}`} className="rounded-full bg-white py-3 text-center text-sm font-medium text-black">Buy when it&apos;s fair</Link>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onBack} className="glass rounded-full py-3 text-sm font-medium">Back</button>
          <button onClick={onSign} className="rounded-full bg-white py-3 text-sm font-medium text-black">{q.verdict === "WARN" ? "Buy anyway" : "Confirm & sign"}</button>
        </div>
      )}
    </>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-3 px-4 py-2.5">
      <dt className="text-muted">{k}</dt>
      <dd className="text-right font-mono tabular-nums">{v}</dd>
    </div>
  );
}
