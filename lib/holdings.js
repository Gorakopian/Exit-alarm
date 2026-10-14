// Does a wallet hold a coin right now? Asked through Helius, cached for 2 minutes.
import { redis } from "./redis.js";

export async function holds(wallet, mint, env = process.env) {
  if (!wallet || !mint || mint.startsWith("demo-")) return false;
  const key = `alarm:hold:${wallet}:${mint}`;
  const cached = await redis("GET", key);
  if (cached != null) return cached === "1";
  let has = false;
  try {
    const res = await fetch(`https://mainnet.helius-rpc.com/?api-key=${env.HELIUS_API_KEY}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner", params: [wallet, { mint }, { encoding: "jsonParsed" }] }),
    });
    const j = await res.json();
    has = (j?.result?.value || []).some((a) => Number(a?.account?.data?.parsed?.info?.tokenAmount?.uiAmount) > 0);
  } catch { has = false; }
  await redis("SET", key, has ? "1" : "0", "EX", 120);
  return has;
}
