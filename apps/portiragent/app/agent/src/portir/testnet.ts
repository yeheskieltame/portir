/**
 * BSC testnet fixtures (contracts/src/testnet), `PORTIR_EXECUTION=testnet`. The plan owner approves
 * PlanRegistry (never this agent) for tUSDT; each due run the agent pulls at most the plan amount through the
 * registry, buys on the TestExchange at a quote signed by the keeper key (`PORTIR_TESTNET_KEEPER_KEY`, the live
 * mainnet price the Guard judged), sends the shares to the owner and returns anything unspent.
 */
import { type Address, type Hex, encodeFunctionData, erc20Abi, parseAbi, parseEventLogs, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import deployments from "../../../../../../contracts/deployments/testnet.json" with { type: "json" };
import { client, planRegistryAbi, registryAddress, sendTx } from "./registry.js";

export const TESTNET = {
  usdt: deployments.usdt as Address,
  exchange: deployments.exchange as Address,
  stocks: deployments.stocks as Record<string, Address>,
};

const exchangeAbi = parseAbi([
  "function buy(address stock, uint256 usdtIn, uint256 minSharesOut, uint128 price, uint40 deadline, bytes sig) returns (uint256)",
  "function feeBps() view returns (uint16)",
  "event Bought(address indexed buyer, address indexed stock, uint256 usdtIn, uint256 sharesOut, uint128 price)",
]);
const QUOTE_DOMAIN = { name: "Portir TestExchange", version: "1", chainId: 97, verifyingContract: TESTNET.exchange } as const;
const QUOTE_TYPES = { Quote: [{ name: "stock", type: "address" }, { name: "price", type: "uint128" }, { name: "deadline", type: "uint40" }] } as const;

export const testnetFeeBps = () => client().readContract({ address: TESTNET.exchange, abi: exchangeAbi, functionName: "feeBps" });

const agentAddress = async () => (await import("@bnbagent/studio-runtime/wallet")).getWallet().address as Address;
const wei = (usdt: number) => parseUnits(usdt.toFixed(6), 18);
const fmt = (v: bigint) => `$${(Number(v / 10n ** 16n) / 100).toFixed(2)}`;

/** Why the owner's tUSDT cannot fund `usdt` right now (balance, or allowance to PlanRegistry), or null if it can. */
export async function fundingProblem(owner: Address, usdt: number): Promise<string | null> {
  const pc = client();
  const need = wei(usdt);
  const [balance, allowance] = await Promise.all([
    pc.readContract({ address: TESTNET.usdt, abi: erc20Abi, functionName: "balanceOf", args: [owner] }),
    pc.readContract({ address: TESTNET.usdt, abi: erc20Abi, functionName: "allowance", args: [owner, registryAddress()] }),
  ]);
  if (balance < need) return `Your wallet has ${fmt(balance)} tUSDT, the order needs ${fmt(need)}. Use the faucet in Profile.`;
  if (allowance < need) return `Plans may spend ${fmt(allowance)} of your tUSDT, the order needs ${fmt(need)}. Allow it on the Plans page.`;
  return null;
}

/** Pull this run's budget from the owner through PlanRegistry (it enforces: executor only, due, at most plan.amount). */
export const pullFunds = (planId: bigint, usdt: number) =>
  sendTx(registryAddress(), encodeFunctionData({ abi: planRegistryAbi, functionName: "pullFunds", args: [planId, wei(usdt)] }));

/** Give unspent money back to the owner through PlanRegistry, which frees the run's budget for a retry. */
export async function returnFunds(planId: bigint, usdt: number): Promise<void> {
  const pc = client();
  const me = await agentAddress();
  const amount = wei(usdt);
  const allowance = await pc.readContract({ address: TESTNET.usdt, abi: erc20Abi, functionName: "allowance", args: [me, registryAddress()] });
  if (allowance < amount) await sendTx(TESTNET.usdt, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [registryAddress(), 2n ** 255n] }));
  await sendTx(registryAddress(), encodeFunctionData({ abi: planRegistryAbi, functionName: "returnFunds", args: [planId, amount] }));
}

/** With funds already pulled: buy `ticker` at `pricePerShare`, then send the shares to `owner`. */
export async function buyOnTestnet(owner: Address, ticker: string, usdt: number, pricePerShare: number, minShares: number): Promise<{ txHash: Hex; shares: number }> {
  const stock = TESTNET.stocks[ticker];
  if (!stock) throw new Error(`${ticker} is not on the testnet exchange`);
  const key = process.env.PORTIR_TESTNET_KEEPER_KEY as Hex | undefined;
  if (!key) throw new Error("PORTIR_TESTNET_KEEPER_KEY is not set");
  const pc = client();
  const me = await agentAddress();
  const amount = wei(usdt);
  const allowance = await pc.readContract({ address: TESTNET.usdt, abi: erc20Abi, functionName: "allowance", args: [me, TESTNET.exchange] });
  if (allowance < amount) await sendTx(TESTNET.usdt, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TESTNET.exchange, 2n ** 255n] }));
  const price = parseUnits(pricePerShare.toFixed(6), 18);
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const sig = await privateKeyToAccount(key).signTypedData({ domain: QUOTE_DOMAIN, types: QUOTE_TYPES, primaryType: "Quote", message: { stock, price, deadline } });
  const txHash = await sendTx(TESTNET.exchange, encodeFunctionData({ abi: exchangeAbi, functionName: "buy", args: [stock, amount, parseUnits(minShares.toFixed(18), 18), price, deadline, sig] }));
  // Shares from the receipt's own Bought event: a balance read can hit an RPC node a block behind.
  const receipt = await pc.waitForTransactionReceipt({ hash: txHash });
  const [ev] = parseEventLogs({ abi: exchangeAbi, eventName: "Bought", logs: receipt.logs });
  if (!ev) throw new Error(`buy ${txHash} emitted no Bought event`);
  const bought = ev.args.sharesOut;
  await sendTx(stock, encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [owner, bought] }));
  return { txHash, shares: Number(bought) / 1e18 };
}
