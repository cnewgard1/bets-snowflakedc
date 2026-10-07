/* Simple session gate for public desk UI. No Kalshi secrets. */
(function () {
  var USER = "chris";
  var PASS = "chris";
  var KEY = "bets_desk_session_v1";

  function ok() {
    try {
      return sessionStorage.getItem(KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function setOk() {
    try {
      sessionStorage.setItem(KEY, "1");
    } catch (e) {}
  }

  function clearOk() {
    try {
      sessionStorage.removeItem(KEY);
    } catch (e) {}
  }

  function showGate() {
    if (document.getElementById("authGate")) return;
    var css = document.createElement("style");
    css.textContent =
      "#authGate{position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;" +
      "background:radial-gradient(1200px 800px at 20% 0%,#fff7ed,transparent),radial-gradient(900px 700px at 90% 20%,#ede9fe,transparent),#f6f4f8;" +
      "font-family:ui-rounded,system-ui,-apple-system,Segoe UI,sans-serif}" +
      "#authGate .card{width:min(360px,92vw);padding:28px 24px;border-radius:24px;background:rgba(255,255,255,.72);" +
      "backdrop-filter:blur(18px);border:1px solid rgba(0,0,0,.06);box-shadow:0 20px 60px rgba(80,60,120,.12)}" +
      "#authGate h1{margin:0 0 6px;font-size:1.35rem;letter-spacing:-.02em}" +
      "#authGate p{margin:0 0 18px;color:#6b6574;font-size:.92rem}" +
      "#authGate label{display:block;font-size:.75rem;font-weight:600;color:#6b6574;margin:10px 0 6px}" +
      "#authGate input{width:100%;box-sizing:border-box;padding:12px 14px;border-radius:14px;border:1px solid rgba(0,0,0,.1);" +
      "background:#fff;font-size:1rem}" +
      "#authGate button{margin-top:16px;width:100%;padding:12px 14px;border:0;border-radius:14px;font-weight:700;" +
      "background:linear-gradient(135deg,#fb923c,#a78bfa);color:#111;cursor:pointer}" +
      "#authGate .err{color:#b91c1c;font-size:.85rem;min-height:1.2em;margin-top:10px}";
    document.head.appendChild(css);

    var gate = document.createElement("div");
    gate.id = "authGate";
    gate.innerHTML =
      '<form class="card" autocomplete="on">' +
      "<h1>Grok Bot · Bets</h1>" +
      "<p>Sign in to open the Kalshi desk UI. Trading keys stay off this host.</p>" +
      '<label for="authUser">Username</label>' +
      '<input id="authUser" name="username" autocomplete="username" required />' +
      '<label for="authPass">Password</label>' +
      '<input id="authPass" name="password" type="password" autocomplete="current-password" required />' +
      '<div class="err" id="authErr"></div>' +
      "<button type=\"submit\">Enter desk</button>" +
      "</form>";
    document.documentElement.style.overflow = "hidden";
    document.body.appendChild(gate);
    var form = gate.querySelector("form");
    form.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var u = (document.getElementById("authUser").value || "").trim();
      var p = document.getElementById("authPass").value || "";
      if (u === USER && p === PASS) {
        setOk();
        gate.remove();
        document.documentElement.style.overflow = "";
        document.documentElement.classList.remove("auth-pending");
        document.documentElement.classList.add("authed");
        window.dispatchEvent(new Event("bets-authed"));
      } else {
        document.getElementById("authErr").textContent = "Wrong username or password.";
      }
    });
    setTimeout(function () {
      var el = document.getElementById("authUser");
      if (el) el.focus();
    }, 50);
  }

  window.BetsAuth = { ok: ok, logout: clearOk };

  function boot() {
    if (ok()) {
      document.documentElement.classList.add("authed");
      return;
    }
    // Hide desk until auth
    document.documentElement.classList.add("auth-pending");
    showGate();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
