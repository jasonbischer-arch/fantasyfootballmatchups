/* The Sports Mattress — single-page site. Data comes from data.json, written by build.py. */
(() => {
"use strict";

const POS = ["QB", "RB", "WR", "TE"];
const POS_NAME = { QB: "quarterbacks", RB: "running backs", WR: "wide receivers", TE: "tight ends" };
const RECENT = 3;
const PLAYOFF_WEEKS = new Set([15, 16, 17]);
const PAGES = ["home", "matchups", "start-sit", "my-team", "trade", "players", "schedule", "teams", "about", "how-it-works", "privacy", "terms", "login", "signup", "forgot", "reset", "account", "blog", "write", "notfound"];
const PAGE_TITLES = {
  home: "Fantasy Football Matchups, Start/Sit and Trade Analyzer", "start-sit": "Start / Sit", "my-team": "My Team",
  trade: "Trade Analyzer", players: "Player Usage", schedule: "Strength of Schedule", teams: "Team Tendencies",
  about: "About", "how-it-works": "How It Works", privacy: "Privacy", terms: "Terms of Use",
  blog: "Blog", write: "Write", notfound: "Page not found", post: "Article",
  login: "Log in", signup: "Create account", forgot: "Reset password", reset: "Set new password", account: "Your account",
};

let D = null;                         // data.json
// On the live site pages have real URLs (/trade/, /players/ ...); the preview uses #trade style.
const CLEAN = !!window.TSM_CLEAN;
const BASE = window.TSM_BASE || "";
const routePath = r => (r === "home" ? "/" : `/${r}/`);
const STATIC_ROUTE = /^(player\/[a-z0-9-]+|team\/[a-z]{2,3})$/;   // pre-built pages (full page loads)
function isRoute(r) { return PAGES.includes(r) || POS.includes(String(r).toUpperCase()) || /^blog\/[a-z0-9-]+$/.test(r) || STATIC_ROUTE.test(r); }
function currentRoute() {
  if (CLEAN) return location.pathname.replace(/^\/+|\/+$/g, "").toLowerCase() || "home";
  return location.hash.slice(1).toLowerCase();
}
function navigate(r) {
  if (CLEAN) { if (location.pathname !== routePath(r)) history.pushState(null, "", routePath(r)); route(true); }
  else navigate(r);
}
// Turn #route links into real paths so search engines can follow them.
function cleanLinks(root = document) {
  if (!CLEAN) return;
  root.querySelectorAll('a[href^="#"]').forEach(a => {
    const r = a.getAttribute("href").slice(1).toLowerCase();
    if (r && isRoute(r)) a.setAttribute("href", routePath(r));
  });
}
const byId = new Map();
const byLabel = new Map();
const state = {
  fmt: "ppr", page: "home", pos: "QB", sort: null, q: "",
  pl: { pos: "ALL", team: "", q: "", sort: { key: "ppg", dir: -1 }, limit: 50 },
  sos: { pos: "RB", sort: { key: "next4", dir: -1 } },
  tm: { sort: { key: "implied", dir: -1 } },
};
const ss = { a: null, b: null, example: false };

// ------------------------------------------------------------------ storage (per-viewer conveniences)
const store = {
  get(k, dflt) { try { const v = localStorage.getItem(k); return v == null ? dflt : JSON.parse(v); } catch (e) { return dflt; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ } },
};

// ------------------------------------------------------------------ helpers
const $ = sel => document.querySelector(sel);
function esc(s) { return String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
const f1 = v => v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(1);
const f2 = v => v == null || Number.isNaN(v) ? "—" : Number(v).toFixed(2);
const pct = v => v == null || Number.isNaN(v) ? "—" : Math.round(v * 100) + "%";
function ordinal(n) { const s = ["th", "st", "nd", "rd"], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }
function pts(o, f) { return f === "half" ? (o.ppr + o.std) / 2 : o[f]; }
function fmtLabel() { return D.formats[state.fmt]; }
function kickLabel(k, withTime) {
  if (!k) return "";
  const [day, time] = k.split(" ");
  const d = new Date(day + "T12:00:00");
  if (isNaN(d)) return "";
  const wd = d.toLocaleDateString("en-US", { weekday: "short" });
  if (!withTime || !time) return wd;
  let [h, m] = time.split(":").map(Number);
  const ap = h >= 12 ? "PM" : "AM"; h = h % 12 || 12;
  return `${wd} ${h}:${String(m).padStart(2, "0")} ${ap} ET`;
}
function initials(name) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join(""); }
function lastName(name) { const p = name.split(" "); return p.length > 1 ? p.slice(1).join(" ") : name; }

// Three-stop color scale (the matchup chart scale).
const RED = [230, 124, 115], ORANGE = [246, 178, 107], YELLOW = [255, 217, 102], GREEN = [87, 187, 138];
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
function scaleColor(v, min, mid, max, midColor = ORANGE) {
  let c;
  if (v == null || max === min) c = midColor;
  else if (v <= mid) c = mix(RED, midColor, mid === min ? 1 : Math.max(0, (v - min) / (mid - min)));
  else c = mix(midColor, GREEN, max === mid ? 1 : Math.min(1, (v - mid) / (max - mid)));
  return `rgb(${c.join(",")})`;
}
function median(arr) { const s = [...arr].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function stops(vals) { vals = vals.filter(v => v != null && !Number.isNaN(v)); return vals.length ? [Math.min(...vals), median(vals), Math.max(...vals)] : [0, 0, 0]; }
const rankColor = r => scaleColor(r, 1, 16.5, 32, ORANGE);
const rankChip = (r, title) => r == null ? `<span class="badge">BYE</span>` : `<span class="rchip" style="background:${rankColor(r)}"${title ? ` title="${esc(title)}"` : ""}>${r}</span>`;

function avatar(p) {
  return `<span class="avatar" aria-hidden="true">${esc(initials(p.name))}${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" decoding="async" width="34" height="34" referrerpolicy="no-referrer">` : ""}</span>`;
}
const playerUrl = p => (CLEAN && p.slug ? `/player/${p.slug}/` : null);
const plink = (p, text) => playerUrl(p)
  ? `<a class="plink" href="${playerUrl(p)}" data-pid="${esc(p.id)}">${esc(text ?? p.name)}</a>`
  : `<button type="button" class="plink" data-pid="${esc(p.id)}">${esc(text ?? p.name)}</button>`;
const teamUrl = abbr => (CLEAN ? `/team/${String(abbr).toLowerCase()}/` : null);
function sortBtn(key, label, cur) {
  const dir = cur && cur.key === key ? (cur.dir > 0 ? "▲" : "▼") : null;
  return `<button type="button" class="sort" data-sort="${key}"${dir ? ` data-dir="${dir}"` : ""}>${label}</button>`;
}
function nextSort(cur, key, textKeys = []) {
  if (cur && cur.key === key) return { key, dir: -cur.dir };
  return { key, dir: textKeys.includes(key) ? 1 : -1 };
}
function cmp(a, b, dir) {
  const na = a == null || Number.isNaN(a), nb = b == null || Number.isNaN(b);
  if (na && nb) return 0; if (na) return 1; if (nb) return -1;
  return (typeof a === "string" ? a.localeCompare(b) : a - b) * dir;
}

// ------------------------------------------------------------------ weather
const SUN = `<circle cx="12" cy="12" r="4.2" fill="#f6b26b"/><g stroke="#f6b26b" stroke-width="1.8" stroke-linecap="round"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g>`;
const MOON = `<path d="M15.5 3.5a8.5 8.5 0 1 0 5 13.6A7 7 0 0 1 15.5 3.5z" fill="#c9b8f0"/>`;
const CLOUD = (y = 0, fill = "#b8c2d4") => `<path d="M7 ${18 + y}h10.5a3.5 3.5 0 0 0 .3-7A5 5 0 0 0 8.2 9.7 4.2 4.2 0 0 0 7 ${18 + y}z" fill="${fill}"/>`;
const WX_ICONS = {
  clear: SUN,
  "clear-night": MOON,
  partly: `<g transform="translate(-3 -3) scale(.75)">${SUN}</g>${CLOUD(1)}`,
  "partly-night": `<g transform="translate(-2 -3) scale(.7)">${MOON}</g>${CLOUD(1)}`,
  cloud: CLOUD(-1, "#9aa6bc"),
  fog: `${CLOUD(-4, "#b8c2d4")}<g stroke="#9aa6bc" stroke-width="1.8" stroke-linecap="round"><path d="M5 18h14M7 21h10"/></g>`,
  rain: `${CLOUD(-4, "#9aa6bc")}<g stroke="#4a90d9" stroke-width="1.8" stroke-linecap="round"><path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/></g>`,
  snow: `${CLOUD(-4, "#b8c2d4")}<g fill="#7aa7e8"><circle cx="8" cy="18.5" r="1.3"/><circle cx="12" cy="20.5" r="1.3"/><circle cx="16" cy="18.5" r="1.3"/></g>`,
  storm: `${CLOUD(-4, "#7d8799")}<path d="M12.5 15l-3 4.5h2.5l-1.5 3.5 4-5h-2.5l1.5-3z" fill="#f6c75f"/>`,
  indoor: `<path d="M3 13a9 7 0 0 1 18 0v6H3z" fill="#a9b6cc"/><path d="M3 13a9 7 0 0 1 18 0" fill="none" stroke="#7d8aa3" stroke-width="1.5"/><g stroke="#ffffff" stroke-opacity=".7" stroke-width="1.2"><path d="M7.5 8.2v10.8M12 6v13M16.5 8.2v10.8"/></g>`,
};
const WX_LABEL = { clear: "Clear", "clear-night": "Clear", partly: "Partly cloudy", "partly-night": "Partly cloudy", cloud: "Cloudy", fog: "Fog", rain: "Rain", snow: "Snow", storm: "Thunderstorms", indoor: "Indoors" };
function wxIcon(cond) { return `<svg class="wx-icon" viewBox="0 0 24 24" aria-hidden="true">${WX_ICONS[cond] || ""}</svg>`; }
function wxRough(w) { return w && !w.indoor && (w.wind >= 15 || (w.precip ?? 0) >= 50 || w.temp <= 25 || w.cond === "snow" || w.cond === "storm"); }
function wxCell(w) {
  if (!w) return `<td class="muted" title="Forecast not available yet">—</td>`;
  if (w.indoor) return `<td class="wx" title="Indoors"><span class="wx-in">${wxIcon("indoor")}<span><b>Indoors</b></span></span></td>`;
  const tip = `${WX_LABEL[w.cond]}, ${w.temp}°F, wind ${w.wind} mph, ${w.precip ?? 0}% chance of precipitation at kickoff`;
  return `<td class="wx${wxRough(w) ? " wx-rough" : ""}" title="${esc(tip)}"><span class="wx-in">${wxIcon(w.cond)}<span><b>${w.temp}°</b><span class="kick">${w.wind} mph · ${w.precip ?? 0}%</span></span></span></td>`;
}

// ------------------------------------------------------------------ player model
function playerLabel(p) { return `${p.name} (${p.pos}, ${p.team})`; }
function injOut(p) { return p.inj && /^(out|ir|pup)/i.test(p.inj.status); }
// Players on IR drop off the weekly injury report, so also go by games actually played:
// 2+ straight team games missed with no injury designation almost always means IR or similar.
function inactive(p) { return !p.inj && (p.missed || 0) >= 2; }
// For hot/cold, risers and suggestions: he played in his team's last game and isn't out or doubtful.
function playedRecently(p) { return !(p.missed >= 1) && !injOut(p) && !(p.inj && /doubtful/i.test(p.inj.status)); }
// Off-season: every regular-season game is final. Nobody has an opponent, so "bye" means "season over".
function offseason() { return !!(D && D.phase === "offseason"); }
function nextSeasonText() {
  const n = D.nextSeason;
  if (!n) return "next season";
  if (!n.kickoff) return `the ${n.season} season`;
  const d = new Date(n.kickoff + "T12:00:00");
  return `the ${n.season} season (kicks off ${d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })})`;
}
function offseasonNotice(what) {
  return `<div class="panel panel-pad off-note"><strong>The ${D.season} season is over.</strong> <span class="muted">${what} returns for Week 1 of ${esc(nextSeasonText())}.</span></div>`;
}
function unavailable(p) {
  return p.bye && !offseason() ? "on bye" : injOut(p) ? "ruled out" : inactive(p) ? `inactive (hasn't played in his team's last ${p.missed} games)` : null;
}
function defFor(p) { return p.bye ? null : D.defenses[p.pos][p.opp]; }
function teamOf(p) { return D.teams[p.team] || {}; }
// Projection: own scoring (60% season, 40% last 3) scaled by how much the opponent allows to the
// position versus league average; the matchup effect is halved and capped at ±25% (small samples).
function project(p, f = state.fmt) {
  const season = pts(p.ppg, f), recent = pts(p.l3, f);
  const base = p.g >= 3 ? 0.6 * season + 0.4 * recent : season;
  if (p.bye) return { base, factor: 1, proj: offseason() && !injOut(p) && !inactive(p) ? base : 0 };
  const d = defFor(p), avg = D.leagueAvg[p.pos][f];
  const raw = avg ? d.fppg[f] / avg : 1;
  const factor = Math.min(1.25, Math.max(0.75, 1 + 0.5 * (raw - 1)));
  const out = injOut(p) || inactive(p) ? 0 : base * factor;
  return { base, factor, proj: out, def: d };
}
function injBadge(p) {
  if (inactive(p)) return `<span class="badge out" title="Hasn't played in his team's last ${p.missed} games">Inactive</span>`;
  if (p.bye && !offseason()) return `<span class="badge out">Bye</span>`;
  if (!p.inj) return p.missed >= 1 ? `<span class="badge q" title="Didn't play in his team's last game${p.injPrev ? ` (Week ${p.injPrev.week}: ${esc(p.injPrev.status)}${p.injPrev.injury ? `, ${esc(p.injPrev.injury)}` : ""})` : ""}">Missed last game</span>` : "";
  return `<span class="badge ${injOut(p) ? "out" : "q"}" title="${esc(p.inj.injury || "")}">${esc(p.inj.status)}</span>`;
}
function oppText(p) { return p.bye ? (offseason() ? "Season over" : "BYE") : `${p.away ? "@" : "vs "}${p.opp}`; }

// ------------------------------------------------------------------ boot
document.addEventListener("error", e => { if (e.target && e.target.tagName === "IMG") e.target.remove(); }, true);
fetch(BASE + "data.json?v=" + encodeURIComponent(window.TSM_BUILD || ""))
  .then(r => { if (!r.ok) throw new Error(r.status); return r.json(); })
  .then(d => { D = d; boot(); })
  .catch(() => { $("#page").innerHTML = `<p class="empty">This week's data couldn't be loaded. Refresh the page to try again.</p>`; });

function boot() {
  const f = store.get("tsm-fmt", null);
  if (f && D.formats[f]) state.fmt = f;
  for (const p of D.players) { byId.set(p.id, p); byLabel.set(playerLabel(p).toLowerCase(), p); }
  const dl = document.createElement("datalist");
  dl.id = "playerList";
  dl.innerHTML = D.players.map(p => `<option value="${esc(playerLabel(p))}"></option>`).join("");
  document.body.appendChild(dl);

  const fmtButtons = Object.entries(D.formats).map(([k, v]) => `<button type="button" data-fmt="${k}">${v}</button>`).join("");
  $("#fmtSeg").innerHTML = fmtButtons;
  $("#navFmt").innerHTML = `<span>Scoring</span><div class="seg seg-sm" role="group" aria-label="Scoring format">${fmtButtons}</div>`;
  document.addEventListener("click", e => {
    const b = e.target.closest("button[data-fmt]");
    if (b) {
      state.fmt = b.dataset.fmt; store.set("tsm-fmt", state.fmt); render();
      if (signedIn() && account.profile && account.profile.scoring !== state.fmt) saveProfile({ scoring: state.fmt }, null);
      return;
    }
    // Skip link and back-to-top use #page, which isn't a page route: handle them here.
    const skip = e.target.closest("[data-skip]");
    if (skip) { e.preventDefault(); $("#page").focus(); return; }
    const top = e.target.closest("[data-top]");
    if (top) { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); $("#page").focus({ preventScroll: true }); return; }
    if (e.target.closest("#nav a")) setMenu(false);
  });
  $("#menuBtn").addEventListener("click", () => setMenu(!document.body.classList.contains("nav-open")));
  document.addEventListener("keydown", e => { if (e.key === "Escape" && document.body.classList.contains("nav-open")) { setMenu(false); $("#menuBtn").focus(); } });
  $("#year").textContent = new Date().getFullYear();
  renderStatus();
  initAuth();
  initConsent();

  const saved = store.get("tsm-ss", null);
  if (saved) { ss.a = byId.get(saved.a) || null; ss.b = byId.get(saved.b) || null; }
  if (!ss.a && !ss.b) {
    const rbs = D.players.filter(p => p.pos === "RB" && !unavailable(p) && playedRecently(p) && p.g >= 4);
    if (rbs.length > 12) { ss.a = rbs[10]; ss.b = rbs[11]; ss.example = true; }
  }

  const page = $("#page");
  page.addEventListener("click", onClick);
  page.addEventListener("input", onInput);
  page.addEventListener("change", onInput);
  page.addEventListener("submit", e => { e.preventDefault(); onAuthSubmit(e); onSettingsSubmit(e); });
  $("#playerDialog").addEventListener("click", e => {
    if (e.target.id === "playerDialog") return closePlayer();
    onClick(e);
  });
  if (CLEAN) {
    // Old #page links (shared before real URLs) move to their real address. Auth links that put
    // tokens in the hash (#access_token=...) are left for Supabase to read.
    const h = location.hash.slice(1).toLowerCase();
    if (h && !h.includes("=") && isRoute(h)) history.replaceState(null, "", routePath(h));
    window.addEventListener("popstate", () => route(true));
    document.addEventListener("click", e => {
      const a = e.target.closest('a[href^="/"]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || a.target === "_blank") return;
      const r = a.getAttribute("href").replace(/^\/+|\/+$/g, "").toLowerCase() || "home";
      if (!isRoute(r) || STATIC_ROUTE.test(r)) return;   // player/team pages load as normal pages
      e.preventDefault(); navigate(r);
    });
    cleanLinks();
  } else window.addEventListener("hashchange", () => route(true));
  route(false);
}

// ------------------------------------------------------------------ routing
function route(scroll) {
  const h = currentRoute();
  if (POS.includes(h.toUpperCase())) { state.page = "matchups"; state.pos = h.toUpperCase(); state.sort = null; }
  else if (/^blog\/[a-z0-9-]+$/.test(h)) { state.page = "post"; state.slug = h.slice(5); }
  else if (h === "news") state.page = "blog";
  else if (STATIC_ROUTE.test(h)) state.page = "static";
  else state.page = PAGES.includes(h) ? h : (CLEAN && h !== "home" ? "notfound" : "home");
  if (state.page === "matchups" && !POS.includes(state.pos)) state.pos = "QB";
  const navPage = { post: "blog", write: "blog" }[state.page] || state.page;
  document.querySelectorAll("#nav a").forEach(a => {
    if (a.dataset.page === navPage) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  document.querySelector('#nav a[data-page="matchups"]').setAttribute("href", CLEAN ? routePath(state.pos.toLowerCase()) : "#" + state.pos.toLowerCase());
  // On narrow screens the menu scrolls sideways; keep the current tab in view.
  const cur = document.querySelector("#nav a[aria-current]"), nav = $("#nav");
  if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2;
  render();
  setMenu(false);
  if (scroll) { window.scrollTo(0, 0); $("#page").focus({ preventScroll: true }); }
  trackPageView(scroll);
}

// Cookie consent (Google Consent Mode). The page head sets the defaults; this records the visitor's choice.
const CONTACT = "thesportsmattress@gmail.com";
function setConsent(analytics) {
  store.set("tsm-consent", { analytics, at: new Date().toISOString() });
  window.dataLayer = window.dataLayer || [];
  if (typeof window.gtag === "function") window.gtag("consent", "update", { analytics_storage: analytics ? "granted" : "denied" });
  window.dataLayer.push({ event: "consent_update", analytics_consent: analytics ? "granted" : "denied" });
  hideCookieBanner();
}
function showCookieBanner() {
  if ($("#cookieBanner")) return;
  const el = document.createElement("section");
  el.id = "cookieBanner"; el.className = "cookie"; el.setAttribute("role", "region"); el.setAttribute("aria-label", "Cookie choices");
  el.innerHTML = `<div class="cookie-inner">
      <p><strong>Cookies.</strong> We use analytics cookies to count visits and see which tools people use. No ads, and we never see what you type. <a href="${CLEAN ? "/privacy/" : "#privacy"}">Privacy</a></p>
      <div class="cookie-actions"><button type="button" class="btn" data-consent="0">Reject</button><button type="button" class="btn primary" data-consent="1">Accept</button></div>
    </div>`;
  document.body.appendChild(el);
  el.addEventListener("click", e => { const b = e.target.closest("[data-consent]"); if (b) setConsent(b.dataset.consent === "1"); });
}
function hideCookieBanner() { const el = $("#cookieBanner"); if (el) el.remove(); }
function initConsent() {
  if (!store.get("tsm-consent", null)) showCookieBanner();
  document.addEventListener("click", e => { if (e.target.closest("[data-cookie-settings]")) showCookieBanner(); });
}

// Analytics: tell Google Tag Manager about page changes made without a full reload.
let lastTracked = "";
function trackPageView(isNavigation) {
  const path = location.pathname + location.hash.replace(/^#(.*=.*)?$/, "");
  if (!isNavigation || path === lastTracked) { lastTracked = path; return; }   // first load is counted by the tag itself
  lastTracked = path;
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: "virtual_page_view", page_path: path, page_location: location.href, page_title: document.title });
}
function render() {
  document.querySelectorAll("button[data-fmt]").forEach(b => b.setAttribute("aria-pressed", b.dataset.fmt === state.fmt));
  const fn = { home: renderHome, matchups: renderMatchups, "start-sit": renderStartSit, "my-team": renderMyTeam,
    players: renderPlayers, schedule: renderSchedule, teams: renderTeams, trade: renderTrade, about: renderAbout, "how-it-works": renderHow, privacy: renderPrivacy, terms: renderTerms,
    login: renderLogin, signup: renderSignup, forgot: renderForgot, reset: renderReset, account: renderAccount,
    blog: renderBlog, post: renderPost, write: renderWrite, notfound: renderNotFound,
    static: () => { if (!$("#page [data-static]")) renderNotFound(); } }[state.page];
  // Use the same search-friendly titles as the pre-built pages.
  const T = window.TSM_TITLES || {};
  if (state.page !== "static") document.title = T[state.page === "matchups" ? state.pos.toLowerCase() : state.page] ||
    `${state.page === "matchups" ? `Week ${D.week} ${state.pos} Matchups` : PAGE_TITLES[state.page]} · The Sports Mattress`;
  const active = document.activeElement && document.activeElement.id;
  const caret = active && document.activeElement.selectionStart;
  fn();
  // Keep typing focus when a filter re-renders the page.
  if (active && active !== "page") {
    const el = document.getElementById(active);
    if (el && el !== document.activeElement && $("#page").contains(el)) {
      el.focus();
      try { if (caret != null) el.setSelectionRange(caret, caret); } catch (e) { /* not a text field */ }
    }
  }
  const pd = $("#playerDialog");
  if (pd.open && pd.dataset.player) fillPlayer(byId.get(pd.dataset.player));
  cleanLinks($("#page")); cleanLinks($("#pdBody"));
  if (state.page === "home" && $("#homePosts")) loadPosts().then(posts => {
    const box = $("#homePosts"); if (!box || !posts.length) return;
    box.hidden = false;
    box.innerHTML = `<div class="section-head"><h2>From the blog</h2><a href="#blog">All articles →</a></div>
      <div class="post-grid">${posts.slice(0, 3).map(p => postCard(p)).join("")}</div>`;
    cleanLinks(box);
  });
}

function setMenu(open) {
  document.body.classList.toggle("nav-open", open);
  const b = $("#menuBtn");
  b.setAttribute("aria-expanded", open); b.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}
// Status bar: when the data was built and when the next scheduled rebuild runs (daily, 5am ET).
function etParts(d) {
  const o = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", weekday: "short", hour: "numeric", hourCycle: "h23" })
    .formatToParts(d).map(x => [x.type, x.value]));
  return { wd: o.weekday, h: Number(o.hour) };
}
function nextUpdate(now = new Date()) {
  const d = new Date(now); d.setMinutes(0, 0, 0);
  for (let i = 1; i <= 24 * 8; i++) {
    d.setTime(d.getTime() + 3600e3);
    const { wd, h } = etParts(d);
    if (h === 5) return d;
  }
  return null;
}
function fmtET(d, opts) { return d.toLocaleString("en-US", { timeZone: "America/New_York", ...opts }); }
function renderStatus() {
  const u = new Date(D.updated), n = nextUpdate();
  if (offseason()) {
    $("#statusWeek").textContent = `${D.season} season complete`;
    $("#statusMeta").textContent = D.nextSeason && D.nextSeason.kickoff
      ? `${D.nextSeason.season} season kicks off ${new Date(D.nextSeason.kickoff + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })}`
      : `Final ${D.season} numbers · weekly matchups return in Week 1`;
    return;
  }
  $("#statusWeek").textContent = `Week ${D.week} matchups are live`;
  $("#statusMeta").textContent = `Updated ${fmtET(u, { weekday: "short", hour: "numeric", minute: "2-digit" })} ET` +
    (n ? ` · Next full update ${fmtET(n, { weekday: "short", hour: "numeric", minute: "2-digit" })} ET` : "");
}
function methodLink(topic) {
  return `<p class="method-link">How ${topic} work: <a href="#how-it-works">see How It Works</a>.</p>`;
}
function pageHead(eyebrow, title, lede) {
  return `<div class="page-head"><div class="eyebrow">${eyebrow}</div><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ""}</div>`;
}
function updatedText() {
  const u = new Date(D.updated);
  return `Stats through Week ${D.statsThrough}. Updated ${u.toLocaleString("en-US", { timeZone: "America/New_York", weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} ET.`;
}

// ------------------------------------------------------------------ events
function onClick(e) {
  const pidEl = e.target.closest("[data-pid]");
  if (pidEl) { e.preventDefault(); return openPlayer(pidEl.dataset.pid); }
  const act = e.target.closest("[data-action]");
  if (act && ACTIONS[act.dataset.action]) { e.preventDefault(); return ACTIONS[act.dataset.action](act); }
  const sortEl = e.target.closest("button[data-sort]");
  if (sortEl) {
    const key = sortEl.dataset.sort;
    if (state.page === "matchups") state.sort = nextSort(state.sort || { key: "rank", dir: -1 }, key, ["player", "opp"]);
    if (state.page === "players") state.pl.sort = nextSort(state.pl.sort, key, ["name", "team", "pos"]);
    if (state.page === "schedule") state.sos.sort = nextSort(state.sos.sort, key, ["team"]);
    if (state.page === "teams") state.tm.sort = nextSort(state.tm.sort, key, ["team"]);
    return render();
  }
  const row = e.target.closest("tr[data-rowpid]");
  if (row) return openPlayer(row.dataset.rowpid);
}
// Re-render after a short pause in typing rather than on every keystroke.
let renderTimer = 0;
function renderSoon() { clearTimeout(renderTimer); renderTimer = setTimeout(render, 160); }
document.addEventListener("keydown", e => {
});
function onInput(e) {
  const t = e.target;
  if (t.id === "mSearch") { state.q = t.value; return renderSoon(); }
  if (t.id === "plSearch") { state.pl.q = t.value; state.pl.limit = 50; return renderSoon(); }
  if (t.id === "plTeam") { state.pl.team = t.value; state.pl.limit = 50; return render(); }
  if (t.id === "pickA" || t.id === "pickB") {
    const slot = t.id === "pickA" ? "a" : "b";
    const v = t.value.trim();
    const p = byLabel.get(v.toLowerCase());
    if (p || !v) { ss[slot] = p || null; ss.example = false; saveSS(); renderSSResult(); }
    return;
  }
  if (t.id === "mtAdd" && e.type === "change") { const p = byLabel.get(t.value.trim().toLowerCase()); if (p) { addToRoster(p); } return; }
  if (t.id === "mtSlots") {
    const team = signedIn() && activeTeam();
    if (team) { team.lineup_format = t.value; saveTeamSoon(team); } else store.set("tsm-slots", t.value);
    return render();
  }
  if (t.id === "teamPick" && e.type === "change") { setActiveTeam(t.value); return; }
  if (t.id === "tradeGive" || t.id === "tradeGet") {
    const p = byLabel.get(t.value.trim().toLowerCase());
    if (p) tradeAdd(t.id === "tradeGive" ? "give" : "get", p);
    return;
  }
}
const ACTIONS = {
  pos(el) { navigate(el.dataset.v.toLowerCase()); },
  plpos(el) { state.pl.pos = el.dataset.v; state.pl.limit = 50; render(); },
  plmore() { state.pl.limit += 50; render(); },
  plall() { state.pl.limit = 1e9; render(); },
  sospos(el) { state.sos.pos = el.dataset.v; render(); },
  swap() { [ss.a, ss.b] = [ss.b, ss.a]; saveSS(); renderStartSit(); },
  close() { closePlayer(); },
  compare(el) {
    const p = byId.get(el.dataset.id); if (!p) return;
    if (ss.example || !ss.a) { ss.a = p; if (ss.example) ss.b = null; }
    else if (ss.a.id !== p.id) ss.b = p;
    ss.example = false; saveSS(); closePlayer(); navigate("start-sit"); if (state.page === "start-sit") render();
  },
  roster(el) {
    const p = byId.get(el.dataset.id); if (!p) return;
    const r = roster();
    if (!r.example && r.ids.includes(p.id)) removeFromRoster(p.id); else addToRoster(p);
    render();
  },
  rmroster(el) { removeFromRoster(el.dataset.id); render(); },
  clearroster() { setRosterIds([]); render(); },
  keepexample() { setRosterIds(exampleRoster().map(p => p.id)); render(); },
  addroster() { const el = $("#mtAdd"); const p = el && byLabel.get(el.value.trim().toLowerCase()); if (p) addToRoster(p); },
  tadd(el) { const p = byId.get(el.dataset.id); if (p) tradeAdd(el.dataset.side, p); },
  trm(el) { tradeRemove(el.dataset.side, el.dataset.id); },
  tswap() { const t = tradeState(); store.set("tsm-trade", { give: t.get, get: t.give }); render(); },
  tclear() { store.set("tsm-trade", { give: [], get: [] }); render(); },
  tkeep() { const t = tradeState(); store.set("tsm-trade", { give: t.give, get: t.get }); render(); },
};

// ------------------------------------------------------------------ HOME
// ESPN team logo codes (nflverse uses the same images).
const ESPN = { LA: "lar", WAS: "wsh" };
function teamLogo(abbr, size) {
  const code = (ESPN[abbr] || abbr).toLowerCase();
  return `<span class="tlogo${size ? " " + size : ""}" aria-hidden="true">${esc(abbr)}<img src="https://a.espncdn.com/i/teamlogos/nfl/500/${code}.png" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer"></span>`;
}
function playerRow(p, right) {
  return `<div class="list-row">
    <div class="pcell">${avatar(p)}<span class="meta">${plink(p)}<small>${p.pos} · ${esc(p.team)} · ${esc(oppText(p))}</small></span></div>
    <div class="right">${right}</div></div>`;
}
function listPanel(items, empty) { return `<div class="panel list">${items.length ? items.join("") : `<p class="empty">${empty}</p>`}</div>`; }
function shareRisers(key, positions, minJump) {
  return D.players.filter(p => positions.includes(p.pos) && p.g >= 4 && !unavailable(p) && playedRecently(p)).map(p => {
    const s = p.season[key], r = p.recent[key];
    return { p, s, r, d: s != null && r != null ? r - s : -1 };
  }).filter(x => x.d >= minJump).sort((a, b) => b.d - a.d).slice(0, 8);
}

function renderHomeOffseason() {
  const f = state.fmt;
  const leaders = POS.map(pos => {
    const list = D.players.filter(p => p.pos === pos && p.g >= 8).sort((a, b) => pts(b.ppg, f) - pts(a.ppg, f)).slice(0, 5);
    return `<article class="panel mcard"><div class="mcard-head"><h3>${pos}</h3><a href="#players" class="muted" style="font-size:13px">All players →</a></div>
      <ol>${list.map((p, i) => `<li><span class="rchip" style="background:${rankColor(32 - i * 2)}">${i + 1}</span><span class="faces">${avatar(p)}</span>
        <span class="who">${plink(p)}<small class="opp-line">${teamLogo(p.team, "sm")}<b>${esc(p.team)}</b> · ${f1(pts(p.ppg, f))} pts/g · ${p.g} games</small></span></li>`).join("")}</ol></article>`;
  }).join("");
  const def = POS.map(pos => {
    const rows = Object.entries(D.defenses[pos]).sort((a, b) => b[1].rank[f] - a[1].rank[f]);
    const item = ([t, d]) => `<li><span class="rchip" style="background:${rankColor(d.rank[f])}">${d.rank[f]}</span><span class="faces">${teamLogo(t)}</span>
      <span class="who"><b>${esc(D.teams[t].name)}</b><small>${f1(d.fppg[f])} pts allowed/g to ${pos}s</small></span></li>`;
    return `<article class="panel mcard"><div class="mcard-head"><h3>vs ${pos}</h3><a href="#${pos.toLowerCase()}" class="muted" style="font-size:13px">Full rankings →</a></div>
      <ol>${rows.slice(0, 3).map(item).join("")}${rows.slice(-2).map(item).join("")}</ol></article>`;
  }).join("");
  $("#page").innerHTML = `
    <section class="hero">
      <div class="hero-main">
        <div class="hero-quilt" aria-hidden="true">${Array.from({ length: 18 }, (_, i) => `<i style="background:${scaleColor(i % 6, 0, 2.5, 5)}"></i>`).join("")}</div>
        <div class="eyebrow">${D.season} season · final</div>
        <h1>The ${D.season} season is in the books</h1>
        <p>Weekly matchup charts, start/sit calls and lineups return for Week 1 of ${esc(nextSeasonText())}. Until then: final defense rankings, season leaders, usage stats, and a Trade Analyzer for keeper and dynasty deals.</p>
        <div class="hero-actions"><a class="btn" href="#trade">Trade Analyzer</a><a class="btn" href="#players">Player usage</a><a class="btn ghost" href="#qb">Defense rankings</a></div>
      </div>
      <div class="hero-side"><div class="stat-tiles">
        <div class="panel tile"><span class="k">Next kickoff</span><span class="v" style="font-size:22px">${D.nextSeason && D.nextSeason.kickoff ? new Date(D.nextSeason.kickoff + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "TBA"}</span><span class="s">${D.nextSeason ? `${D.nextSeason.season} season` : "Schedule not out yet"}</span></div>
        <div class="panel tile"><span class="k">Players tracked</span><span class="v">${D.players.length}</span><span class="s">Full ${D.season} season</span></div>
      </div></div>
    </section>
    <section class="section"><div class="section-head"><h2>${D.season} season leaders</h2><span class="muted" style="font-size:13px">${esc(fmtLabel())} points per game, 8+ games</span></div>
      <div class="grid-4">${leaders}</div></section>
    <section class="section"><div class="section-head"><h2>Softest and toughest defenses</h2><span class="muted" style="font-size:13px">Top 3 and bottom 2 by ${esc(fmtLabel())} points allowed</span></div>
      <div class="grid-4">${def}</div></section>`;
}

function renderHome() {
  if (offseason()) return renderHomeOffseason();
  const f = state.fmt;
  const playing = Object.entries(D.teams).filter(([, t]) => t.opp);
  const byes = Object.entries(D.teams).filter(([, t]) => !t.opp).map(([k]) => k);
  // Hero tiles: this week's headline spots.
  const shootout = playing.filter(([, t]) => t.total != null && !t.away).sort((a, b) => b[1].total - a[1].total)[0];
  const starters = D.players.filter(p => !unavailable(p) && playedRecently(p) && p.g >= 3);
  const smash = starters.filter(p => p.ppg.ppr >= 10)
    .sort((a, b) => defFor(b).rank[f] - defFor(a).rank[f] || project(b).proj - project(a).proj)[0];
  // Fade: a mid-range starter (8–12 PPR pts/g, so the pick stays the same in every format) with the toughest matchup.
  const fade = starters.filter(p => p.ppg.ppr >= 8 && p.ppg.ppr <= 12)
    .sort((a, b) => defFor(a).rank[f] - defFor(b).rank[f] || b.ppg.ppr - a.ppg.ppr)[0];
  // Teams on bye file no injury report, so skip anyone who sat out his team's most recent game.
  const byeStars = D.players.filter(p => p.bye && !p.inj && !p.missed).sort((a, b) => b.ppg.ppr - a.ppg.ppr).slice(0, 3);
  const tileName = p => `<span class="v tile-name">${plink(p)}</span>`;
  const quilt = Array.from({ length: 18 }, (_, i) => `<i style="background:${scaleColor(i % 6, 0, 2.5, 5)};animation-delay:${(i * 0.37) % 3}s"></i>`).join("");

  // Snap share risers (all skill positions).
  const snapUp = shareRisers("snap", ["RB", "WR", "TE"], 0.06).map(x => playerRow(x.p,
    `<span class="up">${pct(x.s)} → ${pct(x.r)}</span><small>snap share, last 3</small>`));
  // Target share risers.
  const tgtUp = shareRisers("tgtShare", ["RB", "WR", "TE"], 0.04).map(x => playerRow(x.p,
    `<span class="up">${pct(x.s)} → ${pct(x.r)}</span><small>target share, last 3 · ${f1(x.p.l3use.tgt ?? x.p.use.tgt)} tgt/g</small>`));
  // Injury report (fantasy starters, chosen by PPR average so the list is the same in every format).
  // This week's Out / Doubtful / Questionable only (no IR); when there are more than fit, the
  // most important (highest-scoring) players win the spots.
  const inj = D.players.filter(p => p.inj && /^(out|doubtful|questionable)/i.test(p.inj.status) && p.ppg.ppr >= 6)
    .sort((a, b) => b.ppg.ppr - a.ppg.ppr).slice(0, 10)
    .map(p => `<div class="list-row">
      <div class="pcell">${avatar(p)}<span class="meta">${plink(p)}<small>${p.pos} · ${esc(p.team)} · ${f1(pts(p.ppg, f))} pts/g</small></span></div>
      <div class="right">${injBadge(p)}<small>${esc(p.inj.injury || "")}</small></div></div>`);
  const filed = (D.injuryTeams || []).length;
  const injNote = filed < 32 ? `<p class="inj-note">Week ${D.week} reports are in for <b>${filed} of 32</b> teams. The rest post later in the week; the site updates every morning at 5am ET.</p>` : "";

  // Signed-in watchlist.
  const watched = [...account.watch].map(id => byId.get(id)).filter(Boolean);
  const watchHtml = !watched.length ? "" : `<section class="section"><div class="section-head"><h2>Your watchlist</h2><a href="#account">Manage →</a></div>
    <div class="watch-grid">${watched.map(p => { const d = defFor(p), fm = formOf(playerModel(f).byId.get(p.id)); return `<div class="panel watch-card">
      <div class="pcell">${avatar(p)}<span class="meta">${plink(p)}<small class="pline">${p.pos} · ${teamLogo(p.team, "sm")}${esc(p.team)} ${p.bye ? "· BYE" : `${p.away ? "@" : "vs"} ${teamLogo(p.opp, "sm")}${esc(p.opp)}`}</small></span></div>
      <div class="watch-stats">${d ? rankChip(d.rank[f], `Matchup rank vs ${p.pos}`) : ""}<span><b>${unavailable(p) ? "—" : f1(project(p).proj)}</b><small>proj</small></span><span class="tag ${fm.cls}">${fm.label}</span>${injBadge(p)}</div></div>`; }).join("")}</div></section>`;

  // Hot and cold: last 3 games vs season average.
  const form = D.players.filter(p => p.g >= 5 && !p.bye && playedRecently(p)).map(p => {
    const s = pts(p.ppg, f), r = pts(p.l3, f);
    return { p, s, r, d: r - s };
  });
  const hot = form.filter(x => x.r >= 10 && x.d >= 3 && x.r >= x.s * 1.2).sort((a, b) => b.d - a.d).slice(0, 8)
    .map(x => playerRow(x.p, `<span class="up">▲ ${f1(x.r)}</span><small>last 3 · season ${f1(x.s)}</small>`));
  const cold = form.filter(x => x.s >= 10 && x.d <= -3 && x.r <= x.s * 0.8 && !injOut(x.p)).sort((a, b) => a.d - b.d).slice(0, 8)
    .map(x => playerRow(x.p, `<span class="down">▼ ${f1(x.r)}</span><small>last 3 · season ${f1(x.s)}</small>`));

  const best = POS.map(pos => {
    const rows = D.positions[pos].rows.filter(r => !r.bye).sort((a, b) => b.def.rank[f] - a.def.rank[f]).slice(0, 5);
    return `<article class="panel mcard">
      <div class="mcard-head"><h3>${pos}</h3><a href="#${pos.toLowerCase()}" class="muted" style="font-size:13px">Full chart →</a></div>
      <ol>${rows.map(r => `<li>${rankChip(r.def.rank[f], `${r.opp} rank vs ${pos}`)}
        <span class="faces">${facesHtml(r, 2)}</span>
        <span class="who">${namesHtml(r)}<small class="opp-line">${r.away ? "@" : "vs"} ${teamLogo(r.opp, "sm")}<b>${esc(r.opp)}</b> · ${f1(r.def.fppg[f])} allowed</small></span></li>`).join("")}</ol>
    </article>`;
  }).join("");

  // Game slate.
  const seen = new Set(), games = [];
  for (const [abbr, t] of playing) {
    if (seen.has(abbr)) continue;
    seen.add(abbr); seen.add(t.opp);
    const away = t.away ? abbr : t.opp, home = t.away ? t.opp : abbr;
    games.push({ away, home, A: D.teams[away], H: D.teams[home], kick: t.kick });
  }
  games.sort((a, b) => (a.kick || "").localeCompare(b.kick || ""));
  const [iMin, iMid, iMax] = stops(playing.map(([, t]) => t.implied));
  const teamRow = (abbr, t) => `<div class="game-row">${teamLogo(abbr)}<b>${esc(abbr)}</b>
      <span class="track"><i style="width:${t.implied != null ? Math.min(100, t.implied / 35 * 100) : 0}%;background:${scaleColor(t.implied, iMin, iMid, iMax)}"></i></span>
      <span class="num">${t.implied != null ? f1(t.implied) : "—"}</span></div>`;
  const slate = games.map(g => {
    const fav = g.H.spread != null ? (g.H.spread < 0 ? `${g.home} ${g.H.spread}` : g.H.spread > 0 ? `${g.away} ${-g.H.spread}` : "Pick'em") : "";
    return `<article class="panel game">
      <div class="game-top"><span>${esc(kickLabel(g.kick, true))}${g.H.roof === "dome" || g.H.roof === "closed" ? " · Dome" : ""}</span>
      <span>${g.H.total != null ? `O/U ${g.H.total}` : ""}${fav ? ` · ${esc(fav)}` : ""}</span></div>
      ${teamRow(g.away, g.A)}${teamRow(g.home, g.H)}
    </article>`;
  }).join("");

  $("#page").innerHTML = `
    <section class="hero">
      <div class="hero-main">
        <div class="hero-quilt" aria-hidden="true">${quilt}</div>
        <div class="eyebrow">${D.season} season · Week ${D.week}</div>
        <h1>Week ${D.week} matchups are in</h1>
        <p>Every defense ranked by what it gives up to QBs, RBs, WRs and TEs, plus start/sit calls, snap and target shares, and rest-of-season schedules. ${esc(updatedText())}</p>
        <div class="hero-actions">
          <a class="btn" href="#${state.pos.toLowerCase()}">Matchup charts</a>
          <a class="btn" href="#start-sit">Start / Sit</a>
          <a class="btn ghost" href="#my-team">Set my lineup</a>
        </div>
      </div>
      <div class="hero-side">
        <div class="stat-tiles">
          <div class="panel tile"><span class="k">Shootout of the week</span>${shootout ? `
            <span class="v tile-game">${teamLogo(shootout[1].opp, "sm")}${esc(shootout[1].opp)} <span class="at">@</span> ${teamLogo(shootout[0], "sm")}${esc(shootout[0])}</span>
            <span class="s">O/U ${shootout[1].total} · ${esc(shootout[1].opp)} ${f1(D.teams[shootout[1].opp].implied)}, ${esc(shootout[0])} ${f1(shootout[1].implied)} projected</span>` :
            `<span class="v">—</span><span class="s">Betting lines aren't posted yet</span>`}</div>
          <div class="panel tile tile-good"><span class="k">Smash spot</span>${smash ? `${tileName(smash)}
            <span class="s">${smash.pos} · ${esc(oppText(smash))} · rank ${defFor(smash).rank[f]} of 32 vs ${smash.pos}s · ${f1(project(smash).proj)} proj</span>` : `<span class="v">—</span>`}</div>
          <div class="panel tile tile-bad"><span class="k">Fade alert</span>${fade ? `${tileName(fade)}
            <span class="s">${fade.pos} · ${esc(oppText(fade))} · rank ${defFor(fade).rank[f]} of 32 vs ${fade.pos}s · ${f1(pts(fade.ppg, f))} pts/g average</span>` : `<span class="v">—</span>`}</div>
          <div class="panel tile"><span class="k">Stars on bye</span>${byeStars.length ? `
            <span class="tile-list">${byeStars.map(p => `<span>${plink(p)} <small>${p.pos} · ${esc(p.team)} · ${f1(pts(p.ppg, f))}</small></span>`).join("")}</span>
            <span class="s">${byes.length} teams off: ${esc(byes.join(", "))}</span>` : `<span class="v">None</span><span class="s">All 32 teams play in Week ${D.week}</span>`}</div>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-head"><h2>Best matchups this week</h2><span class="muted" style="font-size:13px">Rank 32 = defense allows the most ${esc(fmtLabel())} points to the position</span></div>
      <div class="grid-4">${best}</div>
    </section>

    ${watchHtml}
    <section class="grid-2" style="align-items:start">
      <div class="section"><div class="section-head"><h2>Usage risers</h2><span class="muted" style="font-size:13px">Snap share, last 3 vs season</span></div>
        ${listPanel(snapUp, "No big snap-share jumps this week.")}</div>
      <div class="section"><div class="section-head"><h2>Injury report</h2><span class="muted" style="font-size:13px">Week ${D.week}, fantasy starters</span></div>
        <div class="panel list inj-panel">${injNote}${inj.length ? inj.join("") : `<p class="empty">No fantasy-relevant players are listed out or questionable yet.</p>`}</div></div>
    </section>

    <section class="grid-3" style="align-items:start">
      <div class="section"><div class="section-head"><h2>Target share risers</h2><a href="#players">All players →</a></div>
        ${listPanel(tgtUp, "No big target-share jumps this week.")}</div>
      <div class="section"><div class="section-head"><div class="hc-head"><span class="hc-dot" style="background:var(--s-green)"></span><h2>Hot</h2></div><span class="muted" style="font-size:13px">Last 3 games</span></div>
        ${listPanel(hot, "Nobody is running hot right now.")}</div>
      <div class="section"><div class="section-head"><div class="hc-head"><span class="hc-dot" style="background:var(--s-red)"></span><h2>Cold</h2></div><span class="muted" style="font-size:13px">Last 3 games</span></div>
        ${listPanel(cold, "Nobody is in a slump right now.")}</div>
    </section>


    <section class="section" id="homePosts" hidden></section>

    <section class="section">
      <div class="section-head"><h2>Game slate</h2><span class="muted" style="font-size:13px">Projected points from the betting line</span></div>
      <div class="slate">${slate || `<p class="empty">The schedule for this week isn't out yet.</p>`}</div>
    </section>`;
}

// Player cell for the matchup charts: stacked headshots, names, team logo.
function facesHtml(r, max = 9) {
  const ids = r.ids || [];
  return r.players.slice(0, max).map((n, i) => {
    const p = ids[i] && byId.get(ids[i]);
    return p ? avatar(p) : `<span class="avatar" aria-hidden="true">${esc(initials(n.replace(".", "")))}</span>`;
  }).join("");
}
function chartPlayerCell(r) {
  const faces = facesHtml(r);
  return `<div class="chart-player"><span class="faces">${faces}</span>
    <span class="meta"><span class="names">${namesHtml(r)}</span><small class="team-line">${teamLogo(r.team, "sm")}${esc(r.team)}</small></span></div>`;
}
function namesHtml(r) {
  const ids = r.ids || [];
  return r.players.map((n, i) => ids[i] && byId.get(ids[i]) ? plink(byId.get(ids[i]), n) : `<b>${esc(n)}</b>`).join(" / ");
}

// ------------------------------------------------------------------ MATCHUPS
function renderDefenseRankings() {
  const pos = state.pos, f = state.fmt, block = D.positions[pos];
  const rows = Object.entries(D.defenses[pos]).sort((a, b) => b[1].rank[f] - a[1].rank[f]);
  const st = { fppg: stops(rows.map(r => r[1].fppg[f])) };
  block.columns.forEach(c => { st[c.key] = stops(rows.map(r => (r[1].stats || {})[c.key])); });
  $("#page").innerHTML = `
    ${pageHead(`${D.season} final · ${esc(fmtLabel())}`, `${pos} Defense Rankings`, `Every defense ranked by what it allowed to ${POS_NAME[pos]} over the full ${D.season} season.`)}
    ${offseasonNotice("The weekly matchup chart")}
    <div class="controls"><div class="seg seg-lg" role="group" aria-label="Position">${POS.map(p => `<button type="button" data-action="pos" data-v="${p}" aria-pressed="${p === pos}">${p}</button>`).join("")}</div></div>
    <div class="legend"><span>Tough</span><span class="bar" aria-hidden="true"></span><span>Soft</span><span>Rank 1 = fewest ${esc(fmtLabel())} points allowed to ${POS_NAME[pos]}, 32 = most</span></div>
    <div class="table-box"><table>
      <thead><tr><th class="sticky l" scope="col">Defense</th><th scope="col">Rank</th><th scope="col">FPPG</th>${block.columns.map(c => `<th scope="col">${c.label}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(([t, d]) => `<tr><td class="sticky l"><span class="team-cell">${teamLogo(t)}<span><b>${esc(t)}</b> <span class="team-tag">${esc(D.teams[t].name)}</span></span></span></td>
        <td class="scale rank" style="background:${rankColor(d.rank[f])}">${d.rank[f]}</td>
        <td class="scale" style="background:${scaleColor(d.fppg[f], ...st.fppg)}">${f1(d.fppg[f])}</td>
        ${block.columns.map(c => { const v = (d.stats || {})[c.key]; return v == null ? "<td>—</td>" : `<td class="scale" style="background:${scaleColor(v, ...st[c.key], YELLOW)}">${Number(v).toFixed(c.dp)}</td>`; }).join("")}</tr>`).join("")}</tbody>
    </table></div>
    ${methodLink("matchup charts")}`;
}

function renderMatchups() {
  if (offseason()) return renderDefenseRankings();
  const pos = state.pos, f = state.fmt;
  const block = D.positions[pos];
  const cols = [
    { key: "player", label: pos, cls: "sticky l" },
    { key: "opp", label: "Opp" },
    { key: "rank", label: "Rank" },
    { key: "fppg", label: "FPPG" },
    { key: "pa", label: `PA Wk ${D.prevWeek}` },
    ...block.columns.map(c => ({ key: c.key, label: c.label, dp: c.dp, stat: true })),
    { key: "wx", label: "Weather" },
    { key: "implied", label: "Team Tot" },
  ];
  const val = (r, key) => {
    const d = r.def;
    switch (key) {
      case "player": return r.players.join("/");
      case "opp": return r.opp;
      case "implied": return (D.teams[r.team] || {}).implied;
      case "wx": { const w = (D.teams[r.team] || {}).wx; return !w ? null : w.indoor ? 200 : w.temp; }
      case "rank": return d.rank[f];
      case "fppg": return d.fppg[f];
      case "pa": return d.pa ? d.pa.pts[f] : null;
      default: return d.stats[key];
    }
  };
  const playing = block.rows.filter(r => !r.bye), byes = block.rows.filter(r => r.bye);
  const sort = state.sort || { key: "rank", dir: -1 };
  playing.sort((a, b) => cmp(val(a, sort.key), val(b, sort.key), sort.dir) || val(b, "fppg") - val(a, "fppg"));
  const st = { rank: [1, 16.5, 32], fppg: stops(playing.map(r => r.def.fppg[f])),
    pa: stops(playing.filter(r => r.def.pa).map(r => r.def.pa.pts[f])), implied: stops(playing.map(r => val(r, "implied"))) };
  cols.filter(c => c.stat).forEach(c => { st[c.key] = stops(playing.map(r => r.def.stats[c.key])); });
  const q = state.q.trim().toLowerCase();
  const hit = r => !q || r.players.join(" ").toLowerCase().includes(q) || r.team.toLowerCase() === q || (r.opp && r.opp.toLowerCase() === q);

  const body = playing.map(r => {
    const d = r.def, imp = val(r, "implied");
    return `<tr class="${hit(r) ? "" : "dim"}">
      <td class="sticky l">${chartPlayerCell(r)}</td>
      <td><span class="opp-cell">${teamLogo(r.opp)}<span><b>${r.away ? "@" : ""}${esc(r.opp)}</b><span class="kick">${esc(kickLabel(r.kick))}</span></span></span></td>
      <td class="scale rank" style="background:${rankColor(d.rank[f])}">${d.rank[f]}</td>
      <td class="scale" style="background:${scaleColor(d.fppg[f], ...st.fppg)}">${f1(d.fppg[f])}</td>
      ${d.pa ? `<td class="scale pa" style="background:${scaleColor(d.pa.pts[f], ...st.pa)}">${f1(d.pa.pts[f])}<small>(${esc(d.pa.who)})</small></td>` : `<td>BYE</td>`}
      ${cols.filter(c => c.stat).map(c => `<td class="scale" style="background:${scaleColor(d.stats[c.key], ...st[c.key], YELLOW)}">${Number(d.stats[c.key]).toFixed(c.dp)}</td>`).join("")}
      ${wxCell((D.teams[r.team] || {}).wx)}
      <td class="${imp != null ? "scale" : ""}" style="${imp != null ? `background:${scaleColor(imp, ...st.implied, YELLOW)}` : ""}">${imp != null ? f1(imp) : "—"}</td>
    </tr>`;
  }).join("") + byes.map(r => `<tr class="bye ${hit(r) ? "" : "dim"}"><td class="sticky l" style="background:var(--bye)">${chartPlayerCell(r)}</td>
      <td>BYE</td><td>BYE</td><td>BYE</td><td>BYE</td>${cols.filter(c => c.stat).map(() => "<td></td>").join("")}<td></td><td></td></tr>`).join("");

  const downloads = window.TSM_DOWNLOADS ? `<div class="controls"><span class="muted" style="font-size:14px">Download spreadsheets:</span>${
    Object.values(D.formats).map(l => `<a class="btn small" href="${BASE}Week_${D.week}_Matchups_${l.replace(/ /g, "_")}.xlsx">${l} .xlsx</a>`).join("")}</div>` : "";

  $("#page").innerHTML = `
    ${pageHead(`Week ${D.week} · ${esc(fmtLabel())}`, `${pos} Matchups`, `How each team's ${POS_NAME[pos]} line up against this week's opponent. ${esc(updatedText())}`)}
    <div class="controls">
      <div class="seg seg-lg" role="group" aria-label="Position">${POS.map(p => `<button type="button" data-action="pos" data-v="${p}" aria-pressed="${p === pos}">${p}</button>`).join("")}</div>
      <input id="mSearch" type="search" placeholder="Find a player or team" aria-label="Find a player or team" value="${esc(state.q)}">
    </div>
    <div class="legend"><span>Tough matchup</span><span class="bar" aria-hidden="true"></span><span>Great matchup</span><span>Rank 1 = fewest ${esc(fmtLabel())} points allowed to ${POS_NAME[pos]}, 32 = most</span></div>
    <div class="chart-key">
      <p><b>Team Tot</b> = the team's projected points from the betting line. <b>Weather</b> = kickoff forecast; yellow means rough conditions (15+ mph wind, 50%+ rain or snow, or 25°F and below).</p>
    </div>
    <div class="table-box"><table>
      <thead><tr>${cols.map(c => `<th class="${c.cls || ""}" scope="col"${c.key === "implied" ? ' title="Projected points for this team, from the betting line"' : c.key === "wx" ? ' title="Kickoff forecast"' : ""}>${sortBtn(c.key, c.label, state.sort)}</th>`).join("")}</tr></thead>
      <tbody>${body}</tbody></table></div>
    ${downloads}
    ${methodLink("matchup charts")}`;
}

// ------------------------------------------------------------------ START / SIT
function saveSS() { store.set("tsm-ss", { a: ss.a && ss.a.id, b: ss.b && ss.b.id }); }
function renderStartSit() {
  if (offseason()) {
    $("#page").innerHTML = `${pageHead(`${D.season} season · final`, "Start / Sit", "Compare any two players, at any position, with a matchup-adjusted verdict.")}
      ${offseasonNotice("Start / Sit")}
      <p class="muted">In the meantime, the <a href="#trade">Trade Analyzer</a> compares players on full-season value, and <a href="#players">Player usage</a> has every player's ${D.season} numbers.</p>`;
    return;
  }
  $("#page").innerHTML = `
    ${pageHead(`Week ${D.week} · ${esc(fmtLabel())}`, "Start / Sit", "Compare any two players, at any position. The call weighs each player's own scoring and usage against this week's matchup.")}
    <div class="pickers">
      <div class="picker"><label for="pickA">Player 1</label><input id="pickA" type="search" list="playerList" placeholder="Type a name" autocomplete="off" value="${ss.a ? esc(playerLabel(ss.a)) : ""}"></div>
      <button type="button" class="swap" data-action="swap" aria-label="Swap players" title="Swap players">⇄</button>
      <div class="picker"><label for="pickB">Player 2</label><input id="pickB" type="search" list="playerList" placeholder="Type a name" autocomplete="off" value="${ss.b ? esc(playerLabel(ss.b)) : ""}"></div>
    </div>
    <p class="example" id="ssExample" ${ss.example ? "" : "hidden"}>Example comparison. Type any two players above to compare your own.</p>
    <div id="verdict" class="verdict" aria-live="polite"></div>
    <div class="table-box"><table class="cmp" id="cmp"><tbody></tbody></table></div>
    ${methodLink("Start / Sit projections")}`;
  renderSSResult();
}

function verdictFor(A, B, f) {
  const pa = project(A, f), pb = project(B, f);
  const ua = unavailable(A), ub = unavailable(B);
  const reasons = [];
  if (ua && ub) return { cls: "none", call: "Neither can play", margin: `${A.name} is ${ua} and ${B.name} is ${ub}.`, reasons, pa, pb };
  if (ua || ub) {
    const [W, why, L] = ua ? [B, ua, A] : [A, ub, B];
    return { cls: "", call: `Start ${W.name}`, margin: `${L.name} is ${why} this week.`, reasons, pa, pb, winner: W };
  }
  const W = pa.proj >= pb.proj ? A : B, L = W === A ? B : A;
  const pw = W === A ? pa : pb, pl = W === A ? pb : pa;
  const diff = pw.proj - pl.proj, toss = diff < 1, fl = D.formats[f];
  const rw = pw.def.rank[f], rl = pl.def.rank[f];
  if (Math.abs(rw - rl) >= 4) {
    const bp = rw > rl ? W : L, other = bp === W ? L : W;
    reasons.push(`${bp.name} has the better matchup: ${bp.opp} is ${ordinal(33 - Math.max(rw, rl))} most generous to ${bp.pos}s, while ${other.opp} is ${ordinal(33 - Math.min(rw, rl))} against ${other.pos}s.`);
  } else {
    reasons.push(`Similar matchups: ${W.opp} ranks ${rw} and ${L.opp} ranks ${rl} of 32 in ${fl} points allowed to the position.`);
  }
  const saidForm = new Set();
  if (Math.abs(pw.base - pl.base) >= 1) {
    const hi = pw.base > pl.base ? W : L, lo = hi === W ? L : W;
    const hs = pts(hi.ppg, f), hr = pts(hi.l3, f), ls = pts(lo.ppg, f), lr = pts(lo.l3, f);
    if (hs >= ls && hr >= lr) reasons.push(`${hi.name} scores more on his own: ${f1(hs)} per game this season and ${f1(hr)} over his last ${Math.min(RECENT, hi.g)}, vs ${f1(ls)} and ${f1(lr)}.`);
    else if (hr > lr) { reasons.push(`${hi.name} is hotter lately: ${f1(hr)} per game over his last ${Math.min(RECENT, hi.g)} vs ${f1(lr)}, even though ${lo.name}'s season average is higher (${f1(ls)} vs ${f1(hs)}).`); saidForm.add(hi); }
    else { reasons.push(`${hi.name} has the higher season average (${f1(hs)} vs ${f1(ls)}), though ${lo.name} has been better over the last ${RECENT} games (${f1(lr)} vs ${f1(hr)}).`); saidForm.add(lo); }
  }
  // Usage edge for pass catchers / backs.
  const useKey = p => p.pos === "RB" ? null : p.pos === "QB" ? null : "tgtShare";
  if (useKey(A) && useKey(B) && A.recent.tgtShare != null && B.recent.tgtShare != null && Math.abs(A.recent.tgtShare - B.recent.tgtShare) >= 0.05) {
    const hi = A.recent.tgtShare > B.recent.tgtShare ? A : B, lo = hi === A ? B : A;
    reasons.push(`${hi.name} is earning more of his offense's targets lately: ${pct(hi.recent.tgtShare)} vs ${pct(lo.recent.tgtShare)} over the last 3.`);
  }
  for (const p of [A, B]) {
    if (saidForm.has(p)) continue;
    const s = pts(p.ppg, f), r = pts(p.l3, f);
    if (p.g >= 4 && r >= s * 1.3 && r - s >= 3) reasons.push(`${p.name} is trending up: ${f1(r)} per game over his last 3.`);
    if (p.g >= 4 && r <= s * 0.7 && s - r >= 3) reasons.push(`${p.name} is trending down: ${f1(r)} per game over his last 3.`);
  }
  const ta = teamOf(A).implied, tb = teamOf(B).implied;
  if (ta != null && tb != null && Math.abs(ta - tb) >= 4) {
    const hi = ta > tb ? A : B, lo = hi === A ? B : A;
    reasons.push(`${hi.team} is projected to score more (${f1(teamOf(hi).implied)} vs ${f1(teamOf(lo).implied)} for ${lo.team}), which means more scoring chances.`);
  }
  for (const p of [A, B]) if (p.inj) reasons.push(`${p.name} is ${p.inj.status.toLowerCase()}${p.inj.injury ? ` (${p.inj.injury.toLowerCase()})` : ""}. Check his status before kickoff.`);
  if (W.inj && /doubtful/i.test(W.inj.status) && !(L.inj && /doubtful/i.test(L.inj.status))) {
    return { cls: "", call: `Start ${L.name}`, margin: `${W.name} projects higher but is doubtful to play.`, reasons, pa, pb, winner: L };
  }
  return {
    cls: toss ? "toss" : "", call: toss ? `Toss-up, lean ${W.name}` : `Start ${W.name}`, winner: W, reasons, pa, pb,
    margin: `${f1(pw.proj)} vs ${f1(pl.proj)} projected ${fl} points${toss ? ". Too close to call on numbers alone." : ` (+${f1(diff)})`}`,
  };
}

function renderSSResult() {
  const f = state.fmt, A = ss.a, B = ss.b;
  const ex = $("#ssExample"); if (ex) ex.hidden = !ss.example;
  const vEl = $("#verdict"), tb = $("#cmp tbody");
  if (!vEl) return;
  if (!A || !B) {
    vEl.className = "verdict none";
    vEl.innerHTML = `<p class="call">Pick two players</p><p class="margin">Type a name in each box. Any positions work, so you can settle a flex spot too.</p>`;
    tb.innerHTML = ""; return;
  }
  const v = verdictFor(A, B, f);
  vEl.className = "verdict " + v.cls;
  vEl.innerHTML = `<p class="call">${esc(v.call)}</p><p class="margin">${esc(v.margin)}</p>` + (v.reasons.length ? `<ul>${v.reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>` : "");

  const P = [A, B], proj = [v.pa, v.pb], rows = [];
  const edgeIdx = (vals, lower) => {
    if (vals.some(x => x == null || Number.isNaN(x)) || vals[0] === vals[1]) return -1;
    return (lower ? vals[0] < vals[1] : vals[0] > vals[1]) ? 0 : 1;
  };
  const row = (label, cells, edge = -1, cls = "") => rows.push(`<tr${cls ? ` class="${cls}"` : ""}><th class="metric" scope="row">${label}</th>${
    cells.map((c, i) => i === edge ? c.replace(/^<td( class="([^"]*)")?/, (m, _a, k) => `<td class="${k ? k + " " : ""}edge"`) : c).join("")}</tr>`);
  const group = t => rows.push(`<tr class="group"><th colspan="3" scope="colgroup">${t}</th></tr>`);

  rows.push(`<tr class="who"><th class="metric" scope="row"></th>${P.map(p => `<td>${plink(p)}<span class="team-tag">${p.pos} · ${esc(p.team)}${p.depth ? ` · ${p.pos}${p.depth} on depth chart` : ""}</span></td>`).join("")}</tr>`);
  row("Projected points", P.map((p, i) => `<td>${unavailable(p) ? "—" : f1(proj[i].proj)}</td>`), v.winner ? P.indexOf(v.winner) : -1, "proj");

  group(`Week ${D.week} matchup`);
  row("Opponent", P.map(p => `<td>${p.bye ? "BYE" : `${p.away ? "@" : ""}${esc(p.opp)}<span class="sub2">${esc(kickLabel(p.kick, true))}</span>`}</td>`));
  row("Status", P.map(p => `<td>${injBadge(p) || `<span class="badge ok">No injury listed</span>`}${p.inj && p.inj.injury ? `<span class="sub2">${esc(p.inj.injury)}</span>` : ""}</td>`));
  const ranks = P.map(p => p.bye ? null : defFor(p).rank[f]);
  row("Matchup rank", P.map((p, i) => ranks[i] == null ? "<td>—</td>" :
    `<td class="scale" style="background:${rankColor(ranks[i])}">${ranks[i]} of 32<span class="sub2">${ranks[i] >= 25 ? "great" : ranks[i] >= 17 ? "good" : ranks[i] >= 9 ? "tough" : "very tough"} for ${p.pos}s</span></td>`), edgeIdx(ranks));
  row(`${esc(fmtLabel())} pts allowed / g`, P.map(p => p.bye ? "<td>—</td>" : `<td>${f1(defFor(p).fppg[f])}<span class="sub2">league avg ${f1(D.leagueAvg[p.pos][f])} to ${p.pos}s</span></td>`));
  const imp = P.map(p => p.bye ? null : teamOf(p).implied ?? null);
  row("Team projected points", P.map((p, i) => `<td>${imp[i] != null ? f1(imp[i]) : "—"}</td>`), edgeIdx(imp));
  const boosts = P.map((p, i) => p.bye ? null : (proj[i].factor - 1) * 100);
  row("Matchup adjustment", P.map((p, i) => boosts[i] == null ? "<td>—</td>" : `<td>${boosts[i] >= 0 ? "+" : "−"}${Math.abs(boosts[i]).toFixed(0)}%</td>`), edgeIdx(boosts));

  group("Production");
  const sp = P.map(p => pts(p.ppg, f)), l3 = P.map(p => pts(p.l3, f));
  row(`${esc(fmtLabel())} pts / game`, P.map((p, i) => `<td>${f1(sp[i])}<span class="sub2">${p.g} game${p.g === 1 ? "" : "s"}</span></td>`), edgeIdx(sp));
  row(`Last ${RECENT} games`, P.map((p, i) => `<td>${f1(l3[i])}</td>`), edgeIdx(l3));

  group("Usage (season · last 3)");
  const useRow = (label, key, fmt) => {
    const vals = P.map(p => p.season[key]);
    if (vals.every(x => !x)) return;
    row(label, P.map(p => `<td>${fmt(p.season[key])}<span class="sub2">last 3: ${fmt(p.recent[key])}</span></td>`), edgeIdx(vals));
  };
  useRow("Snap share", "snap", pct);
  if (A.pos !== "QB" || B.pos !== "QB") {
    useRow("Target share", "tgtShare", pct);
    useRow("Air yards share", "airShare", pct);
    useRow("Rush share", "rushShare", pct);
  }
  const rzVals = P.map(p => p.season.rzTgt + p.season.rzCar);
  row("Red-zone chances / g", P.map(p => `<td>${f1(p.season.rzTgt + p.season.rzCar)}<span class="sub2">last 3: ${f1(p.recent.rzTgt + p.recent.rzCar)}</span></td>`), edgeIdx(rzVals));
  const LBL = { att: "Pass attempts", pyd: "Pass yards", ptd: "Pass TDs", int: "Interceptions", car: "Carries", ryd: "Rush yards", rtd: "Rush TDs", tgt: "Targets", rec: "Catches", recyd: "Rec yards", rectd: "Rec TDs" };
  for (const k of Object.keys(LBL).filter(k => k in A.use || k in B.use)) {
    const vals = P.map(p => k in p.use ? p.use[k] : null);
    row(`${LBL[k]} / g`, P.map(p => k in p.use ? `<td>${f1(p.use[k])}<span class="sub2">last 3: ${f1(p.l3use[k])}</span></td>` : "<td>—</td>"),
      A.pos === B.pos ? edgeIdx(vals, k === "int") : -1);
  }
  tb.innerHTML = rows.join("");
}

// ------------------------------------------------------------------ MY TEAM
const SLOT_SETS = {
  standard: { label: "QB, 2 RB, 2 WR, TE, FLEX", slots: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX"] },
  wr3: { label: "QB, 2 RB, 3 WR, TE, FLEX", slots: ["QB", "RB", "RB", "WR", "WR", "WR", "TE", "FLEX"] },
  flex2: { label: "QB, 2 RB, 2 WR, TE, 2 FLEX", slots: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "FLEX"] },
  sf: { label: "Superflex: QB, 2 RB, 2 WR, TE, FLEX, SFLEX", slots: ["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "SFLEX"] },
};
const ELIGIBLE = { QB: ["QB"], RB: ["RB"], WR: ["WR"], TE: ["TE"], FLEX: ["RB", "WR", "TE"], SFLEX: ["QB", "RB", "WR", "TE"] };

function exampleRoster() {
  const pick = (pos, idxs) => { const l = D.players.filter(p => p.pos === pos && p.g >= 4 && !unavailable(p) && playedRecently(p)); return idxs.map(i => l[i]).filter(Boolean); };
  return [...pick("QB", [6]), ...pick("RB", [4, 13, 24]), ...pick("WR", [5, 14, 26]), ...pick("TE", [5]), ...pick("WR", [38]), ...pick("RB", [33])];
}
function roster() {
  // Signed in: the active saved team. Signed out: this browser's roster (or an example).
  if (signedIn() && account.loaded) {
    const t = activeTeam();
    return { ids: t ? t.player_ids.filter(id => byId.has(id)) : [], example: false, cloud: true, team: t };
  }
  const saved = store.get("tsm-roster", null);
  if (saved === null) return { ids: exampleRoster().map(p => p.id), example: true };
  return { ids: saved.filter(id => byId.has(id)), example: false };
}
async function setRosterIds(ids) {
  if (signedIn() && account.loaded) {
    let t = activeTeam();
    if (!t) { t = await createTeam("My Team", ids, "standard", true); if (t) toast("Team saved to your account"); return; }
    t.player_ids = ids; saveTeamSoon(t);
  } else store.set("tsm-roster", ids);
}
function addToRoster(p) {
  const r = roster();
  const ids = r.example ? [] : [...r.ids];
  if (!ids.includes(p.id)) ids.push(p.id);
  setRosterIds(ids);
  if (state.page === "my-team") render();
}
function removeFromRoster(id) {
  setRosterIds(roster().ids.filter(x => x !== id));
}
function optimize(players, slots) {
  const pool = players.map(p => ({ p, proj: project(p).proj })).sort((a, b) => b.proj - a.proj);
  const used = new Set(), lineup = [];
  // Fill fixed positions first, then flex slots from what's left (best available).
  const order = slots.map((s, i) => ({ s, i })).sort((a, b) => ELIGIBLE[a.s].length - ELIGIBLE[b.s].length);
  const filled = new Array(slots.length);
  for (const { s, i } of order) {
    const best = pool.find(x => !used.has(x.p.id) && ELIGIBLE[s].includes(x.p.pos) && !unavailable(x.p))
      || pool.find(x => !used.has(x.p.id) && ELIGIBLE[s].includes(x.p.pos));
    if (best) used.add(best.p.id);
    filled[i] = { slot: s, ...(best || {}) };
  }
  lineup.push(...filled);
  const bench = pool.filter(x => !used.has(x.p.id));
  return { lineup, bench };
}
function rosterRow(slot, x, removable) {
  if (!x || !x.p) return `<div class="slot empty-slot"><span class="slot-tag">${slot}</span><span>Empty. Add a player to fill this spot.</span><span></span><span></span></div>`;
  const p = x.p, d = defFor(p), f = state.fmt;
  return `<div class="slot">
    <span class="slot-tag">${slot}</span>
    <div class="pcell">${avatar(p)}<span class="meta"><span>${plink(p)} ${injBadge(p)}</span>
      <small class="pline">${p.pos} · ${teamLogo(p.team, "sm")}${esc(p.team)} ${p.bye ? "· BYE" : `${p.away ? "@" : "vs"} ${teamLogo(p.opp, "sm")}${esc(p.opp)} · ${esc(kickLabel(p.kick))}`}</small></span></div>
    <span>${d ? rankChip(d.rank[f], `Matchup rank vs ${p.pos}`) : ""}</span>
    <span style="display:flex;align-items:center;gap:6px"><span class="proj">${unavailable(p) ? "—" : f1(x.proj)}</span>${removable ? `<button type="button" class="x" data-action="rmroster" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button>` : ""}</span>
  </div>`;
}
function renderMyTeam() {
  const r = roster();
  const setKey = r.cloud ? (r.team ? r.team.lineup_format : "standard") : store.get("tsm-slots", "standard");
  const set = SLOT_SETS[setKey] || SLOT_SETS.standard;
  const players = r.ids.map(id => byId.get(id)).filter(Boolean);
  const { lineup, bench } = optimize(players, set.slots);
  const total = lineup.reduce((s, x) => s + (x.p && !unavailable(x.p) ? x.proj : 0), 0);
  const warnings = lineup.filter(x => x.p && unavailable(x.p)).map(x => `${x.p.name} is ${unavailable(x.p)}, and you don't have another ${x.slot === "FLEX" ? "flex-eligible player" : x.slot} to replace him.`);

  $("#page").innerHTML = `
    ${offseason() ? offseasonNotice("This week's lineup") : ""}
    ${pageHead(offseason() ? `${D.season} season · final` : `Week ${D.week} · ${esc(fmtLabel())}`, r.cloud && r.team ? esc(r.team.name) : "My Team", r.cloud
      ? "Your roster is saved to your account. Here's this week's best lineup, ranked by matchup-adjusted projection."
      : "Add your roster and get this week's best lineup, ranked by matchup-adjusted projection.")}
    ${r.cloud ? teamSwitcher() : sb ? `<div class="panel panel-pad save-cta"><span><strong>Save your team.</strong> <span class="muted">Right now it's only in this browser. Create a free account to keep it, add more teams and use it on any device.</span></span><span style="display:flex;gap:8px"><a class="btn small" href="#login">Log in</a><a class="btn small primary" href="#signup">Create account</a></span></div>` : ""}
    <div class="panel panel-pad addbar">
      <div class="field" style="flex:1 1 260px"><label for="mtAdd">Add a player</label><input id="mtAdd" type="search" list="playerList" placeholder="Type a name and pick from the list" autocomplete="off"></div>
      <button type="button" class="btn primary" data-action="addroster">Add</button>
      <div class="field"><label for="mtSlots">Lineup</label><select id="mtSlots">${Object.entries(SLOT_SETS).map(([k, v]) => `<option value="${k}"${k === setKey ? " selected" : ""}>${esc(v.label)}</option>`).join("")}</select></div>
      ${players.length ? `<button type="button" class="btn" data-action="clearroster">Clear roster</button>` : ""}
    </div>
    ${r.example ? `<div class="panel panel-pad" style="display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap">
      <span><strong>This is an example roster.</strong> <span class="muted">Add your own players above, or keep this one to edit it.</span></span>
      <span style="display:flex;gap:8px"><button type="button" class="btn small" data-action="keepexample">Keep and edit</button><button type="button" class="btn small" data-action="clearroster">Start empty</button></span></div>` : ""}
    <section class="grid-2" style="align-items:start">
      <div class="section">
        <div class="section-head"><h2>Best lineup</h2><span class="muted">${players.length ? `${f1(total)} projected pts` : ""}</span></div>
        <div class="panel lineup">${lineup.map(x => rosterRow(x.slot, x, !r.example)).join("")}</div>
        ${warnings.map(w => `<p class="muted" style="margin:0;font-size:13px">⚠ ${esc(w)}</p>`).join("")}
      </div>
      <div class="section">
        <div class="section-head"><h2>Bench</h2><span class="muted">${bench.length} player${bench.length === 1 ? "" : "s"}</span></div>
        <div class="panel lineup">${bench.length ? bench.map(x => rosterRow("BN", x, !r.example)).join("") : `<p class="empty">Everyone on your roster is in the lineup.</p>`}</div>
      </div>
    </section>
    ${methodLink("lineup picks")}`;
}

// ------------------------------------------------------------------ PLAYERS
const PL_COLS = {
  default: [
    { key: "g", label: "G", get: p => p.g, fmt: v => v },
    { key: "ppg", label: "Pts/G", get: p => pts(p.ppg, state.fmt), fmt: f1 },
    { key: "l3", label: "Last 3", get: p => pts(p.l3, state.fmt), fmt: f1, trend: true },
    { key: "snap", label: "Snap %", get: p => p.season.snap, fmt: pct, bar: 1 },
    { key: "tgtShare", label: "Tgt %", get: p => p.season.tgtShare, fmt: pct, bar: 0.4 },
    { key: "airShare", label: "Air %", get: p => p.season.airShare, fmt: pct, bar: 0.5 },
    { key: "wopr", label: "WOPR", get: p => p.season.wopr, fmt: f2, bar: 1 },
    { key: "rushShare", label: "Rush %", get: p => p.season.rushShare, fmt: pct, bar: 1 },
    { key: "rz", label: "RZ opp/G", get: p => p.season.rzTgt + p.season.rzCar, fmt: f1 },
    { key: "tgt", label: "Tgt/G", get: p => p.use.tgt, fmt: f1 },
    { key: "car", label: "Car/G", get: p => p.use.car, fmt: f1 },
  ],
  QB: [
    { key: "g", label: "G", get: p => p.g, fmt: v => v },
    { key: "ppg", label: "Pts/G", get: p => pts(p.ppg, state.fmt), fmt: f1 },
    { key: "l3", label: "Last 3", get: p => pts(p.l3, state.fmt), fmt: f1, trend: true },
    { key: "snap", label: "Snap %", get: p => p.season.snap, fmt: pct, bar: 1 },
    { key: "att", label: "Att/G", get: p => p.use.att, fmt: f1 },
    { key: "pyd", label: "Pass Yd/G", get: p => p.use.pyd, fmt: f1 },
    { key: "ptd", label: "Pass TD/G", get: p => p.use.ptd, fmt: f2 },
    { key: "int", label: "INT/G", get: p => p.use.int, fmt: f2 },
    { key: "car", label: "Car/G", get: p => p.use.car, fmt: f1 },
    { key: "ryd", label: "Rush Yd/G", get: p => p.use.ryd, fmt: f1 },
    { key: "rz", label: "RZ car/G", get: p => p.season.rzCar, fmt: f1 },
  ],
};
function renderPlayers() {
  const pl = state.pl, f = state.fmt;
  const cols = PL_COLS[pl.pos === "QB" ? "QB" : "default"];
  const q = pl.q.trim().toLowerCase();
  let list = D.players.filter(p => (pl.pos === "ALL" || p.pos === pl.pos)
    && (!pl.team || p.team === pl.team) && (!q || p.name.toLowerCase().includes(q)));
  const get = key => {
    if (key === "name") return p => p.name;
    if (key === "next") return p => p.bye ? null : defFor(p).rank[f];
    const c = cols.find(c => c.key === key); return c ? c.get : p => pts(p.ppg, f);
  };
  const g = get(pl.sort.key);
  list = list.slice().sort((a, b) => cmp(g(a), g(b), pl.sort.dir));
  const shown = list.slice(0, pl.limit);
  const teams = Object.keys(D.teams).sort();
  const body = shown.map(p => {
    const d = defFor(p);
    return `<tr class="clickable" data-rowpid="${esc(p.id)}">
      <td class="sticky l"><div class="pcell">${avatar(p)}<span class="meta">${plink(p)}<small>${p.pos} · ${esc(p.team)} ${injBadge(p)}</small></span></div></td>
      ${cols.map(c => {
        const v = c.get(p);
        if (c.bar && v != null && (p.pos !== "QB" || c.key === "snap")) return `<td class="bar-cell"><span class="fill" style="width:${Math.min(100, v / c.bar * 100)}%"></span><span>${c.fmt(v)}</span></td>`;
        if (c.bar && p.pos === "QB" && c.key !== "snap") return `<td class="muted">—</td>`;
        if (c.trend) { const s = pts(p.ppg, f); const cls = v >= s * 1.2 && v - s >= 2 ? "trend-up" : v <= s * 0.8 && s - v >= 2 ? "trend-down" : ""; return `<td class="${cls}">${c.fmt(v)}</td>`; }
        return `<td>${c.fmt(v)}</td>`;
      }).join("")}
      <td>${d ? `${rankChip(d.rank[f], `${p.opp} rank vs ${p.pos}`)} <span class="team-tag">${p.away ? "@" : ""}${esc(p.opp)}</span>` : `<span class="badge">BYE</span>`}</td>
    </tr>`;
  }).join("");
  $("#page").innerHTML = `
    ${pageHead(`${D.season} season · through Week ${D.statsThrough}`, "Players", "Usage tells you who's getting the ball. Snap share, target share, air yards, WOPR and red-zone chances for every fantasy-relevant player.")}
    <div class="controls">
      <div class="seg" role="group" aria-label="Position">${["ALL", ...POS].map(p => `<button type="button" data-action="plpos" data-v="${p}" aria-pressed="${p === pl.pos}">${p === "ALL" ? "All" : p}</button>`).join("")}</div>
      <select id="plTeam" aria-label="Team"><option value="">All teams</option>${teams.map(t => `<option value="${t}"${t === pl.team ? " selected" : ""}>${esc(D.teams[t].name)}</option>`).join("")}</select>
      <input id="plSearch" type="search" placeholder="Find a player" aria-label="Find a player" value="${esc(pl.q)}">
    </div>
    <div class="table-box"><table>
      <thead><tr><th class="sticky l" scope="col">${sortBtn("name", "Player", pl.sort)}</th>${cols.map(c => `<th scope="col">${sortBtn(c.key, c.label, pl.sort)}</th>`).join("")}<th scope="col">${sortBtn("next", `Wk ${D.week}`, pl.sort)}</th></tr></thead>
      <tbody>${body || `<tr><td colspan="${cols.length + 2}" class="empty">No players match those filters.</td></tr>`}</tbody>
    </table></div>
    <div class="more">${list.length ? `Showing ${shown.length} of ${list.length} players` : ""}${list.length > shown.length ? ` <button type="button" class="btn small" data-action="plmore">Show ${Math.min(50, list.length - shown.length)} more</button><button type="button" class="btn small" data-action="plall">Show all</button>` : ""}</div>
    ${methodLink("usage stats")}`;
}

// ------------------------------------------------------------------ SCHEDULE (strength of schedule)
function renderSchedule() {
  if (offseason()) {
    $("#page").innerHTML = `${pageHead(`${D.season} season · final`, "Strength of Schedule", "Who each team's players face the rest of the way, by position.")}
      ${offseasonNotice("Strength of schedule")}
      <p class="muted">Want to know which defenses were soft this year? See the <a href="#qb">${D.season} defense rankings</a>.</p>`;
    return;
  }
  const pos = state.sos.pos, f = state.fmt;
  const weeks = [];
  for (let w = D.week; w <= 18; w++) weeks.push(w);
  const rows = Object.entries(D.teams).map(([abbr, t]) => {
    const byWeek = new Map(t.sched.map(([w, o, a]) => [w, { opp: o, away: a, rank: D.defenses[pos][o].rank[f] }]));
    const games = weeks.map(w => byWeek.get(w)).filter(Boolean);
    const avg = arr => arr.length ? arr.reduce((s, g) => s + g.rank, 0) / arr.length : null;
    const next4 = avg(t.sched.slice(0, 4).map(([w]) => byWeek.get(w)));
    const ros = avg(games);
    const po = avg(weeks.filter(w => PLAYOFF_WEEKS.has(w)).map(w => byWeek.get(w)).filter(Boolean));
    return { abbr, t, byWeek, next4, ros, po };
  });
  const s = state.sos.sort;
  const g = { team: r => r.abbr, next4: r => r.next4, ros: r => r.ros, po: r => r.po }[s.key] || (r => r.next4);
  rows.sort((a, b) => cmp(g(a), g(b), s.dir));
  const avgCell = v => v == null ? `<td>—</td>` : `<td class="scale" style="background:${rankColor(v)}"><b>${f1(v)}</b></td>`;
  const hasPO = weeks.some(w => PLAYOFF_WEEKS.has(w));
  $("#page").innerHTML = `
    ${pageHead(`Weeks ${D.week}–18 · ${esc(fmtLabel())}`, "Strength of Schedule", `Who each team's ${POS_NAME[pos]} face the rest of the way. Each cell is the opponent's rank in ${esc(fmtLabel())} points allowed to ${POS_NAME[pos]}: green is a soft matchup, red is a tough one.`)}
    <div class="controls"><div class="seg seg-lg" role="group" aria-label="Position">${POS.map(p => `<button type="button" data-action="sospos" data-v="${p}" aria-pressed="${p === pos}">${p}</button>`).join("")}</div></div>
    <div class="legend"><span>Tough</span><span class="bar" aria-hidden="true"></span><span>Soft</span><span>Averages are opponent rank, 1 to 32. Higher is easier.</span></div>
    <div class="table-box"><table class="sos">
      <thead><tr><th class="sticky l" scope="col">${sortBtn("team", "Team", s)}</th><th scope="col">${sortBtn("next4", "Next 4", s)}</th><th scope="col">${sortBtn("ros", "Rest of season", s)}</th>${hasPO ? `<th scope="col">${sortBtn("po", "Wk 15–17", s)}</th>` : ""}
        ${weeks.map(w => `<th scope="col" class="${PLAYOFF_WEEKS.has(w) ? "po" : ""}">Wk ${w}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r => `<tr><td class="sticky l"><span class="team-cell">${teamLogo(r.abbr)}<span><b>${esc(r.abbr)}</b> <span class="team-tag">${esc(r.t.name.split(" ").slice(-1)[0])}</span></span></span></td>
        ${avgCell(r.next4)}${avgCell(r.ros)}${hasPO ? avgCell(r.po) : ""}
        ${weeks.map(w => { const gm = r.byWeek.get(w); return gm ? `<td class="wk scale" style="background:${rankColor(gm.rank)}" title="${esc(D.teams[gm.opp].name)}: ${gm.rank} vs ${pos}"><span class="wk-cell">${teamLogo(gm.opp, "xs")}<span>${gm.away ? "@" : ""}${esc(gm.opp)}</span></span></td>` : `<td class="wk bye">BYE</td>`; }).join("")}</tr>`).join("")}</tbody>
    </table></div>
    ${methodLink("schedule ranks")}`;
}

// ------------------------------------------------------------------ TEAMS
function renderTeams() {
  const s = state.tm.sort;
  const rows = Object.entries(D.teams).map(([abbr, t]) => ({ abbr, ...t }));
  const g = k => r => k === "team" ? r.abbr : r[k];
  rows.sort((a, b) => cmp(g(s.key)(a), g(s.key)(b), s.dir));
  const cols = [
    { key: "implied", label: "Proj pts", fmt: f1, scale: true },
    { key: "spread", label: "Spread", fmt: v => v == null ? "—" : v > 0 ? "+" + v : v === 0 ? "PK" : String(v) },
    { key: "total", label: "O/U", fmt: v => v ?? "—" },
    { key: "ppg", label: "Pts/G", fmt: f1, scale: true },
    { key: "papg", label: "Allowed/G", fmt: f1, scale: true, invert: true },
    { key: "plays", label: "Plays/G", fmt: f1, scale: true },
    { key: "passRate", label: "Pass rate", fmt: pct, scale: true },
    { key: "neutralPass", label: "Neutral pass", fmt: pct, scale: true },
    { key: "proe", label: "PROE", fmt: v => v == null ? "—" : (v > 0 ? "+" : "") + f1(v) + "%", scale: true },
    { key: "rzPlays", label: "RZ plays/G", fmt: f1, scale: true },
  ];
  const st = {}; cols.filter(c => c.scale).forEach(c => { st[c.key] = stops(rows.map(r => r[c.key])); });
  const cell = (c, v) => {
    if (!c.scale || v == null) return `<td>${c.fmt(v)}</td>`;
    const [lo, mid, hi] = st[c.key];
    const col = c.invert ? scaleColor(hi + lo - v, lo, hi + lo - mid, hi, YELLOW) : scaleColor(v, lo, mid, hi, YELLOW);
    return `<td class="scale" style="background:${col}">${c.fmt(v)}</td>`;
  };
  $("#page").innerHTML = `
    ${pageHead(`Week ${D.week}`, "Team Tendencies", "Fantasy points follow volume. These are the offenses that run the most plays, throw the most, and are projected to score the most this week.")}
    <div class="table-box"><table>
      <thead><tr><th class="sticky l" scope="col">${sortBtn("team", "Team", s)}</th><th scope="col">Wk ${D.week}</th>${cols.map(c => `<th scope="col">${sortBtn(c.key, c.label, s)}</th>`).join("")}</tr></thead>
      <tbody>${rows.map(r => `<tr><td class="sticky l"><span class="team-cell">${teamLogo(r.abbr)}<span><b>${teamUrl(r.abbr) ? `<a href="${teamUrl(r.abbr)}">${esc(r.abbr)}</a>` : esc(r.abbr)}</b> <span class="team-tag">${esc(r.name)}</span></span></span></td>
        <td>${r.opp ? `<span class="opp-cell">${teamLogo(r.opp, "sm")}<span>${r.away ? "@" : "vs "}${esc(r.opp)}<span class="kick">${esc(kickLabel(r.kick))}</span></span></span>` : `<span class="badge">BYE</span>`}</td>
        ${cols.map(c => cell(c, r[c.key])).join("")}</tr>`).join("")}</tbody>
    </table></div>
    ${methodLink("team stats")}`;
}

// ------------------------------------------------------------------ PLAYER DRAWER
function openPlayer(id) {
  const p = byId.get(id); if (!p) return;
  const dlg = $("#playerDialog");
  dlg.dataset.player = id;
  fillPlayer(p);
  if (!dlg.open) { try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); } }
  dlg.scrollTop = 0;
  const c = dlg.querySelector(".pd-close"); if (c) c.focus();
}
function closePlayer() { const dlg = $("#playerDialog"); if (dlg.open) dlg.close(); delete dlg.dataset.player; }

function fillPlayer(p) {
  if (!p) return;
  const f = state.fmt, d = defFor(p), t = teamOf(p), pr = project(p);
  const keys = D.logKeys, idx = Object.fromEntries(keys.map((k, i) => [k, i]));
  const log = p.log;
  const ptsOf = g => f === "ppr" ? g[idx.pts] : f === "std" ? g[idx.ptsStd] : (g[idx.pts] + g[idx.ptsStd]) / 2;
  const onRoster = roster().ids.includes(p.id) && !roster().example;
  const tile = (k, v, s) => `<div class="tile"><span class="k">${k}</span><span class="v">${v}</span>${s ? `<span class="s">${s}</span>` : ""}</div>`;
  const u = (key, fmt) => tile(
    { snap: "Snap share", tgtShare: "Target share", airShare: "Air yards share", wopr: "WOPR", rushShare: "Rush share", rz: "Red-zone opp/G", gl: "Goal-line car/G", deep: "Deep targets/G" }[key],
    key === "rz" ? f1(p.season.rzTgt + p.season.rzCar) : key === "gl" ? f1(p.season.glCar) : key === "deep" ? f1(p.season.deepTgt) : fmt(p.season[key]),
    `last 3: ${key === "rz" ? f1(p.recent.rzTgt + p.recent.rzCar) : key === "gl" ? f1(p.recent.glCar) : key === "deep" ? f1(p.recent.deepTgt) : fmt(p.recent[key])}`);
  const usageKeys = p.pos === "QB" ? [["snap", pct], ["rushShare", pct], ["rz"]] :
    p.pos === "RB" ? [["snap", pct], ["rushShare", pct], ["tgtShare", pct], ["rz"], ["gl"], ["wopr", f2]] :
    [["snap", pct], ["tgtShare", pct], ["airShare", pct], ["wopr", f2], ["rz"], ["deep"]];

  // Chart: fantasy points (bars) and snap share (line) by week.
  const W = 520, H = 190, L = 34, R = 34, T = 12, B = 26;
  const weeks = log.map(g => g[idx.wk]);
  const maxPts = Math.max(10, ...log.map(ptsOf));
  const yMax = Math.ceil(maxPts / 10) * 10;
  const n = Math.max(1, log.length), slot = (W - L - R) / n, bw = Math.min(30, slot * 0.6);
  const x = i => L + slot * i + slot / 2, y = v => T + (H - T - B) * (1 - v / yMax), ys = v => T + (H - T - B) * (1 - v);
  const ticks = [0, yMax / 2, yMax];
  const snapPts = log.map((g, i) => g[idx.snap] != null ? [x(i), ys(g[idx.snap])] : null).filter(Boolean);
  const svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Fantasy points and snap share by week">
    ${ticks.map(v => `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ax" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`).join("")}
    ${[0, .5, 1].map(v => `<text class="ax" x="${W - R + 6}" y="${ys(v) + 4}">${v * 100}%</text>`).join("")}
    ${log.map((g, i) => { const v = ptsOf(g); return `<rect class="barp" x="${x(i) - bw / 2}" y="${y(v)}" width="${bw}" height="${Math.max(0, y(0) - y(v))}" rx="3"><title>Week ${g[idx.wk]}: ${f1(v)} pts</title></rect>`; }).join("")}
    ${snapPts.length > 1 ? `<polyline class="snapline" points="${snapPts.map(q => q.join(",")).join(" ")}"/>` : ""}
    ${snapPts.map(q => `<circle class="snapdot" cx="${q[0]}" cy="${q[1]}" r="3.5"/>`).join("")}
    ${weeks.map((w, i) => `<text class="ax" x="${x(i)}" y="${H - 8}" text-anchor="middle">${w}</text>`).join("")}
  </svg>`;

  const logHead = p.pos === "QB"
    ? ["Wk", "Opp", "Snap", "Att", "Pass Yd", "TD", "INT", "Car", "Rush Yd", "Pts"]
    : ["Wk", "Opp", "Snap", "Tgt", "Rec", "Rec Yd", "Car", "Rush Yd", "TD", "RZ", "Pts"];
  const logRows = log.slice().reverse().map(g => p.pos === "QB"
    ? [g[idx.wk], g[idx.opp], pct(g[idx.snap]), g[idx.att], g[idx.pyd], g[idx.ptd], g[idx.int], g[idx.car], g[idx.ryd], f1(ptsOf(g))]
    : [g[idx.wk], g[idx.opp], pct(g[idx.snap]), g[idx.tgt], g[idx.rec], g[idx.recyd], g[idx.car], g[idx.ryd], g[idx.td], g[idx.rz], f1(ptsOf(g))]);

  $("#pdBody").innerHTML = `
    <div class="pd-head">
      <span class="avatar">${esc(initials(p.name))}${p.img ? `<img src="${esc(p.img)}" alt="" referrerpolicy="no-referrer">` : ""}</span>
      <div><h2 id="pdName">${esc(p.name)}</h2><div class="muted" style="font-weight:600">${p.pos} · ${esc((D.teams[p.team] || {}).name || p.team)}${p.depth ? ` · ${p.pos}${p.depth} on depth chart` : ""} ${injBadge(p)}</div></div>
      <button type="button" class="pd-close" data-action="close" aria-label="Close">×</button>
    </div>
    <div class="section">
      <h3>Week ${D.week}</h3>
      <div class="pd-week">
        ${tile("Opponent", p.bye ? (offseason() ? "—" : "BYE") : `${p.away ? "@" : ""}${esc(p.opp)}`, p.bye ? "" : esc(kickLabel(p.kick, true)))}
        ${tile("Matchup", d ? `${d.rank[f]}<span style="font-size:14px"> /32</span>` : "—", d ? `${f1(d.fppg[f])} pts allowed/g` : offseason() ? "Season over" : "")}
        ${tile("Team proj", t.implied != null && !p.bye ? f1(t.implied) : "—", t.total != null && !p.bye ? `O/U ${t.total}` : "")}
        ${tile("Projection", unavailable(p) ? "—" : f1(pr.proj), `${esc(fmtLabel())} pts`)}
      </div>
    </div>
    <div class="section">
      <h3>Usage</h3>
      <div class="usage-grid">${usageKeys.map(([k, fm]) => u(k, fm)).join("")}</div>
    </div>
    <div class="section chart">
      <div class="section-head"><h3>Game by game</h3><span class="chart-legend"><span><i style="background:var(--bar)"></i>${esc(fmtLabel())} pts</span><span><i style="background:var(--ink);height:3px;vertical-align:3px"></i>Snap share</span></span></div>
      <div class="panel panel-pad" style="padding:10px">${log.length ? svg : `<p class="empty">No games yet.</p>`}</div>
    </div>
    <div class="table-box"><table class="log">
      <thead><tr>${logHead.map(h => `<th scope="col">${h}</th>`).join("")}</tr></thead>
      <tbody>${logRows.map(r => `<tr>${r.map(c => `<td>${esc(c ?? "—")}</td>`).join("")}</tr>`).join("")}</tbody>
    </table></div>
    <div class="pd-actions">
      <button type="button" class="btn primary" data-action="compare" data-id="${esc(p.id)}">Compare in Start / Sit</button>
      <button type="button" class="btn" data-action="roster" data-id="${esc(p.id)}">${onRoster ? "Remove from My Team" : "Add to My Team"}</button>
      <button type="button" class="btn" data-action="watch" data-id="${esc(p.id)}">${account.watch.has(p.id) ? "★ Watching" : "☆ Watch"}</button>
      ${playerUrl(p) ? `<a class="btn" href="${playerUrl(p)}">Full player page →</a>` : ""}
    </div>
    <p class="muted" style="margin:0;font-size:12px">Season: ${f1(pts(p.ppg, f))} ${esc(fmtLabel())} pts/g over ${p.g} games, ${f1(pts(p.l3, f))} over the last ${Math.min(RECENT, p.g)}.</p>`;
}

// ================================================================== PLAYER MODEL
// Shared per-format numbers: floor/ceiling, boom/bust, TD share, positional rank.
const STARTERS = { QB: 12, RB: 24, WR: 24, TE: 12 };
const FANTASY_END = 17;               // last week of a typical fantasy season
function percentile(arr, q) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo] + (s[hi] - s[lo]) * (i - lo);
}
const modelCache = new Map();
function playerModel(f = state.fmt) {
  if (modelCache.has(f)) return modelCache.get(f);
  const idx = Object.fromEntries(D.logKeys.map((k, i) => [k, i]));
  const gamePts = g => f === "ppr" ? g[idx.pts] : f === "std" ? g[idx.ptsStd] : (g[idx.pts] + g[idx.ptsStd]) / 2;
  // Boom = 80th percentile of weekly scores by starter-level players at the position; bust = 25th.
  const lines = {};
  for (const pos of POS) {
    const starters = D.players.filter(p => p.pos === pos).sort((a, b) => pts(b.ppg, f) - pts(a.ppg, f)).slice(0, STARTERS[pos]);
    const all = starters.flatMap(p => p.log.map(gamePts));
    lines[pos] = { boom: percentile(all, 0.8), bust: percentile(all, 0.25) };
  }
  const rows = D.players.map(p => {
    const weekly = p.log.map(gamePts), n = weekly.length || 1, L = lines[p.pos];
    const tdPts = p.log.reduce((s, g) => s + g[idx.td] * 6 + g[idx.ptd] * 4, 0);
    const tot = weekly.reduce((a, b) => a + b, 0);
    return {
      p, weekly, season: pts(p.ppg, f), recent: pts(p.l3, f),
      boom: weekly.filter(v => v >= L.boom).length / n, bust: weekly.filter(v => v <= L.bust).length / n,
      tdShare: tot > 0 ? tdPts / tot : 0,
      oppShare: p.pos === "RB" ? p.season.rushShare : p.pos === "QB" ? null : p.season.tgtShare,
      oppShareL3: p.pos === "RB" ? p.recent.rushShare : p.pos === "QB" ? null : p.recent.tgtShare,
    };
  });
  for (const pos of POS) {
    rows.filter(r => r.p.pos === pos).sort((a, b) => b.season - a.season).forEach((r, i) => { r.posRank = i + 1; });
  }
  const out = { rows, byId: new Map(rows.map(r => [r.p.id, r])), lines };
  modelCache.set(f, out);
  return out;
}

// ================================================================== TRADE ANALYZER
// Rest-of-season value: the player's scoring rate (60% season, 40% last 3) for each remaining game
// through Week 17, each game adjusted for that opponent (effect halved, capped at ±20%), minus games
// he's expected to miss. A side's trade value weights its best player fully and extra pieces less,
// because one great player is worth more than two decent ones who need lineup spots.
const DEPTH_WEIGHTS = [1, 0.75, 0.6, 0.5, 0.4, 0.35];
// Replacement level (best player left on waivers) comes from replRank(), which follows the user's league settings.
const replCache = new Map();
function replacementPpg(pos, f) {
  const key = pos + f + JSON.stringify(leagueSettings());
  if (!replCache.has(key)) {
    const list = D.players.filter(p => p.pos === pos && p.g >= 4).map(p => pts(p.ppg, f)).sort((a, b) => b - a);
    replCache.set(key, list[Math.min(list.length - 1, replRank(pos) - 1)] || 0);
  }
  return replCache.get(key);
}

function rosValue(p, f = state.fmt) {
  const m = playerModel(f).byId.get(p.id);
  const base = p.g >= 3 ? 0.6 * m.season + 0.4 * m.recent : m.season;
  const t = D.teams[p.team] || { sched: [] };
  const avg = D.leagueAvg[p.pos][f];
  // Off-season: value a full 17-game season at his scoring rate (useful for keeper and dynasty trades).
  const games = offseason() ? Array.from({ length: 17 }, (_, i) => ({ w: i + 1, o: null, a: 0, rank: null, factor: 1 })) : t.sched.filter(([w]) => w <= FANTASY_END).map(([w, o, a]) => {
    const d = D.defenses[p.pos][o];
    const factor = Math.min(1.2, Math.max(0.8, 1 + 0.5 * (d.fppg[f] / avg - 1)));
    return { w, o, a, rank: d.rank[f], factor };
  });
  // Availability: out this week = lose this game; doubtful = half; a player who has missed 2+ straight
  // games (often a longer injury) loses another week.
  let avail = games.map(() => 1);
  if (games[0] && games[0].w === D.week) {
    if (injOut(p) || inactive(p)) avail[0] = 0;
    else if (p.inj && /doubtful/i.test(p.inj.status)) avail[0] = 0.5;
  }
  if ((p.missed || 0) >= 2) { const i = avail.findIndex(v => v > 0); if (i >= 0) avail[i] = 0; }
  const perGame = games.map((g, i) => base * g.factor * avail[i]);
  const total = perGame.reduce((a, b) => a + b, 0);
  // Trade value: points above a waiver-level replacement, plus a little for depth.
  const repl = replacementPpg(p.pos, f);
  const vorp = games.reduce((s, g, i) => s + (base * g.factor - repl) * avail[i], 0);
  const trade = Math.max(0, vorp) + 0.15 * total;
  const playoff = games.reduce((s, g, i) => s + (PLAYOFF_WEEKS.has(g.w) ? perGame[i] : 0), 0);
  const po = games.filter(g => PLAYOFF_WEEKS.has(g.w));
  const avgRank = arr => arr.length && arr.every(g => g.rank != null) ? arr.reduce((s, g) => s + g.rank, 0) / arr.length : null;
  const played = avail.filter(v => v > 0).length;
  return {
    base, total, playoff, games, played, repl, vorp, trade,
    perGame: played ? total / avail.reduce((a, b) => a + b, 0) : 0,
    next4: avgRank(games.slice(0, 4)), ros: avgRank(games), poRank: avgRank(po), poGames: po.length,
  };
}

// Form over the last 3 games.
function formOf(m) {
  if (m.p.g < 4) return { k: "new", label: "Small sample", cls: "mid" };
  const d = m.recent - m.season;
  if (m.recent >= m.season * 1.2 && d >= 3) return { k: "hot", label: "Hot", cls: "hot" };
  if (m.recent <= m.season * 0.8 && -d >= 3) return { k: "cold", label: "Cold", cls: "cold" };
  return { k: "steady", label: "Steady", cls: "mid" };
}
// Market timing: is his trade value inflated (sell high) or depressed (buy low) right now?
function timingOf(m, v) {
  const form = formOf(m), why = [];
  const shareUp = m.oppShare != null && m.oppShareL3 != null && m.oppShareL3 - m.oppShare >= 0.04;
  const shareDown = m.oppShare != null && m.oppShareL3 != null && m.oppShare - m.oppShareL3 >= 0.04;
  let sell = 0, buy = 0;
  if (form.k === "hot") { sell += 1; why.push(`scoring ${f1(m.recent)} over his last 3 vs ${f1(m.season)} on the season`); }
  if (form.k === "cold") { buy += 1; why.push(`scoring just ${f1(m.recent)} over his last 3 vs ${f1(m.season)} on the season`); }
  if (m.tdShare >= 0.38 && m.season >= 8) { sell += 1; why.push(`${pct(m.tdShare)} of his points come from touchdowns, which tend to even out`); }
  if (shareDown) { sell += 1; why.push(`his ${m.p.pos === "RB" ? "rush" : "target"} share is slipping (${pct(m.oppShare)} → ${pct(m.oppShareL3)})`); }
  if (shareUp) { buy += 1; why.push(`his ${m.p.pos === "RB" ? "rush" : "target"} share is climbing (${pct(m.oppShare)} → ${pct(m.oppShareL3)})`); }
  if (v.next4 != null && v.next4 <= 11) { sell += 1; why.push(`a tough stretch is coming (next 4 opponents average rank ${f1(v.next4)})`); }
  if (v.next4 != null && v.next4 >= 22) { buy += 1; why.push(`a soft stretch is coming (next 4 opponents average rank ${f1(v.next4)})`); }
  if (form.k === "cold" && !shareDown && (m.oppShareL3 ?? 1) > 0) { buy += 0.5; }
  const k = sell - buy >= 1 ? "sell" : buy - sell >= 1 ? "buy" : "hold";
  return { k, why };
}
function timingLabel(k, side) {
  // Read from the user's point of view: trading him away (give) or acquiring him (get).
  if (side === "give") return k === "sell" ? ["Good time to sell", "good"] : k === "buy" ? ["Selling low", "bad"] : ["Fair time to deal", "mid"];
  return k === "buy" ? ["Good time to buy", "good"] : k === "sell" ? ["Buying at his peak", "bad"] : ["Fair price", "mid"];
}

function tradeState() {
  const saved = store.get("tsm-trade", null);
  const clean = ids => (ids || []).filter(id => byId.has(id));
  if (saved) return { give: clean(saved.give), get: clean(saved.get), example: false };
  // Example: a hot pass catcher for a cold running back of similar value.
  const m = playerModel();
  const pool = m.rows.filter(r => r.p.g >= 5 && !unavailable(r.p) && playedRecently(r.p) && r.season >= 11 && r.season <= 19);
  const hots = pool.filter(r => r.p.pos !== "QB" && formOf(r).k === "hot");
  const colds = pool.filter(r => r.p.pos !== "QB" && formOf(r).k === "cold");
  let best = null;
  for (const h of hots) for (const c of colds) {
    const gap = Math.abs(rosValue(h.p).trade - rosValue(c.p).trade) / Math.max(1, rosValue(h.p).trade);
    if (!best || gap < best.gap) best = { h, c, gap };
  }
  if (best) return { give: [best.h.p.id], get: [best.c.p.id], example: true };
  const top = pool.slice(0, 2);
  return { give: top[0] ? [top[0].p.id] : [], get: top[1] ? [top[1].p.id] : [], example: true };
}
function tradeAdd(side, p) {
  const t = tradeState();
  const next = t.example ? { give: [], get: [] } : { give: t.give, get: t.get };
  next.give = next.give.filter(id => id !== p.id); next.get = next.get.filter(id => id !== p.id);
  next[side].push(p.id);
  store.set("tsm-trade", next);
  render();
  const el = document.getElementById(side === "give" ? "tradeGive" : "tradeGet");
  if (el) { el.value = ""; el.focus(); }
}
function tradeRemove(side, id) {
  const t = tradeState();
  store.set("tsm-trade", { give: t.give.filter(x => side !== "give" || x !== id), get: t.get.filter(x => side !== "get" || x !== id) });
  render();
}
function sideValue(players) {
  const vs = players.map(p => rosValue(p));
  const vals = vs.map(v => v.trade).sort((a, b) => b - a);
  return { raw: vs.reduce((a, v) => a + v.total, 0), weighted: vals.reduce((s, v, i) => s + v * (DEPTH_WEIGHTS[i] ?? 0.3), 0) };
}

function renderTrade() {
  const t = tradeState(), f = state.fmt, m = playerModel(f);
  const give = t.give.map(id => byId.get(id)), get = t.get.map(id => byId.get(id));
  const all = [...give.map(p => ({ p, side: "give" })), ...get.map(p => ({ p, side: "get" }))];
  const info = new Map(all.map(({ p }) => { const v = rosValue(p, f), mm = m.byId.get(p.id); return [p.id, { v, m: mm, form: formOf(mm), timing: timingOf(mm, v) }]; }));
  const rosterIds = roster().example ? [] : roster().ids;
  const weeksLeft = offseason() ? 17 : Math.max(0, FANTASY_END - D.week + 1);

  const sideList = (side, list) => `
    <div class="panel trade-side ${side}">
      <div class="trade-side-head"><h2>${side === "give" ? "You give" : "You get"}</h2><span class="muted">${list.length} player${list.length === 1 ? "" : "s"}</span></div>
      <div class="trade-list">${list.map(p => { const i = info.get(p.id); return `<div class="trade-row">
        ${avatar(p)}<div class="meta">${plink(p)} ${injBadge(p)}<small class="pline">${p.pos} · ${teamLogo(p.team, "sm")}${esc(p.team)}</small></div>
        <div class="trade-row-val"><b>${f1(i.v.trade)}</b><small>value · ${f1(i.v.total)} pts</small></div>
        <button type="button" class="x" data-action="trm" data-side="${side}" data-id="${esc(p.id)}" aria-label="Remove ${esc(p.name)}">×</button></div>`; }).join("") || `<p class="empty" style="padding:18px">Add the players you'd ${side === "give" ? "send away" : "receive"}.</p>`}</div>
      <div class="field"><label for="${side === "give" ? "tradeGive" : "tradeGet"}">Add a player</label>
        <input id="${side === "give" ? "tradeGive" : "tradeGet"}" type="search" list="playerList" placeholder="Type a name and pick from the list" autocomplete="off"></div>
      ${side === "give" && rosterIds.length ? `<div class="roster-chips"><span class="muted">From My Team:</span>${rosterIds.map(id => byId.get(id)).filter(p => p && !t.give.includes(p.id)).slice(0, 14).map(p => `<button type="button" class="chip" data-action="tadd" data-side="give" data-id="${esc(p.id)}">${esc(lastName(p.name))} <small>${p.pos}</small></button>`).join("")}</div>` : ""}
    </div>`;

  // Verdict.
  let verdictHtml = "";
  if (give.length && get.length) {
    const G = sideValue(give), R = sideValue(get);
    const diff = R.weighted - G.weighted, big = Math.max(G.weighted, R.weighted) || 1, pctDiff = diff / big;
    const [call, cls] = pctDiff >= 0.15 ? ["You win this trade", "win"] : pctDiff >= 0.05 ? ["Slight edge to you", "win"] :
      pctDiff > -0.05 ? ["Fair trade", "even"] : pctDiff > -0.15 ? ["Slight edge to them", "lose"] : ["You lose this trade", "lose"];
    const giveShare = G.weighted / ((G.weighted + R.weighted) || 1) * 100;
    const poG = give.reduce((s, p) => s + info.get(p.id).v.playoff, 0), poR = get.reduce((s, p) => s + info.get(p.id).v.playoff, 0);
    const reasons = [];
    reasons.push(offseason()
      ? `Over a full 17-game season at their ${D.season} scoring rates, you get ${f1(R.raw)} projected points and give up ${f1(G.raw)}.`
      : `Rest of season (Weeks ${D.week}–${FANTASY_END}), you get ${f1(R.raw)} projected points and give up ${f1(G.raw)}.`);
    const best = all.map(x => ({ ...x, v: info.get(x.p.id).v })).sort((a, b) => b.v.perGame - a.v.perGame)[0];
    if (best) reasons.push(`The best player in the deal is ${best.p.name} (${f1(best.v.perGame)} projected pts/game), and ${best.side === "get" ? "you'd get him" : "you'd be giving him up"}.`);
    if (give.length !== get.length) {
      const more = give.length > get.length ? "give" : "get";
      reasons.push(more === "give"
        ? `You're consolidating ${give.length}-for-${get.length}. That opens ${give.length - get.length} roster spot${give.length - get.length > 1 ? "s" : ""}, and extra pieces count for less here since only so many can start.`
        : `You're taking on ${get.length - give.length} extra player${get.length - give.length > 1 ? "s" : ""}. Depth helps with byes and injuries, but make sure you have the roster spots.`);
    }
    if (weeksLeft >= 3 && Math.abs(poR - poG) >= 3) reasons.push(`Fantasy playoffs (Weeks 15–17): ${poR > poG ? "you come out ahead" : "you come out behind"}, ${f1(poR)} vs ${f1(poG)} projected points.`);
    for (const { p, side } of all) {
      const i = info.get(p.id), [lab] = timingLabel(i.timing.k, side);
      if (i.timing.k !== "hold" && i.timing.why.length) reasons.push(`${p.name}: ${lab.toLowerCase()}, ${i.timing.why[0]}.`);
      if (p.inj || (p.missed || 0) >= 2) reasons.push(`${p.name} ${p.inj ? `is ${p.inj.status.toLowerCase()}${p.inj.injury ? ` (${p.inj.injury.toLowerCase()})` : ""}` : `has missed his team's last ${p.missed} games`}, which lowers his value.`);
    }
    // Balance suggestions: players who'd roughly even the weighted values if added to the short side.
    let balance = "";
    if (Math.abs(pctDiff) >= 0.05) {
      const shortSide = diff < 0 ? "get" : "give";           // side that needs more value
      const n = (shortSide === "get" ? get : give).length;
      const w = DEPTH_WEIGHTS[n] ?? 0.3, need = Math.abs(diff) / w;
      const inTrade = new Set([...t.give, ...t.get]);
      const cands = D.players.filter(p => !inTrade.has(p.id) && !unavailable(p) && playedRecently(p) && p.g >= 3)
        .map(p => ({ p, v: rosValue(p, f).trade })).filter(x => x.v >= need * 0.7 && x.v <= need * 1.3)
        .sort((a, b) => Math.abs(a.v - need) - Math.abs(b.v - need)).slice(0, 5);
      if (cands.length) balance = `<div class="balance"><span class="muted">${shortSide === "get" ? "To even it out, ask them to add one of:" : "To make it fair for them, you could add one of:"}</span>
        ${cands.map(c => `<button type="button" class="chip" data-action="tadd" data-side="${shortSide}" data-id="${esc(c.p.id)}" title="Add to ${shortSide === "get" ? "You get" : "You give"}">${esc(c.p.name)} <small>${c.p.pos} · value ${f1(c.v)}</small></button>`).join("")}</div>`;
    }
    verdictHtml = `<section class="panel trade-verdict ${cls}">
      <div class="tv-top"><div><div class="eyebrow">Verdict · ${esc(fmtLabel())}</div><p class="tv-call">${call}</p>
        <p class="tv-sub">Trade value ${f1(R.weighted)} for you vs ${f1(G.weighted)} for them (${pctDiff >= 0 ? "+" : "−"}${Math.abs(pctDiff * 100).toFixed(0)}%)</p></div>
        <div class="tv-actions"><button type="button" class="btn small primary" data-action="tradeSave">${signedIn() ? "Save trade" : "Log in to save"}</button><button type="button" class="btn small" data-action="tswap">Swap sides</button><button type="button" class="btn small" data-action="tclear">Clear</button></div></div>
      <div class="meter" role="img" aria-label="Trade value: you give ${f1(G.weighted)}, you get ${f1(R.weighted)}">
        <span class="meter-give" style="width:${giveShare}%"><b>You give ${f1(G.weighted)}</b></span><span class="meter-get"><b>You get ${f1(R.weighted)}</b></span>
        <i class="meter-mid"></i></div>
      <ul class="tv-reasons">${reasons.map(r => `<li>${esc(r)}</li>`).join("")}</ul>
      ${balance}
    </section>`;
  } else {
    verdictHtml = `<section class="panel trade-verdict none"><p class="tv-call">Add players to both sides</p><p class="tv-sub">Put who you'd send away under You give and who you'd receive under You get. Any positions, any number of players.</p></section>`;
  }

  // Player cards.
  const card = ({ p, side }) => {
    const { v, m: mm, form, timing } = info.get(p.id);
    const [tl, tcls] = timingLabel(timing.k, side);
    const bars = mm.weekly.slice(-8), bmax = Math.max(10, ...bars), L = m.lines[p.pos];
    const spark = `<svg viewBox="0 0 160 44" class="spark" aria-label="Last ${bars.length} games">${bars.map((x, i) =>
      `<rect x="${i * 20 + 2}" y="${42 - x / bmax * 38}" width="14" height="${Math.max(1, x / bmax * 38)}" rx="2" fill="${x >= L.boom ? "#57bb8a" : x <= L.bust ? "#e67c73" : "var(--bar)"}"><title>${f1(x)} pts</title></rect>`).join("")}</svg>`;
    const use = (label, s, r, fmt) => s == null && r == null ? "" : `<div class="kv"><span>${label}</span><b>${fmt(s)}</b><span class="${r > s * 1.08 ? "trend-up" : r < s * 0.92 ? "trend-down" : "muted"}">${fmt(r)}</span></div>`;
    const chip = g => `<span class="sched-chip" style="background:${rankColor(g.rank)}" title="Week ${g.w}: ${esc(D.teams[g.o].name)}, rank ${g.rank} vs ${p.pos}s"><small>Wk ${g.w}</small><b>${g.a ? "@" : ""}${esc(g.o)}</b></span>`;
    const next4 = v.games.slice(0, 4), po = v.games.filter(g => PLAYOFF_WEEKS.has(g.w));
    return `<article class="panel tcard ${side}">
      <div class="tcard-side">${side === "give" ? "You give" : "You get"}</div>
      <div class="report-head">
        <span class="avatar big">${esc(initials(p.name))}${p.img ? `<img src="${esc(p.img)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}</span>
        <div><h3 class="tcard-name">${plink(p)}</h3><div class="pline muted">${p.pos}${mm.posRank} · ${teamLogo(p.team, "sm")}${esc((D.teams[p.team] || {}).name || p.team)} ${injBadge(p)}</div></div>
      </div>
      <div class="tcard-tags"><span class="tag ${tcls}">${tl}</span><span class="tag ${form.cls}">${form.label}</span>${(p.missed || 0) >= 2 ? `<span class="tag bad">Missed last ${p.missed}</span>` : ""}</div>
      ${timing.why.length ? `<p class="tcard-why">${esc(timing.why.slice(0, 2).join("; "))}.</p>` : ""}
      <div class="tcard-nums">
        <div><span class="k">ROS proj</span><span class="v">${f1(v.perGame)}</span><small>pts/g · ${v.played} games</small></div>
        <div><span class="k">Trade value</span><span class="v">${f1(v.trade)}</span><small>${f1(v.total)} ROS pts</small></div>
        <div><span class="k">Playoffs</span><span class="v">${f1(v.playoff)}</span><small>Wk 15–17</small></div>
      </div>
      <div class="tcard-form">
        ${spark}
        <div><div class="kv tight"><span>Season</span><b>${f1(mm.season)}</b></div><div class="kv tight"><span>Last 3</span><b class="${form.k === "hot" ? "trend-up" : form.k === "cold" ? "trend-down" : ""}">${f1(mm.recent)}</b></div>
          <div class="kv tight"><span>Boom / bust</span><b>${pct(mm.boom)} / ${pct(mm.bust)}</b></div></div>
      </div>
      <h4>Usage <span class="muted">season → last 3</span></h4>
      <div class="report-use">
        ${use("Snap share", p.season.snap, p.recent.snap, pct)}
        ${p.pos !== "QB" ? use("Target share", p.season.tgtShare, p.recent.tgtShare, pct) : ""}
        ${p.pos === "WR" || p.pos === "TE" ? use("Air yards share", p.season.airShare, p.recent.airShare, pct) : ""}
        ${p.pos === "RB" || p.pos === "QB" ? use("Rush share", p.season.rushShare, p.recent.rushShare, pct) : ""}
        ${use("Red-zone chances/g", p.season.rzTgt + p.season.rzCar, p.recent.rzTgt + p.recent.rzCar, f1)}
        <div class="kv"><span>Points from TDs</span><b>${pct(mm.tdShare)}</b><span class="muted">${mm.tdShare >= 0.38 ? "TD-dependent" : ""}</span></div>
      </div>
      ${offseason() ? `<h4>Schedule</h4><p class="muted" style="margin:0;font-size:13px">Strength of schedule appears once ${esc(nextSeasonText())} is under way. Values above assume a full 17-game season.</p>` : `      <h4>Schedule <span class="muted">opponent rank vs ${p.pos}s, 32 = softest</span></h4>
      <div class="sched-row"><span class="sched-label">Next 4 <b>${v.next4 != null ? f1(v.next4) : "—"}</b></span><div class="report-sched">${next4.map(chip).join("") || `<span class="muted">No games left</span>`}</div></div>
      ${po.length ? `<div class="sched-row"><span class="sched-label">Playoffs <b>${f1(v.poRank)}</b></span><div class="report-sched">${po.map(chip).join("")}</div></div>` : ""}
      <div class="sched-row"><span class="sched-label">Rest of season <b>${v.ros != null ? f1(v.ros) : "—"}</b></span><span class="muted" style="font-size:12px">${v.games.length} games through Week ${FANTASY_END}</span></div>`}
    </article>`;
  };

  // Head-to-head table.
  let h2h = "";
  if (all.length >= 2) {
    const metrics = [
      ["Trade value", x => x.v.trade, f1, 1], ["ROS pts/game", x => x.v.perGame, f1, 1], ["ROS total", x => x.v.total, f1, 1], ["Playoff pts (Wk 15–17)", x => x.v.playoff, f1, 1],
      ["Season pts/game", x => x.m.season, f1, 1], ["Last 3 games", x => x.m.recent, f1, 1],
      ["Position rank", x => x.m.posRank, (v, x) => `${x.p.pos}${v}`, -1],
      ["Next 4 schedule", x => x.v.next4, f1, 1], ["Playoff schedule", x => x.v.poRank, f1, 1], ["Rest-of-season schedule", x => x.v.ros, f1, 1],
      ["Snap share", x => x.p.season.snap, pct, 1], ["Target share", x => x.p.pos === "QB" ? null : x.p.season.tgtShare, pct, 1],
      ["Rush share", x => x.p.pos === "WR" || x.p.pos === "TE" ? null : x.p.season.rushShare, pct, 1],
      ["WOPR", x => x.p.pos === "QB" ? null : x.p.season.wopr, f2, 1],
      ["Red-zone chances/g", x => x.p.season.rzTgt + x.p.season.rzCar, f1, 1],
      ["Boom rate", x => x.m.boom, pct, 1], ["Bust rate", x => x.m.bust, pct, -1], ["Points from TDs", x => x.m.tdShare, pct, -1],
    ];
    const xs = all.map(({ p, side }) => ({ p, side, ...info.get(p.id) }));
    h2h = `<section class="section"><div class="section-head"><h2>Head to head</h2><span class="muted" style="font-size:13px">Green is better on each line</span></div>
      <div class="table-box"><table class="h2h">
        <thead><tr><th class="sticky l" scope="col">Stat</th>${xs.map(x => `<th scope="col" class="${x.side}">${esc(lastName(x.p.name))}<small>${x.side === "give" ? "You give" : "You get"}</small></th>`).join("")}</tr></thead>
        <tbody>
          <tr><th class="sticky l" scope="row">Form</th>${xs.map(x => `<td><span class="tag ${x.form.cls}">${x.form.label}</span></td>`).join("")}</tr>
          <tr><th class="sticky l" scope="row">Trade timing</th>${xs.map(x => { const [l, c] = timingLabel(x.timing.k, x.side); return `<td><span class="tag ${c}">${l}</span></td>`; }).join("")}</tr>
          <tr><th class="sticky l" scope="row">Status</th>${xs.map(x => `<td>${injBadge(x.p) || `<span class="muted">Healthy</span>`}</td>`).join("")}</tr>
          ${metrics.map(([label, get, fmt, dir]) => {
            const vals = xs.map(get), nums = vals.filter(v => v != null && !Number.isNaN(v));
            const lo = Math.min(...nums), hi = Math.max(...nums);
            // Neutral when the values are within 5% (or the stat isn't comparable across positions).
            const close = nums.length < 2 || (hi - lo) <= 0.05 * Math.max(Math.abs(hi), Math.abs(lo), 1e-9);
            const mixedPos = label === "Position rank" && new Set(xs.map(x => x.p.pos)).size > 1;
            return `<tr><th class="sticky l" scope="row">${label}</th>${xs.map((x, i) => {
              const v = vals[i];
              if (v == null || Number.isNaN(v)) return `<td class="muted">—</td>`;
              if (close || mixedPos) return `<td>${fmt(v, x)}</td>`;
              const tt = (v - lo) / (hi - lo), score = dir > 0 ? tt : 1 - tt;
              return `<td class="scale" style="background:${scaleColor(score, 0, 0.5, 1, YELLOW)}">${fmt(v, x)}</td>`;
            }).join("")}</tr>`;
          }).join("")}
        </tbody></table></div></section>`;
  }

  $("#page").innerHTML = `
    ${pageHead(`Week ${D.week} · ${esc(fmtLabel())}`, "Trade Analyzer", "Put in a trade and see who wins it: rest-of-season value, playoff schedule, usage, form and whether now is the time to buy or sell.")}
    ${t.example ? `<div class="panel panel-pad example-bar"><span><strong>Example trade.</strong> <span class="muted">Add your own players to either side to start.</span></span><span style="display:flex;gap:8px"><button type="button" class="btn small" data-action="tkeep">Edit this one</button><button type="button" class="btn small" data-action="tclear">Start empty</button></span></div>` : ""}
    <section class="trade-sides">${sideList("give", give)}<div class="trade-arrow" aria-hidden="true">⇄</div>${sideList("get", get)}</section>
    ${signedIn() && account.trades.length ? `<div class="saved-trades"><span class="muted">Saved trades:</span>${account.trades.slice(0, 8).map(x => `<button type="button" class="chip" data-action="tradeLoad" data-id="${x.id}">${esc(x.name)}</button>`).join("")}${account.trades.length > 8 ? `<a href="#account">All ${account.trades.length} →</a>` : ""}</div>` : ""}
    ${verdictHtml}
    ${all.length ? `<section class="tcards">${all.map(card).join("")}</section>` : ""}
    ${h2h}
    ${methodLink("trade values")}`;
}
// ================================================================== CONTENT PAGES
function articlePage(eyebrow, title, lede, sections, toc) {
  return `<article class="article">
    ${pageHead(eyebrow, title, lede)}
    ${toc ? `<nav class="toc panel" aria-label="On this page"><span class="muted">On this page</span>${sections.map((x, i) => `<button type="button" class="chip" data-action="goto" data-target="sec-${i}">${x[0]}</button>`).join("")}</nav>` : ""}
    ${sections.map((x, i) => `<section class="article-sec" id="sec-${i}"><h2>${x[0]}</h2>${x[1]}</section>`).join("")}
  </article>`;
}
ACTIONS.goto = el => { const t = document.getElementById(el.dataset.target); if (t) t.scrollIntoView({ behavior: "smooth", block: "start" }); };

function renderAbout() {
  $("#page").innerHTML = articlePage("About", "Matchups you can sleep on",
    "The Sports Mattress started as a set of hand-made weekly matchup spreadsheets. Now the charts build themselves, with a few more tools around them.", [
    ["What it is", `<p>Free fantasy football research, built around one idea: who a player faces matters. Every week we rank all 32 defenses by what they give up to quarterbacks, running backs, receivers and tight ends, color them from tough to great, and put them next to the players who face them.</p>
      <p>Around the charts are the tools fantasy managers use most: <a href="#start-sit">Start / Sit</a> comparisons, a <a href="#my-team">lineup builder</a>, a <a href="#trade">Trade Analyzer</a>, <a href="#players">player usage</a> (snap share, target share, red-zone chances), <a href="#schedule">strength of schedule</a> and <a href="#teams">team tendencies</a>.</p>`],
    ["When it updates", `<p>Everything rebuilds automatically <strong>every morning at 5am</strong> Eastern: new matchups once the week's games are final, plus the latest injury reports, depth charts, betting lines and kickoff forecasts.</p>`],
    ["Where the numbers come from", `<p>Stats, schedules, betting lines, depth charts, injury reports, snap counts and play-by-play come from <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener">nflverse</a>, an open-source NFL data project. Kickoff weather comes from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>. See <a href="#how-it-works">How It Works</a> for how each number is calculated.</p>`],
    ["Contact", `<p>Questions, ideas or something look off? Email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`],
    ["Not affiliated", `<p>The Sports Mattress is an independent fan project. It isn't affiliated with or endorsed by the NFL, its teams or any fantasy platform.</p>`],
  ]);
}

function renderHow() {
  const f = fmtLabel();
  $("#page").innerHTML = articlePage("Methodology", "How It Works",
    "What every number on the site means and how it's calculated.", [
    ["Scoring", `<p>4 points per passing TD, 1 point per 25 passing yards, 1 per 10 rushing or receiving yards, 6 per rushing or receiving TD, 2 per two-point conversion, −2 per interception or fumble lost. PPR adds 1 point per catch, Half PPR 0.5. Switch formats with the PPR / Half PPR / Standard control at the top of any page.</p>`],
    ["Matchup charts", `<ul>
      <li><strong>Rank</strong>: each defense's fantasy points allowed per game to the position, 1 (fewest, tough) to 32 (most, great). Charts are sorted with the best matchups first.</li>
      <li><strong>FPPG</strong>: fantasy points allowed per game to the position. <strong>PA Wk</strong>: what the defense gave up last week, and who scored the most.</li>
      <li>The other columns are per-game stats the defense allows to the position. QB passing numbers count every pass thrown against the defense.</li>
      <li><strong>Team Tot</strong>: the team's projected points, from the betting spread and over/under. <strong>Weather</strong>: the kickoff-hour forecast for the stadium; domes and closed roofs show as indoors.</li>
      <li>Players come from the latest depth chart. A second RB or TE is listed when he's scoring at least 60% as much as the starter over the last 3 games.</li></ul>`],
    ["Projections and Start / Sit", `<p>A player's projection is his scoring rate (60% season average, 40% last 3 games) multiplied by a matchup adjustment: how many points this week's opponent allows to his position compared with the league average. The adjustment is halved and capped at ±25%, because ten or so games of defensive results are noisy.</p>
      <p>Start / Sit compares two projections. Under 1 point apart is a toss-up. Players ruled out or on bye can't be started, and a doubtful player loses to a healthy one. <strong>My Team</strong> fills each lineup spot with the highest-projected eligible player: fixed positions first, then flex.</p>`],
    ["Trade Analyzer", `<ul>
      <li><strong>Rest-of-season value</strong>: the scoring rate above for every remaining game through Week ${FANTASY_END}, each adjusted for that opponent (effect halved, capped at ±20%). Games he's ruled out of are removed, and a player who has missed 2+ straight games loses another week.</li>
      <li><strong>Trade value</strong>: projected points above a waiver-level replacement at his position (about QB${replRank("QB")}, RB${replRank("RB")}, WR${replRank("WR")}, TE${replRank("TE")} in a ${leagueSettings().size}-team, ${leagueSettings().sf ? "superflex" : "1-QB"} league; signed-in users can change this in their account settings), plus a little for depth. Each side's best player counts in full; extra players count ${DEPTH_WEIGHTS.slice(1, 4).map(w => Math.round(w * 100) + "%").join(", ")} and so on. Within 5% is a fair trade.</li>
      <li><strong>Trade timing</strong> weighs recent form, touchdown dependence, changes in target or rush share and the next four opponents. "Good time to sell" means his value is probably near its peak; "selling low" means it's likely to recover.</li>
      <li><strong>Playoffs</strong> are Weeks 15–17.</li></ul>`],
    ["Usage stats", `<ul>
      <li><strong>Snap share</strong>: share of the team's offensive snaps.</li>
      <li><strong>Target share</strong>: share of team targets in the games he played. <strong>Air yards share</strong>: share of the team's air yards (how far downfield passes travel).</li>
      <li><strong>WOPR</strong>: 1.5 × target share + 0.7 × air yards share. Above 0.5 is elite for a receiver.</li>
      <li><strong>Rush share</strong>: share of team carries. <strong>Red-zone chances</strong>: targets plus carries inside the opponent's 20. <strong>Goal-line carries</strong>: inside the 5.</li>
      <li><strong>Hot / cold</strong>: last 3 games at least 20% and 3 points above (or below) his season average. <strong>Boom / bust</strong>: weeks above the 80th percentile, or below the 25th, of weekly scores by starter-level players at his position.</li></ul>`],
    ["Strength of schedule", `<p>Each remaining opponent is colored by its rank in ${esc(f)} points allowed to the position (32 = softest). Next 4, rest of season and Weeks 15–17 are averages of those ranks. Ranks use this season's results, so they shift as the season goes on.</p>`],
    ["Team tendencies", `<ul>
      <li><strong>Pass rate</strong>: share of plays that are dropbacks. <strong>Neutral pass rate</strong>: the same on 1st and 2nd down while the game is close (win probability 20–80%, first three quarters).</li>
      <li><strong>PROE</strong>: pass rate over expected for the situation. <strong>RZ plays</strong>: snaps inside the opponent's 20 per game.</li></ul>`],
    ["Data and updates", `<p>Data from <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener">nflverse</a> and <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, rebuilt every morning at 5am Eastern. Current data: ${D.season} season, stats through Week ${D.statsThrough}.</p>`],
  ], true);
}

function renderPrivacy() {
  $("#page").innerHTML = articlePage("Legal", "Privacy", "Accounts are optional. Here's exactly what we keep and why.", [
    ["Without an account", `<p>Everything you enter (your roster, Start / Sit picks, trades and scoring format) is saved only in your browser's local storage. It stays on your device and isn't sent to us. Clearing your browser data removes it.</p>`],
    ["With an account", `<p>If you create an account we store your <strong>email address</strong>, an optional <strong>display name</strong>, your <strong>password</strong> (as a secure hash we can't read), and what you choose to save: <strong>teams, saved trades, watchlist and settings</strong> (scoring format, league size, superflex). This is used only to run your account. We don't sell it or share it.</p>
      <p>Account data is stored with <a href="https://supabase.com/" target="_blank" rel="noopener">Supabase</a> in the United States. Each account can only read and change its own data. You stay logged in on a device until you log out.</p>`],
    ["Deleting your data", `<p>Delete your account any time from <a href="#account">Your Account</a>. That permanently removes your login and everything saved to it.</p>`],
    ["Emails", `<p>We only email you for account tasks you start, like confirming your address or resetting your password. No newsletters or marketing.</p>`],
    ["Analytics", `<p>We use Google Analytics, through Google Tag Manager, to count visits and see which pages and tools people use. It uses cookies and collects standard information such as pages viewed, approximate location, device and browser. We don't send it your email, roster or anything you type. Analytics cookies are only used if you allow them: visitors in the EU, UK and Switzerland are asked first, and anyone can accept or reject them in <button type="button" class="link-btn" data-cookie-settings>cookie settings</button> (also linked at the bottom of every page). You can also use Google's <a href="https://tools.google.com/dlpage/gaoptout" target="_blank" rel="noopener">opt-out add-on</a>. We never use advertising cookies.</p>`],
    ["What we don't collect", `<p>No payment details and no advertising trackers. We don't sell your information.</p>`],
    ["Other services", `<p>To show the site, your browser loads fonts from Google Fonts, player photos from NFL.com and team logos from ESPN. Those services receive standard request information (like your IP address) under their own privacy policies. The site is hosted on GitHub Pages.</p>`],
    ["Contact", `<p>Questions about your data, or want it removed? Email <a href="mailto:${CONTACT}">${CONTACT}</a>.</p>`],
    ["Changes", `<p>If this changes, this page will be updated first.</p>`],
  ]);
}

function renderTerms() {
  $("#page").innerHTML = articlePage("Legal", "Terms of Use", "By using The Sports Mattress you agree to these terms.", [
    ["For entertainment and research", `<p>Projections, rankings, grades and trade verdicts are estimates from public data and simple models. They aren't guarantees, and they aren't betting or financial advice. Make your own decisions.</p>`],
    ["Accuracy", `<p>Data comes from third-party sources and is updated on a schedule, so it can be incomplete, delayed or wrong, especially around late injury news. The site is provided "as is", without warranties of any kind.</p>`],
    ["Not affiliated", `<p>The Sports Mattress isn't affiliated with or endorsed by the NFL, its teams, ESPN or any fantasy platform. Team names, logos and player images belong to their owners and are shown for identification only.</p>`],
    ["Accounts", `<p>Accounts are free and optional. Keep your password private; you're responsible for activity on your account. We may remove accounts used for abuse or automated scraping. You can delete your account at any time.</p>`],
    ["Data sources", `<p>Stats from <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener">nflverse</a>. Weather from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.</p>`],
    ["Changes", `<p>These terms may change; the version on this page is the current one.</p>`],
  ]);
}
// ================================================================== ACCOUNTS (Supabase)
// Sign-up, login and saved data. The anon key is public by design; row level security in the
// database limits every user to their own rows.
const SB_CFG = window.TSM_SB || {};
// Email links (confirm sign-up, password reset) land here with details in the #hash. Read them before the
// Supabase client consumes and clears them, so we can say what happened.
const MIN_PASSWORD = 10;   // keep in sync with Supabase: Authentication → Sign In / Providers → Email → minimum password length
const AUTH_LANDING = (() => {
  const h = new URLSearchParams((location.hash || "").replace(/^#/, ""));
  if (h.get("error_description")) return { error: h.get("error_description").replace(/\+/g, " ") };
  return h.get("type") ? { type: h.get("type") } : null;
})();
const sb = window.supabase && SB_CFG.url ? window.supabase.createClient(SB_CFG.url, SB_CFG.key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: "tsm-auth" },
}) : null;
const account = { user: null, profile: null, teams: [], activeTeamId: null, trades: [], watch: new Set(), loaded: false, recovery: false };

function toast(msg, kind = "") {
  let el = $("#toast");
  if (!el) { el = document.createElement("div"); el.id = "toast"; el.setAttribute("role", "status"); document.body.appendChild(el); }
  el.className = "toast show " + kind; el.textContent = msg;
  clearTimeout(toast.t); toast.t = setTimeout(() => { el.className = "toast " + kind; }, 2600);
}
function signedIn() { return !!account.user; }
function displayName() { return (account.profile && account.profile.display_name) || (account.user && account.user.email.split("@")[0]) || ""; }
function friendlyError(e) {
  const m = (e && (e.message || e.error_description)) || String(e);
  if (/invalid login credentials/i.test(m)) return "That email and password don't match. Check them and try again.";
  if (/email not confirmed/i.test(m)) return "Confirm your email first: open the link we sent you, then log in.";
  if (/already registered|already been registered/i.test(m)) return "There's already an account with that email. Log in instead, or reset your password.";
  if (/rate limit/i.test(m)) return "Too many attempts. Wait a few minutes and try again.";
  if (/error sending|not authorized/i.test(m)) return "We couldn't send the email right now. Try again later.";
  if (/password/i.test(m) && /characters|short|weak/i.test(m)) return `Use a password of at least ${MIN_PASSWORD} characters.`;
  return m;
}

async function loadCloud() {
  if (!sb || !account.user) return;
  const uid = account.user.id;
  const [prof, teams, trades, watch] = await Promise.all([
    sb.from("profiles").select("*").eq("id", uid).maybeSingle(),
    sb.from("teams").select("*").order("created_at"),
    sb.from("saved_trades").select("*").order("created_at", { ascending: false }),
    sb.from("watchlist").select("player_id"),
  ]);
  account.profile = prof.data || { id: uid, scoring: state.fmt, lineup_format: "standard", league_size: 12, superflex: false };
  account.teams = teams.data || [];
  account.trades = trades.data || [];
  account.watch = new Set((watch.data || []).map(r => r.player_id));
  account.activeTeamId = account.profile.active_team_id || (account.teams[0] && account.teams[0].id) || null;
  const adm = await sb.rpc("is_admin");
  account.isAdmin = adm.data === true;
  // First login on this device: bring over a team built while logged out.
  const local = store.get("tsm-roster", null);
  if (!account.teams.length && Array.isArray(local) && local.length) {
    const t = await createTeam("My Team", local.filter(id => byId.has(id)), store.get("tsm-slots", "standard"), true);
    if (t) toast("Your team was saved to your account.");
  }
  if (account.profile.scoring && D.formats[account.profile.scoring]) { state.fmt = account.profile.scoring; store.set("tsm-fmt", state.fmt); }
  account.loaded = true;
  clearSettingsCaches();
}

function initAuth() {
  renderAcct();
  if (!sb) return;
  if (AUTH_LANDING && AUTH_LANDING.error) {
    toast(/expired|invalid/i.test(AUTH_LANDING.error) ? "That email link has expired. Log in, or request a new link." : AUTH_LANDING.error, "bad");
  } else if (AUTH_LANDING && AUTH_LANDING.type === "signup") {
    setTimeout(() => { toast("Email confirmed. Welcome to The Sports Mattress!"); if (state.page === "home") navigate("my-team"); }, 600);
  }
  sb.auth.onAuthStateChange((event, session) => {
    const was = account.user && account.user.id;
    const firstCheck = !account.ready;
    account.ready = true;   // the saved session has been checked (signed in or not)
    account.user = session ? session.user : null;
    if (event === "PASSWORD_RECOVERY") { account.recovery = true; navigate("reset"); }
    if (account.user && account.user.id !== was) {
      // Defer database calls out of the auth callback, as Supabase recommends.
      setTimeout(() => loadCloud().then(() => { renderAcct(); render(); }), 0);
    } else if (!account.user && was) {
      Object.assign(account, { profile: null, teams: [], activeTeamId: null, trades: [], watch: new Set(), loaded: false, isAdmin: false });
      clearSettingsCaches(); renderAcct(); render();
    }
    renderAcct();
    if (firstCheck && !account.user && ["account", "write"].includes(state.page)) render();
  });
}

function renderAcct() {
  const html = signedIn()
    ? `<a class="acct-chip" href="#account" title="Your account"><span class="acct-av">${esc(initials(displayName()) || "?")}</span><span class="acct-name">${esc(displayName())}</span></a>`
    : `<a class="btn small ghost-inv" href="#login">Log in</a><a class="btn small" href="#signup">Sign up</a>`;
  const a = $("#acct"); if (a) a.innerHTML = sb ? html : "";
  cleanLinks($("#acct"));
  const m = $("#navAcct");
  if (m) m.innerHTML = !sb ? "" : signedIn()
    ? `<a href="#account">My Account (${esc(displayName())})</a>`
    : `<a href="#login">Log in</a><a href="#signup">Create account</a>`;
  cleanLinks($("#navAcct"));
}

// ---------------------------------------------------------------- saved data helpers
function activeTeam() { return account.teams.find(t => t.id === account.activeTeamId) || account.teams[0] || null; }
let teamSaveTimer = 0;
function saveTeamSoon(team) {
  clearTimeout(teamSaveTimer);
  teamSaveTimer = setTimeout(async () => {
    const { error } = await sb.from("teams").update({ player_ids: team.player_ids, lineup_format: team.lineup_format, name: team.name }).eq("id", team.id);
    if (error) toast("Couldn't save your team: " + friendlyError(error), "bad"); else toast("Team saved");
  }, 400);
}
async function createTeam(name, ids = [], fmt = "standard", quiet = false) {
  const { data, error } = await sb.from("teams").insert({ name, player_ids: ids, lineup_format: fmt }).select().single();
  if (error) { toast(friendlyError(error), "bad"); return null; }
  account.teams.push(data);
  await setActiveTeam(data.id, true);
  if (!quiet) toast(`Created “${name}”`);
  return data;
}
async function setActiveTeam(id, quiet) {
  account.activeTeamId = id;
  if (account.profile) account.profile.active_team_id = id;
  await sb.from("profiles").update({ active_team_id: id }).eq("id", account.user.id);
  if (!quiet) render();
}
async function saveProfile(patch, msg = "Saved") {
  Object.assign(account.profile, patch);
  const { error } = await sb.from("profiles").update(patch).eq("id", account.user.id);
  if (error) toast(friendlyError(error), "bad"); else if (msg) toast(msg);
}
async function toggleWatch(id) {
  if (!signedIn()) { toast("Log in to keep a watchlist"); navigate("login"); return; }
  if (account.watch.has(id)) {
    account.watch.delete(id);
    const { error } = await sb.from("watchlist").delete().eq("player_id", id);
    if (error) { account.watch.add(id); toast(friendlyError(error), "bad"); } else toast("Removed from watchlist");
  } else {
    account.watch.add(id);
    const { error } = await sb.from("watchlist").insert({ player_id: id });
    if (error) { account.watch.delete(id); toast(friendlyError(error), "bad"); } else toast("Added to watchlist");
  }
  render();
}

// League settings shape the Trade Analyzer's replacement levels.
function leagueSettings() {
  if (account.profile) return { size: account.profile.league_size || 12, sf: !!account.profile.superflex };
  return { size: 12, sf: false };
}
function replRank(pos) {
  const { size, sf } = leagueSettings();
  return { QB: sf ? size * 2 + 1 : size + 1, RB: Math.round(size * 2.5), WR: size * 3, TE: size + 1 }[pos];
}
function clearSettingsCaches() { replCache.clear(); }

// ---------------------------------------------------------------- auth pages
function authShell(title, lede, body, foot) {
  return `<section class="auth-wrap"><div class="panel auth-card">
    <div class="eyebrow">The Sports Mattress</div><h1>${title}</h1>${lede ? `<p class="lede">${lede}</p>` : ""}
    ${body}${foot ? `<div class="auth-foot">${foot}</div>` : ""}</div>
    <aside class="auth-side"><h2>Free account perks</h2><ul>
      <li><b>Save your teams</b> for every league and get the best lineup each week.</li>
      <li><b>Save trades</b> from the Trade Analyzer and come back to them.</li>
      <li><b>Watchlist</b> players and see their matchups on the home page.</li>
      <li><b>Your settings everywhere</b>: scoring format and league size on any device.</li></ul></aside></section>`;
}
const noAuth = () => `<p class="auth-msg bad">Accounts aren't available right now. Please try again later.</p>`;
function renderLogin() {
  if (signedIn()) { navigate("account"); return; }
  $("#page").innerHTML = authShell("Log in", "Welcome back. Your teams, trades and watchlist are waiting.",
    sb ? `<form class="auth-form" id="loginForm" novalidate>
      <div class="field"><label for="liEmail">Email</label><input id="liEmail" type="email" autocomplete="email" required></div>
      <div class="field"><label for="liPass">Password</label><input id="liPass" type="password" autocomplete="current-password" required></div>
      <p class="auth-msg" id="authMsg" role="alert"></p>
      <button type="submit" class="btn primary wide">Log in</button>
      <a class="auth-link" href="#forgot">Forgot your password?</a></form>` : noAuth(),
    `New here? <a href="#signup">Create a free account</a>`);
}
function renderSignup() {
  if (signedIn()) { navigate("account"); return; }
  $("#page").innerHTML = authShell("Create your account", "Free. Save your teams, trades and watchlist, and stay logged in on this device.",
    sb ? `<form class="auth-form" id="signupForm" novalidate>
      <div class="field"><label for="suName">Display name</label><input id="suName" type="text" maxlength="40" autocomplete="nickname" placeholder="What should we call you?"></div>
      <div class="field"><label for="suEmail">Email</label><input id="suEmail" type="email" autocomplete="email" required></div>
      <div class="field"><label for="suPass">Password</label><input id="suPass" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required><small class="muted">At least ${MIN_PASSWORD} characters.</small></div>
      <p class="auth-msg" id="authMsg" role="alert"></p>
      <button type="submit" class="btn primary wide">Create account</button>
      <p class="muted" style="margin:0;font-size:12px">By creating an account you agree to the <a href="#terms">Terms of Use</a> and <a href="#privacy">Privacy</a> policy.</p></form>` : noAuth(),
    `Already have an account? <a href="#login">Log in</a>`);
}
function renderForgot() {
  $("#page").innerHTML = authShell("Reset your password", "Enter your email and we'll send you a link to set a new password.",
    sb ? `<form class="auth-form" id="forgotForm" novalidate>
      <div class="field"><label for="fgEmail">Email</label><input id="fgEmail" type="email" autocomplete="email" required></div>
      <p class="auth-msg" id="authMsg" role="alert"></p>
      <button type="submit" class="btn primary wide">Send reset link</button></form>` : noAuth(),
    `Remembered it? <a href="#login">Log in</a>`);
}
function renderReset() {
  $("#page").innerHTML = authShell("Set a new password", signedIn() ? "Choose a new password for your account." : "Open the reset link from your email to set a new password.",
    signedIn() ? `<form class="auth-form" id="resetForm" novalidate>
      <div class="field"><label for="rsPass">New password</label><input id="rsPass" type="password" autocomplete="new-password" minlength="${MIN_PASSWORD}" required><small class="muted">At least ${MIN_PASSWORD} characters.</small></div>
      <p class="auth-msg" id="authMsg" role="alert"></p>
      <button type="submit" class="btn primary wide">Save new password</button></form>` : "",
    `<a href="#login">Back to log in</a>`);
}

async function onAuthSubmit(e) {
  const f = e.target, msg = $("#authMsg");
  if (!f.matches || !f.matches(".auth-form")) return;
  e.preventDefault();
  const btn = f.querySelector("button[type=submit]"), say = (t, ok) => { msg.textContent = t; msg.className = "auth-msg" + (ok ? " ok" : " bad"); };
  const val = id => (document.getElementById(id) || {}).value || "";
  btn.disabled = true;
  try {
    if (f.id === "loginForm") {
      if (!val("liEmail") || !val("liPass")) return say("Enter your email and password.");
      const { error } = await sb.auth.signInWithPassword({ email: val("liEmail").trim(), password: val("liPass") });
      if (error) return say(friendlyError(error));
      toast("Welcome back!"); navigate("my-team");
    } else if (f.id === "signupForm") {
      if (!/^\S+@\S+\.\S+$/.test(val("suEmail").trim())) return say("Enter a valid email address.");
      if (val("suPass").length < MIN_PASSWORD) return say(`Use a password of at least ${MIN_PASSWORD} characters.`);
      const { data, error } = await sb.auth.signUp({
        email: val("suEmail").trim(), password: val("suPass"),
        options: { data: { display_name: val("suName").trim() || undefined }, emailRedirectTo: SB_CFG.site || location.href.split("#")[0] },
      });
      if (error) return say(friendlyError(error));
      if (data.session) { toast("Account created. You're logged in!"); navigate("my-team"); }
      else if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) say("There's already an account with that email. Log in instead, or reset your password.");
      else say("Almost done: check your email and click the confirmation link, then log in.", true);
    } else if (f.id === "forgotForm") {
      if (!/^\S+@\S+\.\S+$/.test(val("fgEmail").trim())) return say("Enter a valid email address.");
      const { error } = await sb.auth.resetPasswordForEmail(val("fgEmail").trim(), { redirectTo: SB_CFG.site || location.href.split("#")[0] });
      if (error) return say(friendlyError(error));
      say("If there's an account with that email, a reset link is on its way.", true);
    } else if (f.id === "resetForm") {
      if (val("rsPass").length < MIN_PASSWORD) return say(`Use a password of at least ${MIN_PASSWORD} characters.`);
      const { error } = await sb.auth.updateUser({ password: val("rsPass") });
      if (error) return say(friendlyError(error));
      account.recovery = false; toast("Password updated"); navigate("account");
    } else if (f.id === "deleteForm") {
      if (val("delConfirm").trim().toUpperCase() !== "DELETE") return say("Type DELETE to confirm.");
      const { error } = await sb.rpc("delete_my_account");
      if (error) return say(friendlyError(error));
      await sb.auth.signOut({ scope: "local" });
      store.set("tsm-roster", null);
      toast("Your account was deleted."); navigate("home");
    }
  } finally { btn.disabled = false; }
}

// ---------------------------------------------------------------- account page
function renderAccount() {
  if (!sb) { $("#page").innerHTML = noAuth(); return; }
  if (!account.ready) { $("#page").innerHTML = `<p class="loading">Loading your account…</p>`; return; }
  if (!signedIn()) { navigate("login"); return; }
  if (!account.loaded) { $("#page").innerHTML = `<p class="loading">Loading your account…</p>`; return; }
  const pr = account.profile, ls = leagueSettings();
  const teamRows = account.teams.map(t => `<div class="list-row">
      <div><b>${esc(t.name)}</b>${t.id === account.activeTeamId ? ` <span class="badge ok">Active</span>` : ""}<small class="muted" style="display:block">${t.player_ids.length} players · ${esc((SLOT_SETS[t.lineup_format] || SLOT_SETS.standard).label)}</small></div>
      <div class="row-actions"><button type="button" class="btn small" data-action="acctOpenTeam" data-id="${t.id}">Open</button>
        <button type="button" class="btn small" data-action="teamDelete" data-id="${t.id}">Delete</button></div></div>`).join("");
  const tradeRows = account.trades.map(t => `<div class="list-row">
      <div><b>${esc(t.name)}</b><small class="muted" style="display:block">${esc(t.give.map(id => (byId.get(id) || {}).name || "?").join(", "))} for ${esc(t.get.map(id => (byId.get(id) || {}).name || "?").join(", "))}</small></div>
      <div class="row-actions"><button type="button" class="btn small" data-action="tradeLoad" data-id="${t.id}">Open</button>
        <button type="button" class="btn small" data-action="tradeDelete" data-id="${t.id}">Delete</button></div></div>`).join("");
  const watchRows = [...account.watch].map(id => byId.get(id)).filter(Boolean).map(p => `<div class="list-row">
      <div class="pcell">${avatar(p)}<span class="meta">${plink(p)} ${injBadge(p)}<small>${p.pos} · ${esc(p.team)} · ${esc(oppText(p))}</small></span></div>
      <div class="row-actions"><button type="button" class="btn small" data-action="watch" data-id="${esc(p.id)}">Remove</button></div></div>`).join("");
  $("#page").innerHTML = `
    ${pageHead("Your account", `Hi, ${esc(displayName())}`, `Signed in as ${esc(account.user.email)}.`)}
    <section class="grid-2" style="align-items:start">
      <div class="section">
        <div class="section-head"><h2>Profile and settings</h2></div>
        <form class="panel panel-pad settings-form" id="settingsForm">
          <div class="field"><label for="stName">Display name</label><input id="stName" type="text" maxlength="40" value="${esc(pr.display_name || "")}"></div>
          <div class="field"><label for="stScoring">Default scoring</label><select id="stScoring">${Object.entries(D.formats).map(([k, v]) => `<option value="${k}"${k === pr.scoring ? " selected" : ""}>${v}</option>`).join("")}</select></div>
          <div class="field-row">
            <div class="field"><label for="stSize">League size</label><select id="stSize">${[8, 10, 12, 14, 16].map(n => `<option value="${n}"${n === ls.size ? " selected" : ""}>${n} teams</option>`).join("")}</select></div>
            <div class="field"><label for="stSf">Quarterbacks</label><select id="stSf"><option value="0"${ls.sf ? "" : " selected"}>1 QB</option><option value="1"${ls.sf ? " selected" : ""}>Superflex / 2 QB</option></select></div>
          </div>
          <p class="muted" style="margin:0;font-size:12px">League size and quarterbacks set how the Trade Analyzer values each position.</p>
          <button type="submit" class="btn primary">Save settings</button>
        </form>
        <div class="section-head"><h2>Account</h2></div>
        <div class="panel panel-pad acct-actions">
          ${account.isAdmin ? `<a class="btn primary" href="#write">Write a blog post</a>` : ""}
          <a class="btn" href="#reset">Change password</a>
          <button type="button" class="btn" data-action="logout">Log out</button>
          <details class="danger"><summary>Delete account</summary>
            <form class="auth-form" id="deleteForm" novalidate><p class="muted" style="margin:0;font-size:13px">This permanently deletes your account, teams, trades and watchlist. Type <b>DELETE</b> to confirm.</p>
              <input id="delConfirm" type="text" autocomplete="off"><p class="auth-msg" id="authMsg" role="alert"></p>
              <button type="submit" class="btn danger-btn">Delete my account</button></form></details>
        </div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Your teams</h2><button type="button" class="btn small" data-action="teamNew">New team</button></div>
        <div class="panel list">${teamRows || `<p class="empty">No teams yet. <a href="#my-team">Build one on My Team</a>.</p>`}</div>
        <div class="section-head"><h2>Saved trades</h2><a href="#trade">Trade Analyzer →</a></div>
        <div class="panel list">${tradeRows || `<p class="empty">No saved trades. Use <b>Save trade</b> on the Trade Analyzer.</p>`}</div>
        <div class="section-head"><h2>Watchlist</h2></div>
        <div class="panel list">${watchRows || `<p class="empty">Nobody yet. Open any player and tap <b>☆ Watch</b>.</p>`}</div>
      </div>
    </section>`;
}
async function onSettingsSubmit(e) {
  if (e.target.id !== "settingsForm") return;
  e.preventDefault();
  const patch = {
    display_name: $("#stName").value.trim().slice(0, 40) || null,
    scoring: $("#stScoring").value, league_size: Number($("#stSize").value), superflex: $("#stSf").value === "1",
  };
  await saveProfile(patch, "Settings saved");
  state.fmt = patch.scoring; store.set("tsm-fmt", state.fmt); clearSettingsCaches(); renderAcct(); render();
}

// ---------------------------------------------------------------- my team (signed in)
function teamSwitcher() {
  const t = activeTeam();
  return `<div class="panel panel-pad team-bar">
    <div class="field"><label for="teamPick">Team</label><select id="teamPick">${account.teams.map(x => `<option value="${x.id}"${t && x.id === t.id ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></div>
    <div class="team-bar-actions">
      <button type="button" class="btn small" data-action="teamNew">New team</button>
      ${t ? `<button type="button" class="btn small" data-action="teamRename">Rename</button><button type="button" class="btn small" data-action="teamDelete" data-id="${t.id}">Delete</button>` : ""}
    </div>
    <span class="muted team-saved">Saved to your account</span>
  </div>`;
}
function inlinePrompt(label, value, onSave) {
  // In-page prompt (browser prompt() is unreliable in embedded views).
  const box = document.createElement("form");
  box.className = "panel panel-pad inline-prompt";
  box.innerHTML = `<label for="ipVal">${esc(label)}</label><div class="pro-code-row"><input id="ipVal" type="text" maxlength="40" value="${esc(value || "")}"><button type="submit" class="btn primary">Save</button><button type="button" class="btn" data-cancel>Cancel</button></div>`;
  $("#page").prepend(box);
  const inp = box.querySelector("input"); inp.focus(); inp.select();
  box.addEventListener("submit", ev => { ev.preventDefault(); ev.stopPropagation(); const v = inp.value.trim(); if (v) { box.remove(); onSave(v); } });
  box.querySelector("[data-cancel]").addEventListener("click", ev => { ev.stopPropagation(); box.remove(); });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

Object.assign(ACTIONS, {
  logout: async () => { await sb.auth.signOut(); toast("Logged out"); navigate("home"); },
  watch: el => toggleWatch(el.dataset.id),
  teamNew: () => inlinePrompt("Name your new team", `Team ${account.teams.length + 1}`, async name => { await createTeam(name); navigate("my-team"); render(); }),
  teamRename: () => { const t = activeTeam(); if (t) inlinePrompt("Rename team", t.name, name => { t.name = name; saveTeamSoon(t); render(); }); },
  teamDelete: async el => {
    const t = account.teams.find(x => x.id === el.dataset.id); if (!t) return;
    if (el.dataset.sure !== "1") { el.dataset.sure = "1"; el.textContent = "Tap again to delete"; setTimeout(() => { if (el.isConnected) { el.dataset.sure = ""; el.textContent = "Delete"; } }, 3000); return; }
    const { error } = await sb.from("teams").delete().eq("id", t.id);
    if (error) return toast(friendlyError(error), "bad");
    account.teams = account.teams.filter(x => x.id !== t.id);
    if (account.activeTeamId === t.id) await setActiveTeam(account.teams[0] ? account.teams[0].id : null, true);
    toast(`Deleted “${t.name}”`); render();
  },
  acctOpenTeam: async el => { await setActiveTeam(el.dataset.id, true); navigate("my-team"); },
  tradeSave: () => {
    if (!signedIn()) { toast("Log in to save trades"); navigate("login"); return; }
    const t = tradeState(), nm = ids => ids.map(id => lastName((byId.get(id) || { name: "?" }).name)).join(" + ");
    inlinePrompt("Name this trade", `${nm(t.give)} for ${nm(t.get)}`.slice(0, 60), async name => {
      const { data, error } = await sb.from("saved_trades").insert({ name, give: t.give, get: t.get }).select().single();
      if (error) return toast(friendlyError(error), "bad");
      account.trades.unshift(data); toast("Trade saved"); render();
    });
  },
  tradeLoad: el => { const t = account.trades.find(x => x.id === el.dataset.id); if (!t) return; store.set("tsm-trade", { give: t.give, get: t.get }); navigate("trade"); render(); },
  tradeDelete: async el => {
    const { error } = await sb.from("saved_trades").delete().eq("id", el.dataset.id);
    if (error) return toast(friendlyError(error), "bad");
    account.trades = account.trades.filter(x => x.id !== el.dataset.id); toast("Trade deleted"); render();
  },
});
// ================================================================== BLOG
// Posts stored in Supabase; anyone can read published posts, only admins can write.
const blog = { posts: null, current: null, editing: null, list: null, preview: false };

function timeAgo(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}
function fmtDate(iso) { return iso ? new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : ""; }
function slugify(t) { return String(t || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80).replace(/-+$/, ""); }
function postPath(slug) { return CLEAN ? `/blog/${slug}/` : "#blog"; }
// Markdown -> safe HTML. Raw HTML is escaped; DOMPurify removes anything unsafe that's left.
function mdToHtml(md) {
  if (!window.marked || !window.DOMPurify) return `<p>${esc(md || "")}</p>`;
  const html = window.marked.parse(String(md || "").replace(/&/g, "&amp;").replace(/</g, "&lt;"), { gfm: true, breaks: false });
  return window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
}
if (window.DOMPurify) window.DOMPurify.addHook("afterSanitizeAttributes", n => {
  if (n.tagName === "A" && /^https?:/i.test(n.getAttribute("href") || "")) { n.setAttribute("target", "_blank"); n.setAttribute("rel", "noopener"); }
  if (n.tagName === "IMG") { n.setAttribute("loading", "lazy"); if (!n.getAttribute("alt")) n.setAttribute("alt", ""); }
});

// Supabase reads that the page waits on give up after a few seconds (then the built copy is used).
const within = (promise, ms = 5000) => Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);
async function loadPosts(force) {
  if (blog.posts && !force) return blog.posts;
  blog.posts = (D.posts || []).slice();
  if (sb) {
    try {
      const { data, error } = await within(sb.from("posts").select("id,slug,title,excerpt,cover_url,tags,author_name,published_at,updated_at,status")
        .eq("status", "published").order("published_at", { ascending: false }).limit(200));
      if (!error && data) blog.posts = data;
    } catch (e) { /* Supabase unreachable: keep the copy built into data.json */ }
  }
  return blog.posts;
}
function postCard(p, big) {
  return `<a class="panel post-card${big ? " big" : ""}" href="${postPath(p.slug)}" data-post="${esc(p.slug)}">
    ${p.cover_url ? `<span class="post-cover" style="background-image:url('${esc(p.cover_url)}')" role="img" aria-label=""></span>` : `<span class="post-cover blank" aria-hidden="true"></span>`}
    <span class="post-card-body"><span class="post-meta">${esc(fmtDate(p.published_at))}${p.author_name ? ` · ${esc(p.author_name)}` : ""}</span>
      <span class="post-card-title">${esc(p.title)}</span>${p.excerpt ? `<span class="post-card-ex">${esc(p.excerpt)}</span>` : ""}
      ${(p.tags || []).length ? `<span class="post-tags">${p.tags.map(t => `<span class="tag mid">${esc(t)}</span>`).join("")}</span>` : ""}</span></a>`;
}

// ---------------------------------------------------------------- blog index + post
function renderBlog() {
  $("#page").innerHTML = `
    <div class="pro-head">${pageHead("Blog", "The Sports Mattress blog", "Articles, rankings and advice from The Sports Mattress.")}
      ${account.isAdmin ? `<a class="btn primary" href="#write">Write a post</a>` : ""}</div>
    <div id="blogList"><p class="loading">Loading articles…</p></div>`;
  loadPosts().then(posts => {
    const box = $("#blogList"); if (!box) return;
    box.innerHTML = posts.length ? `<div class="post-grid">${posts.map((p, i) => postCard(p, i === 0)).join("")}</div>`
      : `<div class="panel panel-pad empty">No articles yet. Check back soon${account.isAdmin ? `, or <a href="#write">write the first one</a>` : ""}.</div>`;
    cleanLinks(box);
  });
}

async function renderPost() {
  const slug = state.slug;
  $("#page").innerHTML = `<p class="loading">Loading article…</p>`;
  let post = null;
  if (sb) {
    try { const { data } = await within(sb.from("posts").select("*").eq("slug", slug).maybeSingle()); post = data; }
    catch (e) { /* fall back to the built copy below */ }
  }
  if (!post) post = (D.posts || []).find(p => p.slug === slug) || null;
  if (state.page !== "post" || state.slug !== slug) return;
  if (!post) return renderNotFound();
  blog.current = post;
  document.title = `${post.title} · The Sports Mattress`;
  const url = (window.TSM_SB && window.TSM_SB.site ? window.TSM_SB.site : location.origin + "/") + `blog/${post.slug}/`;
  const share = encodeURIComponent(url), text = encodeURIComponent(post.title);
  $("#page").innerHTML = `
    <article class="post">
      ${post.status === "draft" ? `<div class="panel panel-pad off-note"><strong>Draft.</strong> <span class="muted">Only admins can see this until it's published.</span></div>` : ""}
      <a href="#blog" class="post-back">← All articles</a>
      <h1 class="post-title">${esc(post.title)}</h1>
      ${post.excerpt ? `<p class="post-dek">${esc(post.excerpt)}</p>` : ""}
      <div class="post-byline"><span>${esc(post.author_name || "The Sports Mattress")}</span><span>${esc(fmtDate(post.published_at || post.created_at))}</span>
        ${(post.tags || []).map(t => `<span class="tag mid">${esc(t)}</span>`).join("")}</div>
      ${post.cover_url ? `<img class="post-hero" src="${esc(post.cover_url)}" alt="">` : ""}
      <div class="post-body">${mdToHtml(post.body_md)}</div>
      <div class="post-share"><span class="muted">Share:</span>
        <a class="btn small" href="https://twitter.com/intent/tweet?url=${share}&text=${text}" target="_blank" rel="noopener">X / Twitter</a>
        <a class="btn small" href="https://www.facebook.com/sharer/sharer.php?u=${share}" target="_blank" rel="noopener">Facebook</a>
        <a class="btn small" href="https://www.reddit.com/submit?url=${share}&title=${text}" target="_blank" rel="noopener">Reddit</a>
        <button type="button" class="btn small" data-action="copyLink" data-url="${esc(url)}">Copy link</button>
        ${account.isAdmin ? `<button type="button" class="btn small primary" data-action="editPost" data-id="${post.id}">Edit</button>` : ""}</div>
      <section class="more-posts" id="morePosts" hidden></section>
    </article>`;
  cleanLinks($("#page"));
  const others = (await loadPosts()).filter(p => p.slug !== slug).slice(0, 3);
  const box = $("#morePosts");
  if (box && others.length && state.slug === slug) {
    box.innerHTML = `<div class="section-head"><h2>More articles</h2><a href="#blog">All articles →</a></div><div class="post-grid">${others.map(p => postCard(p)).join("")}</div>`;
    box.hidden = false;
    cleanLinks(box);
  }
}

function renderNotFound() {
  $("#page").innerHTML = `${pageHead("404", "Page not found", "That page doesn't exist or has moved.")}
    <p><a class="btn primary" href="#home">Go to this week's matchups</a></p>
    <p class="muted">Or try the <a href="#trade">Trade Analyzer</a>, <a href="#start-sit">Start / Sit</a> or the <a href="#blog">blog</a>.</p>`;
  cleanLinks($("#page"));
}

// ---------------------------------------------------------------- write (admins)
async function renderWrite() {
  if (!sb) { $("#page").innerHTML = noAuth(); return; }
  if (!account.ready) { $("#page").innerHTML = `<p class="loading">Loading…</p>`; return; }
  if (!signedIn()) { navigate("login"); return; }
  if (!account.loaded) { $("#page").innerHTML = `<p class="loading">Loading…</p>`; return; }
  if (!account.isAdmin) {
    $("#page").innerHTML = `${pageHead("Blog", "Write", "")}<div class="panel panel-pad">Only site admins can write posts. If you should have access, contact <a href="mailto:${CONTACT}">${CONTACT}</a>.</div>`;
    return;
  }
  if (!blog.list) {
    const { data, error } = await sb.from("posts").select("*").order("updated_at", { ascending: false });
    blog.list = error ? [] : data;
  }
  const e = blog.editing;
  const listHtml = blog.list.map(p => `<div class="list-row">
      <div><b>${esc(p.title)}</b> <span class="badge ${p.status === "published" ? "ok" : "q"}">${p.status === "published" ? "Published" : "Draft"}</span>
        <small class="muted" style="display:block">/blog/${esc(p.slug)}/ · updated ${esc(timeAgo(p.updated_at))}</small></div>
      <div class="row-actions"><button type="button" class="btn small" data-action="editPost" data-id="${p.id}">Edit</button>
        ${p.status === "published" ? `<a class="btn small" href="${postPath(p.slug)}">View</a>` : ""}</div></div>`).join("");
  if (!e) {
    $("#page").innerHTML = `
      <div class="pro-head">${pageHead("Blog", "Write", "Write, save drafts and publish articles. Published posts appear on the blog right away.")}
        <button type="button" class="btn primary" data-action="newPost">New post</button></div>
      <div class="panel list">${listHtml || `<p class="empty">No posts yet. Click <b>New post</b> to write your first.</p>`}</div>`;
    cleanLinks($("#page"));
    return;
  }
  $("#page").innerHTML = `
    <div class="pro-head">${pageHead("Blog", e.id ? "Edit post" : "New post", e.status === "published" ? `Live at /blog/${esc(e.slug)}/` : "Draft: only admins can see it until you publish.")}
      <button type="button" class="btn" data-action="closeEditor">← All posts</button></div>
    <form class="editor" id="postForm" novalidate>
      <div class="editor-main panel panel-pad">
        <div class="field"><label for="peTitle">Title</label><input id="peTitle" type="text" maxlength="140" value="${esc(e.title || "")}" placeholder="A headline people will click"></div>
        <div class="field"><label for="peSlug">Address</label><div class="slug-row"><span class="muted">sportsmattress.io/blog/</span><input id="peSlug" type="text" maxlength="80" value="${esc(e.slug || "")}" placeholder="auto-from-title"></div></div>
        <div class="field"><label for="peExcerpt">Summary <small class="muted">(shown on cards and in Google, about 1–2 sentences)</small></label><textarea id="peExcerpt" rows="2" maxlength="300">${esc(e.excerpt || "")}</textarea></div>
        <div class="field"><label>Article</label>
          <div class="md-toolbar" role="toolbar" aria-label="Formatting">
            <button type="button" data-md="bold" title="Bold"><b>B</b></button><button type="button" data-md="italic" title="Italic"><i>I</i></button>
            <button type="button" data-md="h2" title="Heading">H2</button><button type="button" data-md="h3" title="Subheading">H3</button>
            <button type="button" data-md="link" title="Link">Link</button><button type="button" data-md="ul" title="Bullet list">• List</button>
            <button type="button" data-md="ol" title="Numbered list">1. List</button><button type="button" data-md="quote" title="Quote">“ Quote</button>
            <label class="md-upload" title="Insert image">Image<input type="file" accept="image/*" id="peImage" hidden></label>
            <span class="md-tabs"><button type="button" data-action="mdTab" data-v="write" aria-pressed="${!blog.preview}">Write</button><button type="button" data-action="mdTab" data-v="preview" aria-pressed="${blog.preview}">Preview</button></span>
          </div>
          <textarea id="peBody" rows="22" ${blog.preview ? "hidden" : ""} placeholder="Write your article. **bold**, *italic*, ## Heading, - bullet, [link](https://...)">${esc(e.body_md || "")}</textarea>
          <div class="post-body md-preview panel-pad" id="pePreview" ${blog.preview ? "" : "hidden"}>${blog.preview ? mdToHtml(e.body_md) : ""}</div>
        </div>
      </div>
      <aside class="editor-side">
        <div class="panel panel-pad editor-box">
          <div class="field"><label for="peCover">Cover image</label>
            ${e.cover_url ? `<img class="cover-prev" src="${esc(e.cover_url)}" alt="">` : ""}
            <input id="peCover" type="file" accept="image/*"><small class="muted">JPG, PNG or WebP up to 5 MB. Wide images (1200×630) look best when shared.</small>
            ${e.cover_url ? `<button type="button" class="link-btn" data-action="removeCover" style="font-size:13px">Remove cover</button>` : ""}</div>
          <div class="field"><label for="peTags">Tags <small class="muted">(comma separated)</small></label><input id="peTags" type="text" value="${esc((e.tags || []).join(", "))}" placeholder="Rankings, Week 13, Waivers"></div>
          <div class="field"><label for="peAuthor">Author</label><input id="peAuthor" type="text" maxlength="60" value="${esc(e.author_name || displayName())}"></div>
        </div>
        <div class="panel panel-pad editor-box">
          <p class="auth-msg" id="authMsg" role="alert"></p>
          <button type="button" class="btn primary wide" data-action="savePost" data-publish="1">${e.status === "published" ? "Update published post" : "Publish"}</button>
          <button type="button" class="btn wide" data-action="savePost" data-publish="0">${e.status === "published" ? "Unpublish (back to draft)" : "Save draft"}</button>
          ${e.id ? `<button type="button" class="btn wide danger-ghost" data-action="deletePost" data-id="${e.id}">Delete post</button>` : ""}
        </div>
      </aside>
    </form>`;
}
function editorValues() {
  const e = blog.editing;
  e.title = $("#peTitle").value.trim();
  e.slug = slugify($("#peSlug").value || e.title);
  e.excerpt = $("#peExcerpt").value.trim();
  if ($("#peBody")) e.body_md = $("#peBody").value;
  e.tags = $("#peTags").value.split(",").map(t => t.trim()).filter(Boolean).slice(0, 8);
  e.author_name = $("#peAuthor").value.trim();
  return e;
}
async function uploadImage(file, folder) {
  if (!file) return null;
  if (file.size > 5 * 1024 * 1024) { toast("Images must be 5 MB or smaller", "bad"); return null; }
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase().replace(/[^a-z0-9]/g, "");
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage.from("blog").upload(path, file, { contentType: file.type, upsert: false });
  if (error) { toast("Upload failed: " + friendlyError(error), "bad"); return null; }
  return sb.storage.from("blog").getPublicUrl(path).data.publicUrl;
}
function mdInsert(kind) {
  const ta = $("#peBody"); if (!ta) return;
  const [a, b] = [ta.selectionStart, ta.selectionEnd], sel = ta.value.slice(a, b);
  const wrap = { bold: ["**", "**", "bold text"], italic: ["*", "*", "italic text"], link: ["[", "](https://)", "link text"] }[kind];
  const line = { h2: "## ", h3: "### ", ul: "- ", ol: "1. ", quote: "> " }[kind];
  let ins, caret;
  if (wrap) { ins = wrap[0] + (sel || wrap[2]) + wrap[1]; caret = a + ins.length; }
  else { const start = ta.value.lastIndexOf("\n", a - 1) + 1; ta.setSelectionRange(start, start); ins = line; caret = b + line.length; ta.setRangeText(ins, start, start, "end"); ta.focus(); ta.setSelectionRange(caret, caret); return; }
  ta.setRangeText(ins, a, b, "end"); ta.focus(); ta.setSelectionRange(caret, caret);
}

Object.assign(ACTIONS, {
  copyLink: el => {
    const u = el.dataset.url;
    (navigator.clipboard ? navigator.clipboard.writeText(u) : Promise.reject()).then(() => toast("Link copied"), () => toast(u));
  },
  newPost: () => { blog.editing = { status: "draft", tags: [] }; blog.preview = false; navigate("write"); render(); },
  editPost: async el => {
    const { data, error } = await sb.from("posts").select("*").eq("id", el.dataset.id).single();
    if (error) return toast(friendlyError(error), "bad");
    blog.editing = data; blog.preview = false; navigate("write"); render(); window.scrollTo(0, 0);
  },
  closeEditor: () => { blog.editing = null; render(); },
  mdTab: el => { editorValues(); blog.preview = el.dataset.v === "preview"; render(); },
  removeCover: () => { editorValues(); blog.editing.cover_url = null; render(); },
  savePost: async el => {
    const e = editorValues(), msg = $("#authMsg"), say = t => { msg.textContent = t; msg.className = "auth-msg bad"; };
    const publish = el.dataset.publish === "1";
    if (!e.title) return say("Add a title.");
    if (!e.slug) return say("Add an address (letters and numbers).");
    if (publish && !e.body_md.trim()) return say("Write the article before publishing.");
    const status = publish ? "published" : "draft";
    const row = { title: e.title, slug: e.slug, excerpt: e.excerpt || null, body_md: e.body_md || "", tags: e.tags,
      author_name: e.author_name || null, cover_url: e.cover_url || null, status };
    el.disabled = true;
    const q = e.id ? sb.from("posts").update(row).eq("id", e.id).select().single() : sb.from("posts").insert(row).select().single();
    const { data, error } = await q;
    el.disabled = false;
    if (error) return say(/duplicate|unique/i.test(error.message) ? "Another post already uses that address. Change it and try again." : friendlyError(error));
    blog.editing = data; blog.list = null; blog.posts = null;
    toast(publish ? "Published! It's live on the blog." : e.status === "published" ? "Moved back to drafts" : "Draft saved");
    render();
  },
  deletePost: async el => {
    if (el.dataset.sure !== "1") { el.dataset.sure = "1"; el.textContent = "Tap again to delete"; setTimeout(() => { if (el.isConnected) { el.dataset.sure = ""; el.textContent = "Delete post"; } }, 3000); return; }
    const { error } = await sb.from("posts").delete().eq("id", el.dataset.id);
    if (error) return toast(friendlyError(error), "bad");
    blog.editing = null; blog.list = null; blog.posts = null; toast("Post deleted"); render();
  },
});

// Editor inputs: toolbar, uploads and the auto address.
document.addEventListener("click", e => { const b = e.target.closest("[data-md]"); if (b) { e.preventDefault(); mdInsert(b.dataset.md); } });
document.addEventListener("change", async e => {
  if (e.target.id === "peCover" && e.target.files[0]) {
    editorValues(); toast("Uploading cover…");
    const url = await uploadImage(e.target.files[0], "covers"); if (url) { blog.editing.cover_url = url; render(); toast("Cover uploaded"); }
  }
  if (e.target.id === "peImage" && e.target.files[0]) {
    toast("Uploading image…");
    const url = await uploadImage(e.target.files[0], "images");
    const ta = $("#peBody");
    if (url && ta) { ta.setRangeText(`\n![](${url})\n`, ta.selectionStart, ta.selectionEnd, "end"); toast("Image added"); }
  }
});
document.addEventListener("input", e => {
  if (e.target.id === "peTitle" && blog.editing && !blog.editing.id) { const s = $("#peSlug"); if (s && !s.dataset.touched) s.value = slugify(e.target.value); }
  if (e.target.id === "peSlug") e.target.dataset.touched = "1";
});
})();
