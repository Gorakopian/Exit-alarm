// POST /api/telegram ← Telegram sends every message to the bot here.
import { webhookSecret } from "../lib/telegram.js";
import { handleUpdate } from "../lib/bot.js";
import { readBody, send } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  if ((req.headers?.["x-telegram-bot-api-secret-token"] || "") !== webhookSecret()) return send(res, 401, { error: "unauthorized" });
  try { await handleUpdate(await readBody(req)); } catch { /* always 200 so Telegram doesn't resend */ }
  return send(res, 200, { ok: true });
}
