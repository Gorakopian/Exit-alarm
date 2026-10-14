// Telegram voice calls. Bots can't call people, so this uses CallMeBot (callmebot.com), which rings
// the user's Telegram and reads the text out loud. Each user must first send /start to @CallMeBot_txtbot.
// CallMeBot is free and donation-funded for personal use: ask them before using it for many users.
// To use another provider later, replace callUser() and keep the same signature.

export const CALL_MIN_GAP = 180; // seconds between two calls to the same person

/** Text for the call: short, no symbols, max 256 characters. Pure. */
export function callText(e) {
  const verb = e.side === "buy" ? "is buying" : "is selling";
  const size = e.sol ? ` ${Math.round(e.sol)} SOL.` : "";
  return `Exit alarm! ${e.n} ${verb} ${String(e.sym || "a coin").replace(/[^a-z0-9 ]/gi, "")}.${size} Check Telegram now.`.slice(0, 250);
}

export async function callUser(target, text, env = process.env) {
  if (!target) throw new Error("no_call_target");
  const url = new URL("https://api.callmebot.com/start.php");
  url.searchParams.set("user", target);
  url.searchParams.set("text", text);
  url.searchParams.set("lang", env.CALL_VOICE || "en-GB-Standard-B");
  url.searchParams.set("rpt", "2");
  if (env.CALLMEBOT_APIKEY) url.searchParams.set("apikey", env.CALLMEBOT_APIKEY);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 8000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    const body = (await res.text().catch(() => "")).slice(0, 300);
    if (!res.ok || /error|not authori|not allowed|invalid/i.test(body)) throw new Error(`call_failed: ${body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 140)}`);
    return true;
  } finally {
    clearTimeout(timer);
  }
}
