import { createConfig, http } from "wagmi";
import { bsc, bscTestnet, foundry } from "wagmi/chains";
import { injected } from "wagmi/connectors";

// ponytail: injected connector only (Binance Wallet, MetaMask, ... all inject).
// Swap in the Agentic Wallet SDK connector once its session API is verified (PRD day 8-12).
// One chain at a time, so every read and write targets it. NEXT_PUBLIC_CHAIN: mainnet (default) | testnet | anvil
const CHAINS = { mainnet: bsc, testnet: bscTestnet, anvil: foundry } as const;
export const chain = CHAINS[process.env.NEXT_PUBLIC_CHAIN as keyof typeof CHAINS] ?? bsc;

export const config = createConfig({
  chains: [chain],
  connectors: [injected()],
  transports: { [bsc.id]: http(process.env.NEXT_PUBLIC_RPC_URL), [bscTestnet.id]: http(process.env.NEXT_PUBLIC_RPC_URL), [foundry.id]: http() },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof config;
  }
}
