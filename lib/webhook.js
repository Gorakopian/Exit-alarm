// Keeps the radio's Helius webhook watching the 100 traders + every wallet users added with /add.
// The radio owns the webhook (radio:hookId / radio:hookAuth in the shared database); we only update its address list.
import { redis } from "./redis.js";
import { TRADERS } from "./traders.js";

const HELIUS_HOSTS = ["https://api-mainnet.helius-rpc.com", "https://api.helius.xyz"];

async function heliusApi(path, apiKey, init) {
  let last;
  for (const host of HELIUS_HOSTS) {
    try {
      const res = await fetch(`${host}/v0/${path}?api-key=${apiKey}`, init);
      if (res.ok) return res.json();
      last = new Error(`helius_${res.status}`);
      if (res.status === 401 || res.status === 403 || res.status === 404) break;
    } catch (e) { last = e; }
  }
  throw last;
}

export async function customWallets() {
  const flat = (await redis("HGETALL", "alarm:wallets")) || [];
  const out = [];
  for (let i = 0; i < flat.length; i += 2) out.push(flat[i]);
  return out;
}

/** Make the webhook's address list = traders + added wallets. Costs Helius credits only when it changes. */
export async function syncWebhook(env = process.env) {
  const key = env.HELIUS_API_KEY;
  const [id, auth] = await Promise.all([redis("GET", "radio:hookId"), redis("GET", "radio:hookAuth")]);
  if (!key || !id || !auth) return { ok: false, why: "radio_not_live" };
  const hook = await heliusApi(`webhooks/${id}`, key);
  const want = [...new Set([...TRADERS.map((t) => t.id), ...(await customWallets())])];
  const have = new Set(hook.accountAddresses || []);
  if (want.length === have.size && want.every((a) => have.has(a))) return { ok: true, changed: false };
  await heliusApi(`webhooks/${id}`, key, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      webhookURL: hook.webhookURL,
      transactionTypes: hook.transactionTypes || ["ANY"],
      accountAddresses: want,
      webhookType: hook.webhookType || "enhanced",
      authHeader: auth, // must stay what the radio checks
    }),
  });
  return { ok: true, changed: true, count: want.length };
}
