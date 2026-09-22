/**
 * BSC testnet fixtures (contracts/src/testnet): the agent is the keeper of the TestExchange,
 * mirroring mainnet on-chain prices so testnet buys face the same Guard spreads; it can also
 * buy there with its own tUSDT (`PORTIR_EXECUTION=testnet`).
 */
import { type Address, type Hex, encodeFunctionData, erc20Abi, parseAbi, parseUnits } from "viem";
import deployments from "../../../../../../contracts/deployments/testnet.json" with { type: "json" };
import { assess } from "./market.js";
import { client, sendTx } from "./registry.js";

export const TESTNET = {
  usdt: deployments.usdt as Address,
  exchange: deployments.exchange as Address,
  stocks: deployments.stocks as Record<string, Address>,
};

const exchangeAbi = parseAbi([
  "function setPrices(address[] stocks, uint128[] prices)",
  "function buy(address stock, uint256 usdtIn, uint256 minSharesOut) returns (uint256)",
  "function priceOf(address stock) view returns (uint256 price, uint40 updatedAt, bool fresh)",
  "function feeBps() view returns (uint16)",
]);
const usdtAbi = parseAbi(["function faucet()"]);

const log = (msg: string) => console.log(`[portir.keeper] ${msg}`);

/** Push the mirrored per-share price of every featured stock. One tx. */
export async function pushPrices(): Promise<Hex | null> {
  const entries = Object.entries(TESTNET.stocks);
  const priced = await Promise.allSettled(entries.map(async ([ticker, stock]) => ({ stock, price: (await assess(ticker)).view.offers[0].onchain })));
  const ok = priced.flatMap((p) => (p.status === "fulfilled" && p.value.price > 0 ? [p.value] : []));
  if (ok.length === 0) return null;
  const hash = await sendTx(TESTNET.exchange, encodeFunctionData({ abi: exchangeAbi, functionName: "setPrices", args: [ok.map((o) => o.stock), ok.map((o) => parseUnits(o.price.toFixed(6), 18))] }));
  log(`prices for ${ok.length} stocks → ${hash}`);
  return hash;
}

/** Buy `usdt` worth of `ticker` on the TestExchange with the agent's own tUSDT (faucet if empty). */
export async function buyOnTestnet(ticker: string, usdt: number, minShares: number): Promise<Hex> {
  const stock = TESTNET.stocks[ticker];
  if (!stock) throw new Error(`${ticker} is not on the testnet exchange`);
  const pc = client();
  const me = (await import("@bnbagent/studio-runtime/wallet")).getWallet().address as Address;
  const amount = parseUnits(usdt.toFixed(6), 18);
  const balance = await pc.readContract({ address: TESTNET.usdt, abi: erc20Abi, functionName: "balanceOf", args: [me] });
  if (balance < amount) await sendTx(TESTNET.usdt, encodeFunctionData({ abi: usdtAbi, functionName: "faucet" }));
  const allowance = await pc.readContract({ address: TESTNET.usdt, abi: erc20Abi, functionName: "allowance", args: [me, TESTNET.exchange] });
  if (allowance < amount) await sendTx(TESTNET.usdt, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TESTNET.exchange, amount] }));
  return sendTx(TESTNET.exchange, encodeFunctionData({ abi: exchangeAbi, functionName: "buy", args: [stock, amount, parseUnits(minShares.toFixed(18), 18)] }));
}

export async function testnetPrice(ticker: string): Promise<{ price: number; fresh: boolean; feeBps: number }> {
  const stock = TESTNET.stocks[ticker];
  if (!stock) throw new Error(`${ticker} is not on the testnet exchange`);
  const pc = client();
  const [[price, , fresh], feeBps] = await Promise.all([
    pc.readContract({ address: TESTNET.exchange, abi: exchangeAbi, functionName: "priceOf", args: [stock] }),
    pc.readContract({ address: TESTNET.exchange, abi: exchangeAbi, functionName: "feeBps" }),
  ]);
  return { price: Number(price) / 1e18, fresh, feeBps };
}
