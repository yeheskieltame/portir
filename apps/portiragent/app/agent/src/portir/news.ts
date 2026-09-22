/**
 * Headlines for a ticker. Yahoo Finance (unofficial, no key) for the stock;
 * CoinDesk Data (ex-CryptoCompare, free key) for the crypto/RWA side when
 * COINDESK_API_KEY is set. Cached for five minutes per ticker.
 */
export interface Headline {
  title: string;
  source: string;
  url: string;
  at: number | null;
}

const UA = { "User-Agent": "Mozilla/5.0 (compatible; PortirAgent/1.0)" };
const cache = new Map<string, { at: number; items: Headline[] }>();

async function yahoo(ticker: string, limit: number): Promise<Headline[]> {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=${limit}&quotesCount=0`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const body = (await res.json()) as { news?: { title?: string; publisher?: string; link?: string; providerPublishTime?: number }[] };
  return (body.news ?? []).flatMap((n) => (n.title && n.link ? [{ title: n.title, source: n.publisher ?? "Yahoo Finance", url: n.link, at: n.providerPublishTime ? n.providerPublishTime * 1000 : null }] : []));
}

async function coindesk(query: string, limit: number): Promise<Headline[]> {
  const key = process.env.COINDESK_API_KEY;
  if (!key) return [];
  const url = `https://data-api.coindesk.com/news/v1/search?search_string=${encodeURIComponent(query)}&lang=EN&limit=${limit}&api_key=${key}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return [];
  const body = (await res.json()) as { Data?: { TITLE?: string; SOURCE_DATA?: { NAME?: string }; URL?: string; PUBLISHED_ON?: number }[] };
  return (body.Data ?? []).flatMap((n) => (n.TITLE && n.URL ? [{ title: n.TITLE, source: n.SOURCE_DATA?.NAME ?? "CoinDesk", url: n.URL, at: n.PUBLISHED_ON ? n.PUBLISHED_ON * 1000 : null }] : []));
}

export async function news(ticker: string, limit = 6): Promise<Headline[]> {
  const key = `${ticker.toUpperCase()}:${limit}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < 300_000) return hit.items;
  const [y, c] = await Promise.allSettled([yahoo(ticker, limit), coindesk(`${ticker} tokenized stock`, 3)]);
  const items = [...(y.status === "fulfilled" ? y.value : []), ...(c.status === "fulfilled" ? c.value : [])].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, limit);
  if (items.length) cache.set(key, { at: Date.now(), items });
  return items;
}
