/* Public MLB/ESPN game feed for static hosting. No Kalshi secrets. */
(function (global) {
  const PROP_PLAYERS = [
    { key: "bauers", match: ["jake bauers", "bauers"], label: "Jake Bauers" },
    { key: "yelich", match: ["christian yelich", "yelich"], label: "Christian Yelich" },
    { key: "ortiz", match: ["joey ortiz", "ortiz"], label: "Joey Ortiz" },
  ];
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
    const re = new RegExp(
      "(?<yy>\\\\d{2})(?<mon>[A-Z]{3})(?<dd>\\\\d{2})(?<hhmm>\\\\d{4})(?<t1>" +
        MLB_TEAMS +
        ")(?<t2>" +
        MLB_TEAMS +
        ")"
    );
    // Fixed regex without over-escaping for literal use:
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

      // Boxscore props for HR watch
      const box = ld.boxscore || {};
      const players = box.players || {};
      // Also walk team batters
      const batters = [];
      for (const side of ["away", "home"]) {
        const teamBox = (box.teams || {})[side] || {};
        const plist = teamBox.players || {};
        for (const pid of Object.keys(plist)) {
          const pl = plist[pid] || {};
          const person = pl.person || {};
          const stats = ((pl.stats || {}).batting) || {};
          batters.push({
            name: person.fullName || "",
            hr: stats.homeRuns || 0,
            ab: stats.atBats || 0,
            h: stats.hits || 0,
            rbi: stats.rbi || 0,
            summary: (stats.hits || 0) + "-" + (stats.atBats || 0),
          });
        }
      }
      props = PROP_PLAYERS.map((pp) => {
        const found = batters.find((b) => playerMatch(b.name, pp.match));
        const g = found || { hr: 0, ab: 0, h: 0, rbi: 0, summary: "0-0" };
        return {
          key: pp.key,
          name: pp.label,
          propHit: (g.hr || 0) >= 1,
          game: g,
        };
      });
    } else {
      props = PROP_PLAYERS.map((pp) => ({
        key: pp.key,
        name: pp.label,
        propHit: false,
        game: { hr: 0, ab: 0, h: 0, rbi: 0, summary: "0-0" },
      }));
    }

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

  global.BetsGameFeed = { buildGameFeed, parseGameTicker };
})(typeof window !== "undefined" ? window : globalThis);
