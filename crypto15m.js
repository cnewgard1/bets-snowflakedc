/* crypto15m.js — LIVE 15m crypto desk board (watch-safe; no keys). */
(function (global) {
  "use strict";

  var REFRESH_MS = 3500;
  var CORE = [
    { series: "KXBTC15M", asset: "BTC", pair: "BTC-USD", minVol: 1000 },
    { series: "KXETH15M", asset: "ETH", pair: "ETH-USD", minVol: 500 },
    { series: "KXSOL15M", asset: "SOL", pair: "SOL-USD", minVol: 500 },
    { series: "KXXRP15M", asset: "XRP", pair: "XRP-USD", minVol: 500 },
    { series: "KXDOGE15M", asset: "DOGE", pair: "DOGE-USD", minVol: 500 },
    { series: "KXBNB15M", asset: "BNB", pair: "BNB-USD", minVol: 300 },
    { series: "KXHYPE15M", asset: "HYPE", pair: "HYPE-USD", minVol: 300 },
    { series: "KXZEC15M", asset: "ZEC", pair: "ZEC-USD", minVol: 200 },
    { series: "KXNEAR15M", asset: "NEAR", pair: "NEAR-USD", minVol: 200 }
  ];

  var ELEC = "https://api.elections.kalshi.com/trade-api/v2";
  var DEMO = "https://demo-api.kalshi.co/trade-api/v2";

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      return "&#" + ch.charCodeAt(0) + ";";
    });
  }

  function num(v, d) {
    var n = Number(v);
    return Number.isFinite(n) ? n : d;
  }

  function resolveProxy() {
    try {
      var q = new URLSearchParams(location.search);
      if (q.get("bookProxy")) localStorage.setItem("KALSHI_BOOK_PROXY", q.get("bookProxy"));
      if (q.get("bookToken")) localStorage.setItem("KALSHI_BOOK_TOKEN", q.get("bookToken"));
      if (q.get("marketsProxy")) localStorage.setItem("KALSHI_MARKETS_PROXY", q.get("marketsProxy"));
      return {
        book: (localStorage.getItem("KALSHI_BOOK_PROXY") || "").replace(/\/$/, ""),
        token: localStorage.getItem("KALSHI_BOOK_TOKEN") || "",
        markets: (localStorage.getItem("KALSHI_MARKETS_PROXY") || "").replace(/\/$/, "")
      };
    } catch (e) {
      return { book: "", token: "", markets: "" };
    }
  }

  function fmtPx(asset, x) {
    if (x == null || !Number.isFinite(x)) return "—";
    var a = Math.abs(x);
    var d = a >= 1000 ? 2 : a >= 100 ? 2 : a >= 1 ? 4 : a >= 0.1 ? 5 : 6;
    return x.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
  }

  function fmtCents(x) {
    if (x == null || !Number.isFinite(x)) return "—";
    return (x * 100).toFixed(1) + "¢";
  }

  function fmtPct(x, signed) {
    if (x == null || !Number.isFinite(x)) return "—";
    var s = (signed && x > 0 ? "+" : "") + x.toFixed(1) + "%";
    return s;
  }

  function fmtGap(asset, gap, gapPct) {
    if (gap == null || !Number.isFinite(gap)) return "—";
    var sign = gap > 0 ? "+" : "";
    return sign + fmtPx(asset, gap) + " (" + fmtPct(gapPct, true) + ")";
  }

  function countdown(closeIso) {
    if (!closeIso) return { label: "—", sec: null, urgent: false };
    var ms = Date.parse(closeIso) - Date.now();
    if (!Number.isFinite(ms)) return { label: "—", sec: null, urgent: false };
    if (ms <= 0) return { label: "SETTLING", sec: 0, urgent: true };
    var sec = Math.floor(ms / 1000);
    var m = Math.floor(sec / 60);
    var s = sec % 60;
    return {
      label: m + ":" + String(s).padStart(2, "0"),
      sec: sec,
      urgent: sec <= 60
    };
  }

  function roughFairYes(spot, floor, secLeft) {
    if (!(spot > 0) || !(floor > 0)) return 0.5;
    var move = (spot - floor) / floor;
    var tFrac = Math.max(0.02, Math.min(1, (secLeft == null ? 300 : secLeft) / 900));
    // Rough 15m vol scale (~15–25 bps RMS over a window); not a model, just a desk heuristic.
    var sigma = 0.0018 * Math.sqrt(tFrac);
    var z = move / Math.max(sigma, 1e-6);
    var fair = 0.5 * (1 + Math.tanh(z));
    return Math.max(0.02, Math.min(0.98, fair));
  }

  function enrichRow(raw, spot) {
    var bid = num(raw.yesBid, NaN);
    var ask = num(raw.yesAsk, NaN);
    var mid = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : num(raw.last, NaN);
    var floor = num(raw.floor, NaN);
    var gap = Number.isFinite(spot) && Number.isFinite(floor) ? spot - floor : null;
    var gapPct = gap != null && floor ? (gap / floor) * 100 : null;
    var cd = countdown(raw.closeTime);
    var fair = roughFairYes(spot, floor, cd.sec);
    var edgePct = Number.isFinite(mid) ? (fair - mid) * 100 : null;
    return {
      asset: raw.asset,
      series: raw.series,
      ticker: raw.ticker,
      title: raw.title,
      spot: spot,
      floor: floor,
      gap: gap,
      gapPct: gapPct,
      bid: Number.isFinite(bid) ? bid : null,
      ask: Number.isFinite(ask) ? ask : null,
      mid: Number.isFinite(mid) ? mid : null,
      edgePct: edgePct,
      fair: fair,
      volume24: num(raw.volume24, 0),
      depth: num(raw.depth, 0),
      closeTime: raw.closeTime,
      openTime: raw.openTime,
      countdown: cd.label,
      secLeft: cd.sec,
      urgent: cd.urgent,
      source: raw.source || "kalshi"
    };
  }

  function isLiquid(row, cfg) {
    if (!row || !row.ticker) return false;
    // Always keep core majors even late-window when books pin; drop empty shells.
    if (row.floor == null) return false;
    var minVol = cfg && cfg.minVol != null ? cfg.minVol : 200;
    if (row.volume24 >= minVol) return true;
    if (row.depth >= 20) return true;
    // New window often shows vol24=0 briefly — keep if two-sided book exists.
    if (row.bid != null && row.ask != null && row.ask > 0) return true;
    return ["BTC", "ETH", "SOL", "XRP", "DOGE"].indexOf(row.asset) >= 0;
  }

  async function fetchJson(url, opts) {
    var res = await fetch(url, opts || {});
    if (!res.ok) throw new Error("HTTP " + res.status);
    return res.json();
  }

  async function fetchSpotMap() {
    var out = {};
    await Promise.all(
      CORE.map(async function (c) {
        try {
          var d = await fetchJson("https://api.coinbase.com/v2/prices/" + c.pair + "/spot");
          var n = num(d && d.data && d.data.amount, NaN);
          if (Number.isFinite(n)) out[c.asset] = n;
        } catch (e) {}
      })
    );
    return out;
  }

  function marketFromApi(m, asset, series, source) {
    if (!m) return null;
    var bid = num(m.yes_bid_dollars, NaN);
    var ask = num(m.yes_ask_dollars, NaN);
    return {
      asset: asset,
      series: series,
      ticker: m.ticker,
      title: m.title || asset + " 15m",
      floor: num(m.floor_strike, NaN),
      yesBid: bid,
      yesAsk: ask,
      last: num(m.last_price_dollars, NaN),
      volume24: num(m.volume_24h_fp, 0),
      depth: num(m.yes_bid_size_fp, 0) + num(m.yes_ask_size_fp, 0),
      closeTime: m.close_time,
      openTime: m.open_time,
      source: source
    };
  }

  async function fetchSeriesMarket(base, series, asset) {
    var url = base + "/markets?limit=1&status=open&series_ticker=" + encodeURIComponent(series);
    var d = await fetchJson(url, { headers: { Accept: "application/json" } });
    var m = (d.markets || [])[0];
    return marketFromApi(m, asset, series, base.indexOf("demo-api") >= 0 ? "demo" : "elec");
  }

  async function fetchBoardViaClient() {
    var spots = await fetchSpotMap();
    var rows = [];
    var source = "client";
    // Prefer production host first (works on local desk same-origin proxy paths only).
    // On public Pages, elections rejects browser Origin → fall back to demo-api (CORS OK; thin books).
    var bases = [ELEC, DEMO];
    var used = null;
    for (var b = 0; b < bases.length; b++) {
      try {
        var probe = await fetchSeriesMarket(bases[b], "KXBTC15M", "BTC");
        if (probe && probe.ticker) {
          used = bases[b];
          source = probe.source;
          break;
        }
      } catch (e) {}
    }
    if (!used) throw new Error("no kalshi host reachable from browser");
    await Promise.all(
      CORE.map(async function (c) {
        try {
          var raw = await fetchSeriesMarket(used, c.series, c.asset);
          if (!raw) return;
          var row = enrichRow(raw, spots[c.asset]);
          if (isLiquid(row, c)) rows.push(row);
        } catch (e) {}
      })
    );
    rows.sort(function (a, b) {
      return (b.volume24 || 0) - (a.volume24 || 0);
    });
    return {
      ok: true,
      source: source,
      fetchedAt: Date.now(),
      spots: spots,
      rows: rows
    };
  }

  async function fetchBoardViaProxy(base, token) {
    var headers = { Accept: "application/json" };
    if (token) headers.Authorization = "Bearer " + token;
    var d = await fetchJson(base.replace(/\/$/, "") + "/api/crypto15m", { headers: headers });
    if (!d || !(d.ok || (d.rows && d.rows.length))) throw new Error("empty proxy");
    return d;
  }

  async function loadBoard() {
    var proxy = resolveProxy();
    // 1) same-origin desk
    try {
      var local = await fetchJson("/api/crypto15m", { headers: { Accept: "application/json" } });
      if (local && (local.ok || (local.rows && local.rows.length))) {
        local.source = local.source || "desk";
        return local;
      }
    } catch (e) {}
    // 2) explicit markets proxy or book proxy tunnel
    var bases = [];
    if (proxy.markets) bases.push(proxy.markets);
    if (proxy.book) bases.push(proxy.book);
    for (var i = 0; i < bases.length; i++) {
      try {
        var proxied = await fetchBoardViaProxy(bases[i], proxy.token);
        proxied.source = proxied.source || "proxy";
        return proxied;
      } catch (e) {}
    }
    // 3) pure browser (Coinbase + Kalshi public/demo)
    return fetchBoardViaClient();
  }

  function edgeClass(edge) {
    if (edge == null || !Number.isFinite(edge)) return "";
    if (edge >= 3) return "edge-up";
    if (edge <= -3) return "edge-down";
    return "edge-flat";
  }

  function renderRow(r) {
    var dir = r.gap == null ? "" : r.gap >= 0 ? "gap-up" : "gap-down";
    return (
      '<div class="c15-row' +
      (r.urgent ? " urgent" : "") +
      '" data-asset="' +
      esc(r.asset) +
      '">' +
      '<div class="c15-asset"><span class="c15-sym">' +
      esc(r.asset) +
      '</span><span class="c15-cd' +
      (r.urgent ? " hot" : "") +
      '">' +
      esc(r.countdown) +
      "</span></div>" +
      '<div class="c15-metric"><em>Spot</em><span>' +
      esc(fmtPx(r.asset, r.spot)) +
      "</span></div>" +
      '<div class="c15-metric"><em>Floor</em><span>' +
      esc(fmtPx(r.asset, r.floor)) +
      "</span></div>" +
      '<div class="c15-metric ' +
      dir +
      '"><em>Gap</em><span>' +
      esc(fmtGap(r.asset, r.gap, r.gapPct)) +
      "</span></div>" +
      '<div class="c15-metric"><em>Mid</em><span>' +
      esc(fmtCents(r.mid)) +
      '</span><span class="c15-ba">' +
      esc(fmtCents(r.bid)) +
      " / " +
      esc(fmtCents(r.ask)) +
      "</span></div>" +
      '<div class="c15-metric ' +
      edgeClass(r.edgePct) +
      '"><em>Edge</em><span>' +
      esc(fmtPct(r.edgePct, true)) +
      "</span></div>" +
      "</div>"
    );
  }

  function els() {
    return {
      sub: document.getElementById("crypto15Sub"),
      list: document.getElementById("crypto15List"),
      btn: document.getElementById("btnRefreshCrypto15")
    };
  }

  function setSub(text) {
    var e = els().sub;
    if (e) e.textContent = text;
  }

  function render(data) {
    var list = els().list;
    if (!list) return;
    var rows = (data && data.rows) || [];
    if (!rows.length) {
      list.innerHTML = '<div class="livebook-empty">No liquid *15M markets right now.</div>';
      return;
    }
    list.innerHTML = rows.map(renderRow).join("");
    var t = new Date().toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/Chicago"
    });
    var src = (data && data.source) || "—";
    var srcLabel =
      src === "desk" || src === "elec" || src === "proxy"
        ? "Kalshi prod"
        : src === "demo"
          ? "demo host (CORS) · thin books"
          : src;
    setSub(rows.length + " liquid · " + srcLabel + " · spot Coinbase · " + t + " CT");
  }

  var timer = null;
  var inflight = false;

  async function refresh() {
    if (inflight) return;
    inflight = true;
    try {
      var data = await loadBoard();
      // Normalize proxy/desk payload rows if server already enriched
      if (data.rows && data.rows.length && data.rows[0].countdown == null) {
        data.rows = data.rows.map(function (r) {
          return enrichRow(
            {
              asset: r.asset,
              series: r.series,
              ticker: r.ticker,
              title: r.title,
              floor: r.floor,
              yesBid: r.bid != null ? r.bid : r.yesBid,
              yesAsk: r.ask != null ? r.ask : r.yesAsk,
              last: r.last,
              volume24: r.volume24,
              depth: r.depth,
              closeTime: r.closeTime,
              openTime: r.openTime,
              source: data.source
            },
            r.spot
          );
        });
      }
      render(data);
      global.__deskCrypto15 = data;
    } catch (e) {
      setSub("15m board offline — retrying…");
      var list = els().list;
      if (list) {
        list.innerHTML =
          '<div class="livebook-empty">Could not load *15M board (' +
          esc(e && e.message ? e.message : e) +
          "). Local desk uses /api/crypto15m; public uses Coinbase + Kalshi public/demo.</div>";
      }
      console.warn("[crypto15m]", e);
    } finally {
      inflight = false;
    }
  }

  function boot() {
    if (!document.getElementById("crypto15Card")) return;
    refresh();
    timer = setInterval(refresh, REFRESH_MS);
    var btn = els().btn;
    if (btn) btn.addEventListener("click", function () { refresh(); });
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) refresh();
    });
  }

  global.BetsCrypto15 = { refresh: refresh, loadBoard: loadBoard, CORE: CORE };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})(typeof window !== "undefined" ? window : globalThis);
