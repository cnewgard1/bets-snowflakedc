# Public deploy notes — bets.snowflakedc.com

## Status (2026-10-06 CT)
- Working watch desk: https://cnewgard1.github.io/bets-snowflakedc/
- Custom domain https://bets.snowflakedc.com still points at Lovable A `185.158.133.1` (Vite shell at `/`; some static JS/CSS were copied into Lovable `public/` but root HTML is still the SPA).
- No Lovable↔GitHub sync repo under `cnewgard1` (cannot Publish from git).
- DNS NS: `ns-cloud-a1..a4.googledomains.com` (Squarespace Domains / Google Domains).

## Fix (required)
1. In Squarespace Domains / Google Domains DNS for `snowflakedc.com`:
   - Delete Lovable **A** (or CNAME) for host `bets` → `185.158.133.1`.
   - Add **CNAME** host `bets` → `cnewgard1.github.io`
2. After DNS propagates, re-add repo file `CNAME` containing exactly `bets.snowflakedc.com` (omit while DNS still points at Lovable — otherwise github.io redirects to the broken Lovable shell).
3. Hard-refresh https://bets.snowflakedc.com — expect LIVE GAME (MIL@SD) + empty OPEN book + login `chris`/`chris`.

## Security
- Never put `kalshi.keys*` or private PEM in Lovable, GitHub, or Pages.
- Signed Kalshi calls stay on `~/Grok/kalshi-desk`.
- Optional public book: authenticated read-only proxy + tunnel (see README / DESK-READ-PROXY.md).
