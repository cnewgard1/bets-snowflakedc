# Optional read-only book proxy (Mac desk)

Add to `~/Grok/kalshi-desk` server (Python or Node). **Do not** put the token in GitHub.

```bash
export BOOK_READ_TOKEN="$(openssl rand -hex 16)"
# start desk as usual; expose with: cloudflared tunnel / ngrok http <desk-port>
```

Gate `GET /api/live-book` (and only that path) with:
```
Authorization: Bearer $BOOK_READ_TOKEN
```
Reject missing/wrong token with 401. Do not expose order placement (`POST /api/orders`) through the tunnel.

Then open public UI:
`https://bets.snowflakedc.com/?bookProxy=https://<tunnel>&bookToken=<token>`
