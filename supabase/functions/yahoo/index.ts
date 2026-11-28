// Yahoo Fantasy import for The Sports Mattress.
// GET  -> { configured, client_id }            (the client ID is public; the secret never leaves this function)
// POST { code, redirect_uri } -> { leagues: [...] }
// The code from Yahoo's login is exchanged for a short-lived access token, used once to read the user's NFL
// teams, rosters and league settings, then dropped. Nothing is stored.
const CLIENT_ID = Deno.env.get("YAHOO_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("YAHOO_CLIENT_SECRET") ?? "";
const ORIGINS = ["https://sportsmattress.io", "https://www.sportsmattress.io", "http://localhost:8765"];
const REDIRECTS = ["https://sportsmattress.io/yahoo/"];
const API = "https://fantasysports.yahooapis.com/fantasy/v2";

function cors(req: Request) {
  const o = req.headers.get("origin") ?? "";
  return {
    "Access-Control-Allow-Origin": ORIGINS.includes(o) ? o : ORIGINS[0],
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Vary": "Origin",
  };
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });
}

// Yahoo's JSON mixes "fragment" arrays (merge them), lists of same-key objects (keep), and {"0":..,"count":n} maps.
// deno-lint-ignore no-explicit-any
function flat(x: any): any {
  if (Array.isArray(x)) {
    const fl = x.map(flat);
    const objs = fl.filter((o) => o && typeof o === "object" && !Array.isArray(o));
    const ks = objs.map((o) => Object.keys(o));
    if (objs.length > 1 && objs.length === fl.length && ks.every((k) => k.length === 1) && new Set(ks.map((k) => k[0])).size === 1) return fl;
    const out: Record<string, unknown> = {};
    for (const f of fl) if (f && typeof f === "object" && !Array.isArray(f)) Object.assign(out, f);
    return out;
  }
  if (x && typeof x === "object") {
    const keys = Object.keys(x);
    if (keys.length && keys.every((k) => /^\d+$/.test(k) || k === "count")) {
      return keys.filter((k) => /^\d+$/.test(k)).sort((a, b) => +a - +b).map((k) => flat(x[k]));
    }
    const o: Record<string, unknown> = {};
    for (const k of keys) if (!/^\d+$/.test(k)) o[k] = flat(x[k]);
    for (const k of keys) {
      if (!/^\d+$/.test(k)) continue;
      const f = flat(x[k]);
      if (f && typeof f === "object" && !Array.isArray(f)) Object.assign(o, f); else o[k] = f;
    }
    return o;
  }
  return x;
}
// deno-lint-ignore no-explicit-any
const list = (v: any, key: string): any[] =>
  (Array.isArray(v) ? v : v && typeof v === "object" ? [v] : []).map((it) => (it && it[key]) ?? it).filter(Boolean);

async function yget(path: string, token: string) {
  const r = await fetch(`${API}${path}${path.includes("?") ? "&" : "?"}format=json`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Yahoo API ${r.status} on ${path}`);
  return flat((await r.json()).fantasy_content);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors(req) });
  if (req.method === "GET") return json(req, { configured: !!(CLIENT_ID && CLIENT_SECRET), client_id: CLIENT_ID || null });
  if (req.method !== "POST") return json(req, { error: "method" }, 405);
  if (!CLIENT_ID || !CLIENT_SECRET) return json(req, { error: "Yahoo import isn't set up yet." }, 503);
  let body: { code?: string; redirect_uri?: string };
  try { body = await req.json(); } catch { return json(req, { error: "Bad request" }, 400); }
  const code = String(body.code ?? ""), redirect = String(body.redirect_uri ?? "");
  if (!/^[A-Za-z0-9._~-]{4,512}$/.test(code) || !REDIRECTS.includes(redirect)) return json(req, { error: "Bad request" }, 400);

  // 1. Code -> access token.
  const tr = await fetch("https://api.login.yahoo.com/oauth2/get_token", {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${CLIENT_ID}:${CLIENT_SECRET}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirect }),
  });
  if (!tr.ok) {
    console.log("token exchange failed", tr.status, (await tr.text()).slice(0, 300));
    return json(req, { error: "Yahoo didn't accept the login. Try connecting again." }, 400);
  }
  const token = (await tr.json()).access_token as string;

  try {
    // 2. This user's teams in the current NFL game.
    const u = await yget("/users;use_login=1/games;game_keys=nfl/teams", token);
    const user = list(u.users, "user")[0] ?? {};
    const game = list(user.games, "game")[0] ?? {};
    const myTeams = list(game.teams, "team");
    if (!myTeams.length) return json(req, { leagues: [], season: game.season ?? null });
    const leagueKeys = [...new Set(myTeams.map((t) => String(t.team_key).split(".t.")[0]))];

    // 3. Settings and every team's roster (for trade partners), per league.
    const leagues = [];
    for (const lk of leagueKeys.slice(0, 12)) {
      const [s, r] = await Promise.all([yget(`/league/${lk}/settings`, token), yget(`/league/${lk}/teams/roster`, token)]);
      const lg = s.league ?? {};
      const settings = (Array.isArray(lg.settings) ? lg.settings[0] : lg.settings) ?? {};
      const positions = list(settings.roster_positions, "roster_position").map((p) => ({ position: String(p.position), count: +p.count || 0 }));
      const mods = list(settings.stat_modifiers?.stats, "stat");
      const rec = +(mods.find((m) => String(m.stat_id) === "11")?.value ?? 0);
      const teams = list((r.league ?? {}).teams, "team").map((t) => ({
        team_key: String(t.team_key),
        name: String(t.name ?? "Team"),
        mine: myTeams.some((m) => String(m.team_key) === String(t.team_key)),
        players: list(t.roster?.players, "player").map((p) => ({
          id: String(p.player_id ?? ""),
          name: String(p.name?.full ?? ""),
          pos: String(p.primary_position ?? p.display_position ?? ""),
          team: String(p.editorial_team_abbr ?? "").toUpperCase(),
        })),
      }));
      leagues.push({ league_key: lk, name: String(lg.name ?? "Yahoo league"), num_teams: +lg.num_teams || teams.length, rec, positions, teams });
    }
    return json(req, { leagues, season: game.season ?? null });
  } catch (e) {
    console.log("yahoo read failed", String((e as Error).message));
    return json(req, { error: "Yahoo didn't respond. Try again in a minute." }, 502);
  }
});
