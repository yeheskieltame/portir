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

/** Submit the swap and wait for a terminal state. */
export async function swap(token: string, usdt: number, timeoutMs = 90_000): Promise<{ orderId: string; txHash: string }> {
  const { orderId } = await baw<{ orderId: string }>("market-order", "swap", "--fromTokenQty", String(usdt), "--fromToken", USDT, "--toToken", token, "--binanceChainId", BSC);
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    await new Promise((r) => setTimeout(r, 4000));
    const d = await baw<{ list: { orderId: string; status: string; txHash: string | null }[] }>("market-order", "list", "--orderId", orderId);
    const o = d.list?.find((x) => x.orderId === orderId) ?? d.list?.[0];
    if (o?.status === "FINISHED") return { orderId, txHash: o.txHash ?? "" };
    if (o?.status === "FAILED") throw new Error(`Agentic Wallet order ${orderId} failed`);
  }
  throw new Error(`Agentic Wallet order ${orderId} still pending after ${timeoutMs / 1000}s`);
}
