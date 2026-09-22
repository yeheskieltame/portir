// ponytail: purchases live in localStorage until there is an indexer; enough for cost basis on one device.
import { useMemo, useSyncExternalStore } from "react";

export interface Buy {
  ticker: string;
  shares: number;
  usdt: number;
  pricePerShare: number;
  issuer: string;
  tx: string;
  at: number;
}

const KEY = "portir:buys";
const EVENT = "portir:buys";

const raw = () => {
  try {
    return localStorage.getItem(KEY) ?? "[]";
  } catch {
    return "[]";
  }
};

export function recordBuy(buy: Buy) {
  try {
    localStorage.setItem(KEY, JSON.stringify([...(JSON.parse(raw()) as Buy[]), buy]));
    dispatchEvent(new Event(EVENT));
  } catch {}
}

const subscribe = (cb: () => void) => {
  addEventListener("storage", cb);
  addEventListener(EVENT, cb);
  return () => {
    removeEventListener("storage", cb);
    removeEventListener(EVENT, cb);
  };
};

/** Purchases recorded on this device; empty during SSR so hydration matches. */
export function useBuys(): Buy[] {
  const json = useSyncExternalStore(subscribe, raw, () => "[]");
  return useMemo(() => {
    try {
      return JSON.parse(json) as Buy[];
    } catch {
      return [];
    }
  }, [json]);
}
