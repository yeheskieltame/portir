"use client";

import { useConnect, useConnection, useConnectors, useDisconnect } from "wagmi";

export function ConnectButton() {
  const { address } = useConnection();
  const [connector] = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();

  const cls = "rounded-full border border-line bg-card px-4 py-2 text-sm font-medium";
  if (address) {
    return (
      <button className={cls} onClick={() => disconnect.mutate()} title="Disconnect">
        {address.slice(0, 6)}…{address.slice(-4)}
      </button>
    );
  }
  return (
    <button className={cls} disabled={connect.isPending} onClick={() => connect.mutate({ connector })}>
      {connect.isPending ? "Connecting…" : "Connect wallet"}
    </button>
  );
}
