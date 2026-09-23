/**
 * BSC testnet fixtures (contracts/src/testnet): the agent buys on the TestExchange with its own tUSDT
 * (`PORTIR_EXECUTION=testnet`). The exchange settles at a quote signed by the keeper key
 * (`PORTIR_TESTNET_KEEPER_KEY`, same signer the app uses), carrying the live mainnet price the Guard judged.
 */
import { type Address, type Hex, encodeFunctionData, erc20Abi, parseAbi, parseUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import deployments from "../../../../../../contracts/deployments/testnet.json" with { type: "json" };
import { client, sendTx } from "./registry.js";

export const TESTNET = {
  usdt: deployments.usdt as Address,
  exchange: deployments.exchange as Address,
  stocks: deployments.stocks as Record<string, Address>,
};

const exchangeAbi = parseAbi([
  "function buy(address stock, uint256 usdtIn, uint256 minSharesOut, uint128 price, uint40 deadline, bytes sig) returns (uint256)",
  "function feeBps() view returns (uint16)",
]);
const usdtAbi = parseAbi(["function faucet()"]);
const QUOTE_DOMAIN = { name: "Portir TestExchange", version: "1", chainId: 97, verifyingContract: TESTNET.exchange } as const;
const QUOTE_TYPES = { Quote: [{ name: "stock", type: "address" }, { name: "price", type: "uint128" }, { name: "deadline", type: "uint40" }] } as const;

export const testnetFeeBps = () => client().readContract({ address: TESTNET.exchange, abi: exchangeAbi, functionName: "feeBps" });

/** Buy `usdt` worth of `ticker` at `pricePerShare` (live mainnet price) with the agent's own tUSDT (faucet if empty). */
export async function buyOnTestnet(ticker: string, usdt: number, pricePerShare: number, minShares: number): Promise<Hex> {
  const stock = TESTNET.stocks[ticker];
  if (!stock) throw new Error(`${ticker} is not on the testnet exchange`);
  const key = process.env.PORTIR_TESTNET_KEEPER_KEY as Hex | undefined;
  if (!key) throw new Error("PORTIR_TESTNET_KEEPER_KEY is not set");
  const pc = client();
  const me = (await import("@bnbagent/studio-runtime/wallet")).getWallet().address as Address;
  const amount = parseUnits(usdt.toFixed(6), 18);
  const balance = await pc.readContract({ address: TESTNET.usdt, abi: erc20Abi, functionName: "balanceOf", args: [me] });
  if (balance < amount) await sendTx(TESTNET.usdt, encodeFunctionData({ abi: usdtAbi, functionName: "faucet" }));
  const allowance = await pc.readContract({ address: TESTNET.usdt, abi: erc20Abi, functionName: "allowance", args: [me, TESTNET.exchange] });
  if (allowance < amount) await sendTx(TESTNET.usdt, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [TESTNET.exchange, amount] }));
  const price = parseUnits(pricePerShare.toFixed(6), 18);
  const deadline = Math.floor(Date.now() / 1000) + 600;
  const sig = await privateKeyToAccount(key).signTypedData({ domain: QUOTE_DOMAIN, types: QUOTE_TYPES, primaryType: "Quote", message: { stock, price, deadline } });
  return sendTx(TESTNET.exchange, encodeFunctionData({ abi: exchangeAbi, functionName: "buy", args: [stock, amount, parseUnits(minShares.toFixed(18), 18), price, deadline, sig] }));
}
