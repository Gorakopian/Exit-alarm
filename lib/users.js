// Players' settings and who follows whom, in the shared database (all keys start with "alarm:").
import { redis, getJSON, setJSON } from "./redis.js";
import { TRADERS, TRADER_BY_ID } from "./traders.js";

export const STAR_COUNT = 20;
export const STARS = TRADERS.slice(0, STAR_COUNT);
const RANK = Object.fromEntries(TRADERS.map((t, i) => [t.id, i]));
export const isStar = (id) => (RANK[id] ?? 999) < STAR_COUNT;

const key = (chatId) => `alarm:user:${chatId}`;

export function newUser(chatId, username) {
  return { chatId, username: username || null, follows: [], wallet: null, mode: "auto", buys: false, minSol: 0, call: { on: false, user: null }, lastCallAt: 0, createdAt: Math.floor(Date.now() / 1000) };
}

export async function getUser(chatId, username) {
  const u = (await getJSON(key(chatId))) || newUser(chatId, username);
  if (username && u.username !== username) u.username = username;
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
  for (const id of traderIds) {
    if (!u.follows.includes(id)) continue;
    u.follows = u.follows.filter((x) => x !== id);
    await redis("HDEL", `alarm:followers:${id}`, String(u.chatId));
    removed.push(id);
  }
  await saveUser(u);
  return removed;
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
