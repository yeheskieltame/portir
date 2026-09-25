"use client";

import { erc20Abi, formatUnits } from "viem";
import { useConnect, useConnection, useConnectors, useDisconnect, useReadContract, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from "wagmi";
import { useMode, useSetMode } from "@/app/mode";
import { usd } from "@/app/verdict";
import { type Mode, NET } from "@/lib/mode";
import { planRegistryAddress } from "@/lib/planRegistry";
import { TESTNET, mockUsdtAbi } from "@/lib/testnet";
import { AgentFuel, ConnectClaude } from "./agent";
import { chain } from "@/lib/wagmi";

export default function Profile() {
  const { address } = useConnection();
  const [connector] = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const mode = useMode();
  const setMode = useSetMode();
  const net = NET[mode];
  const usdt = useReadContract({ address: net.usdt, abi: erc20Abi, functionName: "balanceOf", args: [address!], chainId: net.chain.id, query: { enabled: !!address } });
  const explorer = chain.blockExplorers?.default.url;

  return (
    <>
      <h1 className="mt-4 text-[34px] leading-[1] tracking-[-0.03em]">
        Your <span className="serif-italic text-[1.1em]">profile.</span>
      </h1>

      <section className="glass mt-6 rounded-3xl p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg">Mode</h2>
          <span className="text-xs text-muted">{net.label}</span>
        </div>
        <div className="glass mt-3 grid grid-cols-2 rounded-full p-1">
          {(["testnet", "mainnet"] as Mode[]).map((m) => (
            <button key={m} onClick={() => setMode(m)} className={`rounded-full py-2 text-sm font-medium capitalize ${m === mode ? "bg-white text-black" : "text-muted"}`}>
              {m}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-muted">
          {mode === "testnet"
            ? "Prices, sessions and the Guard are live from BNB Chain; buys settle on BSC testnet with free tUSDT against the featured stocks. Try everything here first."
            : "Real USDT and real stock tokens on BNB Chain through the Binance Trading API. Every order is checked by the Guard before your wallet signs."}
        </p>
      </section>

      {!address ? (
        <div className="glass mt-4 rounded-3xl p-5 text-sm text-muted">
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
          <div className="glass mt-4 flex items-center gap-3 rounded-3xl p-4 lg:col-span-2">
            <span aria-hidden className="size-12 shrink-0 rounded-full" style={{ background: `conic-gradient(from ${parseInt(address.slice(2, 5), 16) % 360}deg, #61a6f6, #ffb040, #7ef0b0, #61a6f6)` }} />
            <div className="min-w-0">
              <p className="truncate font-mono text-sm">{address}</p>
              <p className="mt-0.5 text-xs text-muted">Plans on {chain.name} · buys on {net.chain.name}</p>
            </div>
          </div>

          <dl className="glass mt-4 divide-y divide-line rounded-3xl text-sm lg:mt-0">
            <Row label={mode === "testnet" ? "tUSDT on BSC testnet" : "USDT on BNB Chain"} value={usdt.data === undefined ? "…" : usd.format(Number(formatUnits(usdt.data, 18)))} />
            {mode === "testnet" && <Faucet address={address} onDone={() => usdt.refetch()} />}
            <Row label="Agentic Wallet session" value="Next" chip />
            <Row label="Executor agent" value={process.env.NEXT_PUBLIC_EXECUTOR ? "Live" : "Next"} chip />
          </dl>

          <div className="glass mt-4 divide-y divide-line rounded-3xl text-sm lg:mt-0">
            {explorer && <a className="block px-4 py-3" href={`${net.explorer}/address/${address}`} target="_blank" rel="noopener">Wallet on BscScan ↗</a>}
            {explorer && planRegistryAddress && <a className="block px-4 py-3" href={`${explorer}/address/${planRegistryAddress}`} target="_blank" rel="noopener">Plan registry contract ↗</a>}
            {mode === "testnet" && <a className="block px-4 py-3" href={`${net.explorer}/address/${TESTNET.exchange}`} target="_blank" rel="noopener">Testnet exchange contract ↗</a>}
            <button className="block w-full px-4 py-3 text-left text-block" onClick={() => disconnect.mutate()}>Disconnect</button>
          </div>
        </div>
      )}

      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-4">
        <ConnectClaude />
        <AgentFuel />
      </div>
    </>
  );
}

/** MockUSDT.faucet(): 10,000 tUSDT per claim, no cooldown, signed by the user's wallet on BSC testnet. */
function Faucet({ onDone }: { address: `0x${string}`; onDone: () => void }) {
  const write = useWriteContract();
  const { switchChainAsync, isPending: switching } = useSwitchChain();
  const receipt = useWaitForTransactionReceipt({ hash: write.data, chainId: NET.testnet.chain.id, query: { enabled: !!write.data } });
  const busy = write.isPending || receipt.isLoading || switching;
  const error = write.error;
  // Make sure the wallet is on BSC testnet first; the wallet adds the chain if it does not know it.
  const claim = async () => {
    await switchChainAsync({ chainId: NET.testnet.chain.id });
    write.mutate({ address: TESTNET.usdt, abi: mockUsdtAbi, functionName: "faucet", chainId: NET.testnet.chain.id }, { onSuccess: () => setTimeout(onDone, 4000) });
  };
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <dt className="text-muted">Faucet</dt>
      <dd className="text-right">
        <button
          disabled={busy}
          onClick={() => void claim().catch(() => {})}
          className="rounded-full bg-white px-3 py-1 text-xs font-medium text-black disabled:opacity-50"
        >
          {busy ? "Sending…" : receipt.isSuccess ? "Sent · get more" : "Get 10,000 tUSDT"}
        </button>
        {error && <p className="mt-1 max-w-[12rem] text-[11px] text-block">{"shortMessage" in error ? error.shortMessage : error.message}</p>}
      </dd>
    </div>
  );
}

function Row({ label, value, chip }: { label: string; value: string; chip?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3">
      <dt className="text-muted">{label}</dt>
      <dd className={chip ? `rounded-full border px-2 py-0.5 text-[11px] ${value === "Live" ? "border-go/40 bg-go/10 text-go" : "border-warn/40 bg-warn/10 text-warn"}` : "font-mono tabular-nums"}>{value}</dd>
    </div>
  );
}
