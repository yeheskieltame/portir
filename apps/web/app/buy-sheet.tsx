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
const ORDER = { GO: 0, WARN: 1, BLOCK: 2 } as const;

/** One stock is a single leg with weight 1; a basket is one leg per holding. */
export interface Leg {
  ticker: string;
  name: string;
  onchain: number;
  weight: number;
}
interface Quoted extends Leg {
  usdt: number;
  q: BuyResponse;
}
type Step =
  | { at: "amount" }
  | { at: "quoting" }
  | { at: "confirm"; legs: Quoted[] }
  | { at: "signing"; legs: Quoted[]; note: string }
  | { at: "done"; legs: Quoted[]; txs: string[] }
  | { at: "error"; message: string };

export function BuySheet({ name, legs }: { name: string; legs: Leg[] }) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(legs.length > 1 ? "100" : "10");
  const [step, setStep] = useState<Step>({ at: "amount" });
  const { address } = useConnection();
  const [connector] = useConnectors();
  const connect = useConnect();
  const balance = useReadContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [address!], chainId: bsc.id, query: { enabled: !!address } });
  const have = balance.data === undefined ? null : Number(formatUnits(balance.data, 18));
  const usdtIn = Number(amount);
  const minOrder = legs.length; // each leg needs at least 1 USDT
  const valid = usdtIn >= minOrder && (have === null || usdtIn <= have);
  const basket = legs.length > 1;

  const close = () => { setOpen(false); setStep({ at: "amount" }); };

  async function getQuote() {
    setStep({ at: "quoting" });
    const quoted: Quoted[] = [];
    for (const leg of legs) {
      const usdt = Math.floor(usdtIn * leg.weight * 100) / 100;
      const res = await fetch("/api/buy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: leg.ticker, usdt, wallet: address }) });
      const q = (await res.json()) as BuyResponse & { error?: string };
      if (!res.ok || q.error) return setStep({ at: "error", message: `${leg.ticker}: ${q.error ?? "could not get a quote"}` });
      quoted.push({ ...leg, usdt, q });
    }
    setStep({ at: "confirm", legs: quoted });
  }

  async function sign(quoted: Quoted[]) {
    const txs: string[] = [];
    try {
      setStep({ at: "signing", legs: quoted, note: "Switching to BNB Chain…" });
      await switchChain(config, { chainId: bsc.id });
      for (const leg of quoted) {
        const who = basket ? `${leg.ticker}: ` : "";
        for (const a of leg.q.approvals ?? []) {
          setStep({ at: "signing", legs: quoted, note: `${who}approve USDT in your wallet…` });
          const hash = await sendTransaction(config, { chainId: bsc.id, to: a.to as `0x${string}`, data: a.data as `0x${string}` });
          await waitForTransactionReceipt(config, { chainId: bsc.id, hash });
        }
        setStep({ at: "signing", legs: quoted, note: `${who}confirm the purchase in your wallet…` });
        const hash = await sendTransaction(config, { chainId: bsc.id, to: leg.q.tx!.to as `0x${string}`, data: leg.q.tx!.data as `0x${string}`, value: BigInt(leg.q.tx!.value || "0") });
        setStep({ at: "signing", legs: quoted, note: `${who}waiting for BNB Chain…` });
        const receipt = await waitForTransactionReceipt(config, { chainId: bsc.id, hash });
        if (receipt.status !== "success") throw new Error(`${who}the transaction reverted. Nothing was spent except gas.`);
        recordBuy({ ticker: leg.ticker, shares: leg.q.shares!, usdt: leg.usdt, pricePerShare: leg.q.pricePerShare!, issuer: leg.q.issuer!, tx: hash, at: Date.now() });
        txs.push(hash);
      }
      balance.refetch();
      setStep({ at: "done", legs: quoted, txs });
    } catch (e) {
      const message = e instanceof Error && "shortMessage" in e ? String((e as { shortMessage: string }).shortMessage) : e instanceof Error ? e.message : String(e);
      setStep({ at: "error", message: txs.length ? `${txs.length} of ${quoted.length} purchases went through before this: ${message}` : message });
    }
  }

  return (
    <>
      <button onClick={() => setOpen(true)} className="rounded-full bg-white py-3 text-sm font-medium text-black active:scale-95">
        {basket ? "Buy basket" : "Buy"}
      </button>
      {open && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 backdrop-blur-sm" onClick={close}>
          <div className="animate-rise max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-[#0b111c] p-5 pb-8" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Buy ${name}`}>
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
                  <span className="text-xs text-muted">Amount in USDT{basket && ` · split across ${legs.length} holdings`}</span>
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
                {basket ? (
                  <ul className="mt-4 space-y-1 font-mono text-xs text-muted tabular-nums">
                    {legs.map((l) => (
                      <li key={l.ticker} className="flex justify-between"><span>{l.ticker} · {Math.round(l.weight * 100)}%</span><span>{usd.format(usdtIn * l.weight)} ≈ {((usdtIn * l.weight) / l.onchain).toFixed(4)} sh</span></li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 font-mono text-sm text-muted tabular-nums">≈ {usdtIn > 0 ? (usdtIn / legs[0].onchain).toFixed(4) : "0"} shares at {usd.format(legs[0].onchain)}</p>
                )}
                <button disabled={!valid || step.at === "quoting"} onClick={getQuote} className="mt-5 w-full rounded-full bg-white py-3 font-medium text-black disabled:opacity-50">
                  {step.at === "quoting" ? "Asking the Guard…" : have !== null && usdtIn > have ? "Not enough USDT" : usdtIn < minOrder ? `At least $${minOrder}` : "Check price"}
                </button>
              </>
            ) : step.at === "confirm" || step.at === "signing" ? (
              <Confirm legs={step.legs} note={step.at === "signing" ? step.note : null} onSign={() => sign(step.legs)} onBack={() => setStep({ at: "amount" })} planHref={basket ? `/plans?target=BASKET:${encodeURIComponent(name)}` : `/plans?target=${legs[0].ticker}`} />
            ) : step.at === "done" ? (
              <>
                <p className="text-go">✓ Done</p>
                <h2 className="mt-1 text-xl">{basket ? `You own a slice of ${name}` : `You own ${step.legs[0].q.shares!.toFixed(4)} ${legs[0].ticker} shares`}</h2>
                <dl className="glass mt-4 divide-y divide-line rounded-2xl text-sm">
                  {step.legs.map((l, i) => (
                    <Row key={l.ticker} k={`${l.ticker} · ${l.q.issuer}`} v={`${l.q.shares!.toFixed(4)} sh at ${usd.format(l.q.pricePerShare!)}`} href={`https://bscscan.com/tx/${step.txs[i]}`} />
                  ))}
                  <Row k="Paid" v={`${usd.format(step.legs.reduce((n, l) => n + l.usdt, 0))} USDT`} />
                </dl>
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

function Confirm({ legs, note, onSign, onBack, planHref }: { legs: Quoted[]; note: string | null; onSign: () => void; onBack: () => void; planHref: string }) {
  const worst = legs.reduce<BuyResponse["verdict"]>((w, l) => (ORDER[l.q.verdict] > ORDER[w] ? l.q.verdict : w), "GO");
  const tone = TONE[worst];
  const blocked = worst === "BLOCK" || legs.some((l) => !l.q.tx);
  const one = legs.length === 1 ? legs[0] : null;
  return (
    <>
      <div className="flex items-center gap-2">
        <span className={`rounded-full border px-2.5 py-1 text-xs font-medium ${tone.chip}`}>{tone.label}</span>
        {one && one.q.spreadBps !== null && <span className="font-mono text-xs text-muted tabular-nums">{pct(one.q.spreadBps / 100)} vs exchange</span>}
        {!one && <span className="text-xs text-muted">worst of {legs.length} holdings</span>}
      </div>
      {one ? (
        <p className="mt-3 text-sm">{one.q.reason}</p>
      ) : (
        <ul className="mt-3 space-y-1.5 text-sm">
          {legs.map((l) => {
            const t = TONE[l.q.verdict];
            return (
              <li key={l.ticker} className="flex items-center gap-2">
                <span aria-hidden className={`size-1.5 shrink-0 rounded-full ${t.dot}`} />
                <span className="font-mono text-xs">{l.ticker}</span>
                <span className="truncate text-xs text-muted">{l.q.reason}</span>
              </li>
            );
          })}
        </ul>
      )}
      {!blocked && (
        <dl className="glass mt-4 divide-y divide-line rounded-2xl text-sm">
          <Row k="You pay" v={`${usd.format(legs.reduce((n, l) => n + l.usdt, 0))} USDT`} />
          {one ? (
            <>
              <Row k="You get" v={`≈ ${one.q.shares!.toFixed(4)} shares`} />
              {one.q.minShares !== undefined && <Row k="At least" v={`${one.q.minShares.toFixed(4)} shares`} />}
              <Row k="Price per share" v={usd.format(one.q.pricePerShare!)} />
              <Row k="Exchange price" v={one.q.reference === null ? "n/a" : usd.format(one.q.reference)} />
              <Row k="Provider" v={`${one.q.issuer} · ${one.q.vendor}${one.q.impactBps ? ` · impact ${(one.q.impactBps / 100).toFixed(2)}%` : ""}`} />
            </>
          ) : (
            legs.map((l) => <Row key={l.ticker} k={`${l.ticker} · ${l.q.issuer}`} v={`≈ ${l.q.shares!.toFixed(4)} sh at ${usd.format(l.q.pricePerShare!)}`} />)
          )}
        </dl>
      )}
      {note ? (
        <p className="mt-5 animate-pulse text-center text-sm text-muted">{note}</p>
      ) : blocked ? (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onBack} className="glass rounded-full py-3 text-sm font-medium">Back</button>
          <Link href={planHref} className="rounded-full bg-white py-3 text-center text-sm font-medium text-black">Buy when it&apos;s fair</Link>
        </div>
      ) : (
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button onClick={onBack} className="glass rounded-full py-3 text-sm font-medium">Back</button>
          <button onClick={onSign} className="rounded-full bg-white py-3 text-sm font-medium text-black">{worst === "WARN" ? "Buy anyway" : `Confirm & sign${one ? "" : ` (${legs.length})`}`}</button>
        </div>
      )}
    </>
  );
}

function Row({ k, v, href }: { k: string; v: string; href?: string }) {
  return (
    <div className="flex justify-between gap-3 px-4 py-2.5">
      <dt className="text-muted">{href ? <a href={href} target="_blank" rel="noopener" className="underline">{k} ↗</a> : k}</dt>
      <dd className="text-right font-mono tabular-nums">{v}</dd>
    </div>
  );
}
