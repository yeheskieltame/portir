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
    <button
      className="rounded-full bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
      disabled={connect.isPending}
      onClick={() => connect.mutate({ connector })}
    >
      {connect.isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
