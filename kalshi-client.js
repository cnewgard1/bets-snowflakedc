/**
 * Kalshi API client stub — plug-in point for live trading later.
 *
 * Env placeholders (set via window.__KALSHI__ or build-time inject):
 *   KALSHI_API_KEY
 *   KALSHI_API_SECRET
 *   KALSHI_LIVE=true  → required for any non-dry-run order
 *
 * Default mode is always dry-run. No real orders ship from this demo.
 */
(function (global) {
  "use strict";

  const cfg = Object.assign(
    {
      apiKey: "",
      apiSecret: "",
      live: false,
      baseUrl: "https://trading-api.kalshi.com/trade-api/v2",
    },
    global.__KALSHI__ || {}
  );

  // Also read meta tags if present
  const metaKey = document.querySelector('meta[name="kalshi-api-key"]');
  const metaSecret = document.querySelector('meta[name="kalshi-api-secret"]');
  const metaLive = document.querySelector('meta[name="kalshi-live"]');
  if (metaKey && metaKey.content) cfg.apiKey = metaKey.content;
  if (metaSecret && metaSecret.content) cfg.apiSecret = metaSecret.content;
  if (metaLive && metaLive.content === "true") cfg.live = true;

  function hasCredentials() {
    return Boolean(cfg.apiKey && cfg.apiSecret);
  }

  function isLiveEnabled() {
    return Boolean(cfg.live && hasCredentials());
  }

  function status() {
    return {
      mode: isLiveEnabled() ? "live" : "dry-run",
      hasCredentials: hasCredentials(),
      liveFlag: Boolean(cfg.live),
      baseUrl: cfg.baseUrl,
    };
  }

  /**
   * Trading policy helpers — encode the five risk rules.
   */
  const Policy = {
    /** Margin (capital at risk) must stay within 37–59% of deposit. */
    MARGIN_MIN: 0.37,
    MARGIN_MAX: 0.59,

    clampMarginPct(pct) {
      return Math.min(this.MARGIN_MAX, Math.max(this.MARGIN_MIN, pct));
    },

    /**
     * Size an entry so it can exit against measured opposing depth
     * without walking the book (rule: never enter bigger than exit-safe).
     */
    exitSafeSize(desiredContracts, opposingDepthContracts, maxSlippageCents) {
      const depthCap = Math.max(0, Math.floor(opposingDepthContracts * 0.85));
      const slipCap = maxSlippageCents <= 1 ? depthCap : Math.floor(depthCap * 0.9);
      return Math.min(desiredContracts, slipCap);
    },

    /** Prefer resting on bid — never cross the spread to "hit market". */
    preferBid(side, bestBid, bestAsk) {
      if (side === "buy" || side === "yes") return bestBid;
      return bestAsk; // selling YES / buying NO sits on ask of YES ≈ bid of NO
    },

    /** Refuse to hold into a large visible sell wall above entry. */
    wouldHitSellWall(entryCents, wallCents, wallSize, positionSize) {
      if (wallCents == null) return false;
      const near = wallCents - entryCents <= 3;
      const heavy = wallSize >= positionSize * 3;
      return near && heavy;
    },

    /** Measure depth on both sides before sizing. */
    measureDepth(bids, asks) {
      const sum = (levels) =>
        (levels || []).reduce((a, l) => a + (l.size || l.depth || 0), 0);
      return { bidDepth: sum(bids), askDepth: sum(asks) };
    },
  };

  async function request(path, options) {
    if (!isLiveEnabled()) {
      return {
        ok: false,
        dryRun: true,
        path,
        message: "Dry-run only — live Kalshi mode is OFF until keys + explicit enable.",
        body: null,
      };
    }
    // Live path reserved for a future authenticated client.
    // Intentionally not implemented in this demo build.
    throw new Error(
      "Live Kalshi HTTP client not wired in this demo. Keep KALSHI_LIVE unset."
    );
  }

  async function getMarkets(params) {
    return request("/markets" + (params ? "?" + new URLSearchParams(params) : ""), {
      method: "GET",
    });
  }

  async function getOrderbook(ticker) {
    return request("/markets/" + encodeURIComponent(ticker) + "/orderbook", {
      method: "GET",
    });
  }

  async function getBalance() {
    return request("/portfolio/balance", { method: "GET" });
  }

  /**
   * Place order — always dry-runs unless live is explicitly enabled.
   * Even then, this stub refuses until a real signer is plugged in.
   */
  async function placeOrder(order) {
    const depth = Policy.measureDepth(order.bids || [], order.asks || []);
    const safeQty = Policy.exitSafeSize(
      order.count || 0,
      order.side === "buy" ? depth.askDepth : depth.bidDepth,
      order.maxSlippageCents || 1
    );

    const payload = {
      ticker: order.ticker,
      side: order.side,
      action: order.action || "buy",
      type: "limit",
      count: safeQty,
      yes_price: Policy.preferBid(order.side, order.bestBid, order.bestAsk),
      client_order_id: order.clientOrderId || "grok-bot-" + Date.now(),
    };

    if (Policy.wouldHitSellWall(order.entryCents, order.wallCents, order.wallSize, safeQty)) {
      return {
        ok: false,
        dryRun: true,
        rejected: true,
        reason: "policy: refuse to drag into sell wall",
        payload,
      };
    }

    if (!isLiveEnabled()) {
      return {
        ok: true,
        dryRun: true,
        message: "Order simulated (dry-run). Not sent to Kalshi.",
        payload,
      };
    }

    return request("/portfolio/orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });
  }

  global.KalshiClient = {
    config: cfg,
    status,
    hasCredentials,
    isLiveEnabled,
    Policy,
    getMarkets,
    getOrderbook,
    getBalance,
    placeOrder,
  };
})(typeof window !== "undefined" ? window : globalThis);
