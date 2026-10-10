/**
 * Telegram reports: what the agent bought, held back, sold or rescued, sent to the owner's chat.
 * Linking: the app opens t.me/<bot>?start=<wallet address>; the bot stores chat ↔ address here.
 * Off (every call a no-op) until TELEGRAM_BOT_TOKEN is set.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const TOKEN = () => process.env.TELEGRAM_BOT_TOKEN;
// ponytail: one JSON file on the agent host; move to a KV store when the agent runs as more than one process.
const STORE = resolve(process.env.PORTIR_TELEGRAM_STORE ?? "../../.studio/telegram-links.json");
const log = (msg: string) => console.log(`[portir.telegram] ${msg}`);

type Links = Record<string, number[]>; // lowercased address → chat ids
const load = (): Links => (existsSync(STORE) ? (JSON.parse(readFileSync(STORE, "utf8")) as Links) : {});
const save = (l: Links) => writeFileSync(STORE, JSON.stringify(l, null, 2));

async function api(method: string, body: object) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN()}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(40_000) });
  const json = (await res.json()) as { ok: boolean; result?: unknown; description?: string };
  if (!json.ok) throw new Error(`${method}: ${json.description}`);
  return json.result;
}

const send = (chat: number, text: string) => api("sendMessage", { chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true });

/** Tell every chat linked to `owner`. Never throws: a report must not break a trade. */
export async function notify(owner: string, text: string): Promise<void> {
  if (!TOKEN()) return;
  const chats = load()[owner.toLowerCase()] ?? [];
  await Promise.all(chats.map((c) => send(c, text).catch((e) => log(`send to ${c} failed: ${e instanceof Error ? e.message : e}`))));
}

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

// ponytail: anyone can link any address. They only see what is already public on-chain; add a signed link if that changes.
async function handle(chat: number, text: string) {
  const links = load();
  const [cmd, arg] = text.trim().split(/\s+/);
  if (cmd === "/start" && arg && /^0x[0-9a-fA-F]{40}$/.test(arg)) {
    const key = arg.toLowerCase();
    links[key] = [...new Set([...(links[key] ?? []), chat])];
    save(links);
    return send(chat, `Linked to <b>${short(arg)}</b>. You will hear from me when I buy, hold a buy back because of news, sell, or rescue your loan.\n\nSend /stop to unlink.`);
  }
  if (cmd === "/stop") {
    for (const k of Object.keys(links)) links[k] = links[k].filter((c) => c !== chat);
    save(links);
    return send(chat, "Unlinked. No more reports.");
  }
  return send(chat, "Open Portir → Profile → Telegram alerts to link your wallet.");
}

/** Long-poll the bot for /start and /stop. */
export function startTelegramLoop(): void {
  if (!TOKEN()) {
    log("TELEGRAM_BOT_TOKEN not set; reports off");
    return;
  }
  // A second agent on the same bot (the mainnet executor) only sends; one getUpdates poller per bot token.
  if (process.env.PORTIR_TELEGRAM_POLL === "off") return;
  let offset = 0;
  const loop = async () => {
    for (;;) {
      try {
        const updates = (await api("getUpdates", { offset, timeout: 30, allowed_updates: ["message"] })) as { update_id: number; message?: { chat: { id: number }; text?: string } }[];
        for (const u of updates) {
          offset = u.update_id + 1;
          if (u.message?.text) await handle(u.message.chat.id, u.message.text).catch((e) => log(`reply failed: ${e instanceof Error ? e.message : e}`));
        }
      } catch (e) {
        log(`poll failed: ${e instanceof Error ? e.message : e}`);
        await new Promise((r) => setTimeout(r, 10_000));
      }
    }
  };
  log("listening for /start links");
  void loop();
}
