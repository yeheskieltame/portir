/**
 * Binance Agentic Wallet as the executor's trading backend.
 *
 * The user signs in once (QR in the Binance App) and sets the limits there:
 * daily cap, token scope, high-risk handling. This process only drives the
 * `baw` CLI within those limits; it never holds a key. Binance runs the swap
 * from its own infrastructure, so this path is not subject to the cloud-IP
 * block the Trading API applies (DEVEX day 4).
 *
 * Session: `~/.baw/session.json`, or `BAW_SESSION_JSON` (its content) which is
 * materialised at startup for deployed runtimes. Lives ≤48h idle / 7d max.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { type Address, erc20Abi, formatUnits, type Hex } from "viem";
import { client } from "./registry.js";

export const USDT = "0x55d398326f99059fF775485246999027B3197955";
const BSC = "56";

function bawBin(): string {
  const require = createRequire(import.meta.url);
  const pkg = require.resolve("@binance/agentic-wallet/package.json");
  const bin = require(pkg).bin as string | Record<string, string>;
  return join(dirname(pkg), typeof bin === "string" ? bin : bin.baw);
}

/** Deployed runtimes carry the session as a secret; write it where the CLI looks. */
export function ensureSession(): void {
  // Base64 survives every env/secret channel; raw JSON does not.
  const json = process.env.BAW_SESSION_B64 ? Buffer.from(process.env.BAW_SESSION_B64, "base64").toString("utf8") : process.env.BAW_SESSION_JSON;
  // The CLI honours BINANCE_BAW_DIR; deployed runtimes may only have /tmp writable.
  const file = join(process.env.BINANCE_BAW_DIR ?? join(homedir(), ".baw"), "session.json");
  if (!json || existsSync(file)) return;
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, json, { mode: 0o600 });
}

export async function baw<T = unknown>(...args: string[]): Promise<T> {
  ensureSession();
  const out = await new Promise<string>((resolve, reject) => {
    const p = spawn(process.execPath, [bawBin(), ...args, "--json"], { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("error", reject);
    p.on("close", () => resolve(stdout || stderr));
  });
  let body: { success?: boolean; data?: T; error?: { name?: string; message?: string } };
  try {
    body = JSON.parse(out.slice(out.indexOf("{")));
  } catch {
    throw new Error(`baw ${args[0]} ${args[1]}: ${out.slice(0, 200)}`);
  }
  if (!body.success) throw new Error(`baw ${args[0]} ${args[1]}: ${body.error?.name ?? ""} ${body.error?.message ?? "failed"}`.trim());
  return body.data as T;
}

export const status = () => baw<{ status: string }>("wallet", "status");
export const settings = () => baw<{ sessionExpireTime: string; dailyLimit: number; quotaLeft: number }>("wallet", "settings");

/** Why the wallet cannot take a `usdt` order right now, or null. Checked before any of the owner's money moves. */
export async function notReady(usdt: number): Promise<string | null> {
  try {
    await bscAddress();
    const s = await settings();
    // ponytail: field formats read from the CLI's typings, not seen live yet; an unreadable value skips that check.
    const expires = Number(s.sessionExpireTime) || Date.parse(s.sessionExpireTime);
    if (Number.isFinite(expires) && expires - Date.now() < 30 * 60_000) return "the Agentic Wallet session is about to expire; the operator must sign in again";
    if (Number.isFinite(s.quotaLeft) && s.quotaLeft < usdt) return `the Agentic Wallet has $${s.quotaLeft} of today's limit left`;
    return null;
  } catch (e) {
    return `the Agentic Wallet is not reachable (${e instanceof Error ? e.message.slice(0, 100) : e})`;
  }
}

export async function bscAddress(): Promise<string> {
  const d = await baw<{ addresses: { binanceChainId: string; address: string }[] }>("wallet", "address");
  const a = d.addresses.find((x) => x.binanceChainId === BSC);
  if (!a) throw new Error("Agentic Wallet has no BSC address");
  return a.address;
}

/** Quote `usdt` USDT → `token` (raw token units as a decimal string). */
export async function quote(token: string, usdt: number): Promise<{ tokensOut: number; slippage: number }> {
  const d = await baw<{ toCoinAmount: string; slippage: number }>("market-order", "quote", "--fromTokenQty", String(usdt), "--fromToken", USDT, "--toToken", token, "--binanceChainId", BSC);
  return { tokensOut: Number(d.toCoinAmount), slippage: d.slippage };
}

/** The order was submitted but did not reach a final state: the money may already be spent, so it must not be refunded. */
export class SwapPending extends Error {}

const SLIPPAGE_PCT = process.env.PORTIR_SLIPPAGE_PCT ?? "1";

/** Submit the swap and wait for a terminal state. Throws `SwapPending` when the outcome is unknown. */
export async function swap(token: string, usdt: number, timeoutMs = 90_000): Promise<{ orderId: string; txHash: string }> {
  const { orderId } = await baw<{ orderId: string }>("market-order", "swap", "--fromTokenQty", String(usdt), "--fromToken", USDT, "--toToken", token, "--slippage", SLIPPAGE_PCT, "--binanceChainId", BSC);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 4000));
    const d = await baw<{ list: { orderId: string; status: string; txHash: string | null }[] }>("market-order", "list", "--orderId", orderId).catch(() => null);
    const o = d?.list?.find((x) => x.orderId === orderId);
    if (o?.status === "FINISHED") return { orderId, txHash: o.txHash ?? "" };
    if (o?.status === "FAILED") throw new Error(`Agentic Wallet order ${orderId} failed`);
  }
  throw new SwapPending(`Agentic Wallet order ${orderId} not final after ${timeoutMs / 1000}s`);
}

/** The wallet's on-chain balance of `token` (raw units) and the token's decimals. */
export async function balanceOf(token: Address, wallet: Address): Promise<{ raw: bigint; decimals: number }> {
  const pc = client();
  const [raw, decimals] = await Promise.all([
    pc.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
    pc.readContract({ address: token, abi: erc20Abi, functionName: "decimals" }),
  ]);
  return { raw, decimals };
}

/** Wait until a swap's transaction is mined, so a balance read afterwards includes it. */
export const settled = (txHash: string) => (/^0x[0-9a-fA-F]{64}$/.test(txHash) ? client().waitForTransactionReceipt({ hash: txHash as Hex, timeout: 60_000 }).then(() => {}) : Promise.resolve());
export const units = (raw: bigint, decimals: number) => formatUnits(raw, decimals);

/** Send an exact amount (decimal string or number) of a token from the Agentic Wallet. Returns the tx hash. */
export async function send(token: string, recipient: string, amount: number | string): Promise<string> {
  const d = await baw<{ txHash?: string; hash?: string }>("wallet", "send", "--binanceChainId", BSC, "--tokenAddress", token, "--recipient", recipient, "--amount", String(amount));
  return d.txHash ?? d.hash ?? "";
}
