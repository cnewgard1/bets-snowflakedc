# bets.snowflakedc.com — watch-only Kalshi desk UI

**Watch-only** (no order placement). **No Kalshi private keys** on this host, Lovable, or GitHub.

## What works publicly
- **LIVE GAME** — browser fetches MLB Stats API + ESPN (`game-feed.js`, CORS `*`).
- **OPEN / CLOSED book** — empty unless optional read-only `bookProxy` (GET `/api/live-book` only). No trading on this domain.

## Local trading desk (keys stay here)
```bash
cd ~/Grok/kalshi-desk
# start Python/Node desk with kalshi.keys.local.json
# UI at http://127.0.0.1:<port> gets signed /api/live-book
```
Trading / order placement is **local desk only**, never on the public domain.

## Optional: show resting orders on the public watch UI (safe)
Never commit keys. Tunnel a **read-only** desk endpoint:

1. On the Mac desk, set `BOOK_READ_TOKEN` (random secret) and allow `GET /api/live-book` only with `Authorization: Bearer <token>`.
2. Expose via Cloudflare Tunnel / ngrok (HTTPS). Do **not** expose `POST /api/orders`.
3. Open the public UI once with:
   `?bookProxy=https://YOUR_TUNNEL&bookToken=YOUR_TOKEN`
   (stored in `localStorage`, stripped from the URL).

Without a proxy, the public site shows a clear empty-book message + live game data.

## DNS (critical)
`bets.snowflakedc.com` must **CNAME → `cnewgard1.github.io`** (GitHub Pages), **not** Lovable.
If DNS points at Lovable, you get a blank React shell with no game feed.

After DNS points at GitHub Pages, re-add a `CNAME` file containing `bets.snowflakedc.com`.

Interim URL: https://cnewgard1.github.io/bets-snowflakedc/

Session gate: `chris` / `chris` (UI only, not Kalshi auth).
