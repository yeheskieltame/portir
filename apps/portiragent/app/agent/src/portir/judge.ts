/**
 * News check before a buy: the LLM reads the ticker's recent headlines and may hold the buy back for a
 * concrete near-term risk (earnings within a day, halt, fraud, regulator, a news-driven swing in progress).
 * Fail-open: no brain, no headlines or a bad answer means the rule-based Guard alone decides.
 * The LLM never moves money; it can only say "wait", which the executor records with its reason.
 */
import { strict as assert } from "node:assert";
import { execFile } from "node:child_process";
import { news } from "./news.js";

export type NewsCall = { wait: boolean; reason: string; headlines: number };

const CACHE_MS = 60 * 60_000; // one opinion per ticker per hour, so a 15-minute scan does not re-ask
const cache = new Map<string, { at: number; call: NewsCall }>();
const log = (msg: string) => console.log(`[portir.judge] ${msg}`);

const SYSTEM = `You are the news check of an automated stock-buying agent. The price and market-hours checks already passed.
Decide if this buy should go ahead now or wait up to a day. Say "wait" ONLY for a concrete near-term risk in the headlines:
earnings or guidance within about 24 hours, a trading halt, fraud or accounting issues, a regulator or court action,
or a sharp news-driven move happening right now. Ordinary news, analyst opinions and general market chatter mean "buy".
Reply with JSON only: {"decision":"buy"|"wait","reason":"one plain sentence under 140 characters that names the headline"}`;

function claudeCli(prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile("claude", ["-p", "--output-format", "text", "--tools", "", "--system-prompt", SYSTEM, "--model", process.env.PORTIR_BRAIN_MODEL ?? "sonnet"], { timeout: 90_000, maxBuffer: 1 << 20, env: { ...process.env, CLAUDECODE: "" } }, (err, out) => (err ? reject(err) : resolve(out)));
    child.stdin?.end(prompt);
  });
}

/** The model configured in studio.toml [llm] (Groq in production). */
async function studioModel(prompt: string): Promise<string> {
  const [{ generateText }, { buildModel }] = await Promise.all([import("ai"), import("../model.js")]);
  const { text } = await generateText({ model: buildModel(), system: SYSTEM, prompt, abortSignal: AbortSignal.timeout(60_000) });
  return text;
}

/** The last valid {"decision", "reason"} object: reasoning models think out loud first and may echo the format. */
export function parseCall(raw: string): { wait: boolean; reason: string } | null {
  const candidates = raw.match(/\{[^{}]*"decision"[^{}]*\}/g) ?? [];
  for (const c of candidates.reverse()) {
    try {
      const j = JSON.parse(c) as { decision?: string; reason?: string };
      if (j.decision === "buy" || j.decision === "wait") return { wait: j.decision === "wait", reason: String(j.reason ?? "").trim().slice(0, 160) };
    } catch {
      // the echoed format, or a half-written object: try the previous one
    }
  }
  return null;
}

/** Should the buy of `tickers` wait for the news? Returns null when the check could not run (then: buy). */
export async function newsCheck(tickers: string[]): Promise<NewsCall | null> {
  if (process.env.PORTIR_NEWS_CHECK === "off") return null;
  const key = tickers.join(",");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.call;
  try {
    const since = Date.now() - 72 * 3600_000;
    const lists = await Promise.all(tickers.map(async (t) => ({ t, items: (await news(t, 6)).filter((h) => (h.at ?? Date.now()) >= since) })));
    const count = lists.reduce((n, l) => n + l.items.length, 0);
    if (count === 0) return null;
    const hours = (at: number | null) => (at ? `${Math.max(0, Math.round((Date.now() - at) / 3600_000))}h ago` : "recent");
    const prompt = `Buying: ${key}. Now: ${new Date().toUTCString()}.\n\n${lists.map((l) => `${l.t}:\n${l.items.map((h) => `- (${hours(h.at)}, ${h.source}) ${h.title}`).join("\n") || "- no headlines"}`).join("\n\n")}`;
    const raw = process.env.PORTIR_BRAIN === "claude-cli" ? await claudeCli(prompt) : await studioModel(prompt);
    const parsed = parseCall(raw);
    if (!parsed) {
      log(`${key}: unreadable answer, buying on the Guard alone (…${raw.slice(-160).replace(/\s+/g, " ")})`);
      return null;
    }
    const call = { ...parsed, headlines: count };
    cache.set(key, { at: Date.now(), call });
    log(`${key}: ${call.wait ? "WAIT" : "buy"} — ${call.reason} (${count} headlines)`);
    return call;
  } catch (e) {
    log(`${key}: check failed, buying on the Guard alone (${e instanceof Error ? e.message.slice(0, 160) : e})`);
    return null;
  }
}

// Self-check: `node --import tsx src/portir/judge.ts`
if (import.meta.url === `file://${process.argv[1]}`) {
  assert.deepEqual(parseCall('```json\n{"decision":"wait","reason":"Earnings tonight."}\n```'), { wait: true, reason: "Earnings tonight." });
  assert.deepEqual(parseCall('{"decision":"buy","reason":"Nothing unusual."}'), { wait: false, reason: "Nothing unusual." });
  assert.equal(parseCall('{"decision":"maybe"}'), null);
  assert.equal(parseCall("no json"), null);
  assert.deepEqual(parseCall('Format: {"decision":"buy"|"wait","reason":"..."}\nThinking...\n{"decision":"wait","reason":"Delivery report Thursday."}'), { wait: true, reason: "Delivery report Thursday." });
  console.log("judge ok");
}
