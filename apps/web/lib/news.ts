import "server-only";

// Headlines for a ticker: Yahoo Finance (unofficial, no key) plus CoinDesk Data when COINDESK_API_KEY is set.
// Same sources and shape as the agent's src/portir/news.ts; kept in sync by hand.
export interface Headline {
  title: string;
  source: string;
  url: string;
  at: number | null;
}

const UA = { "User-Agent": "Mozilla/5.0 (compatible; Portir/1.0)" };

async function yahoo(ticker: string, limit: number): Promise<Headline[]> {
  const res = await fetch(`https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(ticker)}&newsCount=${limit}&quotesCount=0`, {
    headers: UA,
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`yahoo ${res.status}`);
  const body = (await res.json()) as { news?: { title?: string; publisher?: string; link?: string; providerPublishTime?: number }[] };
  return (body.news ?? []).flatMap((n) => (n.title && n.link ? [{ title: n.title, source: n.publisher ?? "Yahoo Finance", url: n.link, at: n.providerPublishTime ? n.providerPublishTime * 1000 : null }] : []));
}

async function coindesk(query: string, limit: number): Promise<Headline[]> {
  const key = process.env.COINDESK_API_KEY;
  if (!key) return [];
  const res = await fetch(`https://data-api.coindesk.com/news/v1/search?search_string=${encodeURIComponent(query)}&lang=EN&limit=${limit}&api_key=${key}`, {
    next: { revalidate: 300 },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { Data?: { TITLE?: string; SOURCE_DATA?: { NAME?: string }; URL?: string; PUBLISHED_ON?: number }[] };
  return (body.Data ?? []).flatMap((n) => (n.TITLE && n.URL ? [{ title: n.TITLE, source: n.SOURCE_DATA?.NAME ?? "CoinDesk", url: n.URL, at: n.PUBLISHED_ON ? n.PUBLISHED_ON * 1000 : null }] : []));
}

export async function loadNews(ticker: string, limit = 6): Promise<Headline[]> {
  const [y, c] = await Promise.allSettled([yahoo(ticker, limit), coindesk(`${ticker} tokenized stock`, 3)]);
  return [...(y.status === "fulfilled" ? y.value : []), ...(c.status === "fulfilled" ? c.value : [])].sort((a, b) => (b.at ?? 0) - (a.at ?? 0)).slice(0, limit);
}
