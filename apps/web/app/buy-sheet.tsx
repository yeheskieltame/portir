"use client";

import Link from "next/link";
import { useState } from "react";
import { erc20Abi, formatUnits, parseUnits } from "viem";
import { useConnect, useConnection, useConnectors, useReadContract } from "wagmi";
import { getBalance, readContract, sendTransaction, switchChain, waitForTransactionReceipt, writeContract } from "wagmi/actions";
import { NoWallet } from "@/app/connect-button";
import { useMode } from "@/app/mode";
import { NET } from "@/lib/mode";
import type { BuyResponse } from "@/app/api/buy/route";
import { TONE, pct, usd } from "@/app/verdict";
import { recordBuy } from "@/lib/buys";
import { CADENCES, USDT_DECIMALS, encodeTarget, executorAddress, planRegistryAbi, planRegistryAddress } from "@/lib/planRegistry";
import { chain as registryChain, config } from "@/lib/wagmi";

const QUICK = [10, 25, 50, 100];
const MIN_GAS_BNB = parseUnits("0.0005", 18); // a swap on BSC costs well under this
const ORDER = { GO: 0, WARN: 1, BLOCK: 2 } as const;
type Cadence = keyof typeof CADENCES;

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
  | { at: "plan"; once: boolean }
  | { at: "planning"; note: string; once: boolean }
  | { at: "planned"; hash: string; once: boolean }
  | { at: "error"; message: string };

/** Buy now or on a schedule, in one sheet: the amount typed for one carries into the other. */
export function BuySheet({ name, legs, initial }: { name: string; legs: Leg[]; initial?: "plan" }) {
  const [open, setOpen] = useState(initial === "plan");
  const [repeat, setRepeat] = useState(initial === "plan");
  const [cadence, setCadence] = useState<Cadence>("Weekly");
  const [smart, setSmart] = useState(true);
  const [amount, setAmount] = useState(legs.length > 1 ? "100" : "10");
  const [step, setStep] = useState<Step>({ at: "amount" });
  const { address } = useConnection();
  const mode = useMode();
  const net = NET[mode];
  const USDT = net.usdt;
  const [connector] = useConnectors();
  const connect = useConnect();
  const balance = useReadContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [address!], chainId: net.chain.id, query: { enabled: !!address } });
  const have = balance.data === undefined ? null : Number(formatUnits(balance.data, 18));
  const usdtIn = Number(amount);
  const minOrder = legs.length; // each leg needs at least 1 USDT
  const valid = usdtIn >= minOrder && (repeat || have === null || usdtIn <= have);
  const basket = legs.length > 1;
  const target = basket ? `BASKET:${name}` : legs[0].ticker;

  const show = (plan: boolean) => { setRepeat(plan); setStep({ at: "amount" }); setOpen(true); };
  const close = () => { setOpen(false); setStep({ at: "amount" }); };

  async function getQuote() {
    setStep({ at: "quoting" });
    const quoted: Quoted[] = [];
    for (const leg of legs) {
      const usdt = Math.floor(usdtIn * leg.weight * 100) / 100;
      const res = await fetch("/api/buy", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticker: leg.ticker, usdt, wallet: address, mode }) });
      const q = (await res.json()) as BuyResponse & { error?: string };
      if (!res.ok || q.error) return setStep({ at: "error", message: `${leg.ticker}: ${q.error ?? "could not get a quote"}` });
      quoted.push({ ...leg, usdt, q });
    }
    setStep({ at: "confirm", legs: quoted });
  }

  async function sign(quoted: Quoted[]) {
    const txs: string[] = [];
    try {
      setStep({ at: "signing", legs: quoted, note: `Switching to ${net.chain.name}…` });
      await switchChain(config, { chainId: net.chain.id });
      const gas = await getBalance(config, { address: address!, chainId: net.chain.id });
      if (gas.value < MIN_GAS_BNB) throw new Error(`You need a little BNB on ${net.chain.name} for gas (about $0.05 covers a purchase). Top up BNB, then try again.`);
      for (const leg of quoted) {
        const who = basket ? `${leg.ticker}: ` : "";
        const wei = parseUnits(leg.usdt.toFixed(6), 18);
        for (const a of leg.q.approvals ?? []) {
          // The API always includes an approval; skip it when the allowance already covers this order.
          const allowance = await readContract(config, { address: USDT, abi: erc20Abi, functionName: "allowance", args: [address!, a.spender as `0x${string}`], chainId: net.chain.id });
          if (allowance >= wei) continue;
          setStep({ at: "signing", legs: quoted, note: `${who}approve USDT in your wallet…` });
          const hash = await sendTransaction(config, { chainId: net.chain.id, to: a.to as `0x${string}`, data: a.data as `0x${string}` });
          await waitForTransactionReceipt(config, { chainId: net.chain.id, hash });
        }
        setStep({ at: "signing", legs: quoted, note: `${who}confirm the purchase in your wallet…` });
        const hash = await sendTransaction(config, { chainId: net.chain.id, to: leg.q.tx!.to as `0x${string}`, data: leg.q.tx!.data as `0x${string}`, value: BigInt(leg.q.tx!.value || "0") });
        setStep({ at: "signing", legs: quoted, note: `${who}waiting for BNB Chain…` });
        const receipt = await waitForTransactionReceipt(config, { chainId: net.chain.id, hash });
        if (receipt.status !== "success") throw new Error(`${who}the transaction reverted. Nothing was spent except gas.`);
        recordBuy({ ticker: leg.ticker, shares: leg.q.shares!, usdt: leg.usdt, pricePerShare: leg.q.pricePerShare!, issuer: leg.q.issuer!, tx: hash, at: Date.now() });
        txs.push(hash);
      }
      balance.refetch();
      setStep({ at: "done", legs: quoted, txs });
    } catch (e) {
      setStep({ at: "error", message: txs.length ? `${txs.length} of ${quoted.length} purchases went through before this: ${errText(e)}` : errText(e) });
    }
  }

  async function startPlan(once: boolean) {
    try {
      setStep({ at: "planning", note: `Switching to ${registryChain.name}…`, once });
      await switchChain(config, { chainId: registryChain.id });
      setStep({ at: "planning", note: "Confirm the plan in your wallet…", once });
      const hash = await writeContract(config, {
        chainId: registryChain.id,
        address: planRegistryAddress!,
        abi: planRegistryAbi,
        functionName: "createPlan",
        args: [encodeTarget(target), parseUnits(usdtIn.toFixed(6), USDT_DECIMALS), CADENCES[cadence] * 86_400, 0, once || smart, once, executorAddress],
      });
      setStep({ at: "planning", note: "Waiting for BNB Chain…", once });
      const receipt = await waitForTransactionReceipt(config, { chainId: registryChain.id, hash });
      if (receipt.status !== "success") throw new Error("The transaction reverted. Nothing was spent except gas.");
      setStep({ at: "planned", hash, once });
    } catch (e) {
      setStep({ at: "error", message: errText(e) });
    }
  }

  const every = cadence === "Weekly" ? "week" : cadence === "Monthly" ? "month" : "2 weeks";
  const firstBuy = smart ? "the next time the market is open and the price is fair" : "as soon as the agent sees it";

  return (
    <>
      <button onClick={() => show(true)} className="glass rounded-full py-3 text-sm font-medium active:scale-95">Set up a plan</button>
      <button onClick={() => show(false)} className="rounded-full bg-white py-3 text-sm font-medium text-black active:scale-95">
        {basket ? "Buy basket" : "Buy"}
      </button>
      {open && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-black/60 backdrop-blur-sm lg:items-center" onClick={close}>
          {/* Bottom sheet on phones, centered dialog on desktop. */}
          <div className="animate-rise max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl border border-line bg-[#0b111c] p-5 pb-8 lg:rounded-3xl lg:p-6" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Buy ${name}`}>
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20 lg:hidden" />

            {!address ? (
              <>
                <h2 className="text-xl">Connect to buy {name}</h2>
                <p className="mt-2 text-sm text-muted">Your wallet signs every transaction. Portir never holds funds.</p>
                <button className="mt-5 w-full rounded-full bg-white py-3 font-medium text-black" disabled={connect.isPending} onClick={() => connect.mutate({ connector })}>
                  {connect.isPending ? "Connecting…" : "Connect wallet"}
                </button>
                <NoWallet error={connect.error} />
              </>
            ) : step.at === "amount" || step.at === "quoting" ? (
              <>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="truncate text-xl">{repeat ? "Invest in" : "Buy"} {name}</h2>
                  <div className="glass grid shrink-0 grid-cols-2 rounded-full p-1 text-xs font-medium">
                    {[false, true].map((r) => (
                      <button key={String(r)} onClick={() => setRepeat(r)} className={`rounded-full px-3 py-1.5 transition-colors ${r === repeat ? "bg-white text-black" : "text-muted"}`}>{r ? "Repeat" : "One time"}</button>
                    ))}
                  </div>
                </div>
                <p className="mt-1 text-sm text-muted">{have === null ? "Reading your USDT…" : `You have ${usd.format(have)} ${mode === "testnet" ? "tUSDT on BSC testnet" : "USDT on BNB Chain"}`}</p>
                <label className="mt-5 block">
                  <span className="text-xs text-muted">{repeat ? `Amount each time` : "Amount"} in USDT{basket && ` · split across ${legs.length} holdings`}</span>
                  <span className="mt-1 flex items-baseline gap-1 border-b border-line pb-2 font-mono text-[40px] leading-none">
                    <span className="text-muted">$</span>
                    <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} className="w-full bg-transparent outline-none" autoFocus />
                  </span>
                </label>
                <div className="mt-3 flex gap-2">
                  {QUICK.map((n) => (
                    <button key={n} onClick={() => setAmount(String(n))} className={`rounded-full px-3 py-1.5 font-mono text-xs ${amount === String(n) ? "bg-white text-black" : "glass"}`}>${n}</button>
                  ))}
                  {!repeat && have !== null && have > 0 && <button onClick={() => setAmount(have.toFixed(2))} className="glass ml-auto rounded-full px-3 py-1.5 font-mono text-xs">Max</button>}
                </div>
                {repeat && (
                  <div className="animate-rise mt-5">
                    <span className="text-xs text-muted">How often</span>
                    <div className="mt-1.5 flex gap-2">
                      {(Object.keys(CADENCES) as Cadence[]).map((c) => (
                        <button key={c} onClick={() => setCadence(c)} className={`rounded-full px-3 py-1.5 text-xs font-medium ${c === cadence ? "bg-white text-black" : "glass"}`}>{c}</button>
                      ))}
                    </div>
                    <label className="mt-4 flex items-start gap-3 text-sm">
                      <input type="checkbox" checked={smart} onChange={(e) => setSmart(e.target.checked)} className="mt-1 accent-brand" />
                      <span>
                        Smart timing
                        <span className="block text-xs text-muted">Wait up to 48 hours for the market to open and the price to be fair.</span>
                      </span>
                    </label>
                  </div>
                )}
                {basket ? (
                  <ul className="mt-4 space-y-1 font-mono text-xs text-muted tabular-nums">
                    {legs.map((l) => (
                      <li key={l.ticker} className="flex justify-between"><span>{l.ticker} · {Math.round(l.weight * 100)}%</span><span>{usd.format(usdtIn * l.weight)} ≈ {((usdtIn * l.weight) / l.onchain).toFixed(4)} sh</span></li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-4 font-mono text-sm text-muted tabular-nums">≈ {usdtIn > 0 ? (usdtIn / legs[0].onchain).toFixed(4) : "0"} shares at {usd.format(legs[0].onchain)}{repeat && " today"}</p>
                )}
                <button disabled={!valid || step.at === "quoting"} onClick={repeat ? () => setStep({ at: "plan", once: false }) : getQuote} className="mt-5 w-full rounded-full bg-white py-3 font-medium text-black disabled:opacity-50">
                  {step.at === "quoting" ? "Asking the Guard…" : usdtIn < minOrder ? `At least $${minOrder}` : repeat ? "Review plan" : have !== null && usdtIn > have ? "Not enough USDT" : "Check price"}
                </button>
              </>
            ) : step.at === "confirm" || step.at === "signing" ? (
              <Confirm legs={step.legs} note={step.at === "signing" ? step.note : null} onSign={() => sign(step.legs)} onBack={() => setStep({ at: "amount" })} onPlan={() => setStep({ at: "plan", once: true })} />
            ) : step.at === "plan" || step.at === "planning" ? (
              <>
                <h2 className="text-xl">{step.once ? `Buy ${usd.format(usdtIn)} of ${name} when it's fair` : `${usd.format(usdtIn)} of ${name}, every ${every}`}</h2>
                <p className="mt-2 text-sm text-muted">{step.once ? "The agent checks every 15 minutes for up to 7 days. The first time the market is open and the price is fair it buys once, writes its reason on-chain, and stops." : `The first buy happens ${firstBuy}. Each run is checked by the Guard and its reason is written on-chain.`}</p>
                {!planRegistryAddress ? (
                  <p className="mt-4 text-sm text-block">The plan registry is not deployed yet.</p>
                ) : (
                  <dl className="glass mt-4 divide-y divide-line rounded-2xl text-sm">
                    <Row k={step.once ? "Amount" : "Each time"} v={`${usd.format(usdtIn)} USDT`} />
                    {step.once ? <Row k="Buys" v="Once, then done" /> : <Row k="Every" v={cadence} />}
                    <Row k="Smart timing" v={step.once ? "On · up to 7 days" : smart ? "On · 48h window" : "Off"} />
                    <Row k="Executor" v="Portir agent" />
                    <Row k="Plan lives on" v={registryChain.name} />
                  </dl>
                )}
                {step.at === "planning" ? (
                  <p className="mt-5 animate-pulse text-center text-sm text-muted">{step.note}</p>
                ) : (
                  <div className="mt-5 grid grid-cols-2 gap-2">
                    <button onClick={() => setStep({ at: "amount" })} className="glass rounded-full py-3 text-sm font-medium">Back</button>
                    <button disabled={!planRegistryAddress} onClick={() => startPlan(step.once)} className="rounded-full bg-white py-3 text-sm font-medium text-black disabled:opacity-50">{step.once ? "Start watching" : "Start plan"}</button>
                  </div>
                )}
              </>
            ) : step.at === "planned" ? (
              <>
                <p className="text-go">✓ {step.once ? "The agent is watching" : "Plan started"}</p>
                <h2 className="mt-1 text-xl">{step.once ? `${usd.format(usdtIn)} of ${name}, once it's fair` : `${usd.format(usdtIn)} of ${name}, every ${every}`}</h2>
                <p className="mt-2 text-sm text-muted">Keep USDT in your wallet. {step.once ? "The agent buys the first time the market is open and the price is fair, then stops." : `The agent buys ${firstBuy}, then every ${every}, and writes its reason next to each run.`}</p>
                <dl className="glass mt-4 divide-y divide-line rounded-2xl text-sm">
                  <Row k="Transaction" v={`${step.hash.slice(0, 10)}…`} href={`${registryChain.blockExplorers?.default.url}/tx/${step.hash}`} />
                </dl>
                <Link href="/plans" className="mt-5 block w-full rounded-full bg-white py-3 text-center font-medium text-black">See your plans</Link>
              </>
            ) : step.at === "done" ? (
              <>
                <p className="text-go">✓ Done</p>
                <h2 className="mt-1 text-xl">{basket ? `You own a slice of ${name}` : `You own ${step.legs[0].q.shares!.toFixed(4)} ${legs[0].ticker} shares`}</h2>
                <dl className="glass mt-4 divide-y divide-line rounded-2xl text-sm">
                  {step.legs.map((l, i) => (
                    <Row key={l.ticker} k={`${l.ticker} · ${l.q.issuer}`} v={`${l.q.shares!.toFixed(4)} sh at ${usd.format(l.q.pricePerShare!)}`} href={`${net.explorer}/tx/${step.txs[i]}`} />
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

const errText = (e: unknown) => (e instanceof Error && "shortMessage" in e ? String((e as { shortMessage: string }).shortMessage) : e instanceof Error ? e.message : String(e));

function Confirm({ legs, note, onSign, onBack, onPlan }: { legs: Quoted[]; note: string | null; onSign: () => void; onBack: () => void; onPlan: () => void }) {
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
          <button onClick={onPlan} className="rounded-full bg-white py-3 text-sm font-medium text-black">Buy when it&apos;s fair</button>
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
