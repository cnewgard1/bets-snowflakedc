/* Public MLB/ESPN game feed for static hosting. No Kalshi secrets. */
(function (global) {
  // Tracked props: HR / hits / RBI / K monitors. Fun opportunity estimates — not Kalshi mids.
  const TRACKED_PROPS = [
    {
      key: "bauers_hr",
      match: ["jake bauers", "bauers"],
      player: "Jake Bauers",
      label: "Bauers 1+ HR",
      kind: "hr",
      line: 1,
      role: "batter",
    },
    {
      key: "yelich_hr",
      match: ["christian yelich", "yelich"],
      player: "Christian Yelich",
      label: "Yelich 1+ HR",
      kind: "hr",
      line: 1,
      role: "batter",
    },
    {
      key: "ortiz_hr",
      match: ["joey ortiz", "ortiz"],
      player: "Joey Ortiz",
      label: "Ortiz 1+ HR",
      kind: "hr",
      line: 1,
      role: "batter",
    },
    {
      key: "chourio_h",
      match: ["jackson chourio", "chourio"],
      player: "Jackson Chourio",
      label: "Chourio 1+ H",
      kind: "hits",
      line: 1,
      role: "batter",
    },
    {
      key: "contreras_rbi",
      match: ["william contreras", "contreras"],
      player: "William Contreras",
      label: "Contreras 1+ RBI",
      kind: "rbi",
      line: 1,
      role: "batter",
    },
    {
      key: "may_k",
      match: ["dustin may"],
      player: "Dustin May",
      label: "May Ks",
      kind: "ks",
      line: null,
      role: "pitcher",
    },
  ];

  // Casual fun rates (labeled as estimates in UI)
  const PA_PER_TEAM_INNING = 1.0; // ~1 PA per remaining half-inning for a regular
  const EXPECTED_PA_GAME = 4.0;
  const BF_PER_IP = 3.8;
  const EXPECTED_IP_START = 5.5;

  const TEAM_ABBR = { MIL: "Milwaukee Brewers", SD: "San Diego Padres" };
  const MLB_TEAMS =
    "MIL|SD|LAD|ATL|NYY|BOS|CHC|NYM|PHI|HOU|TEX|SEA|SF|OAK|TOR|TB|MIN|CLE|DET|KC|CWS|CIN|PIT|STL|COL|ARI|MIA|WSH";

  async function publicGet(url) {
    try {
      const res = await fetch(url, {
        headers: { Accept: "application/json" },
      });
      const body = await res.json().catch(() => ({}));
      return { status: res.status, ok: res.ok, body };
    } catch (e) {
      return { status: 0, ok: false, body: { error: String(e && e.message) } };
    }
  }

  function parseGameTicker(ticker) {
    ticker = String(ticker || "KXMLBGAME-26OCT062130MILSD").toUpperCase();
    const m = ticker.match(
      /(\d{2})([A-Z]{3})(\d{2})(\d{4})(MIL|SD|LAD|ATL|NYY|BOS|CHC|NYM|PHI|HOU|TEX|SEA|SF|OAK|TOR|TB|MIN|CLE|DET|KC|CWS|CIN|PIT|STL|COL|ARI|MIA|WSH)(MIL|SD|LAD|ATL|NYY|BOS|CHC|NYM|PHI|HOU|TEX|SEA|SF|OAK|TOR|TB|MIN|CLE|DET|KC|CWS|CIN|PIT|STL|COL|ARI|MIA|WSH)/
    );
    if (!m) {
      return {
        dateIso: "2026-10-06",
        dateMlb: "10/06/2026",
        dateEspn: "20261006",
        awayAbbr: "MIL",
        homeAbbr: "SD",
        hhmm: "2130",
        ticker,
      };
    }
    const months = {
      JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
      JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
    };
    const yy = parseInt(m[1], 10);
    const year = 2000 + yy;
    const mon = months[m[2]] || 10;
    const dd = parseInt(m[3], 10);
    return {
      dateIso: year.toString().padStart(4, "0") + "-" + String(mon).padStart(2, "0") + "-" + String(dd).padStart(2, "0"),
      dateMlb: String(mon).padStart(2, "0") + "/" + String(dd).padStart(2, "0") + "/" + year,
      dateEspn: year + String(mon).padStart(2, "0") + String(dd).padStart(2, "0"),
      awayAbbr: m[5],
      homeAbbr: m[6],
      hhmm: m[4],
      ticker,
    };
  }

  function playerMatch(fullName, needles) {
    const n = String(fullName || "").toLowerCase();
    return needles.some((x) => n.includes(x));
  }

  function parseInningsPitched(ip) {
    if (ip == null || ip === "") return 0;
    if (typeof ip === "number") return ip;
    const s = String(ip);
    const parts = s.split(".");
    const whole = parseInt(parts[0], 10) || 0;
    const frac = parts.length > 1 ? parseInt(parts[1], 10) || 0 : 0;
    // MLB stores .1 / .2 as outs
    return whole + (frac >= 3 ? frac / 10 : frac / 3);
  }

  function teamHalfInningsLeft(inning, inningState, isFinal, side) {
    if (isFinal) return 0;
    const inn = inning == null ? 1 : Number(inning) || 1;
    const state = String(inningState || "Top").toLowerCase();
    // Pregame / scheduled: full 9 halves for each side
    if (inning == null && !inningState) return 9;

    let left = 0;
    if (side === "away") {
      // Away bats tops
      if (state === "top") left = Math.max(0, 9 - inn + 1);
      else left = Math.max(0, 9 - inn);
    } else {
      // Home bats bottoms
      if (state === "bottom") left = Math.max(0, 9 - inn + 1);
      else if (state === "top" || state === "middle") left = Math.max(0, 9 - inn + 1);
      else left = Math.max(0, 9 - inn); // End
    }
    if (inn > 9) left = Math.max(left, state === "end" ? 0 : 1);
    return left;
  }

  function pitcherInningsLeft(inning, inningState, isFinal, ipThrown) {
    if (isFinal) return 0;
    const inn = inning == null ? 1 : Number(inning) || 1;
    const state = String(inningState || "Top").toLowerCase();
    let gameIPLeft = 0;
    if (inning == null) gameIPLeft = EXPECTED_IP_START;
    else {
      // Rough full-game innings remaining (both sides)
      const rem = Math.max(0, 9 - inn + (state === "bottom" || state === "end" ? 0 : 0.5));
      gameIPLeft = rem;
    }
    const thrown = parseInningsPitched(ipThrown);
    const startLeft = Math.max(0, EXPECTED_IP_START - thrown);
    // Cap to what's left in the game and a typical start
    return Math.min(startLeft, Math.max(gameIPLeft, 0));
  }

  function buildOpportunity(prop, game, ctx) {
    const kind = prop.kind;
    const line = prop.line;
    const current =
      kind === "hr"
        ? game.hr || 0
        : kind === "hits"
          ? game.h || 0
          : kind === "rbi"
            ? game.rbi || 0
            : kind === "ks"
              ? game.so || 0
              : 0;
    const hit = line != null ? current >= line : false;

    if (ctx.isFinal && !hit && line != null) {
      return {
        current,
        estRemaining: 0,
        estLabel: "final · missed",
        progressPct: 100,
        vibe: "dead",
        vibeLabel: "Final · no cash",
        detail: kind === "ks" ? (game.ip || "0") + " IP" : (game.ab || 0) + " AB",
      };
    }
    if (hit) {
      return {
        current,
        estRemaining: 0,
        estLabel: "cashed",
        progressPct: 100,
        vibe: "hit",
        vibeLabel: "HIT ✓",
        detail: kind === "ks" ? current + " K" : null,
      };
    }

    if (prop.role === "pitcher" || kind === "ks") {
      const ipLeft = pitcherInningsLeft(ctx.inning, ctx.inningState, ctx.isFinal, game.ip);
      const bfLeft = Math.round(ipLeft * BF_PER_IP * 10) / 10;
      const thrown = parseInningsPitched(game.ip);
      const progressPct = Math.min(
        100,
        Math.round((thrown / EXPECTED_IP_START) * 100)
      );
      const vibe = ctx.isLive || thrown > 0 ? "alive" : "pre";
      return {
        current,
        estRemaining: bfLeft,
        estLabel: "est ~" + (Math.round(ipLeft * 10) / 10) + " IP / ~" + Math.round(bfLeft) + " BF",
        progressPct,
        vibe,
        vibeLabel: progressPct + "% start · " + current + " K",
        detail: (game.ip || "0") + " IP · " + (game.bf || 0) + " BF",
      };
    }

    // Batter props
    const side = prop.side || game.side || "away";
    const halves = teamHalfInningsLeft(ctx.inning, ctx.inningState, ctx.isFinal, side);
    const estPA = Math.round(halves * PA_PER_TEAM_INNING * 10) / 10;
    const ab = game.ab || 0;
    const pa = game.pa != null ? game.pa : ab + (game.bb || 0);
    const progressPct = Math.min(100, Math.round((pa / EXPECTED_PA_GAME) * 100));
    const vibe = ctx.isLive || ab > 0 ? "alive" : "pre";
    let unit = "AB";
    if (kind === "hits") unit = "AB";
    if (kind === "rbi") unit = "AB";
    return {
      current,
      estRemaining: estPA,
      estLabel: "est ~" + estPA + " " + unit + " left",
      progressPct,
      vibe,
      vibeLabel: progressPct + "% through · ~" + estPA + " " + unit + " left",
      detail: (game.summary || ab + " AB") + (kind === "hr" ? " · " + (game.hr || 0) + " HR" : ""),
    };
  }

  function emptyGame() {
    return {
      ab: 0,
      h: 0,
      hr: 0,
      rbi: 0,
      bb: 0,
      k: 0,
      pa: 0,
      so: 0,
      ip: "0.0",
      bf: 0,
      summary: "0-0",
      side: null,
    };
  }

  function attachOpportunities(props, ctx) {
    return (props || []).map(function (p) {
      const game = p.game || emptyGame();
      const opp = buildOpportunity(p, game, ctx || {});
      return Object.assign({}, p, {
        current: opp.current,
        opportunity: opp,
        propHit: p.line != null ? opp.current >= p.line : !!p.propHit,
      });
    });
  }

  function escHtml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderPropsHtml(data) {
    const props = attachOpportunities(data.props || [], {
      inning: data.inning,
      inningState: data.inningState,
      isFinal: data.isFinal,
      isLive: data.isLive,
    });
    const away = data.away || {};
    const home = data.home || {};
    const rows = [];

    let winnerBadge = "OPEN";
    let winnerCls = "prop-badge";
    if (data.isFinal && data.winnerHint === "MIL") {
      winnerBadge = "MIL WINS";
      winnerCls = "prop-badge hit";
    } else if (data.isFinal && data.winnerHint && data.winnerHint !== "MIL") {
      winnerBadge = data.winnerHint + " WINS";
      winnerCls = "prop-badge dead";
    } else if (data.isLive) {
      winnerBadge = "LIVE";
      winnerCls = "prop-badge alive";
    }

    rows.push(
      '<div class="prop-card prop-game">' +
        '<div class="prop-card-top">' +
        '<div class="prop-name">Brewers win</div>' +
        '<span class="' +
        winnerCls +
        '">' +
        escHtml(winnerBadge) +
        "</span></div>" +
        '<div class="prop-statline">' +
        escHtml(away.abbr || "MIL") +
        " " +
        (away.runs != null ? away.runs : 0) +
        " – " +
        (home.runs != null ? home.runs : 0) +
        " " +
        escHtml(home.abbr || "SD") +
        "</div>" +
        '<div class="prop-bar"><div class="prop-bar-fill vibe-' +
        (data.isFinal ? (data.winnerHint === "MIL" ? "hit" : "dead") : data.isLive ? "alive" : "pre") +
        '" style="width:' +
        (data.isFinal ? "100" : data.isLive ? "55" : "8") +
        '%"></div></div>' +
        '<div class="prop-vibe">' +
        (data.isFinal
          ? data.winnerHint === "MIL"
            ? "Final · Brewers cash"
            : "Final · " + escHtml(data.winnerHint || "?")
          : data.isLive
            ? "Live · scoreboard watch (not a Kalshi mid)"
            : "Pregame · waiting on first pitch") +
        "</div></div>"
    );

    props.forEach(function (p) {
      const g = p.game || emptyGame();
      const o = p.opportunity || {};
      const kind = p.kind || "hr";
      let statline = "";
      let badge = "";
      if (kind === "hr") {
        statline =
          (g.hr || 0) +
          " HR · " +
          (g.summary || "0-0") +
          " · AB " +
          (g.ab || 0);
        badge = p.propHit ? "HR ✓" : (g.hr || 0) + " HR";
      } else if (kind === "hits") {
        statline =
          (g.h || 0) +
          " H · " +
          (g.summary || "0-0") +
          " · AB " +
          (g.ab || 0);
        badge = p.propHit ? "HIT ✓" : (g.h || 0) + " H";
      } else if (kind === "rbi") {
        statline =
          (g.rbi || 0) +
          " RBI · " +
          (g.summary || "0-0") +
          " · AB " +
          (g.ab || 0);
        badge = p.propHit ? "RBI ✓" : (g.rbi || 0) + " RBI";
      } else if (kind === "ks") {
        statline =
          (g.so || 0) +
          " K · " +
          (g.ip || "0.0") +
          " IP · " +
          (g.bf || 0) +
          " BF";
        badge = (g.so || 0) + " K";
      } else {
        statline = g.summary || "—";
        badge = "—";
      }

      const vibe = o.vibe || "pre";
      const pct = o.progressPct != null ? o.progressPct : 0;
      rows.push(
        '<div class="prop-card vibe-' +
          escHtml(vibe) +
          '">' +
          '<div class="prop-card-top">' +
          '<div class="prop-name">' +
          escHtml(p.label || p.name) +
          "</div>" +
          '<span class="prop-badge ' +
          escHtml(vibe) +
          '">' +
          escHtml(badge) +
          "</span></div>" +
          '<div class="prop-statline">' +
          escHtml(statline) +
          "</div>" +
          '<div class="prop-bar"><div class="prop-bar-fill vibe-' +
          escHtml(vibe) +
          '" style="width:' +
          pct +
          '%"></div></div>' +
          '<div class="prop-vibe">' +
          escHtml(o.vibeLabel || "") +
          (o.estLabel && vibe !== "hit"
            ? " · " + escHtml(o.estLabel)
            : "") +
          "</div>" +
          (vibe === "alive" || vibe === "pre"
            ? '<div class="prop-note">est from innings left × ~1 PA/inn · not a Kalshi mid</div>'
            : "") +
          "</div>"
      );
    });

    return rows.join("");
  }

  async function buildGameFeed(ticker) {
    const meta = parseGameTicker(ticker);
    const awayAbbr = meta.awayAbbr;
    const homeAbbr = meta.homeAbbr;

    const schedUrl =
      "https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=" +
      encodeURIComponent(meta.dateMlb) +
      "&hydrate=linescore,team,probablePitcher";
    const sched = await publicGet(schedUrl);
    let gamePk = null;
    let scheduleGame = null;
    if (sched.ok) {
      for (const day of sched.body.dates || []) {
        for (const g of day.games || []) {
          const a = (((g.teams || {}).away || {}).team) || {};
          const h = (((g.teams || {}).home || {}).team) || {};
          const aname = String(a.name || "").toLowerCase();
          const hname = String(h.name || "").toLowerCase();
          const an = String(a.abbreviation || a.teamName || a.name || "").toUpperCase();
          const hn = String(h.abbreviation || h.teamName || h.name || "").toUpperCase();
          const milSide =
            aname.includes("milwaukee") ||
            hname.includes("milwaukee") ||
            an === "MIL" ||
            hn === "MIL";
          const sdSide =
            aname.includes("san diego") ||
            hname.includes("san diego") ||
            aname.includes("padres") ||
            hname.includes("padres") ||
            an === "SD" ||
            hn === "SD";
          if (milSide && sdSide) {
            gamePk = g.gamePk;
            scheduleGame = g;
            break;
          }
        }
        if (gamePk) break;
      }
    }

    const espn = await publicGet(
      "https://site.api.espn.com/apis/site/v2/sports/baseball/mlb/scoreboard?dates=" +
        meta.dateEspn
    );
    let espnEvent = null;
    if (espn.ok) {
      for (const e of espn.body.events || []) {
        const comps = (e.competitions || [{}])[0];
        const abbrs = (comps.competitors || []).map((c) =>
          String(((c.team || {}).abbreviation) || "").toUpperCase()
        );
        if (abbrs.includes(awayAbbr) && abbrs.includes(homeAbbr)) {
          espnEvent = e;
          break;
        }
      }
    }

    let live = null;
    if (gamePk) {
      const liveRes = await publicGet(
        "https://statsapi.mlb.com/api/v1.1/game/" + gamePk + "/feed/live"
      );
      if (liveRes.ok) live = liveRes.body;
    }

    let statusText = "Scheduled";
    let inning = null;
    let inningState = null;
    let outs = 0,
      balls = 0,
      strikes = 0;
    let awayRuns = 0,
      homeRuns = 0,
      awayHits = 0,
      homeHits = 0,
      awayErrors = 0,
      homeErrors = 0;
    let isLive = false,
      isFinal = false;
    let startTime = null,
      venue = null;
    let playsOut = [];
    let props = [];
    let bases = { first: false, second: false, third: false };
    let batter = null,
      pitcher = null;
    let awayName = TEAM_ABBR[awayAbbr] || awayAbbr;
    let homeName = TEAM_ABBR[homeAbbr] || homeAbbr;

    if (scheduleGame) {
      const st = scheduleGame.status || {};
      statusText = st.detailedState || st.abstractGameState || statusText;
      startTime = scheduleGame.gameDate;
      venue = ((scheduleGame.venue || {}).name) || null;
      const ateam = (((scheduleGame.teams || {}).away || {}).team) || {};
      const hteam = (((scheduleGame.teams || {}).home || {}).team) || {};
      awayName = ateam.name || awayName;
      homeName = hteam.name || homeName;
      const ls = scheduleGame.linescore || {};
      if (ls) {
        awayRuns = (((ls.teams || {}).away || {}).runs) || 0;
        homeRuns = (((ls.teams || {}).home || {}).runs) || 0;
      }
    }

    if (espnEvent && !live) {
      const comps = (espnEvent.competitions || [{}])[0];
      const st = ((comps.status || {}).type) || {};
      statusText = st.detail || st.description || statusText;
      for (const c of comps.competitors || []) {
        const abbr = String(((c.team || {}).abbreviation) || "").toUpperCase();
        const score = parseInt(c.score || 0, 10);
        if (abbr === awayAbbr) awayRuns = score;
        if (abbr === homeAbbr) homeRuns = score;
      }
    }

    const roster = []; // { name, side, batting, pitching }

    if (live) {
      const gd = live.gameData || {};
      const ld = live.liveData || {};
      const st = gd.status || {};
      statusText = st.detailedState || statusText;
      const abstract = String(st.abstractGameState || "").toLowerCase();
      isLive = abstract === "live";
      isFinal = abstract === "final" || st.codedGameState === "F";
      startTime = ((gd.datetime || {}).dateTime) || startTime;
      venue = ((gd.venue || {}).name) || venue;
      const teams = gd.teams || {};
      awayName = ((teams.away || {}).name) || awayName;
      homeName = ((teams.home || {}).name) || homeName;

      const ls = ld.linescore || {};
      inning = ls.currentInning;
      inningState = ls.inningState;
      outs = ls.outs || 0;
      balls = ls.balls || 0;
      strikes = ls.strikes || 0;
      awayRuns = (((ls.teams || {}).away || {}).runs) ?? awayRuns;
      homeRuns = (((ls.teams || {}).home || {}).runs) ?? homeRuns;
      awayHits = (((ls.teams || {}).away || {}).hits) || 0;
      homeHits = (((ls.teams || {}).home || {}).hits) || 0;
      awayErrors = (((ls.teams || {}).away || {}).errors) || 0;
      homeErrors = (((ls.teams || {}).home || {}).errors) || 0;
      const offense = ls.offense || {};
      bases = {
        first: !!offense.first,
        second: !!offense.second,
        third: !!offense.third,
      };

      const plays = ld.plays || {};
      const cp = plays.currentPlay || {};
      const mu = cp.matchup || {};
      if (mu.batter) batter = mu.batter.fullName;
      if (mu.pitcher) pitcher = mu.pitcher.fullName;

      const allPlays = plays.allPlays || [];
      const interesting = [];
      for (const p of allPlays) {
        const r = p.result || {};
        const a = p.about || {};
        const desc = r.description || r.event || "";
        if (!desc) continue;
        interesting.push({
          inning: a.inning,
          half: a.halfInning,
          event: r.event,
          description: desc,
          isScoring: !!r.isScoringPlay || (r.awayScore != null && r.homeScore != null && (r.rbi || 0) > 0),
        });
      }
      playsOut = interesting.slice(-18);

      const box = ld.boxscore || {};
      for (const side of ["away", "home"]) {
        const teamBox = (box.teams || {})[side] || {};
        const plist = teamBox.players || {};
        for (const pid of Object.keys(plist)) {
          const pl = plist[pid] || {};
          const person = pl.person || {};
          const batting = ((pl.stats || {}).batting) || {};
          const pitching = ((pl.stats || {}).pitching) || {};
          roster.push({
            name: person.fullName || "",
            side,
            batting,
            pitching,
          });
        }
      }
    }

    const ctx = { inning, inningState, isFinal, isLive };

    props = TRACKED_PROPS.map(function (pp) {
      const found = roster.find(function (b) {
        return playerMatch(b.name, pp.match);
      });
      const bat = (found && found.batting) || {};
      const pit = (found && found.pitching) || {};
      const ab = bat.atBats || 0;
      const h = bat.hits || 0;
      const hr = bat.homeRuns || 0;
      const rbi = bat.rbi || 0;
      const bb = bat.baseOnBalls || 0;
      const k = bat.strikeOuts || 0;
      const so = pit.strikeOuts || 0;
      const ip = pit.inningsPitched != null ? String(pit.inningsPitched) : "0.0";
      const bf = pit.battersFaced || 0;
      const summary =
        bat.summary ||
        (pp.role === "pitcher" ? so + " K, " + ip + " IP" : h + "-" + ab);
      const game = {
        ab,
        h,
        hr,
        rbi,
        bb,
        k,
        pa: ab + bb,
        so,
        ip,
        bf,
        summary,
        side: found ? found.side : pp.role === "pitcher" ? "home" : "away",
      };
      const current =
        pp.kind === "hr"
          ? hr
          : pp.kind === "hits"
            ? h
            : pp.kind === "rbi"
              ? rbi
              : pp.kind === "ks"
                ? so
                : 0;
      const propHit = pp.line != null ? current >= pp.line : false;
      const base = {
        key: pp.key,
        name: pp.player,
        label: pp.label,
        kind: pp.kind,
        line: pp.line,
        role: pp.role,
        side: game.side,
        propHit,
        current,
        game,
      };
      base.opportunity = buildOpportunity(base, game, ctx);
      return base;
    });

    let winnerHint = null;
    if (isFinal) {
      if (awayRuns > homeRuns) winnerHint = awayAbbr;
      else if (homeRuns > awayRuns) winnerHint = homeAbbr;
    }

    let inningLabel = statusText;
    if (isLive && inning != null) {
      inningLabel = (inningState || "") + " " + inning;
    } else if (isFinal) {
      inningLabel = "Final";
    }

    return {
      ok: true,
      source: live ? "mlb-statsapi" : espnEvent ? "espn" : "none",
      ticker: meta.ticker,
      status: statusText,
      isLive,
      isFinal,
      inning,
      inningState,
      inningLabel,
      startTime,
      venue,
      count: { balls, strikes, outs },
      bases,
      batter,
      pitcher,
      away: {
        abbr: awayAbbr,
        name: awayName,
        runs: awayRuns,
        hits: awayHits,
        errors: awayErrors,
      },
      home: {
        abbr: homeAbbr,
        name: homeName,
        runs: homeRuns,
        hits: homeHits,
        errors: homeErrors,
      },
      winnerHint,
      plays: playsOut,
      props,
      meta,
    };
  }

  global.BetsGameFeed = {
    buildGameFeed,
    parseGameTicker,
    renderPropsHtml,
    attachOpportunities,
    TRACKED_PROPS,
  };
})(typeof window !== "undefined" ? window : globalThis);
