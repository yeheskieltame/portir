import assert from "node:assert/strict";
import { test } from "node:test";
import { guard, pickIssuer, simulationOk, spreadBps } from "./index.ts";

test("spreadBps is exact at the thresholds", () => {
  assert.equal(spreadBps(100.5, 100), 50);
  assert.equal(spreadBps(101, 100), 100);
  assert.equal(spreadBps(99, 100), -100);
  assert.throws(() => spreadBps(0, 100), RangeError);
  assert.throws(() => spreadBps(100, NaN), RangeError);
});

test("guard follows the PRD verdict table", () => {
  const at = (onchain: number, extra = {}) => guard({ session: "closed", onchain, reference: 100, ...extra });

  assert.equal(at(100.5).verdict, "GO"); // <= 0.5% is green, boundary included
  assert.equal(at(100.51).verdict, "WARN");
  assert.equal(at(101).verdict, "WARN"); // <= 1.0% is amber, boundary included
  assert.equal(at(101.3).verdict, "BLOCK"); // PRD flow B: closed, 1.3%
  assert.equal(at(98).verdict, "GO"); // discount favours the buyer
  assert.equal(at(100, { halted: "EARNINGS" }).verdict, "BLOCK");
  assert.equal(guard({ session: "open", onchain: 100.2, reference: 100 }).verdict, "GO");

  assert.match(at(101.3).reason, /closed.*1\.30% above/);
  assert.match(at(100, { halted: "EARNINGS" }).reason, /EARNINGS/);
});

test("simulationOk rejects fills more than 0.3% worse than the quote", () => {
  assert.equal(simulationOk(100, 100.3), true);
  assert.equal(simulationOk(100, 100.31), false);
  assert.equal(simulationOk(100, 99), true);
});

test("pickIssuer: lowest effective cost, halted excluded, volume breaks ties", () => {
  const q = (issuer: string, spread: number, impact: number, volume24hUsd: number, halted?: string) => ({
    issuer,
    spreadBps: spread,
    impactBps: impact,
    volume24hUsd,
    halted,
  });

  assert.equal(pickIssuer([q("bstocks", 20, 30, 1), q("ondo", 40, 5, 1)])?.issuer, "ondo");
  assert.equal(pickIssuer([q("bstocks", 1, 1, 1, "SPLIT"), q("ondo", 40, 5, 1)])?.issuer, "ondo");
  assert.equal(pickIssuer([q("bstocks", 10, 10, 5), q("ondo", 15, 5, 9)])?.issuer, "ondo");
  assert.equal(pickIssuer([q("bstocks", 1, 1, 1, "SPLIT")]), undefined);
});
