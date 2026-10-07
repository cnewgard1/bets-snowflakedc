/**
 * Grok Bot · Kalshi Desk — live open/closed bids only.
 * Demo simulation (climbing equity, fake order book, fake positions) removed.
 */
(function () {
  "use strict";
  window.__deskUseLivePortfolio = false;
})();

/* TEXT_SCALE — A−/A+ UI type scale, persisted in localStorage */
(function bootTextScale() {
  "use strict";

  var KEY = "bets_text_scale";
  var MIN = 0.85;
  var MAX = 1.4;
  var STEP = 0.075;
  var DEFAULT = 1; // pairs with --text-base 17.5px (~ +9% vs 16px)

  function clamp(n) {
    return Math.min(MAX, Math.max(MIN, Math.round(n * 1000) / 1000));
  }

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw == null || raw === "") return DEFAULT;
      var n = Number(raw);
      return Number.isFinite(n) ? clamp(n) : DEFAULT;
    } catch (e) {
      return DEFAULT;
    }
  }

  function apply(scale) {
    var n = clamp(scale);
    document.documentElement.style.setProperty("--text-scale", String(n));
    try {
      localStorage.setItem(KEY, String(n));
    } catch (e) {}
    var minus = document.getElementById("btnTextMinus");
    var plus = document.getElementById("btnTextPlus");
    if (minus) minus.disabled = n <= MIN + 0.0001;
    if (plus) plus.disabled = n >= MAX - 0.0001;
    return n;
  }

  var current = apply(read());

  function bump(dir) {
    current = apply(current + dir * STEP);
  }

  var minus = document.getElementById("btnTextMinus");
  var plus = document.getElementById("btnTextPlus");
  if (minus) minus.addEventListener("click", function () { bump(-1); });
  if (plus) plus.addEventListener("click", function () { bump(1); });
})();

/* KALSHI_LIVE_BOOK — open (resting/filled) + closed (settled) + real equity */
(function bootLiveBook() {
  "use strict";

  const REFRESH_MS = 12000; // fast while live / open bids
  const SESSION_CAP = 150;
  let bookTimer = null;
  let lastOpenCount = 0;
  let autoRefreshStopped = false;

  const lb = {
    sub: document.getElementById("liveBookSub"),
    list: document.getElementById("liveBookList"),
    stake: document.getElementById("lbStake"),
    filled: document.getElementById("lbFilled"),
    posVal: document.getElementById("lbPosVal"),
    cap: document.getElementById("lbCap"),
    capFill: document.getElementById("lbCapFill"),
    meta: document.getElementById("liveBookMeta"),
    btn: document.getElementById("btnRefreshBook"),
    chip: document.getElementById("modeChip"),
    demoNote: document.getElementById("demoNote"),
    balance: document.getElementById("balanceDisplay"),
    pnlAbs: document.getElementById("pnlAbs"),
    pnlMult: document.getElementById("pnlMult"),
    capAtRisk: document.getElementById("capAtRisk"),
    capRiskLabel: document.getElementById("capRiskLabel"),
    capFreeLabel: document.getElementById("capFreeLabel"),
    marginChip: document.getElementById("marginChip"),
    closedSub: document.getElementById("closedBookSub"),
    closedList: document.getElementById("closedBookList"),
    realized: document.getElementById("lbRealized"),
    closedCount: document.getElementById("lbClosedCount"),
  };

  function money(n) {
    if (n == null || Number.isNaN(Number(n))) return "—";
    return "$" + Number(n).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setSub(text) {
    if (lb.sub) lb.sub.textContent = text;
  }

  function renderEmpty(el, msg) {
    if (el) el.innerHTML = '<div class="livebook-empty">' + esc(msg) + "</div>";
  }

  function renderOpenBet(b) {
    const side = (b.side || "yes").toUpperCase();
    const book = (b.bookSide || "bid").toUpperCase();
    const status = (b.status || "resting").toLowerCase();
    const cents = b.priceCents != null ? b.priceCents + "¢" : "—";
    const rem = b.contractsRemaining != null ? b.contractsRemaining : "—";
    const filled = b.contractsFilled != null ? b.contractsFilled : 0;
    const initial = b.contractsInitial != null ? b.contractsInitial : rem;
    const marketBits = [];
    if (b.marketMidCents != null) marketBits.push("mid " + b.marketMidCents + "¢");
    if (b.marketLastCents != null) marketBits.push("last " + b.marketLastCents + "¢");
    const marketLine = marketBits.length ? marketBits.join(" · ") : "market —";
    const kind = filled > 0 && Number(rem) === 0 ? "filled" : status;

    return (
      '<article class="bet-card">' +
      '<div class="bet-top">' +
      "<div>" +
      '<div class="bet-title">' + esc(b.title || b.ticker) + "</div>" +
      '<div class="bet-ticker">' + esc(b.ticker || "") + "</div>" +
      "</div>" +
      '<span class="bet-badge ' + esc(kind) + '">' + esc(kind) + "</span>" +
      "</div>" +
      '<div class="bet-row">' +
      "<span><em>Side</em>" + side + " " + book + "</span>" +
      "<span><em>Qty</em>" + rem + " left / " + initial + "</span>" +
      '<span><em>Price</em><span class="bet-odds">' + cents + "</span></span>" +
      "</div>" +
      '<div class="bet-grid">' +
      '<div class="bet-cell"><span class="bet-cell-label">Stake</span><span class="bet-cell-val">' +
      money(b.cost) +
      "</span></div>" +
      '<div class="bet-cell"><span class="bet-cell-label">Filled</span><span class="bet-cell-val">' +
      (filled > 0 ? filled + " (" + (b.fillPct || 0) + "%)" : "0") +
      "</span></div>" +
      '<div class="bet-cell"><span class="bet-cell-label">Locked</span><span class="bet-cell-val">' +
      money(b.cost) +
      "</span></div>" +
      "</div>" +
      '<div class="bet-foot">' +
      "<span>" + esc(marketLine) + "</span>" +
      "<span>" +
      (filled > 0 ? "partial/filled " + filled : "unfilled resting") +
      (b.exchangeIndex != null ? " · shard " + b.exchangeIndex : "") +
      "</span>" +
      "</div>" +
      "</article>"
    );
  }

  const ARCHIVE_KEY = "bets_done_archive_v1";
  const ARCHIVE_OPEN_KEY = "bets_done_archive_open_v1";

  function dateKeyFromSettled(ts, fallback) {
    if (fallback) return fallback;
    if (!ts) {
      return new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    }
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) {
      const m = String(ts).match(/(\d{4}-\d{2}-\d{2})/);
      return m ? m[1] : new Date().toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
    }
    return d.toLocaleDateString("en-CA", { timeZone: "America/Chicago" });
  }

  function formatDateLabel(dateKey) {
    const parts = String(dateKey || "").split("-");
    if (parts.length !== 3) return dateKey || "—";
    const d = new Date(Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 17, 0, 0));
    return d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      timeZone: "America/Chicago",
    });
  }

  function signedMoney(n) {
    const x = Number(n) || 0;
    const abs = money(Math.abs(x)).replace("$", "");
    if (x > 0) return "+$" + abs;
    if (x < 0) return "−$" + abs;
    return "$" + abs;
  }

  function loadArchiveStore() {
    try {
      const raw = localStorage.getItem(ARCHIVE_KEY);
      if (!raw) return { byId: {} };
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" && parsed.byId ? parsed : { byId: {} };
    } catch (e) {
      return { byId: {} };
    }
  }

  function saveArchiveStore(store) {
    try {
      localStorage.setItem(ARCHIVE_KEY, JSON.stringify(store));
    } catch (e) {}
  }

  function loadOpenDates() {
    try {
      const raw = localStorage.getItem(ARCHIVE_OPEN_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (e) {
      return null;
    }
  }

  function saveOpenDates(map) {
    try {
      localStorage.setItem(ARCHIVE_OPEN_KEY, JSON.stringify(map || {}));
    } catch (e) {}
  }

  function normalizeClosedItem(c, source) {
    const dateKey = c.dateKey || dateKeyFromSettled(c.settledTime, null);
    const id =
      c.id ||
      (source || c.source || "book") +
        ":" +
        dateKey +
        ":" +
        String(c.ticker || c.title || Math.random());
    const pnl = Number(c.pnl || 0);
    return {
      id: id,
      ticker: c.ticker || "",
      title: c.title || c.ticker || "Settlement",
      cost: Number(c.cost || 0),
      revenue: Number(c.revenue != null ? c.revenue : 0),
      pnl: pnl,
      result: c.result || (pnl > 0 ? "win" : pnl < 0 ? "loss" : "flat"),
      settledTime: c.settledTime || dateKey,
      dateKey: dateKey,
      source: source || c.source || "book",
    };
  }

  /** Merge closed items into local archive. Book overwrites watch for same logical bet. */
  function mergeClosedIntoArchive(items, source) {
    const list = items || [];
    if (!list.length && source !== "book") return loadArchiveStore();
    const store = loadArchiveStore();
    list.forEach(function (raw) {
      const item = normalizeClosedItem(raw, source);
      const prev = store.byId[item.id];
      if (prev && prev.source === "book" && item.source === "watch") return;
      // Prefer book over watch even if ids differ: match ticker+dateKey
      if (item.source === "book" && item.ticker) {
        Object.keys(store.byId).forEach(function (k) {
          const p = store.byId[k];
          if (
            p &&
            p.source === "watch" &&
            p.dateKey === item.dateKey &&
            String(p.ticker || "").toUpperCase().indexOf(String(item.ticker).toUpperCase().slice(0, 8)) >= 0
          ) {
            delete store.byId[k];
          }
        });
      }
      store.byId[item.id] = item;
    });
    saveArchiveStore(store);
    return store;
  }

  function archiveItemsGrouped(store) {
    const groups = {};
    Object.keys(store.byId || {}).forEach(function (id) {
      const item = store.byId[id];
      if (!item) return;
      const dk = item.dateKey || dateKeyFromSettled(item.settledTime);
      if (!groups[dk]) groups[dk] = [];
      groups[dk].push(item);
    });
    Object.keys(groups).forEach(function (dk) {
      groups[dk].sort(function (a, b) {
        return Math.abs(Number(b.pnl || 0)) - Math.abs(Number(a.pnl || 0));
      });
    });
    return groups;
  }

  function renderArchiveRow(c) {
    const pnl = Number(c.pnl || 0);
    const cls = pnl > 0 ? "up" : pnl < 0 ? "down" : "";
    const result = c.result || (pnl > 0 ? "win" : pnl < 0 ? "loss" : "flat");
    return (
      '<article class="archive-row">' +
      '<div class="archive-row-top">' +
      '<div class="archive-title">' +
      esc(c.title || c.ticker) +
      "</div>" +
      '<span class="bet-badge ' +
      esc(result) +
      '">' +
      esc(result) +
      "</span></div>" +
      (c.ticker
        ? '<div class="archive-ticker">' + esc(c.ticker) + "</div>"
        : "") +
      '<div class="archive-cols">' +
      '<span class="archive-bet"><em>Bet</em> ' +
      money(c.cost) +
      "</span>" +
      '<span class="archive-pnl ' +
      cls +
      '"><em>Win/Loss</em> ' +
      signedMoney(pnl) +
      "</span></div></article>"
    );
  }

  function renderClosedArchive(store) {
    const groups = archiveItemsGrouped(store || loadArchiveStore());
    const dates = Object.keys(groups).sort().reverse();
    if (!dates.length) {
      renderEmpty(lb.closedList, "No settled bets yet.");
      if (lb.realized) lb.realized.textContent = money(0);
      if (lb.closedCount) lb.closedCount.textContent = "0";
      if (lb.closedSub) lb.closedSub.textContent = "Archive empty · settled wins / losses";
      return { count: 0, realized: 0 };
    }

    let realized = 0;
    let count = 0;
    dates.forEach(function (dk) {
      groups[dk].forEach(function (c) {
        realized += Number(c.pnl || 0);
        count += 1;
      });
    });
    realized = Math.round(realized * 10000) / 10000;

    const openMap = loadOpenDates();
    const newest = dates[0];
    const html = dates
      .map(function (dk) {
        const items = groups[dk];
        let dayPnl = 0;
        let dayStake = 0;
        items.forEach(function (c) {
          dayPnl += Number(c.pnl || 0);
          dayStake += Number(c.cost || 0);
        });
        dayPnl = Math.round(dayPnl * 10000) / 10000;
        const dayCls = dayPnl > 0 ? "up" : dayPnl < 0 ? "down" : "";
        let isOpen;
        if (openMap && Object.prototype.hasOwnProperty.call(openMap, dk)) {
          isOpen = !!openMap[dk];
        } else {
          isOpen = dk === newest; // newest day expanded; older archived collapsed
        }
        return (
          '<details class="archive-day"' +
          (isOpen ? " open" : "") +
          ' data-date="' +
          esc(dk) +
          '">' +
          '<summary class="archive-summary">' +
          '<div class="archive-summary-text">' +
          '<span class="archive-date">' +
          esc(formatDateLabel(dk)) +
          "</span>" +
          '<span class="archive-meta">' +
          items.length +
          " bet" +
          (items.length === 1 ? "" : "s") +
          " · stake " +
          money(dayStake) +
          "</span></div>" +
          '<span class="archive-net ' +
          dayCls +
          '">' +
          signedMoney(dayPnl) +
          "</span></summary>" +
          '<div class="archive-items">' +
          items.map(renderArchiveRow).join("") +
          "</div></details>"
        );
      })
      .join("");

    if (lb.closedList) {
      lb.closedList.innerHTML = '<div class="archive-accordion">' + html + "</div>";
      if (!lb.closedList._archiveToggleBound) {
        lb.closedList._archiveToggleBound = true;
        lb.closedList.addEventListener("toggle", function (ev) {
          const det = ev.target;
          if (!det || !det.classList || !det.classList.contains("archive-day")) return;
          const map = loadOpenDates() || {};
          map[det.getAttribute("data-date")] = det.open;
          saveOpenDates(map);
        }, true);
      }
    }
    if (lb.realized) {
      lb.realized.textContent = money(realized);
      lb.realized.classList.toggle("up", realized > 0);
      lb.realized.classList.toggle("down", realized < 0);
    }
    if (lb.closedCount) lb.closedCount.textContent = String(count);
    if (lb.closedSub) {
      lb.closedSub.textContent =
        count +
        " settled · " +
        dates.length +
        " day" +
        (dates.length === 1 ? "" : "s") +
        " · realized " +
        money(realized);
    }
    return { count: count, realized: realized };
  }

  function ingestClosedFromBook(closed) {
    const list = closed || [];
    if (list.length) mergeClosedIntoArchive(list, "book");
    return renderClosedArchive(loadArchiveStore());
  }

  function ingestClosedFromWatch(gameData) {
    if (!window.BetsGameFeed || typeof window.BetsGameFeed.buildWatchClosed !== "function") {
      return renderClosedArchive(loadArchiveStore());
    }
    const items = window.BetsGameFeed.buildWatchClosed(gameData);
    if (items && items.length) mergeClosedIntoArchive(items, "watch");
    return renderClosedArchive(loadArchiveStore());
  }

  // Prefer book closed when available; watch fills archive when book is empty/offline.
  window.BetsDoneArchive = {
    ingestBook: ingestClosedFromBook,
    ingestWatch: ingestClosedFromWatch,
    render: function () {
      return renderClosedArchive(loadArchiveStore());
    },
  };

  function renderClosed(c) {
    return renderArchiveRow(normalizeClosedItem(c, c.source || "book"));
  }

  function applyPortfolioFromLive(summary) {
    if (!summary) return;
    const cash = Number(
      summary.cashAvailable != null
        ? summary.cashAvailable
        : summary.shard3Balance != null
          ? summary.shard3Balance
          : summary.balanceDollars
    );
    if (Number.isNaN(cash)) return;

    const openStake = Number(
      summary.openExposure != null ? summary.openExposure : summary.totalStake || 0
    );
    const posVal = Number(summary.positionValue || 0);
    const realized = Number(summary.realizedPnl || 0);
    // Equity = cash + filled position mark. Closed P&L already sits in cash once settled.
    // Do NOT add resting max-payout or double-count realized.
    const equity = Number(
      summary.equity != null ? summary.equity : cash + posVal
    );
    const cap = Number(summary.sessionCap || SESSION_CAP);

    const dollars = Math.floor(Math.abs(equity));
    const cents = Math.round((Math.abs(equity) - dollars) * 100);
    const sign = equity < 0 ? "-" : "";
    if (lb.balance) {
      lb.balance.innerHTML =
        '<span class="dollars">' +
        sign +
        "$" +
        dollars.toLocaleString("en-US") +
        '</span><span class="cents">.' +
        String(cents).padStart(2, "0") +
        "</span>";
    }

    if (lb.pnlAbs) {
      lb.pnlAbs.textContent =
        (realized >= 0 ? "Realized +" : "Realized −") +
        money(Math.abs(realized)).replace("$", "");
      lb.pnlAbs.className = realized >= 0 ? "pnl-up" : "pnl-down";
    }
    if (lb.pnlMult) {
      lb.pnlMult.textContent =
        "Cash " +
        money(cash) +
        " · Open " +
        money(openStake) +
        " · Pos " +
        money(posVal);
    }

    const denom = Math.max(cash + openStake, 1);
    if (lb.capAtRisk) lb.capAtRisk.style.width = Math.min(100, (openStake / denom) * 100) + "%";
    if (lb.capRiskLabel) lb.capRiskLabel.textContent = "Open " + money(openStake);
    if (lb.capFreeLabel) lb.capFreeLabel.textContent = "Cash " + money(Math.max(0, cash));
    if (lb.marginChip) {
      lb.marginChip.textContent =
        "Cap " + Math.round((openStake / Math.max(cap, 1)) * 100) + "%";
    }
    const progress = document.getElementById("progressFill");
    if (progress) {
      progress.style.width =
        Math.max(0, Math.min(100, (openStake / Math.max(cap, 1)) * 100)) + "%";
    }
  }

  function renderBook(data) {
    const summary = data.summary || {};
    const bets = data.bets || [];
    const closed = data.closed || [];
    const positions = data.positions || [];
    const cap = summary.sessionCap || SESSION_CAP;
    const stake = Number(summary.openExposure != null ? summary.openExposure : summary.totalStake || 0);
    const filledContracts = bets.reduce(function (a, b) {
      return a + Number(b.contractsFilled || 0);
    }, 0);
    const posVal = Number(summary.positionValue || 0);
    const realized = Number(summary.realizedPnl || 0);

    if (lb.stake) lb.stake.textContent = money(stake);
    if (lb.filled) lb.filled.textContent = String(filledContracts);
    if (lb.posVal) lb.posVal.textContent = money(posVal);
    if (lb.cap) lb.cap.textContent = money(stake) + " / $" + cap;

    if (lb.capFill) {
      const pct = Math.min(100, (stake / cap) * 100);
      lb.capFill.style.width = pct + "%";
      lb.capFill.classList.toggle("near-cap", pct >= 90);
    }

    const shardBal =
      summary.cashAvailable != null
        ? money(summary.cashAvailable)
        : summary.shard3Balance != null
          ? money(summary.shard3Balance)
          : "—";
    if (lb.meta) {
      lb.meta.textContent =
        "Equity " +
        money(summary.equity != null ? summary.equity : summary.cashAvailable) +
        " · cash " +
        shardBal +
        " · open " +
        money(stake) +
        " · " +
        bets.length +
        " resting · " +
        positions.length +
        " pos";
    }

    if (!bets.length && !positions.length) {
      renderEmpty(lb.list, "No open resting bids or filled positions.");
    } else if (lb.list) {
      const posCards = positions.map(function (p) {
        return (
          '<article class="bet-card">' +
          '<div class="bet-top"><div><div class="bet-title">' +
          esc(p.ticker) +
          '</div></div><span class="bet-badge filled">position</span></div>' +
          '<div class="bet-grid">' +
          '<div class="bet-cell"><span class="bet-cell-label">Contracts</span><span class="bet-cell-val">' +
          (p.position != null ? p.position : "—") +
          "</span></div>" +
          '<div class="bet-cell"><span class="bet-cell-label">Mark</span><span class="bet-cell-val">' +
          money(p.marketExposure) +
          "</span></div>" +
          '<div class="bet-cell"><span class="bet-cell-label">Realized</span><span class="bet-cell-val">' +
          money(p.realizedPnl) +
          "</span></div>" +
          "</div></article>"
        );
      });
      lb.list.innerHTML = posCards.concat(bets.map(renderOpenBet)).join("");
    }

    // Closed accordion archive: book settlements when present; else keep watch archive.
    if (closed.length) {
      ingestClosedFromBook(closed);
    } else if (!window.__deskUseLivePortfolio) {
      renderClosedArchive(loadArchiveStore());
    } else {
      // Live book OK but nothing settled yet — still show any archived watch days
      renderClosedArchive(loadArchiveStore());
    }

    applyPortfolioFromLive(summary);

    const now = new Date();
    const ts = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/Chicago",
    });
    setSub(bets.length + " resting · updated " + ts + " CT");
  }

  function applyStatus(meta) {
    if (!meta) return;
    if (lb.chip) {
      lb.chip.textContent = meta.live ? "LIVE" : "KEYS · DRY";
      lb.chip.classList.toggle("live", !!meta.live);
      lb.chip.title = meta.note || "";
    }
    if (lb.demoNote) {
      lb.demoNote.textContent = meta.keysLoaded
        ? "Live desk · portfolio = cash + positions · resting ≠ fake equity"
        : "Public view · game feed on · trading local-only";
    }
  }

  async function refreshBook() {
    if (lb.btn) {
      lb.btn.classList.remove("spin");
      void lb.btn.offsetWidth;
      lb.btn.classList.add("spin");
    }
    try {
      const res = await fetch("/api/live-book?status=resting");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      if (!data.ok && !(data.bets && data.bets.length)) {
        throw new Error(
          (data.body && data.body.error) ||
            (data.ordersHttp && !data.ordersHttp.ok
              ? "orders HTTP " + data.ordersHttp.status
              : "live-book failed")
        );
      }
      applyStatus(data.meta);
      try {
        if (window.BetsGameFeed && typeof window.BetsGameFeed.mergePropFills === "function") {
          window.BetsGameFeed.mergePropFills(data.positions || []);
        }
      } catch (eMerge) {}
      window.__deskUseLivePortfolio = true;
      renderBook(data);
      console.log(
        "[Kalshi] equity",
        data.summary && data.summary.equity,
        "open",
        data.summary && data.summary.openExposure,
        "realized",
        data.summary && data.summary.realizedPnl
      );
    } catch (e) {
      window.__deskUseLivePortfolio = false;
      setSub("Public UI · Kalshi signed routes not on this host");
      renderEmpty(
        lb.list,
        "Live Kalshi book stays on your local desk (keys never on this host)."
      );
      if (window.BetsDoneArchive) {
        const arch = window.BetsDoneArchive.render();
        if (lb.closedSub) {
          const n = arch && arch.count != null ? arch.count : 0;
          lb.closedSub.textContent =
            n
              ? n + " archived · watch fills (book offline)"
              : "Archive waits on settled fills · book offline";
        }
      } else {
        renderEmpty(lb.closedList, "Closed book available when the local desk server is running.");
      }
      if (lb.chip) {
        lb.chip.textContent = "OFFLINE";
        lb.chip.classList.remove("live");
      }
      console.warn("[Kalshi] live book unavailable", e && e.message);
    }
  }

  function stopBookAutoRefresh(reason) {
    if (bookTimer) {
      clearInterval(bookTimer);
      bookTimer = null;
    }
    autoRefreshStopped = true;
    window.__deskAutoRefreshStopped = true;
    console.log("[Kalshi] auto-refresh stopped:", reason || "game finished · no open bids");
  }

  function startBookAutoRefresh() {
    if (bookTimer) clearInterval(bookTimer);
    autoRefreshStopped = false;
    window.__deskAutoRefreshStopped = false;
    bookTimer = setInterval(refreshBook, REFRESH_MS);
  }

  function gameIsFinished() {
    // Game feed sets this from MLB/ESPN status (final / game over / completed)
    const st = String(window.__deskGameStatus || "").toLowerCase();
    if (!st) return false; // unknown → keep refreshing
    return (
      st === "final" ||
      st === "f" ||
      st === "game over" ||
      st === "completed" ||
      st === "closed" ||
      st.indexOf("final") !== -1
    );
  }

  function maybeStopOrResumeAutoRefresh() {
    window.__deskOpenBidCount = lastOpenCount;
    const finished = gameIsFinished();
    window.__deskGameFinished = finished;
    // Stop only when game is done AND no open bids remain (any game)
    if (finished && lastOpenCount === 0) {
      stopBookAutoRefresh("game finished · no open bids");
      return;
    }
    // Live or any open bids → keep / resume ~12s
    if (autoRefreshStopped || !bookTimer) {
      startBookAutoRefresh();
    }
  }

  const _renderBook = renderBook;
  renderBook = function (data) {
    const bets = (data && data.bets) || [];
    lastOpenCount = bets.length;
    _renderBook(data);
    maybeStopOrResumeAutoRefresh();
  };


  window.addEventListener("bets-live-book", function (ev) {
    try {
      const data = ev && ev.detail;
      if (!data) return;
      window.__deskUseLivePortfolio = true;
      if (data.closed && data.closed.length) ingestClosedFromBook(data.closed);
      renderBook(data);
    } catch (e) {}
  });

  if (lb.btn) lb.btn.addEventListener("click", function () { refreshBook(); });
  refreshBook();
  startBookAutoRefresh();
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !autoRefreshStopped) refreshBook();
  });
})();


/* KALSHI_GAME_FEED — public MLB Stats API / ESPN (no Kalshi secrets) */
(function bootGameFeed() {
  "use strict";

  const REFRESH_MS = 20000; // fast while live / open bids
  const GAME_TICKER = "KXMLBGAME-26OCT062130MILSD";
  let gameTimer = null;
  let gameAutoStopped = false;

  const el = {
    sub: document.getElementById("gameFeedSub"),
    awayAbbr: document.getElementById("gameAwayAbbr"),
    homeAbbr: document.getElementById("gameHomeAbbr"),
    awayRuns: document.getElementById("gameAwayRuns"),
    homeRuns: document.getElementById("gameHomeRuns"),
    inning: document.getElementById("gameInning"),
    count: document.getElementById("gameCount"),
    bases: document.getElementById("gameBases"),
    matchup: document.getElementById("gameMatchup"),
    props: document.getElementById("gameProps"),
    plays: document.getElementById("gamePlays"),
    btn: document.getElementById("btnRefreshGame"),
  };

  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function setBases(bases) {
    if (!el.bases) return;
    const map = { first: "b1", second: "b2", third: "b3" };
    Object.keys(map).forEach(function (k) {
      const node = el.bases.querySelector("." + map[k]);
      if (node) node.classList.toggle("on", !!(bases && bases[k]));
    });
  }

  function renderProps(data) {
    if (!el.props) return;
    if (window.BetsGameFeed && typeof window.BetsGameFeed.renderPropsHtml === "function") {
      el.props.innerHTML = window.BetsGameFeed.renderPropsHtml(data);
      return;
    }
    const props = data.props || [];
    const rows = [];
    const away = data.away || {};
    const home = data.home || {};
    const badge = data.isLive ? "LIVE" : data.isFinal ? (data.winnerHint || "?") + " WINS" : "OPEN";
    rows.push(
      '<div class="prop-card"><div class="prop-card-top"><div class="prop-name">Brewers win</div><span class="prop-badge">' +
        esc(badge) +
        '</span></div><div class="prop-statline">' +
        esc(away.abbr || "MIL") +
        " " +
        (away.runs != null ? away.runs : 0) +
        " – " +
        (home.runs != null ? home.runs : 0) +
        " " +
        esc(home.abbr || "SD") +
        "</div></div>"
    );
    props.forEach(function (p) {
      const g = p.game || {};
      rows.push(
        '<div class="prop-card"><div class="prop-card-top"><div class="prop-name">' +
          esc(p.label || p.name) +
          '</div><span class="prop-badge">' +
          esc(p.propHit ? "HIT" : String(p.current != null ? p.current : g.hr || 0)) +
          '</span></div><div class="prop-statline">' +
          esc(g.summary || "0-0") +
          "</div></div>"
      );
    });
    el.props.innerHTML = rows.join("");
  }

  function renderPlays(plays) {
    if (!el.plays) return;
    if (!plays || !plays.length) {
      el.plays.innerHTML =
        '<div class="livebook-empty">No plays yet — first pitch ~9:30 PM EDT.</div>';
      return;
    }
    const html = plays
      .slice()
      .reverse()
      .map(function (p) {
        const half = (p.half || "").toString();
        const inn = p.inning != null ? half + " " + p.inning : "";
        return (
          '<div class="play-row' +
          (p.isScoring ? " scoring" : "") +
          '">' +
          '<div class="play-meta">' +
          esc(inn) +
          (p.event ? " · " + esc(p.event) : "") +
          "</div>" +
          "<div>" +
          esc(p.description) +
          "</div>" +
          "</div>"
        );
      })
      .join("");
    el.plays.innerHTML = html;
  }

  function render(data) {
    const away = data.away || {};
    const home = data.home || {};
    if (el.awayAbbr) el.awayAbbr.textContent = away.abbr || "MIL";
    if (el.homeAbbr) el.homeAbbr.textContent = home.abbr || "SD";
    if (el.awayRuns) el.awayRuns.textContent = away.runs != null ? away.runs : "0";
    if (el.homeRuns) el.homeRuns.textContent = home.runs != null ? home.runs : "0";
    if (el.inning) {
      el.inning.textContent = data.inningLabel || data.status || "—";
      el.inning.style.color = data.isLive ? "#0f766e" : data.isFinal ? "#15803d" : "#8a8794";
    }
    const c = data.count || {};
    if (el.count) {
      el.count.textContent =
        "B" +
        (c.balls != null ? c.balls : 0) +
        " · S" +
        (c.strikes != null ? c.strikes : 0) +
        " · O" +
        (c.outs != null ? c.outs : 0);
    }
    setBases(data.bases || {});

    const bits = [];
    if (data.pitcher) bits.push("P: " + data.pitcher);
    if (data.batter) bits.push("AB: " + data.batter);
    if (data.venue) bits.push(data.venue);
    if (el.matchup) {
      el.matchup.textContent = bits.length ? bits.join(" · ") : "Lineups loading…";
    }

    renderProps(data);
    renderPlays(data.plays || []);

    const now = new Date();
    const t = now.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      second: "2-digit",
      timeZone: "America/Chicago",
    });
    const src = data.source || "mlb";
    if (el.sub) {
      el.sub.textContent =
        (away.abbr || "MIL") +
        " @ " +
        (home.abbr || "SD") +
        " · " +
        (data.status || "—") +
        " · " +
        src +
        " · " +
        t +
        " CT";
    }

    // Publish status for live-book stop/resume (final + no open bids → stop)
    if (data.isFinal) {
      window.__deskGameStatus = "Final";
    } else if (data.isLive) {
      window.__deskGameStatus = data.status || "Live";
    } else {
      window.__deskGameStatus = data.status || "Scheduled";
    }
    window.__deskGameFinished = !!data.isFinal;
    try {
      if (window.BetsDoneArchive && typeof window.BetsDoneArchive.ingestWatch === "function") {
        // Prefer book when live; still merge terminal watch fills (book overwrites)
        window.BetsDoneArchive.ingestWatch(data);
      }
    } catch (eArch) {}
    if (typeof maybeStopOrResumeGameRefresh === "function") {
      maybeStopOrResumeGameRefresh();
    }
  }

  async function refreshGame() {
    if (el.btn) {
      el.btn.classList.remove("spin");
      void el.btn.offsetWidth;
      el.btn.classList.add("spin");
    }
    try {
      let data = null;
      // Prefer same-origin /api/game when a public proxy is present
      try {
        const res = await fetch(
          "/api/game?ticker=" + encodeURIComponent(GAME_TICKER)
        );
        if (res.ok) {
          const j = await res.json();
          if (j && j.ok) data = j;
        }
      } catch (_) {}
      // Static CDN / GitHub Pages: build feed in-browser (MLB+ESPN CORS *)
      if (!data && window.BetsGameFeed && window.BetsGameFeed.buildGameFeed) {
        data = await window.BetsGameFeed.buildGameFeed(GAME_TICKER);
      }
      if (!data || !data.ok) throw new Error("game feed not ok");
      render(data);
      console.log(
        "[Game]",
        data.status,
        (data.away && data.away.runs) + "-" + (data.home && data.home.runs),
        "plays",
        (data.plays || []).length
      );
    } catch (e) {
      if (el.sub) el.sub.textContent = "Game feed offline — retrying…";
      console.warn("[Game] feed unavailable", e && e.message);
    }
  }

  function stopGameAutoRefresh(reason) {
    if (gameTimer) {
      clearInterval(gameTimer);
      gameTimer = null;
    }
    gameAutoStopped = true;
    console.log("[Game] auto-refresh stopped:", reason || "game finished · no open bids");
  }

  function startGameAutoRefresh() {
    if (gameTimer) clearInterval(gameTimer);
    gameAutoStopped = false;
    gameTimer = setInterval(refreshGame, REFRESH_MS);
  }

  function maybeStopOrResumeGameRefresh() {
    const open = Number(window.__deskOpenBidCount || 0);
    const st = String(window.__deskGameStatus || "").toLowerCase();
    const finished =
      !!st &&
      (st === "final" ||
        st === "f" ||
        st === "game over" ||
        st === "completed" ||
        st === "closed" ||
        st.indexOf("final") !== -1);
    if (finished && open === 0) {
      stopGameAutoRefresh("game finished · no open bids");
      return;
    }
    if (gameAutoStopped || !gameTimer) {
      startGameAutoRefresh();
    }
  }

  if (el.btn) el.btn.addEventListener("click", refreshGame);
  refreshGame();
  startGameAutoRefresh();
  // Poll stop/resume condition (book updates open count; we publish game status)
  setInterval(maybeStopOrResumeGameRefresh, 5000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && !gameAutoStopped) refreshGame();
  });
})();
