// POST /api/hook ← the radio passes on every new trade here (with the shared secret).
import { redis } from "../lib/redis.js";
import { processEvents } from "../lib/alarm.js";
import { readBody, send } from "../lib/http.js";

export default async function handler(req, res) {
  if (req.method !== "POST") return send(res, 405, { error: "Use POST." });
  const inbox = JSON.parse((await redis("GET", "alarm:inbox")) || "{}");
  const got = req.headers?.["x-alarm-secret"] || "";
  if (!inbox.secret || got !== inbox.secret) return send(res, 401, { error: "unauthorized" });
  try {
    const body = await readBody(req);
    const events = Array.isArray(body) ? body : body?.events || [];
    return send(res, 200, { ok: true, ...(await processEvents(events)) });
  } catch {
    return send(res, 200, { ok: false });
  }
}
