// GET /api/setup → connects everything (the landing page calls this on every visit; cheap when nothing changed):
//  - points the Telegram bot at https://<this site>/api/telegram and sets its command menu
//  - tells the radio (through the shared database) where to pass on trades
// Returns the bot's username for the "Open in Telegram" button.
import { randomBytes } from "node:crypto";
import { tg, hasBot, webhookSecret, COMMANDS } from "../lib/telegram.js";
import { redis, getJSON, setJSON, hasDatabase } from "../lib/redis.js";
import { send } from "../lib/http.js";

export default async function handler(req, res) {
  if (!hasDatabase() && process.env.VERCEL) {
    const dbVars = Object.keys(process.env).filter((k) => /KV|REDIS|UPSTASH/i.test(k));
    return send(res, 200, { ready: false, problem: "no_database", seen: dbVars });
  }
  if (!hasBot()) return send(res, 200, { ready: false, problem: "no_bot_token" });
  const host = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "").split(",")[0].trim();
  const oneOff = /-[a-z0-9]{9}-[a-z0-9-]+\.vercel\.app$/i.test(host);
  try {
    let bot = await getJSON("alarm:bot");
    const stale = !bot || Date.now() / 1000 - (bot.at || 0) > 6 * 3600;
    if (!oneOff && host && !/localhost/.test(host) && (stale || bot.host !== host)) {
      const me = await tg("getMe");
      await tg("setWebhook", { url: `https://${host}/api/telegram`, secret_token: webhookSecret(), allowed_updates: ["message", "callback_query"] });
      await tg("setMyCommands", { commands: COMMANDS });
      await tg("setMyDescription", { description: "Exit Alarm: get a message and a Telegram call the second a famous memecoin trader dumps a coin you hold." }).catch(() => {});
      const inbox = (await getJSON("alarm:inbox")) || {};
      await setJSON("alarm:inbox", { url: `https://${host}/api/hook`, secret: inbox.secret || randomBytes(18).toString("hex") });
      bot = { username: me.username, host, at: Math.floor(Date.now() / 1000) };
      await setJSON("alarm:bot", bot);
    }
    const radioSeen = await redis("GET", "radio:hookId");
    return send(res, 200, { ready: !!bot, bot: bot?.username || null, radio: !!radioSeen });
  } catch (e) {
    return send(res, 200, { ready: false, problem: String(e.message || e).slice(0, 160) });
  }
}
