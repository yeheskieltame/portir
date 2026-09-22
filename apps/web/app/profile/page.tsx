"use client";

import { erc20Abi, formatUnits } from "viem";
import { bsc } from "wagmi/chains";
import { useConnect, useConnection, useConnectors, useDisconnect, useReadContract } from "wagmi";
import { usd } from "@/app/verdict";
import { planRegistryAddress } from "@/lib/planRegistry";
import { chain } from "@/lib/wagmi";

const USDT = "0x55d398326f99059fF775485246999027B3197955"; // BSC USDT, 18 decimals (same as @portir/core/trading, kept out of the client bundle)

export default function Profile() {
  const { address } = useConnection();
  const [connector] = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const usdt = useReadContract({ address: USDT, abi: erc20Abi, functionName: "balanceOf", args: [address!], chainId: bsc.id, query: { enabled: !!address } });
  const explorer = chain.blockExplorers?.default.url;

  return (
    <>
      <h1 className="mt-4 text-[34px] leading-[1] tracking-[-0.03em]">
        Your <span className="serif-italic text-[1.1em]">profile.</span>
      </h1>

      {!address ? (
        <div className="glass mt-6 rounded-3xl p-5 text-sm text-muted">
          Connect a wallet to see balances, plans and sessions. No seed phrase is ever asked for here.
          <button
            className="mt-4 block rounded-full bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-60"
            disabled={connect.isPending}
            onClick={() => connect.mutate({ connector })}
          >
            {connect.isPending ? "Connecting…" : "Connect wallet"}
          </button>
        </div>
      ) : (
        <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-6">
          <div className="glass mt-6 flex items-center gap-3 rounded-3xl p-4 lg:col-span-2">
            <span aria-hidden className="size-12 shrink-0 rounded-full" style={{ background: `conic-gradient(from ${parseInt(address.slice(2, 5), 16) % 360}deg, #61a6f6, #ffb040, #7ef0b0, #61a6f6)` }} />
            <div className="min-w-0">
              <p className="truncate font-mono text-sm">{address}</p>
              <p className="mt-0.5 text-xs text-muted">{chain.name}</p>
            </div>
          </div>

          <dl className="glass mt-4 divide-y divide-line rounded-3xl text-sm lg:mt-0">
            <Row label="USDT on BNB Chain" value={usdt.data === undefined ? "…" : usd.format(Number(formatUnits(usdt.data, 18)))} />
            <Row label="Agentic Wallet session" value="Next" chip />
            <Row label="Executor agent" value="Next" chip />
          </dl>

          <div className="glass mt-4 divide-y divide-line rounded-3xl text-sm lg:mt-0">
            {explorer && <a className="block px-4 py-3" href={`${explorer}/address/${address}`} target="_blank" rel="noopener">Wallet on BscScan ↗</a>}
            {explorer && planRegistryAddress && <a className="block px-4 py-3" href={`${explorer}/address/${planRegistryAddress}`} target="_blank" rel="noopener">Plan registry contract ↗</a>}
            <button className="block w-full px-4 py-3 text-left text-block" onClick={() => disconnect.mutate()}>Disconnect</button>
          </div>
        </div>
      )}
    </>
  );
}

function Row({ label, value, chip }: { label: string; value: string; chip?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className={chip ? "rounded-full border border-warn/40 bg-warn/10 px-2 py-0.5 text-[11px] text-warn" : "font-mono tabular-nums"}>{value}</dd>
    </div>
  );
}
