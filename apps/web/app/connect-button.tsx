"use client";

import { useState } from "react";
import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi";

export function ConnectButton() {
  const { address } = useConnection();
  const [connector] = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const [copied, setCopied] = useState(false);

  if (address) {
    const copy = () => navigator.clipboard.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1200); });
    return (
      <span className="glass flex items-center rounded-full font-mono text-sm">
        <button className="py-2 pl-4 pr-2" onClick={() => disconnect.mutate()} title="Disconnect">
          {address.slice(0, 6)}…{address.slice(-4)}
        </button>
        <button className="py-2 pl-1 pr-3 text-muted" onClick={copy} title="Copy address" aria-label="Copy address">
          {copied ? "✓" : "⧉"}
        </button>
      </span>
    );
  }
  return (
    <span className="relative">
      <button
        className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
        disabled={connect.isPending}
        onClick={() => connect.mutate({ connector })}
      >
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
