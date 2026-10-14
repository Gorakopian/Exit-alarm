// Turns incoming trades into alarms for the people who follow those traders.
import { redis } from "./redis.js";
import { send, esc } from "./telegram.js";
import { TRADER_BY_ID } from "./traders.js";
import { getUser, saveUser, followers, isStar, effectiveMode } from "./users.js";
import { holds } from "./holdings.js";
import { callUser, callText, CALL_MIN_GAP } from "./caller.js";

const fmtUsd = (n) => (n == null ? null : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}k` : `$${Math.round(n)}`);

/** The alarm message. Pure. */
export function alarmText(e, { holding } = {}) {
  const t = TRADER_BY_ID[e.t] || {};
  const star = isStar(e.t) ? "★ " : "";
  const head = e.side === "sell" ? "🚨 <b>EXIT ALARM</b>" : "🟢 <b>APE ALERT</b>";
  const verb = e.side === "sell" ? "SOLD" : "BOUGHT";
  const sig = String(e.id || "").split(":")[0];
  const links = [
    e.mint && !e.mint.startsWith("demo-") ? `<a href="https://dexscreener.com/solana/${esc(e.mint)}">Chart</a>` : null,
    sig && !sig.startsWith("demo") ? `<a href="https://solscan.io/tx/${esc(sig)}">Transaction</a>` : null,
    t.x ? `<a href="https://x.com/${esc(t.x)}">@${esc(t.x)}</a>` : null,
  ].filter(Boolean).join(" · ");
  return [
    head,
    `${star}<b>${esc(e.n)}</b> just ${verb} <b>$${esc(e.sym)}</b>`,
    `💰 ${e.sol ?? "?"} SOL${e.mcap ? ` · mcap ${fmtUsd(e.mcap)}` : ""}`,
    holding ? "⚠️ <b>You hold this coin.</b>" : null,
    links,
  ].filter(Boolean).join("\n");
}

/** Should this user hear about this trade? (wallet check happens after). Pure. */
export function wants(u, e) {
  if (!u.follows?.includes(e.t)) return false;
  if (e.side === "buy" && !u.buys) return false;
  if (u.minSol && (e.sol || 0) < u.minSol) return false;
  return true;
}

/**
 * Handle a batch of trades. For each follower: filter, check holdings if their mode needs it,
 * send the message, and call them (at most once every 3 minutes).
 */
export async function processEvents(events, env = process.env) {
  const sent = { messages: 0, calls: 0, errors: 0 };
  for (const e of events) {
    if (!e?.t || !e.side) continue;
    // never alarm twice for the same trade (Helius can retry)
    if ((await redis("SET", `alarm:seen:${e.id}`, "1", "NX", "EX", 3600)) !== "OK") continue;
    const chatIds = await followers(e.t);
    for (const chatId of chatIds) {
      try {
        const u = await getUser(chatId);
        if (!wants(u, e)) continue;
        let holding = false;
        if (u.wallet && e.side === "sell") holding = await holds(u.wallet, e.mint, env);
        if (effectiveMode(u) === "holding" && e.side === "sell" && !holding) continue;
        await send(chatId, alarmText(e, { holding }));
        sent.messages++;
        const now = Math.floor(Date.now() / 1000);
        const callWorthy = e.side === "sell" && (holding || effectiveMode(u) === "all");
        if (u.call?.on && callWorthy && now - (u.lastCallAt || 0) >= CALL_MIN_GAP) {
          u.lastCallAt = now;
          await saveUser(u);
          try { await callUser(u.call.user, callText(e), env); sent.calls++; }
          catch (err) { await send(chatId, `📞 Couldn't call you: ${esc(String(err.message).slice(0, 100))}. Check /call test.`).catch(() => {}); }
        }
      } catch (err) {
        sent.errors++;
        // user blocked the bot: stop sending to them
        if (/blocked|chat not found|deactivated/i.test(String(err.message))) await redis("HDEL", `alarm:followers:${e.t}`, String(chatId));
      }
    }
  }
  return sent;
}
