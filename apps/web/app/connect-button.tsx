"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { useMode, useSetMode } from "@/app/mode";
import { type Mode, NET } from "@/lib/mode";
import { chain as registryChain } from "@/lib/wagmi";

/** The chain a page needs: plans live on the registry chain, everything else follows the mode. */
export function useTargetChain() {
  const mode = useMode();
  const path = usePathname();
  return path.startsWith("/plans") ? registryChain : NET[mode].chain;
}

export function ConnectButton() {
  const { address, chainId } = useConnection();
  const [connector] = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const { switchChain, isPending: switching, error: switchError } = useSwitchChain();
  const mode = useMode();
  const setMode = useSetMode();
  const target = useTargetChain();
  const wrong = !!address && chainId !== target.id;
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const asked = useRef<string | null>(null);

  // Ask the wallet to switch once per (address, page target); wagmi adds the chain to the wallet if it is missing.
  useEffect(() => {
    const key = `${address}:${target.id}`;
    if (!wrong || asked.current === key) return;
    asked.current = key;
    switchChain({ chainId: target.id });
  }, [wrong, address, target.id, switchChain]);

  if (!address) {
    return (
      <span className="relative">
        <button className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-60" disabled={connect.isPending} onClick={() => connect.mutate({ connector })}>
          {connect.isPending ? "Connecting…" : "Connect wallet"}
        </button>
        {connect.error && (
          <span className="absolute right-0 top-full z-30 mt-2 w-64 rounded-2xl border border-line bg-[#0b111c] p-3 text-left text-xs shadow-[0_12px_40px_rgba(0,0,0,.6)]">
            <NoWallet error={connect.error} />
          </span>
        )}
      </span>
    );
  }

  const copy = () => navigator.clipboard.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
  return (
    <span className="relative">
      <button onClick={() => setOpen((o) => !o)} className={`glass flex items-center gap-2 rounded-full py-2 pl-3 pr-4 font-mono text-sm ${wrong ? "border-warn/50" : ""}`} aria-expanded={open} aria-haspopup="dialog">
        <span aria-hidden className={`size-2 rounded-full ${wrong ? "bg-warn" : "bg-go"}`} />
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
      {open && (
        <>
          <span className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-30 mt-2 w-72 rounded-3xl border border-line bg-[#0b111c] p-4 text-sm shadow-[0_16px_50px_rgba(0,0,0,.6)]" role="dialog" aria-label="Wallet">
            <div className="flex items-center gap-3">
              <span aria-hidden className="size-9 shrink-0 rounded-full" style={{ background: `conic-gradient(from ${parseInt(address.slice(2, 5), 16) % 360}deg, #61a6f6, #ffb040, #7ef0b0, #61a6f6)` }} />
              <button onClick={copy} className="min-w-0 flex-1 text-left" title="Copy address">
                <span className="block truncate font-mono text-xs">{address}</span>
                <span className="text-[11px] text-muted">{copied ? "Copied" : "Tap to copy"}</span>
              </button>
            </div>

            <div className="mt-4 flex items-center justify-between rounded-2xl border border-line px-3 py-2">
              <span className="min-w-0">
                <span className="block text-[11px] text-muted">Network</span>
                <span className={`block truncate text-xs ${wrong ? "text-warn" : ""}`}>{wrong ? `Wallet is on chain ${chainId ?? "?"}` : target.name}</span>
              </span>
              {wrong && (
                <button onClick={() => switchChain({ chainId: target.id })} disabled={switching} className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-medium text-black disabled:opacity-50">
                  {switching ? "Switching…" : `Switch to ${target.name.replace("BNB Smart Chain", "BSC")}`}
                </button>
              )}
            </div>
            {switchError && <p className="mt-1 text-[11px] text-block">{"shortMessage" in switchError ? switchError.shortMessage : switchError.message}</p>}

            <div className="mt-3">
              <span className="text-[11px] text-muted">Mode</span>
              <div className="glass mt-1 grid grid-cols-2 rounded-full p-1">
                {(["testnet", "mainnet"] as Mode[]).map((m) => (
                  <button key={m} onClick={() => setMode(m)} className={`rounded-full py-1.5 text-xs font-medium capitalize ${m === mode ? "bg-white text-black" : "text-muted"}`}>
                    {m}
                  </button>
                ))}
              </div>
            </div>

            <button className="mt-3 w-full rounded-full border border-block/40 py-2 text-xs text-block" onClick={() => { disconnect.mutate(); setOpen(false); }}>
              Disconnect
            </button>
          </div>
        </>
      )}
    </span>
  );
}

/** Explains a failed connect. On a phone without an injected wallet the fix is to open the page inside a wallet's browser. */
export function NoWallet({ error }: { error: Error | null }) {
  if (!error) return null;
  const missing = error.name === "ProviderNotFoundError" || /provider not found/i.test(error.message);
  return (
    <span className="mt-2 block text-xs text-muted">
      {missing ? (
        <>
          No wallet found in this browser. Open this page inside <b className="text-white">Binance Wallet</b> or <b className="text-white">MetaMask</b> (their in-app browser), or install a wallet extension on desktop.
        </>
      ) : (
        "shortMessage" in error ? String((error as { shortMessage: string }).shortMessage) : error.message
      )}
    </span>
  );
}
