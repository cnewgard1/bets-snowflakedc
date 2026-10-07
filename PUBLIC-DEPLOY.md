# Public deploy notes — bets.snowflakedc.com

## Root cause of blank data (2026-10-06)
- DNS `bets.snowflakedc.com` → Lovable (`185.158.133.1` / `lovable-app-*.p.l5e.io`).
- Lovable shell has title/meta only — **no** `game-feed.js`, **no** `/api/live-book`.
- Working static desk lives in GitHub Pages repo `cnewgard1/bets-snowflakedc`.
- GitHub Pages CNAME was redirecting `cnewgard1.github.io/bets-snowflakedc/` → custom domain (Lovable), so the good build was unreachable.

## Fix
1. Squarespace Domains / Cloudflare DNS / Google Cloud DNS:
   - `bets` **CNAME** → `cnewgard1.github.io`
   - Remove Lovable A/CNAME for `bets`.
2. Keep `CNAME` file `bets.snowflakedc.com` in this repo (re-add after interim github.io testing).
3. Hard-refresh https://bets.snowflakedc.com — expect LIVE GAME (MIL@SD) + empty OPEN book message.

## Security
- Never put `kalshi.keys*` or private PEM in Lovable, GitHub, or Pages.
- Signed Kalshi calls stay on `~/Grok/kalshi-desk`.
- Optional public book: authenticated read-only proxy + tunnel (see README / DESK-READ-PROXY.md).
