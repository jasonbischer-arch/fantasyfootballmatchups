/* The Sports Mattress — single-page site. Data comes from data.json, written by build.py. */
(() => {
"use strict";

const POS = ["QB", "RB", "WR", "TE"];
const POS_NAME = { QB: "quarterbacks", RB: "running backs", WR: "wide receivers", TE: "tight ends" };
const RECENT = 3;
const PLAYOFF_WEEKS = new Set([15, 16, 17]);
const PAGES = ["home", "matchups", "start-sit", "my-team", "trade", "players", "schedule", "teams", "about", "how-it-works", "privacy", "terms"];
const PAGE_TITLES = {
  home: "Fantasy Football Matchups, Start/Sit and Trade Analyzer", "start-sit": "Start / Sit", "my-team": "My Team",
  trade: "Trade Analyzer", players: "Player Usage", schedule: "Strength of Schedule", teams: "Team Tendencies",
  about: "About", "how-it-works": "How It Works", privacy: "Privacy", terms: "Terms of Use",
};

let D = null;                         // data.json
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
const plink = (p, text) => `<button type="button" class="plink" data-pid="${esc(p.id)}">${esc(text ?? p.name)}</button>`;
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
function unavailable(p) {
  return p.bye ? "on bye" : injOut(p) ? "ruled out" : inactive(p) ? `inactive (hasn't played in his team's last ${p.missed} games)` : null;
}
function defFor(p) { return p.bye ? null : D.defenses[p.pos][p.opp]; }
function teamOf(p) { return D.teams[p.team] || {}; }
// Projection: own scoring (60% season, 40% last 3) scaled by how much the opponent allows to the
// position versus league average; the matchup effect is halved and capped at ±25% (small samples).
function project(p, f = state.fmt) {
  const season = pts(p.ppg, f), recent = pts(p.l3, f);
  const base = p.g >= 3 ? 0.6 * season + 0.4 * recent : season;
  if (p.bye) return { base, factor: 1, proj: 0 };
  const d = defFor(p), avg = D.leagueAvg[p.pos][f];
  const raw = avg ? d.fppg[f] / avg : 1;
  const factor = Math.min(1.25, Math.max(0.75, 1 + 0.5 * (raw - 1)));
  const out = injOut(p) || inactive(p) ? 0 : base * factor;
  return { base, factor, proj: out, def: d };
}
function injBadge(p) {
  if (inactive(p)) return `<span class="badge out" title="Hasn't played in his team's last ${p.missed} games">Inactive</span>`;
  if (p.bye) return `<span class="badge out">Bye</span>`;
  if (!p.inj) return p.missed >= 1 ? `<span class="badge q" title="Didn't play in his team's last game${p.injPrev ? ` (Week ${p.injPrev.week}: ${esc(p.injPrev.status)}${p.injPrev.injury ? `, ${esc(p.injPrev.injury)}` : ""})` : ""}">Missed last game</span>` : "";
  return `<span class="badge ${injOut(p) ? "out" : "q"}" title="${esc(p.inj.injury || "")}">${esc(p.inj.status)}</span>`;
}
function oppText(p) { return p.bye ? "BYE" : `${p.away ? "@" : "vs "}${p.opp}`; }

// ------------------------------------------------------------------ boot
document.addEventListener("error", e => { if (e.target && e.target.tagName === "IMG") e.target.remove(); }, true);
fetch("data.json?v=" + encodeURIComponent(window.TSM_BUILD || ""))
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
    if (b) { state.fmt = b.dataset.fmt; store.set("tsm-fmt", state.fmt); render(); return; }
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
  page.addEventListener("submit", e => e.preventDefault());
  $("#playerDialog").addEventListener("click", e => {
    if (e.target.id === "playerDialog") return closePlayer();
    onClick(e);
  });
  window.addEventListener("hashchange", () => route(true));
  route(false);
}

// ------------------------------------------------------------------ routing
function route(scroll) {
  const h = location.hash.slice(1).toLowerCase();
  if (POS.includes(h.toUpperCase())) { state.page = "matchups"; state.pos = h.toUpperCase(); state.sort = null; }
  else state.page = PAGES.includes(h) ? h : "home";
  if (state.page === "matchups" && !POS.includes(state.pos)) state.pos = "QB";
  document.querySelectorAll("#nav a").forEach(a => {
    if (a.dataset.page === state.page) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
  });
  document.querySelector('#nav a[data-page="matchups"]').href = "#" + state.pos.toLowerCase();
  // On narrow screens the menu scrolls sideways; keep the current tab in view.
  const cur = document.querySelector("#nav a[aria-current]"), nav = $("#nav");
  if (cur && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = cur.offsetLeft - (nav.clientWidth - cur.offsetWidth) / 2;
  render();
  setMenu(false);
  if (scroll) { window.scrollTo(0, 0); $("#page").focus({ preventScroll: true }); }
}

function render() {
  document.querySelectorAll("button[data-fmt]").forEach(b => b.setAttribute("aria-pressed", b.dataset.fmt === state.fmt));
  const fn = { home: renderHome, matchups: renderMatchups, "start-sit": renderStartSit, "my-team": renderMyTeam,
    players: renderPlayers, schedule: renderSchedule, teams: renderTeams, trade: renderTrade, about: renderAbout, "how-it-works": renderHow, privacy: renderPrivacy, terms: renderTerms }[state.page];
  document.title = `${state.page === "matchups" ? `Week ${D.week} ${state.pos} Matchups` : PAGE_TITLES[state.page]} · The Sports Mattress`;
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
}

function setMenu(open) {
  document.body.classList.toggle("nav-open", open);
  const b = $("#menuBtn");
  b.setAttribute("aria-expanded", open); b.setAttribute("aria-label", open ? "Close menu" : "Open menu");
}
// Status bar: when the data was built and when the next scheduled rebuild runs (Wed 10am, Sun 5am ET).
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
    if ((wd === "Wed" && h === 10) || (wd === "Sun" && h === 5)) return d;
  }
  return null;
}
function fmtET(d, opts) { return d.toLocaleString("en-US", { timeZone: "America/New_York", ...opts }); }
function renderStatus() {
  const u = new Date(D.updated), n = nextUpdate();
  $("#statusWeek").textContent = `Week ${D.week} matchups are live`;
  $("#statusMeta").textContent = `Updated ${fmtET(u, { weekday: "short", hour: "numeric", minute: "2-digit" })} ET` +
    (n ? ` · Next update ${fmtET(n, { weekday: "short", hour: "numeric", minute: "2-digit" })} ET` : "");
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
  if (t.id === "mtSlots") { store.set("tsm-slots", t.value); return render(); }
  if (t.id === "tradeGive" || t.id === "tradeGet") {
    const p = byLabel.get(t.value.trim().toLowerCase());
    if (p) tradeAdd(t.id === "tradeGive" ? "give" : "get", p);
    return;
  }
}
const ACTIONS = {
  pos(el) { location.hash = el.dataset.v.toLowerCase(); },
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
    ss.example = false; saveSS(); closePlayer(); location.hash = "start-sit"; if (state.page === "start-sit") render();
  },
  roster(el) {
    const p = byId.get(el.dataset.id); if (!p) return;
    const r = roster();
    if (!r.example && r.ids.includes(p.id)) removeFromRoster(p.id); else addToRoster(p);
    render();
  },
  rmroster(el) { removeFromRoster(el.dataset.id); render(); },
  clearroster() { store.set("tsm-roster", []); render(); },
  keepexample() { store.set("tsm-roster", exampleRoster().map(p => p.id)); render(); },
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

function renderHome() {
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
  // Injury report: this week's statuses, players who sat out last week, and IR.
  const relevant = p => p.ppg.ppr >= 7;
  const byPpg = (a, b) => b.ppg.ppr - a.ppg.ppr;
  const injRow = (p, right) => `<div class="list-row">
      <div class="pcell">${avatar(p)}<span class="meta">${plink(p)}<small class="pline">${p.pos} · ${teamLogo(p.team, "sm")}${esc(p.team)} · ${f1(pts(p.ppg, f))} pts/g</small></span></div>
      <div class="right">${right}</div></div>`;
  const current = D.players.filter(p => p.inj && p.inj.status !== "IR" && relevant(p)).sort(byPpg).slice(0, 8)
    .map(p => injRow(p, `${injBadge(p)}<small>${esc(p.inj.injury || "")}</small>`));
  const sat = D.players.filter(p => !p.inj && p.missed >= 1 && !inactive(p) && relevant(p)).sort(byPpg).slice(0, 6)
    .map(p => injRow(p, `<span class="badge q">Missed last game</span><small>${p.injPrev ? `Wk ${p.injPrev.week}: ${esc(p.injPrev.status)}${p.injPrev.injury ? ` · ${esc(p.injPrev.injury)}` : ""}` : "No reason listed"}</small>`));
  const ir = D.players.filter(p => (p.inj && p.inj.status === "IR") || inactive(p)).filter(p => p.ppg.ppr >= 9).sort(byPpg);
  const filed = (D.injuryTeams || []).length;
  const injGroup = (title, rows, empty) => `<div class="inj-group"><h3>${title}</h3>${rows.length ? rows.join("") : `<p class="inj-empty">${empty}</p>`}</div>`;
  const injHtml = `${filed < 32 ? `<p class="inj-note">Week ${D.week} reports are in for <b>${filed} of 32</b> teams. The rest post by Friday, and the site picks them up Sunday at 5am ET.</p>` : ""}
    ${injGroup(`Week ${D.week} report`, current, filed ? "No fantasy starters listed yet." : "No team has filed yet.")}
    ${injGroup("Missed last game", sat, "Every fantasy starter played last week.")}
    ${ir.length ? `<div class="inj-group"><h3>On injured reserve</h3><p class="inj-ir">${ir.map(p => `${plink(p)} <small>${p.pos} · ${esc(p.team)}</small>`).join(", ")}</p></div>` : ""}`;

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

    <section class="grid-2" style="align-items:start">
      <div class="section"><div class="section-head"><h2>Usage risers</h2><span class="muted" style="font-size:13px">Snap share, last 3 vs season</span></div>
        ${listPanel(snapUp, "No big snap-share jumps this week.")}</div>
      <div class="section"><div class="section-head"><h2>Injury report</h2><span class="muted" style="font-size:13px">Week ${D.week}, fantasy starters</span></div>
        <div class="panel list inj-panel">${injHtml}</div></div>
    </section>

    <section class="grid-3" style="align-items:start">
      <div class="section"><div class="section-head"><h2>Target share risers</h2><a href="#players">All players →</a></div>
        ${listPanel(tgtUp, "No big target-share jumps this week.")}</div>
      <div class="section"><div class="section-head"><div class="hc-head"><span class="hc-dot" style="background:var(--s-green)"></span><h2>Hot</h2></div><span class="muted" style="font-size:13px">Last 3 games</span></div>
        ${listPanel(hot, "Nobody is running hot right now.")}</div>
      <div class="section"><div class="section-head"><div class="hc-head"><span class="hc-dot" style="background:var(--s-red)"></span><h2>Cold</h2></div><span class="muted" style="font-size:13px">Last 3 games</span></div>
        ${listPanel(cold, "Nobody is in a slump right now.")}</div>
    </section>


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
function renderMatchups() {
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
    Object.values(D.formats).map(l => `<a class="btn small" href="Week_${D.week}_Matchups_${l.replace(/ /g, "_")}.xlsx">${l} .xlsx</a>`).join("")}</div>` : "";

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
  const saved = store.get("tsm-roster", null);
  if (saved === null) return { ids: exampleRoster().map(p => p.id), example: true };
  return { ids: saved.filter(id => byId.has(id)), example: false };
}
function addToRoster(p) {
  const r = roster();
  const ids = r.example ? [] : r.ids;
  if (!ids.includes(p.id)) ids.push(p.id);
  store.set("tsm-roster", ids);
  if (state.page === "my-team") render();
}
function removeFromRoster(id) {
  const r = roster();
  store.set("tsm-roster", r.ids.filter(x => x !== id));
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
  const setKey = store.get("tsm-slots", "standard");
  const set = SLOT_SETS[setKey] || SLOT_SETS.standard;
  const players = r.ids.map(id => byId.get(id)).filter(Boolean);
  const { lineup, bench } = optimize(players, set.slots);
  const total = lineup.reduce((s, x) => s + (x.p && !unavailable(x.p) ? x.proj : 0), 0);
  const warnings = lineup.filter(x => x.p && unavailable(x.p)).map(x => `${x.p.name} is ${unavailable(x.p)}, and you don't have another ${x.slot === "FLEX" ? "flex-eligible player" : x.slot} to replace him.`);

  $("#page").innerHTML = `
    ${pageHead(`Week ${D.week} · ${esc(fmtLabel())}`, "My Team", "Add your roster and get this week's best lineup, ranked by matchup-adjusted projection. Your roster is saved in this browser.")}
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
      <tbody>${rows.map(r => `<tr><td class="sticky l"><span class="team-cell">${teamLogo(r.abbr)}<span><b>${esc(r.abbr)}</b> <span class="team-tag">${esc(r.name)}</span></span></span></td>
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
        ${tile("Opponent", p.bye ? "BYE" : `${p.away ? "@" : ""}${esc(p.opp)}`, p.bye ? "" : esc(kickLabel(p.kick, true)))}
        ${tile("Matchup", d ? `${d.rank[f]}<span style="font-size:14px"> /32</span>` : "—", d ? `${f1(d.fppg[f])} pts allowed/g` : "")}
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
// Replacement level: roughly the best player at each position left on waivers in a 12-team, 1-QB league.
const REPLACEMENT_RANK = { QB: 13, RB: 30, WR: 36, TE: 13 };
const replCache = new Map();
function replacementPpg(pos, f) {
  const key = pos + f;
  if (!replCache.has(key)) {
    const list = D.players.filter(p => p.pos === pos && p.g >= 4).map(p => pts(p.ppg, f)).sort((a, b) => b - a);
    replCache.set(key, list[Math.min(list.length - 1, REPLACEMENT_RANK[pos] - 1)] || 0);
  }
  return replCache.get(key);
}

function rosValue(p, f = state.fmt) {
  const m = playerModel(f).byId.get(p.id);
  const base = p.g >= 3 ? 0.6 * m.season + 0.4 * m.recent : m.season;
  const t = D.teams[p.team] || { sched: [] };
  const avg = D.leagueAvg[p.pos][f];
  const games = t.sched.filter(([w]) => w <= FANTASY_END).map(([w, o, a]) => {
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
  const avgRank = arr => arr.length ? arr.reduce((s, g) => s + g.rank, 0) / arr.length : null;
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
  const weeksLeft = Math.max(0, FANTASY_END - D.week + 1);

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
    reasons.push(`Rest of season (Weeks ${D.week}–${FANTASY_END}), you get ${f1(R.raw)} projected points and give up ${f1(G.raw)}.`);
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
        <div class="tv-actions"><button type="button" class="btn small" data-action="tswap">Swap sides</button><button type="button" class="btn small" data-action="tclear">Clear</button></div></div>
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
      <h4>Schedule <span class="muted">opponent rank vs ${p.pos}s, 32 = softest</span></h4>
      <div class="sched-row"><span class="sched-label">Next 4 <b>${v.next4 != null ? f1(v.next4) : "—"}</b></span><div class="report-sched">${next4.map(chip).join("") || `<span class="muted">No games left</span>`}</div></div>
      ${po.length ? `<div class="sched-row"><span class="sched-label">Playoffs <b>${f1(v.poRank)}</b></span><div class="report-sched">${po.map(chip).join("")}</div></div>` : ""}
      <div class="sched-row"><span class="sched-label">Rest of season <b>${v.ros != null ? f1(v.ros) : "—"}</b></span><span class="muted" style="font-size:12px">${v.games.length} games through Week ${FANTASY_END}</span></div>
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
    ["When it updates", `<p>Everything rebuilds automatically every <strong>Wednesday at 10am</strong> and <strong>Sunday at 5am</strong> Eastern. Wednesday brings the new week's matchups with every game from the week before; Sunday morning picks up the final injury reports, depth chart changes and the latest kickoff forecast.</p>`],
    ["Where the numbers come from", `<p>Stats, schedules, betting lines, depth charts, injury reports, snap counts and play-by-play come from <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener">nflverse</a>, an open-source NFL data project. Kickoff weather comes from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>. See <a href="#how-it-works">How It Works</a> for how each number is calculated.</p>`],
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
      <li><strong>Trade value</strong>: projected points above a waiver-level replacement at his position (about QB${REPLACEMENT_RANK.QB}, RB${REPLACEMENT_RANK.RB}, WR${REPLACEMENT_RANK.WR}, TE${REPLACEMENT_RANK.TE} in a 12-team, 1-QB league), plus a little for depth. Each side's best player counts in full; extra players count ${DEPTH_WEIGHTS.slice(1, 4).map(w => Math.round(w * 100) + "%").join(", ")} and so on. Within 5% is a fair trade.</li>
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
    ["Data and updates", `<p>Data from <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener">nflverse</a> and <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>, rebuilt every Wednesday at 10am and Sunday at 5am Eastern. Current data: ${D.season} season, stats through Week ${D.statsThrough}.</p>`],
  ], true);
}

function renderPrivacy() {
  $("#page").innerHTML = articlePage("Legal", "Privacy", "Short version: there are no accounts, and nothing you enter leaves your browser.", [
    ["What we store", `<p>Your settings (scoring format), your My Team roster, your Start / Sit players and your trade are saved in your browser's local storage so they're there next time. They stay on your device and aren't sent to us. Clearing your browser data removes them.</p>`],
    ["What we don't collect", `<p>No sign-up, no names or emails, no payment details, and no advertising or analytics trackers.</p>`],
    ["Other services", `<p>To show the site, your browser loads fonts from Google Fonts, player photos from NFL.com and team logos from ESPN. Those services receive standard request information (like your IP address) under their own privacy policies. The site is hosted on GitHub Pages.</p>`],
    ["Changes", `<p>If this changes (for example, if we add analytics), this page will be updated first.</p>`],
  ]);
}

function renderTerms() {
  $("#page").innerHTML = articlePage("Legal", "Terms of Use", "By using The Sports Mattress you agree to these terms.", [
    ["For entertainment and research", `<p>Projections, rankings, grades and trade verdicts are estimates from public data and simple models. They aren't guarantees, and they aren't betting or financial advice. Make your own decisions.</p>`],
    ["Accuracy", `<p>Data comes from third-party sources and is updated on a schedule, so it can be incomplete, delayed or wrong, especially around late injury news. The site is provided "as is", without warranties of any kind.</p>`],
    ["Not affiliated", `<p>The Sports Mattress isn't affiliated with or endorsed by the NFL, its teams, ESPN or any fantasy platform. Team names, logos and player images belong to their owners and are shown for identification only.</p>`],
    ["Data sources", `<p>Stats from <a href="https://github.com/nflverse/nflverse-data" target="_blank" rel="noopener">nflverse</a>. Weather from <a href="https://open-meteo.com/" target="_blank" rel="noopener">Open-Meteo</a>.</p>`],
    ["Changes", `<p>These terms may change; the version on this page is the current one.</p>`],
  ]);
}
})();
