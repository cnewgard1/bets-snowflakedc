/* public-overrides.js — WATCH-ONLY public UI. MLB/ESPN + optional read bookProxy. No keys, no orders. */
(function () {
  "use strict";

  function resolveBookProxy() {
    try {
      var q = new URLSearchParams(location.search);
      if (q.get("bookProxy")) localStorage.setItem("KALSHI_BOOK_PROXY", q.get("bookProxy"));
      if (q.get("bookToken")) localStorage.setItem("KALSHI_BOOK_TOKEN", q.get("bookToken"));
      if (q.has("bookProxy") || q.has("bookToken")) {
        q.delete("bookProxy");
        q.delete("bookToken");
        history.replaceState(null, "", location.pathname + (q.toString() ? "?" + q : "") + location.hash);
      }
    } catch (e) {}
    try {
      return {
        base: (localStorage.getItem("KALSHI_BOOK_PROXY") || "").replace(/\/$/, ""),
        token: localStorage.getItem("KALSHI_BOOK_TOKEN") || ""
      };
    } catch (e) {
      return { base: "", token: "" };
    }
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) {
      var code = ch.charCodeAt(0);
      return "&#" + code + ";";
    });
  }

  function empty(el, msg) {
    if (el) el.innerHTML = '<div class="livebook-empty">' + esc(msg) + "</div>";
  }

  // Kill any trading stubs on public host
  try {
    window.__KALSHI__ = Object.assign({}, window.__KALSHI__ || {}, { live: false, watchOnly: true });
    if (window.KalshiClient && window.KalshiClient.prototype) {
      window.KalshiClient.prototype.placeOrder = function () {
        return Promise.resolve({ ok: false, dryRun: true, error: "watch-only public UI" });
      };
    }
  } catch (e) {}

  async function refreshBookPublic() {
    var list = document.getElementById("liveBookList");
    var closedList = document.getElementById("closedBookList");
    var sub = document.getElementById("liveBookSub");
    var chip = document.getElementById("modeChip");
    var demoNote = document.getElementById("demoNote");
    var statusText = document.querySelector(".status-text");
    var proxy = resolveBookProxy();
    if (statusText) statusText.textContent = "WATCH · NO TRADE";
    try {
      var headers = { Accept: "application/json" };
      if (proxy.token) headers.Authorization = "Bearer " + proxy.token;
      var res = await fetch((proxy.base || "") + "/api/live-book?status=resting", { headers: headers });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var data = await res.json();
      if (!(data && (data.ok || (data.bets && data.bets.length) || (data.closed && data.closed.length)))) {
        throw new Error("empty");
      }
      window.dispatchEvent(new CustomEvent("bets-live-book", { detail: data }));
      if (sub) {
        var n = (data.bets && data.bets.length) || 0;
        var c = (data.closed && data.closed.length) || 0;
        sub.textContent = "Watch · " + n + " resting · " + c + " closed (read-only proxy)";
      }
      if (chip) {
        chip.textContent = "WATCH";
        chip.classList.add("live");
      }
      return;
    } catch (e) {
      window.__deskUseLivePortfolio = false;
      if (sub) {
        sub.textContent = proxy.base
          ? "Watch · book proxy unreachable"
          : "Watch-only · book empty here (no keys on public host)";
      }
      empty(
        list,
        proxy.base
          ? "Read proxy failed. Book snapshot needs a working ?bookProxy= tunnel (GET /api/live-book only). No keys on this host."
          : "OPEN book is empty on this public watch UI — Kalshi keys are never deployed here. Optional: paste a read-only tunnel (?bookProxy=&bookToken=)."
      );
      empty(
        closedList,
        "Closed / settled book needs a read-only desk snapshot or bookProxy. Trading stays on ~/Grok/kalshi-desk only."
      );
      if (chip) {
        chip.textContent = "WATCH";
        chip.classList.remove("live");
      }
      if (demoNote) {
        demoNote.textContent =
          "Watch-only · MLB/ESPN game on · no order placement · Kalshi keys never on Lovable/GitHub";
      }
    }
  }

  async function refreshGamePublic() {
    var GAME_TICKER = "KXMLBGAME-26OCT062130MILSD";
    var el = {
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
      plays: document.getElementById("gamePlays")
    };
    try {
      if (!window.BetsGameFeed) throw new Error("no feed");
      var data = await window.BetsGameFeed.buildGameFeed(GAME_TICKER);
      if (!data || !data.ok) throw new Error("bad feed");
      var away = data.away || {};
      var home = data.home || {};
      if (el.awayAbbr) el.awayAbbr.textContent = away.abbr || "MIL";
      if (el.homeAbbr) el.homeAbbr.textContent = home.abbr || "SD";
      if (el.awayRuns) el.awayRuns.textContent = away.runs != null ? away.runs : "0";
      if (el.homeRuns) el.homeRuns.textContent = home.runs != null ? home.runs : "0";
      if (el.inning) {
        el.inning.textContent = data.inningLabel || data.status || "—";
        el.inning.style.color = data.isLive ? "#0f766e" : data.isFinal ? "#15803d" : "#8a8794";
      }
      var c = data.count || {};
      if (el.count) {
        el.count.textContent =
          "B" + (c.balls || 0) + " · S" + (c.strikes || 0) + " · O" + (c.outs || 0);
      }
      if (el.bases) {
        [["first", "b1"], ["second", "b2"], ["third", "b3"]].forEach(function (pair) {
          var n = el.bases.querySelector("." + pair[1]);
          if (n) n.classList.toggle("on", !!(data.bases && data.bases[pair[0]]));
        });
      }
      var bits = [];
      if (data.pitcher) bits.push("P: " + data.pitcher);
      if (data.batter) bits.push("AB: " + data.batter);
      if (data.venue) bits.push(data.venue);
      if (el.matchup) el.matchup.textContent = bits.length ? bits.join(" · ") : "Lineups loading…";
      if (el.props) {
        var badge = data.isLive
          ? "LIVE"
          : data.isFinal && data.winnerHint
            ? data.winnerHint + " WINS"
            : "OPEN";
        var rows = [
          '<div class="prop-row"><div class="prop-name">Brewers win</div><div class="prop-line">' +
            esc(away.abbr || "MIL") +
            " " +
            (away.runs || 0) +
            " – " +
            (home.runs || 0) +
            " " +
            esc(home.abbr || "SD") +
            '</div><span class="prop-hr">' +
            esc(badge) +
            "</span></div>"
        ];
        (data.props || []).forEach(function (p) {
          var g = p.game || {};
          rows.push(
            '<div class="prop-row"><div class="prop-name">' +
              esc(p.name) +
              ' 1+ HR</div><div class="prop-line">' +
              esc(g.summary || "0-0") +
              '</div><span class="prop-hr' +
              (p.propHit ? " hit" : "") +
              '">' +
              esc(p.propHit ? "HR OK" : (g.hr || 0) + " HR") +
              "</span></div>"
          );
        });
        el.props.innerHTML = rows.join("");
      }
      if (el.plays) {
        var plays = data.plays || [];
        el.plays.innerHTML = plays.length
          ? plays
              .slice()
              .reverse()
              .map(function (p) {
                var inn = p.inning != null ? (p.half || "") + " " + p.inning : "";
                return (
                  '<div class="play-row' +
                  (p.isScoring ? " scoring" : "") +
                  '"><div class="play-meta">' +
                  esc(inn) +
                  (p.event ? " · " + esc(p.event) : "") +
                  "</div><div>" +
                  esc(p.description) +
                  "</div></div>"
                );
              })
              .join("")
          : '<div class="livebook-empty">No plays yet — first pitch ~9:30 PM EDT.</div>';
      }
      var t = new Date().toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZone: "America/Chicago"
      });
      if (el.sub) {
        el.sub.textContent =
          (away.abbr || "MIL") +
          " @ " +
          (home.abbr || "SD") +
          " · " +
          (data.status || "—") +
          " · " +
          (data.source || "mlb") +
          " · " +
          t +
          " CT";
      }
      window.__deskGameStatus = data.isFinal
        ? "Final"
        : data.isLive
          ? data.status || "Live"
          : data.status || "Scheduled";
      window.__deskGameFinished = !!data.isFinal;
      console.log("[Game/watch]", data.status, (away.runs || 0) + "-" + (home.runs || 0));
    } catch (e) {
      if (el.sub) el.sub.textContent = "Game feed offline — MLB/ESPN retrying…";
      if (el.matchup) {
        el.matchup.textContent = "Watch UI uses statsapi.mlb.com + ESPN (no Kalshi keys).";
      }
      console.warn("[Game/watch]", e && e.message);
    }
  }

  function boot() {
    setTimeout(refreshBookPublic, 500);
    setInterval(refreshBookPublic, 12000);
    var btnB = document.getElementById("btnRefreshBook");
    if (btnB) {
      btnB.addEventListener(
        "click",
        function (ev) {
          ev.stopImmediatePropagation();
          refreshBookPublic();
        },
        true
      );
    }
    setTimeout(refreshGamePublic, 150);
    setInterval(refreshGamePublic, 20000);
    var btnG = document.getElementById("btnRefreshGame");
    if (btnG) {
      btnG.addEventListener(
        "click",
        function (ev) {
          ev.stopImmediatePropagation();
          refreshGamePublic();
        },
        true
      );
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
