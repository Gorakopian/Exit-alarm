// Run with: node test/alarm.test.js  — fake Telegram, CallMeBot and Helius
import assert from "node:assert/strict";
import { Readable } from "node:stream";

process.env.TELEGRAM_BOT_TOKEN = "123:TEST";
process.env.HELIUS_API_KEY = "H";
const { TRADERS } = await import("../lib/traders.js");
const { findTraders, getUser } = await import("../lib/users.js");
const { handleUpdate } = await import("../lib/bot.js");
const { processEvents, alarmText, wants } = await import("../lib/alarm.js");
const { callText } = await import("../lib/caller.js");
const { redis } = await import("../lib/redis.js");

// ---- fake network ----
const sent = [], calls = [];
let holding = true;
globalThis.fetch = async (url, init = {}) => {
  const u = String(url);
  const body = init.body ? JSON.parse(init.body) : null;
  const ok = (result) => ({ ok: true, status: 200, json: async () => ({ ok: true, result }), text: async () => "" });
  if (u.includes("api.telegram.org")) {
    const method = u.split("/").pop();
    if (method === "sendMessage") sent.push(body);
    if (method === "getMe") return ok({ username: "ExitAlarmTestBot" });
    return ok(true);
  }
  if (u.includes("callmebot")) { calls.push(new URL(u)); return { ok: true, status: 200, text: async () => "Call sent" }; }
  if (u.includes("helius")) return { ok: true, json: async () => ({ result: { value: holding ? [{ account: { data: { parsed: { info: { tokenAmount: { uiAmount: 5 } } } } } }] : [] } }) };
  throw new Error("unexpected fetch " + u);
};
const say = (text, chatId = 42, username = "degenfan") => handleUpdate({ message: { chat: { id: chatId, type: "private" }, from: { username }, text } });

// Finding traders
const cupsey = TRADERS.find((t) => t.name === "Cupsey");
assert.equal(findTraders("cupsey")[0].id, cupsey.id);
assert.equal(findTraders("@Cupseyy")[0].id, cupsey.id);
assert.equal(findTraders("zzzz").length, 0);

// Commands
await say("/start");
assert.match(sent.at(-1).text, /EXIT ALARM/);
await say("/stars");
let u = await getUser(42);
assert.equal(u.follows.length, 20);
await say("/unfollow cupsey");
assert.equal((await getUser(42)).follows.includes(cupsey.id), false);
await say("/follow cupsey");
assert.ok((await getUser(42)).follows.includes(cupsey.id));
await say("/wallet nonsense");
assert.match(sent.at(-1).text, /Never your seed phrase/);
await say("/wallet 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
await say("/call on");
u = await getUser(42);
assert.deepEqual([u.wallet.slice(0, 4), u.call.on, u.call.user], ["7xKX", true, "@degenfan"]);
await say("/list");
assert.match(sent.at(-1).text, /only sells of coins you hold/);

// Alarm: a sell of a coin the user holds → message + call
const ev = { id: "SIGabc:2fg5QD", ts: 1, t: cupsey.id, n: "Cupsey", side: "sell", mint: "MintXYZ", sym: "GOBLIN", sol: 12.4, mcap: 450000 };
assert.ok(wants(u, ev));
assert.match(alarmText(ev, { holding: true }), /EXIT ALARM[\s\S]*Cupsey[\s\S]*GOBLIN[\s\S]*You hold this coin/);
assert.equal(callText(ev), "Exit alarm! Cupsey is selling GOBLIN. 12 SOL. Check Telegram now.");
const before = sent.length;
let r = await processEvents([ev]);
assert.deepEqual([r.messages, r.calls], [1, 1]);
assert.equal(calls.at(-1).searchParams.get("user"), "@degenfan");
assert.match(sent[before].text, /EXIT ALARM/);
// Same trade again (Helius retry) → nothing
r = await processEvents([ev]);
assert.equal(r.messages, 0);
// Not holding → no alarm in holding mode
holding = false;
await redis("DEL", `alarm:hold:${u.wallet}:MintNEW`);
r = await processEvents([{ ...ev, id: "SIGdef:x", mint: "MintNEW" }]);
assert.equal(r.messages, 0);
// Buys are off by default
r = await processEvents([{ ...ev, id: "SIGbuy:x", side: "buy" }]);
assert.equal(r.messages, 0);
// Second sell within 3 minutes: message yes, call no
holding = true;
await say("/wallet off");
r = await processEvents([{ ...ev, id: "SIGghi:x", mint: "MintOTHER" }]);
assert.deepEqual([r.messages, r.calls], [1, 0]);

// Hook endpoint needs the secret the setup leaves in the database
await redis("SET", "alarm:inbox", JSON.stringify({ url: "https://x/api/hook", secret: "s3cret" }));
const { default: hook } = await import("../api/hook.js");
const call = (headers, body) => new Promise((resolve) => {
  const req = Readable.from([Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method: "POST", url: "/api/hook", headers });
  hook(req, { statusCode: 200, setHeader() {}, end(x) { resolve({ status: this.statusCode, body: JSON.parse(x) }); } });
});
assert.equal((await call({}, [ev])).status, 401);
const okRes = await call({ "x-alarm-secret": "s3cret" }, [{ ...ev, id: "SIGjkl:x" }]);
assert.equal(okRes.status, 200);
assert.equal(okRes.body.messages, 1);

// Telegram endpoint rejects updates without Telegram's secret header
const { default: tgHook } = await import("../api/telegram.js");
const tcall = (headers) => new Promise((resolve) => {
  const req = Readable.from([Buffer.from(JSON.stringify({ message: { chat: { id: 1, type: "private" }, text: "/start" } }))]);
  Object.assign(req, { method: "POST", url: "/api/telegram", headers });
  tgHook(req, { statusCode: 200, setHeader() {}, end(x) { resolve(this.statusCode); } });
});
assert.equal(await tcall({}), 401);
console.log("alarm OK");
