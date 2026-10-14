// Players' settings and who follows whom, in the shared database (all keys start with "alarm:").
import { redis, getJSON, setJSON } from "./redis.js";
import { TRADERS, TRADER_BY_ID } from "./traders.js";
import { syncWebhook, customWallets } from "./webhook.js";

export const STAR_COUNT = 20;
export const STARS = TRADERS.slice(0, STAR_COUNT);
const RANK = Object.fromEntries(TRADERS.map((t, i) => [t.id, i]));
export const isStar = (id) => (RANK[id] ?? 999) < STAR_COUNT;

const key = (chatId) => `alarm:user:${chatId}`;

export const MAX_CUSTOM = 3;        // own wallets per user
export const MAX_CUSTOM_ALL = 300;  // own wallets in total (each costs Helius credits)
export const isCustom = (id) => !TRADER_BY_ID[id];
export const customOf = (u) => (u.follows || []).filter(isCustom);
/** Display name for a trader or an added wallet. Pure. */
export const nameFor = (u, id) => TRADER_BY_ID[id]?.name || u?.names?.[id] || `${id.slice(0, 4)}…${id.slice(-4)}`;

export function newUser(chatId, username) {
  return { chatId, username: username || null, follows: [], names: {}, wallet: null, mode: "auto", buys: false, minSol: 0, call: { on: false, user: null }, lastCallAt: 0, createdAt: Math.floor(Date.now() / 1000) };
}

export async function getUser(chatId, username) {
  const u = (await getJSON(key(chatId))) || newUser(chatId, username);
  if (username && u.username !== username) u.username = username;
  u.names ||= {};
  return u;
}
export const saveUser = (u) => setJSON(key(u.chatId), u);

export async function follow(u, traderIds) {
  const added = [];
  for (const id of traderIds) {
    if (!TRADER_BY_ID[id] || u.follows.includes(id)) continue;
    u.follows.push(id);
    await redis("HSET", `alarm:followers:${id}`, String(u.chatId), "1");
    added.push(id);
  }
  await saveUser(u);
  return added;
}

export async function unfollow(u, traderIds) {
  const removed = [];
  let unwatched = false;
  for (const id of traderIds) {
    if (!u.follows.includes(id)) continue;
    u.follows = u.follows.filter((x) => x !== id);
    await redis("HDEL", `alarm:followers:${id}`, String(u.chatId));
    if (isCustom(id)) {
      delete u.names[id];
      if (!(await followers(id)).length) { await redis("HDEL", "alarm:wallets", id); unwatched = true; }
    }
    removed.push(id);
  }
  await saveUser(u);
  if (unwatched) await syncWebhook().catch(() => {});
  return removed;
}

/** Watch any Solana wallet. Returns { ok } or { ok:false, why }. */
export async function addCustom(u, addr, name) {
  if (TRADER_BY_ID[addr]) { await follow(u, [addr]); return { ok: true, trader: true }; }
  const label = String(name || "").replace(/[<>&]/g, "").trim().slice(0, 24);
  if (u.follows.includes(addr)) { if (label) { u.names[addr] = label; await saveUser(u); } return { ok: true, already: true }; }
  if (customOf(u).length >= MAX_CUSTOM) return { ok: false, why: "max_user" };
  const known = (await redis("HGET", "alarm:wallets", addr)) != null;
  if (!known && (await customWallets()).length >= MAX_CUSTOM_ALL) return { ok: false, why: "max_all" };
  u.follows.push(addr);
  u.names[addr] = label || `${addr.slice(0, 4)}…${addr.slice(-4)}`;
  await redis("HSET", `alarm:followers:${addr}`, String(u.chatId), "1");
  await saveUser(u);
  if (!known) {
    await redis("HSET", "alarm:wallets", addr, String(Math.floor(Date.now() / 1000)));
    const r = await syncWebhook().catch((e) => ({ ok: false, why: String(e.message || e) }));
    if (!r.ok) return { ok: true, pending: true };
  }
  return { ok: true };
}

/** Find one of the user's added wallets by nickname or address. Pure. */
export function findCustom(u, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return null;
  return customOf(u).find((a) => a.toLowerCase() === q || String(u.names?.[a] || "").toLowerCase() === q) || null;
}

export async function followers(traderId) {
  const flat = (await redis("HGETALL", `alarm:followers:${traderId}`)) || [];
  const ids = [];
  for (let i = 0; i < flat.length; i += 2) ids.push(flat[i]);
  return ids;
}

/** Find traders by name or X handle. Exact match wins, otherwise "contains". Pure. */
export function findTraders(query) {
  const q = String(query || "").trim().replace(/^@/, "").toLowerCase();
  if (!q) return [];
  const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const nq = norm(q);
  const exact = TRADERS.filter((t) => norm(t.name) === nq || norm(t.x) === nq || t.id.toLowerCase() === q);
  if (exact.length) return exact;
  return TRADERS.filter((t) => (nq && (norm(t.name).includes(nq) || norm(t.x).includes(nq))));
}

/** Which mode applies: with a linked wallet "holding" (only coins you hold), otherwise "all". */
export const effectiveMode = (u) => (u.mode === "all" || u.mode === "holding" ? u.mode : u.wallet ? "holding" : "all");
