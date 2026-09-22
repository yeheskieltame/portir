"use client";

import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi";

export function ConnectButton() {
  const { address } = useConnection();
  const [connector] = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();

  if (address) {
    return (
      <button className="glass rounded-full px-4 py-2 font-mono text-sm" onClick={() => disconnect.mutate()} title="Disconnect">
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
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
