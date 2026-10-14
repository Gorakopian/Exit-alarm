// Talking to Telegram's Bot API. The bot token comes from @BotFather (TELEGRAM_BOT_TOKEN).
import { createHash } from "node:crypto";

const token = () => process.env.TELEGRAM_BOT_TOKEN || "";
export const hasBot = () => Boolean(token());

/** Secret Telegram sends back with every update, so nobody else can post fake updates. */
export const webhookSecret = () => createHash("sha256").update("exit-alarm:" + token()).digest("hex").slice(0, 48);

export async function tg(method, body) {
  if (!token()) throw new Error("no_bot_token");
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!j.ok) throw new Error(`tg_${method}: ${j.description || res.status}`);
  return j.result;
}

export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function send(chatId, html, extra = {}) {
  return tg("sendMessage", { chat_id: chatId, text: html, parse_mode: "HTML", disable_web_page_preview: true, ...extra });
}

export const COMMANDS = [
  { command: "stars", description: "Follow all 20 famous traders" },
  { command: "follow", description: "Follow a trader: /follow cupsey" },
  { command: "unfollow", description: "Stop following: /unfollow cupsey" },
  { command: "add", description: "Watch any wallet: /add <address> nickname" },
  { command: "remove", description: "Stop watching a wallet you added" },
  { command: "list", description: "Who you follow and your settings" },
  { command: "traders", description: "All 100 traders you can follow" },
  { command: "wallet", description: "Only alarm on coins you hold: /wallet <address>" },
  { command: "call", description: "Get a Telegram call: /call on, /call off, /call test" },
  { command: "buys", description: "Also alarm on buys: /buys on" },
  { command: "min", description: "Ignore small trades: /min 2 (SOL)" },
  { command: "help", description: "How it works" },
];
