import assert from "node:assert/strict";
import { test } from "node:test";
import { createTrader, fillDeviationBps, perSharePrice, usdt } from "./trading.ts";

const E18 = 10n ** 18n;

test("usdt converts to 18-decimal units without float drift", () => {
  assert.equal(usdt(10), 10n * E18);
  assert.equal(usdt(0.1), E18 / 10n);
  assert.equal(usdt(19.99), 1999n * 10n ** 16n);
});

test("perSharePrice divides out the multiplier", () => {
  // $100 buys 0.5 tokens of a 2-shares-per-token stock: 1 share costs $100.
  assert.equal(perSharePrice(100n * E18, E18 / 2n, 2), 100);
  assert.ok(Math.abs(perSharePrice(usdt(10), 44_756_000_000_000_000n, 1.0017152487959898) - 223.05) < 0.01);
  assert.throws(() => perSharePrice(0n, 1n, 1), RangeError);
  assert.throws(() => perSharePrice(1n, 0n, 1), RangeError);
});

test("fillDeviationBps: how much less the simulation delivers than the quote", () => {
  assert.equal(fillDeviationBps(1000n, 1000n), 0);
  assert.equal(fillDeviationBps(1000n, 997n), 30.09); // just over the PRD's 0.3% line
  assert.ok(fillDeviationBps(1000n, 1003n) < 0); // better than quoted
  assert.equal(fillDeviationBps(1000n, 0n), Infinity);
});

test("createTrader refuses to run without credentials", () => {
  assert.throws(() => createTrader({ apiKey: "", apiSecret: "" }), /key and secret/);
});
