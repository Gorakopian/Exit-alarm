# Exit Alarm 🚨📞

Telegram bot that pings you, and **calls you on Telegram**, the moment a famous memecoin trader sells a coin you hold.

- Follow any of the 100 traders from Degen League / Degen Radio (or tap "Follow all 20 stars")
- Link your public wallet → you only get alarms for coins **you** hold
- `/call on` → a Telegram voice call through CallMeBot reads out the alarm (max 1 call per 3 minutes)

## How it gets trades
The Degen Radio Helius webhook already watches the 100 wallets. The radio forwards every new trade to
`https://<this site>/api/hook` (it finds the address + secret under `alarm:inbox` in the shared Upstash database).
So no second Helius webhook is needed.

## Setup (Vercel)
1. Create a bot with @BotFather → copy the token
2. New Vercel project from this repo
3. Storage → connect the **same** Upstash database as the radio
4. Env vars: `TELEGRAM_BOT_TOKEN`, `HELIUS_API_KEY` (optional: `CALL_VOICE`, `CALLMEBOT_APIKEY`)
5. Settings → Deployment Protection → turn off Vercel Authentication; add a domain like `exit-alarm-live.vercel.app`
6. Redeploy, then open the site once → it connects the bot to Telegram and the radio

## Bot commands
`/stars` `/follow <name>` `/unfollow <name>` `/list` `/traders` `/wallet <address|off>` `/mode` `/buys on|off` `/min <sol>` `/call on|off|test`

## Notes
- Calls use CallMeBot (free, donation-funded, meant for personal use). Each user must press Start in @CallMeBot_txtbot once. Ask CallMeBot before going big.
- Only public wallet addresses. Never a seed phrase.

## Dev
`npm test` · `node scripts/dev.js`
