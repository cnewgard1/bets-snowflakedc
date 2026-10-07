/* Public MLB/ESPN game feed for static hosting. No Kalshi secrets. */
(function (global) {
  // Tracked props: HR / hits / RBI / K monitors. Fun opportunity estimates — not Kalshi mids.
  // Known filled YES positions (contracts @ cost → max $1/contract payout).
  // Used when no live-book proxy; mergePropFills() can override from positions.
  const KNOWN_PROP_FILLS = {
    brewers_win: { contracts: 90, cost: 39.6, payout: 90, tickerHint: "KXMLBGAME" },
    bauers_hr: { contracts: 166, cost: 24.9, payout: 166, tickerHint: "JBAUERS" },
    yelich_hr: { contracts: 222, cost: 19.98, payout: 222, tickerHint: "CYELICH" },
    ortiz_hr: { contracts: 300, cost: 15.0, payout: 300, tickerHint: "JORTIZ" },
    chourio_h: { contracts: 15, cost: 9.75, payout: 15, tickerHint: "JCHOURIO" },
    contreras_rbi: { contracts: 25, cost: 7.5, payout: 25, tickerHint: "WCONTRERAS" },
    may_k: { contracts: 11, cost: 6.05, payout: 11, tickerHint: "DMAY3-3" },
  };

  const TRACKED_PROPS = [
    {
      key: "bauers_hr",
      match: ["jake bauers", "bauers"],
      player: "Jake Bauers",
      label: "Bauers 1+ HR",
      kind: "hr",
      line: 1,
      role: "batter",
      fill: KNOWN_PROP_FILLS.bauers_hr,
    },
    {
      key: "yelich_hr",
      match: ["christian yelich", "yelich"],
      player: "Christian Yelich",
      label: "Yelich 1+ HR",
      kind: "hr",
      line: 1,
      role: "batter",
      fill: KNOWN_PROP_FILLS.yelich_hr,
    },
    {
      key: "ortiz_hr",
      match: ["joey ortiz", "ortiz"],
      player: "Joey Ortiz",
      label: "Ortiz 1+ HR",
      kind: "hr",
      line: 1,
      role: "batter",
      fill: KNOWN_PROP_FILLS.ortiz_hr,
    },
    {
      key: "chourio_h",
      match: ["jackson chourio", "chourio"],
      player: "Jackson Chourio",
      label: "Chourio 1+ H",
      kind: "hits",
      line: 1,
      role: "batter",
      fill: KNOWN_PROP_FILLS.chourio_h,
    },
    {
      key: "contreras_rbi",
      match: ["william contreras", "contreras"],
      player: "William Contreras",
      label: "Contreras 1+ RBI",
      kind: "rbi",
      line: 1,
      role: "batter",
      fill: KNOWN_PROP_FILLS.contreras_rbi,
    },
    {
      key: "may_k",
      match: ["dustin may"],
      player: "Dustin May",
      label: "May 3+ Ks",
      kind: "ks",
      line: 3,
      role: "pitcher",
      fill: KNOWN_PROP_FILLS.may_k,
    },
  ];

  // Casual fun rates (labeled as estimates in UI)
  const PA_PER_TEAM_INNING = 1.0; // ~1 PA per remaining half-inning for a regular
  const EXPECTED_PA_GAME = 4.0;
  const BF_PER_IP = 3.8;
  const EXPECTED_IP_START = 5.5;

  // Casual per-opportunity rates for fun success % (NOT Kalshi mids / market prices).
  const SUCCESS_RATE = {
    hr: 0.035, // HR per PA
    hits: 0.27, // hit per AB/PA
    rbi: 0.12, // RBI event per PA (rough)
    ks: 0.22, // K per batter faced
  };

  function clampPct(n) {
    const x = Math.round(Number(n));
    if (!isFinite(x)) return 0;
    return Math.max(0, Math.min(100, x));
  }

  /** P(at least k successes in n Bernoulli trials) — small-k exact, else soft curve. */
  function bernoulliAtLeast(p, n, k) {
    if (k <= 0) return 1;
    if (n <= 0 || p <= 0) return 0;
    if (p >= 1) return 1;
    const trials = Math.max(0, Math.min(40, Math.round(n * 10) / 10));
    if (k === 1) return 1 - Math.pow(1 - p, trials);
    if (k === 2) {
      const q = 1 - p;
      const p0 = Math.pow(q, trials);
      const p1 = trials * p * Math.pow(q, Math.max(0, trials - 1));
      return Math.max(0, 1 - p0 - p1);
    }
    // k >= 3: Poisson-ish soft curve from expected count
    const expected = p * trials;
    if (expected <= 0) return 0;
    // P(X >= k) ≈ 1 - e^{-λ} * sum_{i=0}^{k-1} λ^i / i!
    let term = Math.exp(-expected);
    let cdf = term;
    for (let i = 1; i < k; i++) {
      term *= expected / i;
      cdf += term;
    }
    return Math.max(0, Math.min(1, 1 - cdf));
  }

  /**
   * Simple success possibility % from remaining ABs/IP/BF + progress vs line.
   * Hit → 100, dead → 0. Labeled in UI as estimate, not Kalshi mid.
   */
  function estimateSuccessPct(opts) {
    const vibe = opts.vibe;
    if (vibe === "hit") return 100;
    if (vibe === "dead") return 0;
    const line = opts.line != null ? Number(opts.line) : null;
    const current = opts.current != null ? Number(opts.current) : 0;
    if (line != null && current >= line) return 100;
    const need = line != null ? Math.max(0, line - current) : 1;
    if (need === 0) return 100;
    const est = opts.estRemaining != null ? Number(opts.estRemaining) : 0;
    const kind = opts.kind || "hits";
    const p = SUCCESS_RATE[kind] != null ? SUCCESS_RATE[kind] : 0.15;
    let raw = bernoulliAtLeast(p, est, need);
    // Mild late-game dampener when still short and clock is mostly spent
    const progressPct = opts.progressPct != null ? Number(opts.progressPct) : 0;
    if (need > 0 && progressPct >= 80 && est < need * (kind === "ks" ? 4 : 1.2)) {
      raw *= 0.85;
    }
    // Live range: keep 1–99 until terminal so cards don't read like settled
    const pct = clampPct(raw * 100);
    if (opts.isLive || opts.started) {
      if (pct <= 0 && est > 0) return 1;
      if (pct >= 100) return 99;
    }
    return pct;
  }

  /** Brewers-win heuristic from lead + innings left (estimate, not Kalshi mid). */
  function estimateWinSuccessPct(lead, innN, isLive, isFinal, winnerHint) {
    if (isFinal && winnerHint === "MIL") return 100;
    if (isFinal) return 0;
    if (!isLive) return 48; // MIL away pregame prior — rough
    const inn = innN != null ? Number(innN) || 1 : 1;
    const innLeft = Math.max(0.25, 9 - inn + 0.5);
    const leverage = 1 + (1 - Math.min(1, innLeft / 9)) * 2.2;
    let pct = 50 + lead * 7 * leverage;
    if (lead < 0 && inn >= 7) pct -= (inn - 6) * 6;
    if (lead > 0 && inn >= 8) pct += 8;
    if (lead === 0 && inn >= 8) pct = 45;
    return Math.max(1, Math.min(99, Math.round(pct)));
  }

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

  // Progressive heat: cool alive → warm → hot → critical as remaining
  // ABs / IP / BF / innings dwindle or late game with no progress.
  // Terminal vibes stay hit (green) / dead (final miss).
  function pickDwindleVibe(opts) {
    const kind = opts.kind;
    const est = opts.estRemaining != null ? Number(opts.estRemaining) : 0;
    const progressPct = opts.progressPct != null ? Number(opts.progressPct) : 0;
    const current = opts.current != null ? Number(opts.current) : 0;
    const line = opts.line;
    const need = line != null ? Math.max(0, Number(line) - current) : 1;
    const started = !!opts.started;
    const isLive = !!opts.isLive;

    if (!isLive && !started) return "pre";

    // Scarcity 0 (plenty) → 4 (almost out) from remaining opportunity units.
    let scarcity = 0;
    if (kind === "ks") {
      // estRemaining ≈ batters faced left
      if (est >= 14) scarcity = 0;
      else if (est >= 9) scarcity = 1;
      else if (est >= 5) scarcity = 2;
      else if (est >= 2.5) scarcity = 3;
      else scarcity = 4;
      // Still need multiple Ks with thin BF left
      if (need >= 2 && est < need * 5) scarcity = Math.min(4, scarcity + 1);
      if (need >= 3 && est < need * 4) scarcity = Math.min(4, scarcity + 1);
    } else {
      // Batter: estRemaining ≈ PA / AB left
      if (est >= 3.5) scarcity = 0;
      else if (est >= 2.5) scarcity = 1;
      else if (est >= 1.5) scarcity = 2;
      else if (est >= 0.75) scarcity = 3;
      else scarcity = 4;
    }

    // Late game + still short of the line → push warmer/redder
    if (need > 0) {
      if (progressPct >= 55) scarcity = Math.min(4, scarcity + 1);
      if (progressPct >= 75) scarcity = Math.min(4, scarcity + 1);
      if (progressPct >= 90) scarcity = Math.min(4, scarcity + 1);
    }

    const map = ["alive", "alive", "warm", "hot", "critical"];
    return map[scarcity] || "alive";
  }

  function dwindleVibeLabel(vibe, progressPct, current, unitLeft, unit) {
    const left = "~" + unitLeft + " " + unit + " left";
    if (vibe === "warm") return "Warming · " + left;
    if (vibe === "hot") return "Getting hot · " + left;
    if (vibe === "critical") return "On the ropes · " + left;
    if (vibe === "alive") return progressPct + "% through · " + left;
    return progressPct + "% · " + left;
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
        successPct: 0,
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
        successPct: 100,
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
      const started = ctx.isLive || thrown > 0;
      const vibe = pickDwindleVibe({
        kind: "ks",
        estRemaining: bfLeft,
        progressPct,
        current,
        line,
        isLive: ctx.isLive,
        started,
      });
      const ipLabel = Math.round(ipLeft * 10) / 10;
      const successPct = estimateSuccessPct({
        kind: "ks",
        current,
        line,
        estRemaining: bfLeft,
        progressPct,
        vibe,
        isLive: ctx.isLive,
        started,
      });
      return {
        current,
        estRemaining: bfLeft,
        estLabel: "est ~" + ipLabel + " IP / ~" + Math.round(bfLeft) + " BF",
        progressPct,
        vibe,
        vibeLabel: dwindleVibeLabel(vibe, progressPct, current, Math.round(bfLeft), "BF") +
          " · " + current + " K",
        successPct,
        detail: (game.ip || "0") + " IP · " + (game.bf || 0) + " BF",
      };
    }

    // Batter props
    const side = prop.side || game.side || "away";
    const halves = teamHalfInningsLeft(ctx.inning, ctx.inningState, ctx.isFinal, side);
    const estPA = Math.round(halves * PA_PER_TEAM_INNING * 10) / 10;
    const ab = game.ab || 0;
    const pa = game.pa != null ? game.pa : ab + (game.bb || 0);
    // Blend PA-used with innings-used so late game heats even if PA count is low
    const innProgress = Math.min(
      100,
      Math.round(((9 - halves) / 9) * 100)
    );
    const paProgress = Math.min(100, Math.round((pa / EXPECTED_PA_GAME) * 100));
    const progressPct = Math.max(paProgress, innProgress);
    const started = ctx.isLive || ab > 0 || pa > 0;
    const vibe = pickDwindleVibe({
      kind: kind,
      estRemaining: estPA,
      progressPct,
      current,
      line,
      isLive: ctx.isLive,
      started,
    });
    let unit = "AB";
    if (kind === "hits") unit = "AB";
    if (kind === "rbi") unit = "AB";
    if (kind === "hr") unit = "AB";
    const successPct = estimateSuccessPct({
      kind: kind,
      current,
      line,
      estRemaining: estPA,
      progressPct,
      vibe,
      isLive: ctx.isLive,
      started,
    });
    return {
      current,
      estRemaining: estPA,
      estLabel: "est ~" + estPA + " " + unit + " left",
      progressPct,
      vibe,
      vibeLabel: dwindleVibeLabel(vibe, progressPct, current, estPA, unit),
      successPct,
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
        fill: p.fill || KNOWN_PROP_FILLS[p.key] || null,
      });
    });
  }


  function moneyShort(n) {
    const x = Number(n);
    if (!isFinite(x)) return "—";
    const s = x.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
    return "$" + s;
  }

  function resolveFill(propOrKey) {
    if (!propOrKey) return null;
    if (typeof propOrKey === "string") {
      return KNOWN_PROP_FILLS[propOrKey] || null;
    }
    return propOrKey.fill || KNOWN_PROP_FILLS[propOrKey.key] || null;
  }

  /** Overlay live-book positions onto known fills when a proxy/desk book is present. */
  function mergePropFills(positions) {
    const list = positions || [];
    if (!list.length) return KNOWN_PROP_FILLS;
    function apply(key, matcher) {
      for (let i = 0; i < list.length; i++) {
        const p = list[i] || {};
        const t = String(p.ticker || "").toUpperCase();
        if (!matcher(t)) continue;
        const contracts = Math.abs(Number(p.position != null ? p.position : p.contractsFilled || 0));
        if (!contracts) continue;
        const cost = Number(p.marketExposure != null ? p.marketExposure : p.cost || 0);
        KNOWN_PROP_FILLS[key] = {
          contracts: contracts,
          cost: cost,
          payout: contracts,
          tickerHint: t,
          realizedPnl: p.realizedPnl,
        };
        break;
      }
    }
    apply("brewers_win", function (t) { return t.indexOf("KXMLBGAME") >= 0 && /[-]MIL$/.test(t); });
    apply("bauers_hr", function (t) { return t.indexOf("BAUERS") >= 0; });
    apply("yelich_hr", function (t) { return t.indexOf("YELICH") >= 0; });
    apply("ortiz_hr", function (t) { return t.indexOf("ORTIZ") >= 0; });
    apply("chourio_h", function (t) { return t.indexOf("CHOURIO") >= 0; });
    apply("contreras_rbi", function (t) { return t.indexOf("CONTRERAS") >= 0; });
    apply("may_k", function (t) { return t.indexOf("KXMLBKS") >= 0 && t.indexOf("MAY") >= 0; });
    TRACKED_PROPS.forEach(function (pp) {
      if (KNOWN_PROP_FILLS[pp.key]) pp.fill = KNOWN_PROP_FILLS[pp.key];
    });
    return KNOWN_PROP_FILLS;
  }

  function formatFillHtml(fill, vibe) {
    if (!fill || fill.cost == null) return "";
    const stake = moneyShort(fill.cost);
    const maxPay = moneyShort(fill.payout != null ? fill.payout : fill.contracts);
    let right;
    if (vibe === "hit") {
      right = "settled " + maxPay;
    } else if (vibe === "dead") {
      right = "settled $0";
    } else {
      right = "to win " + maxPay;
    }
    return (
      '<div class="prop-money"><span class="prop-stake">Bet ' +
      stake +
      '</span><span class="prop-payout">' +
      right +
      "</span></div>"
    );
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
    let winnerVibe = "pre";
    let winnerPct = 8;
    let winnerLabel = "Pregame · waiting on first pitch";
    let winnerSuccess = 48;
    const milRuns = away.runs != null ? Number(away.runs) : 0;
    const oppRuns = home.runs != null ? Number(home.runs) : 0;
    const lead = milRuns - oppRuns;
    const innN = data.inning != null ? Number(data.inning) || 1 : 1;
    if (data.isFinal && data.winnerHint === "MIL") {
      winnerBadge = "MIL WINS";
      winnerCls = "prop-badge hit";
      winnerVibe = "hit";
      winnerPct = 100;
      winnerSuccess = 100;
      winnerLabel = "Final · Brewers cash";
    } else if (data.isFinal && data.winnerHint && data.winnerHint !== "MIL") {
      winnerBadge = data.winnerHint + " WINS";
      winnerCls = "prop-badge dead";
      winnerVibe = "dead";
      winnerPct = 100;
      winnerSuccess = 0;
      winnerLabel = "Final · " + escHtml(data.winnerHint || "?");
    } else if (data.isLive) {
      winnerBadge = "LIVE";
      // Innings clock for game prop + score margin heat
      winnerPct = Math.min(100, Math.round(((innN - 1) / 9) * 100 + 12));
      let scarcity = 0;
      if (innN >= 6) scarcity = 1;
      if (innN >= 7) scarcity = 2;
      if (innN >= 8) scarcity = 3;
      if (innN >= 9) scarcity = 4;
      if (lead < 0) scarcity = Math.min(4, scarcity + (lead <= -2 ? 2 : 1));
      else if (lead === 0 && innN >= 6) scarcity = Math.min(4, scarcity + 1);
      else if (lead > 0) scarcity = Math.max(0, scarcity - 1);
      const wmap = ["alive", "alive", "warm", "hot", "critical"];
      winnerVibe = wmap[scarcity] || "alive";
      winnerCls = "prop-badge " + winnerVibe;
      if (winnerVibe === "critical") winnerLabel = "On the ropes · late & short";
      else if (winnerVibe === "hot") winnerLabel = "Getting hot · late scoreboard";
      else if (winnerVibe === "warm") winnerLabel = "Warming · clock ticking";
      else winnerLabel = "Live · scoreboard watch (not a Kalshi mid)";
      winnerSuccess = estimateWinSuccessPct(lead, innN, true, false, data.winnerHint);
    } else {
      winnerSuccess = estimateWinSuccessPct(0, 1, false, false, null);
    }

    rows.push(
      '<div class="prop-card prop-game vibe-' +
        winnerVibe +
        '">' +
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
        milRuns +
        " – " +
        oppRuns +
        " " +
        escHtml(home.abbr || "SD") +
        "</div>" +
        '<div class="prop-bar"><div class="prop-bar-fill vibe-' +
        winnerVibe +
        '" style="width:' +
        winnerPct +
        '%"></div></div>' +
        '<div class="prop-chance">' +
        '<span class="prop-chance-pct">' +
        (winnerVibe === "hit" || winnerVibe === "dead"
          ? winnerSuccess + "%"
          : "~" + winnerSuccess + "%") +
        '</span><span class="prop-chance-tag">est success · not Kalshi mid</span></div>' +
        '<div class="prop-vibe">' +
        winnerLabel +
        "</div>" +
        formatFillHtml(resolveFill("brewers_win"), winnerVibe) +
        "</div>"
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
        badge = p.propHit
          ? (p.line != null ? p.line + "+ ✓" : "K ✓")
          : (g.so || 0) + " K";
      } else {
        statline = g.summary || "—";
        badge = "—";
      }

      const vibe = o.vibe || "pre";
      const pct = o.progressPct != null ? o.progressPct : 0;
      let successPct = o.successPct;
      if (successPct == null) {
        if (vibe === "hit") successPct = 100;
        else if (vibe === "dead") successPct = 0;
        else successPct = estimateSuccessPct({
          kind: kind,
          current: o.current != null ? o.current : 0,
          line: p.line,
          estRemaining: o.estRemaining,
          progressPct: pct,
          vibe: vibe,
          isLive: data.isLive,
          started: vibe !== "pre",
        });
      }
      const successTxt =
        vibe === "hit" || vibe === "dead"
          ? successPct + "%"
          : "~" + successPct + "%";
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
          '<div class="prop-chance">' +
          '<span class="prop-chance-pct">' +
          escHtml(successTxt) +
          '</span><span class="prop-chance-tag">est success · not Kalshi mid</span></div>' +
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
          formatFillHtml(resolveFill(p), vibe) +
          (vibe === "hit" || vibe === "dead"
            ? ""
            : '<div class="prop-note">heuristic from remaining ABs/IP · not a Kalshi mid</div>') +
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
        fill: pp.fill || KNOWN_PROP_FILLS[pp.key] || null,
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
    pickDwindleVibe,
    buildOpportunity,
    estimateSuccessPct,
    estimateWinSuccessPct,
    mergePropFills,
    KNOWN_PROP_FILLS,
    TRACKED_PROPS,
  };
})(typeof window !== "undefined" ? window : globalThis);
