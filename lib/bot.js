// What the bot does with each message or button tap.
import { send, tg, esc } from "./telegram.js";
import { TRADERS, TRADER_BY_ID } from "./traders.js";
import { getUser, saveUser, follow, unfollow, findTraders, STARS, isStar, effectiveMode } from "./users.js";
import { callUser, CALL_MIN_GAP } from "./caller.js";

const isAddress = (s) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || ""));
const tname = (id) => { const t = TRADER_BY_ID[id]; return t ? `${isStar(id) ? "★ " : ""}${t.name}${t.x ? ` (@${t.x})` : ""}` : id.slice(0, 6); };

const MAIN_BUTTONS = {
  inline_keyboard: [
    [{ text: "⭐ Follow all 20 stars", callback_data: "stars" }],
    [{ text: "📋 All traders", callback_data: "traders" }, { text: "⚙️ My settings", callback_data: "list" }],
    [{ text: "📞 Turn on calls", callback_data: "callon" }],
  ],
};

const HELP = `<b>🚨 EXIT ALARM</b>
Know the second a famous trader dumps. Get a message, and a <b>Telegram call</b> if you want.

<b>Follow traders</b>
/stars follows the 20 most famous (Ansem, Frank, Cupsey, Orangie…)
/follow cupsey or /follow @Cupseyy
/unfollow cupsey · /traders shows all 100

<b>Only coins you hold</b> (recommended)
/wallet &lt;your Solana address&gt; and you only get alarms when they sell a coin <i>you</i> hold.
/wallet off to go back to all their sells.

<b>Calls</b>
1. Open @CallMeBot_txtbot and press Start (once, lets it call you)
2. Make sure you have a Telegram username
3. /call on, then /call test

<b>More</b>
/buys on: also alarm on buys · /min 2: ignore trades under 2 SOL · /list: your settings

Just for fun and information, not financial advice.`;

function settingsText(u) {
  const mode = effectiveMode(u);
  const lines = [
    `<b>Your Exit Alarm</b>`,
    `Following: ${u.follows.length ? u.follows.map((id) => esc(tname(id))).join(", ") : "nobody yet (try /stars)"}`,
    `Wallet: ${u.wallet ? `<code>${esc(u.wallet.slice(0, 4))}…${esc(u.wallet.slice(-4))}</code>` : "not linked"}`,
    `Alarms: ${mode === "holding" ? "only sells of coins you hold" : "every sell"}${u.buys ? " + buys" : ""}${u.minSol ? `, min ${u.minSol} SOL` : ""}`,
    `Calls: ${u.call?.on ? `on (${esc(u.call.user)})` : "off"}`,
  ];
  return lines.join("\n");
}

async function reply(u, text, extra) { return send(u.chatId, text, extra); }

export async function handleCommand(u, text) {
  const [cmdRaw, ...rest] = String(text || "").trim().split(/\s+/);
  const cmd = cmdRaw.toLowerCase().replace(/@.*$/, "");
  const arg = rest.join(" ").trim();

  switch (cmd) {
    case "/start":
    case "/help":
      await saveUser(u);
      return reply(u, HELP, { reply_markup: MAIN_BUTTONS });

    case "/stars": {
      const added = await follow(u, STARS.map((t) => t.id));
      return reply(u, added.length ? `⭐ Now following ${added.length} stars. You'll hear it when they dump.\nTip: /wallet &lt;address&gt; to only get alarms for coins you hold.` : "You already follow all the stars.");
    }

    case "/follow":
    case "/unfollow": {
      if (!arg) return reply(u, `Who? Example: <code>${cmd} cupsey</code>. /traders shows everyone.`);
      const found = findTraders(arg);
      if (!found.length) return reply(u, `No trader called "${esc(arg)}". /traders shows all 100.`);
      if (found.length > 1 && found.length <= 8) {
        return reply(u, `Which one?`, { reply_markup: { inline_keyboard: found.map((t) => [{ text: tname(t.id), callback_data: `${cmd === "/follow" ? "f" : "u"}:${t.id}` }]) } });
      }
      if (found.length > 8) return reply(u, `Too many matches for "${esc(arg)}". Be more specific.`);
      const ids = [found[0].id];
      if (cmd === "/follow") {
        const added = await follow(u, ids);
        return reply(u, added.length ? `✅ Following ${esc(tname(ids[0]))}.` : `You already follow ${esc(tname(ids[0]))}.`);
      }
      const removed = await unfollow(u, ids);
      return reply(u, removed.length ? `Stopped following ${esc(tname(ids[0]))}.` : `You weren't following ${esc(tname(ids[0]))}.`);
    }

    case "/list":
      return reply(u, settingsText(u), {
        reply_markup: u.follows.length ? { inline_keyboard: u.follows.slice(0, 30).map((id) => [{ text: `✖ ${tname(id)}`, callback_data: `u:${id}` }]) } : undefined,
      });

    case "/traders": {
      const lines = TRADERS.map((t, i) => `${i + 1}. ${esc(tname(t.id))}`);
      for (let i = 0; i < lines.length; i += 50) await reply(u, (i === 0 ? "<b>All traders</b> (★ = star)\nFollow with /follow name\n\n" : "") + lines.slice(i, i + 50).join("\n"));
      return;
    }

    case "/wallet": {
      if (/^off$/i.test(arg)) { u.wallet = null; await saveUser(u); return reply(u, "Wallet unlinked. You'll get every sell from traders you follow."); }
      if (!isAddress(arg)) return reply(u, "Send your Solana wallet address, like:\n<code>/wallet 7xKX…</code>\nOnly the public address. Never your seed phrase or private key.");
      u.wallet = arg; u.mode = "auto"; await saveUser(u);
      return reply(u, "🔗 Wallet linked. From now on you only get an alarm when a trader you follow sells a coin <b>you</b> hold.\n<code>/wallet off</code> to undo.");
    }

    case "/mode": {
      if (!/^(all|holding)$/i.test(arg)) return reply(u, "Use <code>/mode all</code> (every sell) or <code>/mode holding</code> (only coins you hold).");
      if (/holding/i.test(arg) && !u.wallet) return reply(u, "Link your wallet first: <code>/wallet &lt;address&gt;</code>");
      u.mode = arg.toLowerCase(); await saveUser(u);
      return reply(u, `Mode: ${u.mode === "all" ? "every sell" : "only coins you hold"}.`);
    }

    case "/buys":
      u.buys = /^on$/i.test(arg); await saveUser(u);
      return reply(u, u.buys ? "Buys are on: you'll also hear when they ape in." : "Buys off: only sells.");

    case "/min": {
      const n = Number(String(arg).replace(",", "."));
      if (!(n >= 0) || n > 10000) return reply(u, "Example: <code>/min 2</code> ignores trades under 2 SOL. <code>/min 0</code> for everything.");
      u.minSol = n; await saveUser(u);
      return reply(u, n ? `Ignoring trades under ${n} SOL.` : "Showing trades of every size.");
    }

    case "/call": {
      const a = arg.toLowerCase();
      if (a === "off") { u.call = { on: false, user: u.call?.user || null }; await saveUser(u); return reply(u, "Calls off. You'll still get messages."); }
      const target = a.startsWith("+") ? arg.replace(/[^\d+]/g, "") : u.username ? "@" + u.username : null;
      if (a === "on" || a.startsWith("+")) {
        if (!target) return reply(u, "You need a Telegram username for calls (Settings → Username), or use your number: <code>/call +32470123456</code>");
        u.call = { on: true, user: target }; await saveUser(u);
        return reply(u, `📞 Calls on for ${esc(target)}.\nImportant: open @CallMeBot_txtbot and press <b>Start</b> once, otherwise the call can't reach you. Then try <code>/call test</code>.`);
      }
      if (a === "test") {
        if (!u.call?.on) return reply(u, "Turn calls on first: <code>/call on</code>");
        const now = Math.floor(Date.now() / 1000);
        if (now - (u.lastCallAt || 0) < 60) return reply(u, "Give it a minute before the next test call.");
        try {
          u.lastCallAt = now; await saveUser(u);
          await callUser(u.call.user, "This is your Exit Alarm test call. When a famous trader dumps, I will call you like this.");
          return reply(u, "📞 Calling you now on Telegram…");
        } catch (e) {
          return reply(u, `The call didn't go through (${esc(String(e.message).slice(0, 120))}).\nDid you press Start in @CallMeBot_txtbot? In Telegram → Privacy → Calls, allow calls from everybody or add it to contacts.`);
        }
      }
      return reply(u, "Use <code>/call on</code>, <code>/call off</code> or <code>/call test</code>.");
    }

    default:
      if (cmd.startsWith("/")) return reply(u, "I don't know that one. /help shows everything.");
      // Plain text: treat as a trader search
      const found = findTraders(text).slice(0, 8);
      if (found.length) return reply(u, "Follow one of these?", { reply_markup: { inline_keyboard: found.map((t) => [{ text: `➕ ${tname(t.id)}`, callback_data: `f:${t.id}` }]) } });
      return reply(u, "Send /help to see what I can do.");
  }
}

export async function handleUpdate(update) {
  if (update.callback_query) {
    const q = update.callback_query;
    const chatId = q.message?.chat?.id;
    if (!chatId) return;
    const u = await getUser(chatId, q.from?.username);
    const data = String(q.data || "");
    tg("answerCallbackQuery", { callback_query_id: q.id }).catch(() => {});
    if (data === "stars") return handleCommand(u, "/stars");
    if (data === "traders") return handleCommand(u, "/traders");
    if (data === "list") return handleCommand(u, "/list");
    if (data === "callon") return handleCommand(u, "/call on");
    if (data.startsWith("f:")) { const id = data.slice(2); await follow(u, [id]); return reply(u, `✅ Following ${esc(tname(id))}.`); }
    if (data.startsWith("u:")) { const id = data.slice(2); await unfollow(u, [id]); return reply(u, `Stopped following ${esc(tname(id))}.`); }
    return;
  }
  const m = update.message;
  if (!m?.chat?.id || m.chat.type !== "private" || typeof m.text !== "string") return;
  const u = await getUser(m.chat.id, m.from?.username);
  return handleCommand(u, m.text);
}

export { settingsText, CALL_MIN_GAP };
