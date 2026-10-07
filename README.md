# bets.snowflakedc.com — public Kalshi desk UI

Static UI only. **No Kalshi private keys** on this host, Lovable, or GitHub.

## What works publicly
- **LIVE GAME** — browser fetches MLB Stats API + ESPN (`game-feed.js`, CORS `*`).
- **OPEN / CLOSED book** — empty on public static hosts (no `/api/live-book` signing).

## Local trading desk (keys stay here)
```bash
cd ~/Grok/kalshi-desk
# start Python/Node desk with kalshi.keys.local.json
# UI at http://127.0.0.1:<port> gets signed /api/live-book
```

## Optional: show resting orders on the public UI (safe)
Never commit keys. Chris can tunnel a **read-only** desk endpoint:

1. On the Mac desk, set `BOOK_READ_TOKEN` (random secret) and allow `GET /api/live-book` only with `Authorization: Bearer <token>`.
2. Expose that host via Cloudflare Tunnel / ngrok (HTTPS).
3. Open the public UI once with:
   `?bookProxy=https://YOUR_TUNNEL&bookToken=YOUR_TOKEN`
   (values are stored in `localStorage` and stripped from the URL).

Without a proxy, the public site shows a clear empty-book message and live game data.

## DNS (critical)
`bets.snowflakedc.com` must **CNAME → `cnewgard1.github.io`** (GitHub Pages), **not** Lovable.
If DNS points at Lovable, you get a blank React shell with no game feed.

Interim URL while DNS is wrong: https://cnewgard1.github.io/bets-snowflakedc/

Session gate: `chris` / `chris` (UI only, not Kalshi auth).
