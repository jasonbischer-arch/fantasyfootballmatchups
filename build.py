#!/usr/bin/env python3
"""Build The Sports Mattress: weekly fantasy football matchup charts and tools.

Pulls free NFL data from nflverse (weekly player stats, schedule and betting lines,
depth charts, injury reports, snap counts, play-by-play), works out what every
defense allows to QBs, RBs, WRs and TEs, player usage and team tendencies, and writes:

  site/index.html                      the website
  site/assets/                         stylesheet, script, logo
  site/data.json                       everything the site shows
  site/Week_<N>_Matchups_<FMT>.xlsx    spreadsheet versions (PPR / Half / Standard)

Usage:
  python build.py                 # auto-detect season and upcoming week
  python build.py --week 12       # force a week
  python build.py --season 2025 --week 10
"""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import shutil
import sys
import urllib.request
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Public address of the site (used for share previews, sitemap and the 404 redirect).
# Change this if you move to a custom domain, e.g. "https://thesportsmattress.com/".
SITE_URL = "https://sportsmattress.io/"
# Supabase project for accounts. The anon key is meant to be public: row level security in the
# database limits every signed-in user to their own rows.
SUPABASE_URL = "https://wwqyqvkuaxchfcunajwt.supabase.co"
SUPABASE_ANON_KEY = ("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Ind3cXlxdmt1YXhjaGZjdW5hand0"
                     "Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTU2NTIxMzYsImV4cCI6MjExMTIyODEzNn0.swTtGyHesNC1_35A2XeZWsmSXUHfhpmgeJMb7V1HvN0")
CACHE = ROOT / ".cache"
OUT = ROOT / "site"

NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
URL_STATS = NFLVERSE + "/stats_player/stats_player_week_{season}.csv"
URL_SCHEDULE = NFLVERSE + "/schedules/games.csv"
URL_DEPTH = NFLVERSE + "/depth_charts/depth_charts_{season}.csv"
URL_INJURIES = NFLVERSE + "/injuries/injuries_{season}.csv"
URL_SNAPS = NFLVERSE + "/snap_counts/snap_counts_{season}.csv"
URL_ROSTER = NFLVERSE + "/rosters/roster_{season}.csv"
URL_PLAYERS = NFLVERSE + "/players/players.csv"
URL_PBP = NFLVERSE + "/pbp/play_by_play_{season}.csv.gz"

# Home stadium coordinates, for kickoff weather. Fixed domes are always indoors;
# retractable roofs count as indoors unless the schedule says the roof is open.
STADIUMS = {
    "ARI": (33.5276, -112.2626), "ATL": (33.7554, -84.4008), "BAL": (39.2780, -76.6227), "BUF": (42.7738, -78.7870),
    "CAR": (35.2258, -80.8528), "CHI": (41.8623, -87.6167), "CIN": (39.0955, -84.5161), "CLE": (41.5061, -81.6995),
    "DAL": (32.7473, -97.0945), "DEN": (39.7439, -105.0201), "DET": (42.3400, -83.0456), "GB": (44.5013, -88.0622),
    "HOU": (29.6847, -95.4107), "IND": (39.7601, -86.1639), "JAX": (30.3239, -81.6373), "KC": (39.0489, -94.4839),
    "LA": (33.9535, -118.3392), "LAC": (33.9535, -118.3392), "LV": (36.0909, -115.1833), "MIA": (25.9580, -80.2389),
    "MIN": (44.9737, -93.2581), "NE": (42.0909, -71.2643), "NO": (29.9511, -90.0812), "NYG": (40.8135, -74.0745),
    "NYJ": (40.8135, -74.0745), "PHI": (39.9008, -75.1675), "PIT": (40.4468, -80.0158), "SEA": (47.5952, -122.3316),
    "SF": (37.4030, -121.9700), "TB": (27.9759, -82.5033), "TEN": (36.1665, -86.7713), "WAS": (38.9077, -76.8645),
}
NEUTRAL_STADIUMS = {  # international and neutral-site games, by nflverse stadium_id
    "MEX00": (19.3029, -99.1505), "LON00": (51.5560, -0.2796), "LON02": (51.6043, -0.0664),
    "GER00": (48.2188, 11.6247), "MUN00": (48.2188, 11.6247), "FRA00": (50.0686, 8.6455), "BER00": (52.5147, 13.2395),
    "SAO00": (-23.5453, -46.4742), "DUB00": (53.3607, -6.2511), "MAD00": (40.4531, -3.6883), "MEL00": (-37.8200, 144.9834),
}
FIXED_DOMES = {"DET", "LV", "MIN", "NO", "LA", "LAC"}
RETRACTABLE = {"ARI", "ATL", "DAL", "HOU", "IND"}
URL_WEATHER = ("https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}"
               "&hourly=temperature_2m,precipitation_probability,wind_speed_10m,weather_code"
               "&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FNew_York&past_days=3&forecast_days=16")

TEAM_NAMES = {
    "ARI": "Arizona Cardinals", "ATL": "Atlanta Falcons", "BAL": "Baltimore Ravens", "BUF": "Buffalo Bills",
    "CAR": "Carolina Panthers", "CHI": "Chicago Bears", "CIN": "Cincinnati Bengals", "CLE": "Cleveland Browns",
    "DAL": "Dallas Cowboys", "DEN": "Denver Broncos", "DET": "Detroit Lions", "GB": "Green Bay Packers",
    "HOU": "Houston Texans", "IND": "Indianapolis Colts", "JAX": "Jacksonville Jaguars", "KC": "Kansas City Chiefs",
    "LA": "Los Angeles Rams", "LAC": "Los Angeles Chargers", "LV": "Las Vegas Raiders", "MIA": "Miami Dolphins",
    "MIN": "Minnesota Vikings", "NE": "New England Patriots", "NO": "New Orleans Saints", "NYG": "New York Giants",
    "NYJ": "New York Jets", "PHI": "Philadelphia Eagles", "PIT": "Pittsburgh Steelers", "SEA": "Seattle Seahawks",
    "SF": "San Francisco 49ers", "TB": "Tampa Bay Buccaneers", "TEN": "Tennessee Titans", "WAS": "Washington Commanders",
}

POSITIONS = ["QB", "RB", "WR", "TE"]
FORMATS = {"ppr": 1.0, "half": 0.5, "std": 0.0}
FORMAT_LABEL = {"ppr": "PPR", "half": "Half PPR", "std": "Standard"}

# How many depth-chart players to list per team for each position.
DEPTH_SHOWN = {"QB": 1, "RB": 2, "WR": 3, "TE": 2}
# Show a second RB/TE only when he scores at least this share of the starter's points.
COMMITTEE_SHARE = 0.6
RECENT_GAMES = 3

# Defensive stat columns (all are "allowed per game to this position").
COLUMNS = {
    "QB": [("pass_yds", "Pass Y/G", 1), ("pass_td", "Pass TD/G", 2), ("int", "INT/G", 2)],
    "RB": [
        ("rush_yds", "Rush Y/G", 1), ("rush_td", "Rush TD/G", 2),
        ("rec", "Rec/G", 2), ("rec_yds", "Rec Y/G", 1), ("rec_td", "Rec TD/G", 2),
    ],
    "WR": [("tgt", "Tgt/G", 1), ("rec", "Rec/G", 2), ("rec_yds", "Rec Y/G", 1), ("rec_td", "Rec TD/G", 2)],
    "TE": [("tgt", "Tgt/G", 1), ("rec", "Rec/G", 2), ("rec_yds", "Rec Y/G", 1), ("rec_td", "Rec TD/G", 2)],
}


# --------------------------------------------------------------------------- data

def fetch(url: str, name: str, max_age_hours: float = 6) -> Path:
    """Download url into the cache (reused if fresh)."""
    CACHE.mkdir(exist_ok=True)
    path = CACHE / name
    if path.exists() and (dt.datetime.now().timestamp() - path.stat().st_mtime) < max_age_hours * 3600:
        return path
    print(f"  downloading {url}", file=sys.stderr)
    req = urllib.request.Request(url, headers={"User-Agent": "fantasy-matchups-builder"})
    tmp = path.with_suffix(".part")
    with urllib.request.urlopen(req, timeout=300) as resp, open(tmp, "wb") as f:
        shutil.copyfileobj(resp, f, length=1 << 20)
    tmp.replace(path)
    return path


def num(v) -> float:
    try:
        return float(v) if v not in ("", "NA", None) else 0.0
    except ValueError:
        return 0.0


def fantasy_points(r: dict, rec_pts: float) -> float:
    return (
        0.04 * num(r["passing_yards"]) + 4 * num(r["passing_tds"]) - 2 * num(r["passing_interceptions"])
        + 0.1 * num(r["rushing_yards"]) + 6 * num(r["rushing_tds"])
        + 0.1 * num(r["receiving_yards"]) + 6 * num(r["receiving_tds"]) + rec_pts * num(r["receptions"])
        + 2 * (num(r["passing_2pt_conversions"]) + num(r["rushing_2pt_conversions"]) + num(r["receiving_2pt_conversions"]))
        - 2 * (num(r["sack_fumbles_lost"]) + num(r["rushing_fumbles_lost"]) + num(r["receiving_fumbles_lost"]))
        + 6 * num(r["special_teams_tds"])
    )


def short_name(full: str) -> str:
    parts = full.split()
    if len(parts) < 2:
        return full
    return f"{parts[0][0]}. {' '.join(parts[1:])}"


def norm_pos(p: str) -> str | None:
    p = (p or "").upper()
    if p == "FB":
        return "RB"
    return p if p in POSITIONS else None


def load_schedule(season: int) -> list[dict]:
    path = fetch(URL_SCHEDULE, "games.csv")
    with open(path, newline="") as f:
        return [g for g in csv.DictReader(f) if g["season"] == str(season) and g["game_type"] == "REG"]


def load_stats(season: int) -> list[dict]:
    path = fetch(URL_STATS.format(season=season), f"stats_{season}.csv")
    with open(path, newline="") as f:
        return [r for r in csv.DictReader(f) if r["season_type"] == "REG"]


def load_depth(season: int) -> dict[str, dict[str, list[dict]]]:
    """Latest depth chart per team: {team: {pos: [player rows sorted by rank]}}."""
    path = fetch(URL_DEPTH.format(season=season), f"depth_{season}.csv")
    latest: dict[str, str] = {}
    rows: list[dict] = []
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            if r["pos_abb"] not in POSITIONS:
                continue
            rows.append({k: r[k] for k in ("dt", "team", "player_name", "gsis_id", "pos_abb", "pos_rank")})
            if r["dt"] > latest.get(r["team"], ""):
                latest[r["team"]] = r["dt"]
    depth: dict[str, dict[str, list[dict]]] = defaultdict(lambda: defaultdict(list))
    seen = set()
    for r in rows:
        if r["dt"] != latest[r["team"]]:
            continue
        key = (r["team"], r["pos_abb"], r["gsis_id"])
        if key in seen:
            continue
        seen.add(key)
        depth[r["team"]][r["pos_abb"]].append(r)
    for team in depth.values():
        for lst in team.values():
            lst.sort(key=lambda r: int(num(r["pos_rank"])))
    return depth


def load_roster_status(season: int) -> dict[str, str]:
    """Official roster status per gsis_id (ACT, RES = injured reserve/PUP, CUT, RET, DEV...). Empty if unavailable.

    The weekly injury report leaves out players on IR, so this is how IR players are caught.
    """
    try:
        path = fetch(URL_ROSTER.format(season=season), f"roster_{season}.csv")
    except Exception as e:
        print(f"  roster status unavailable: {e}", file=sys.stderr)
        return {}
    latest: dict[str, tuple[int, str]] = {}
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            wk = int(num(r.get("week")))
            if r["gsis_id"] and wk >= latest.get(r["gsis_id"], (-1, ""))[0]:
                latest[r["gsis_id"]] = (wk, r["status"])
    return {k: v[1] for k, v in latest.items()}


def load_snaps(season: int) -> dict[tuple[str, int], tuple[float, int]]:
    """Offensive snap share per (gsis_id, week). Empty if unavailable."""
    try:
        snaps_path = fetch(URL_SNAPS.format(season=season), f"snaps_{season}.csv")
        players_path = fetch(URL_PLAYERS, "players.csv", max_age_hours=72)
    except Exception as e:
        print(f"  snap counts unavailable: {e}", file=sys.stderr)
        return {}
    pfr_to_gsis = {}
    with open(players_path, newline="") as f:
        for r in csv.DictReader(f):
            if r["pfr_id"] and r["gsis_id"]:
                pfr_to_gsis[r["pfr_id"]] = r["gsis_id"]
    out = {}
    with open(snaps_path, newline="") as f:
        for r in csv.DictReader(f):
            if r["game_type"] != "REG" or num(r["offense_snaps"]) <= 0:
                continue
            gid = pfr_to_gsis.get(r["pfr_player_id"])
            if gid:
                out[(gid, int(r["week"]))] = (num(r["offense_pct"]), int(num(r["offense_snaps"])))
    return out


def load_pbp(season: int, game_ids: set[str]):
    """Red-zone usage per player-week and play-calling tendencies per team-week."""
    import gzip
    player = defaultdict(lambda: defaultdict(float))   # (gsis, week) -> rz_tgt / rz_car / gl_car
    team = defaultdict(lambda: defaultdict(float))     # (team, week) -> plays, dropbacks, neutral..., proe
    try:
        path = fetch(URL_PBP.format(season=season), f"pbp_{season}.csv.gz")
    except Exception as e:
        print(f"  play-by-play unavailable: {e}", file=sys.stderr)
        return player, team
    with gzip.open(path, "rt", newline="") as f:
        for r in csv.DictReader(f):
            if r["game_id"] not in game_ids or r["play_type"] not in ("pass", "run") or r["two_point_attempt"] == "1":
                continue
            wk, pos_team = int(r["week"]), r["posteam"]
            yl = num(r["yardline_100"]) or 99
            dropback = r["qb_dropback"] == "1"
            t = team[(pos_team, wk)]
            t["plays"] += 1
            t["dropbacks"] += dropback
            if yl <= 20:
                t["rz_plays"] += 1
            wp = num(r["wp"]) if r["wp"] not in ("", "NA") else 0.5
            if r["down"] in ("1", "2") and 0.2 <= wp <= 0.8 and r["qtr"] in ("1", "2", "3"):
                t["neutral"] += 1
                t["neutral_pass"] += dropback
            if r["pass_oe"] not in ("", "NA"):
                t["proe_sum"] += num(r["pass_oe"])
                t["proe_n"] += 1
            if yl <= 20:
                if r["pass_attempt"] == "1" and r["receiver_player_id"] not in ("", "NA"):
                    player[(r["receiver_player_id"], wk)]["rz_tgt"] += 1
                if r["rush_attempt"] == "1" and r["rusher_player_id"] not in ("", "NA"):
                    player[(r["rusher_player_id"], wk)]["rz_car"] += 1
                    if yl <= 5:
                        player[(r["rusher_player_id"], wk)]["gl_car"] += 1
            if num(r["air_yards"]) >= 20 and r["pass_attempt"] == "1" and r["receiver_player_id"] not in ("", "NA"):
                player[(r["receiver_player_id"], wk)]["deep_tgt"] += 1
    return player, team


def wx_condition(code: int, hour: int) -> str:
    """Open-Meteo WMO weather code -> icon name."""
    night = hour >= 18 or hour < 6
    if code in (95, 96, 99):
        return "storm"
    if code in (71, 73, 75, 77, 85, 86):
        return "snow"
    if code in (51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82):
        return "rain"
    if code in (45, 48):
        return "fog"
    if code == 3:
        return "cloud"
    if code in (1, 2):
        return "partly-night" if night else "partly"
    return "clear-night" if night else "clear"


def fetch_json(url: str, attempts: int = 4, timeout: int = 20):
    """GET a JSON document, retrying with backoff (the weather API sometimes times out from CI)."""
    import time
    for i in range(attempts):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "fantasy-matchups-builder"})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.load(resp)
        except Exception as e:
            if i == attempts - 1:
                raise
            print(f"  retrying weather request ({e})", file=sys.stderr)
            time.sleep(3 * (i + 1))


def load_weather(games: list[dict]) -> dict[str, dict]:
    """Kickoff forecast per game_id from Open-Meteo (free, no key), in one batched request."""
    out, outdoor = {}, []
    for g in games:
        home, roof = g["home_team"], (g["roof"] or "").lower()
        neutral = g["location"] == "Neutral"
        indoor = roof in ("dome", "closed") or (not neutral and (home in FIXED_DOMES or (home in RETRACTABLE and roof != "open")))
        if indoor:
            out[g["game_id"]] = {"indoor": True}
            continue
        coords = NEUTRAL_STADIUMS.get(g["stadium_id"]) if neutral else STADIUMS.get(home)
        if coords and g["gameday"] and g["gametime"]:
            outdoor.append((g, coords))
    if outdoor:
        url = URL_WEATHER.format(lat=",".join(str(c[0]) for _, c in outdoor), lon=",".join(str(c[1]) for _, c in outdoor))
        try:
            data = fetch_json(url)
            if isinstance(data, dict):
                data = [data]
            for (g, _), loc in zip(outdoor, data):
                hourly = loc["hourly"]
                hh = int(g["gametime"].split(":")[0])    # schedule times are Eastern, as is the API's timezone
                key = f'{g["gameday"]}T{hh:02d}:00'
                if key not in hourly["time"]:
                    continue
                i = hourly["time"].index(key)
                code = int(hourly["weather_code"][i] or 0)
                out[g["game_id"]] = {
                    "temp": round(hourly["temperature_2m"][i]),
                    "wind": round(hourly["wind_speed_10m"][i]),
                    "precip": hourly["precipitation_probability"][i],
                    "cond": wx_condition(code, hh),
                }
        except Exception as e:
            print(f"  weather unavailable: {e}", file=sys.stderr)
    got = sum(1 for v in out.values() if "temp" in v)
    print(f"  weather: {got} of {len(outdoor)} outdoor forecasts, {sum(1 for v in out.values() if v.get('indoor'))} indoor games", file=sys.stderr)
    return out


LAST_INJURY_INFO = {"prev": {}, "teams": set()}


def load_injuries(season: int, week: int) -> dict[str, dict]:
    """This week's official injury report: {gsis_id: {"status", "injury"}}. Empty if unavailable.

    Also records (in LAST_INJURY_INFO) which teams have filed this week's report and last week's
    statuses, so players who sat out last week can show why while this week's report is pending.
    """
    try:
        path = fetch(URL_INJURIES.format(season=season), f"injuries_{season}.csv")
    except Exception as e:  # the injury file is a nice-to-have
        print(f"  injuries unavailable: {e}", file=sys.stderr)
        return {}
    out, prev, teams = {}, {}, set()
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            if r["game_type"] != "REG":
                continue
            if r["week"] == str(week):
                teams.add(r["team"])
                if r["report_status"] not in ("", "NA"):
                    out[r["gsis_id"]] = {"status": r["report_status"], "injury": r["report_primary_injury"]}
            elif r["week"] == str(week - 1) and r["report_status"] not in ("", "NA"):
                prev[r["gsis_id"]] = {"status": r["report_status"], "injury": r["report_primary_injury"], "week": week - 1}
    LAST_INJURY_INFO.update(prev=prev, teams=teams)
    print(f"  injury report: {len(teams)} teams have filed for week {week}", file=sys.stderr)
    return out


# --------------------------------------------------------------------------- analysis

def pick_week(schedule: list[dict]) -> int:
    unplayed = [int(g["week"]) for g in schedule if g["result"] in ("", "NA")]
    return min(unplayed) if unplayed else max(int(g["week"]) for g in schedule)


def build(season: int, week: int | None) -> dict:
    schedule = load_schedule(season)
    if not schedule:
        raise SystemExit(f"No {season} schedule found.")
    target = week or pick_week(schedule)
    prev = target - 1
    print(f"Season {season}, building Week {target}", file=sys.stderr)

    stats = load_stats(season)
    depth = load_depth(season)
    injuries = load_injuries(season, target)
    roster_status = load_roster_status(season)

    completed = {g["game_id"]: g for g in schedule
                 if g["result"] not in ("", "NA") and int(g["week"]) < target}
    games_played: dict[str, int] = defaultdict(int)
    for g in completed.values():
        games_played[g["home_team"]] += 1
        games_played[g["away_team"]] += 1

    # Per (defense, position): season totals and per-week totals.
    tot = defaultdict(lambda: defaultdict(float))            # (def, pos) -> stat -> value
    last = defaultdict(lambda: defaultdict(float))           # (def, pos) -> fmt -> pts in prev week
    last_players = defaultdict(lambda: defaultdict(float))   # (def, pos) -> player -> ppr pts prev week
    # Recent fantasy points per player for committee detection.
    recent_weeks = set(range(max(1, target - RECENT_GAMES), target))
    player_recent = defaultdict(lambda: [0.0, 0])            # gsis -> [ppr pts, games]
    plog = defaultdict(list)                                 # gsis -> list of game entries

    team_game = defaultdict(lambda: defaultdict(float))     # (team, week) -> tgt / air / car
    for r in stats:
        if r["game_id"] not in completed:
            continue
        tg = team_game[(r["team"], int(r["week"]))]
        tg["tgt"] += num(r["targets"])
        tg["air"] += max(0.0, num(r["receiving_air_yards"]))
        tg["car"] += num(r["carries"])
        pos = norm_pos(r["position"])
        defense, week_no = r["opponent_team"], int(r["week"])
        # Pass yards/TDs/INTs allowed count every passer, whatever his position.
        t_all = tot[(defense, "QB")]
        t_all["pass_yds"] += num(r["passing_yards"])
        t_all["pass_td"] += num(r["passing_tds"])
        t_all["int"] += num(r["passing_interceptions"])
        if not pos:
            continue
        plog[r["player_id"]].append({
            "week": week_no, "team": r["team"], "opp": defense, "name": r["player_display_name"], "pos": pos,
            "headshot": r["headshot_url"] if r["headshot_url"] not in ("", "NA") else "",
            "pts": {f: fantasy_points(r, rp) for f, rp in FORMATS.items()},
            "use": {k: num(r[src]) for k, src in USAGE_SRC.items()},
            "air": num(r["receiving_air_yards"]),
        })
        t = tot[(defense, pos)]
        for fmt, rp in FORMATS.items():
            pts = fantasy_points(r, rp)
            t["pts_" + fmt] += pts
            if week_no == prev:
                last[(defense, pos)][fmt] += pts
        if week_no == prev:
            last_players[(defense, pos)][r["player_display_name"]] += fantasy_points(r, 1.0)
        t["rush_yds"] += num(r["rushing_yards"])
        t["rush_td"] += num(r["rushing_tds"])
        t["rec"] += num(r["receptions"])
        t["tgt"] += num(r["targets"])
        t["rec_yds"] += num(r["receiving_yards"])
        t["rec_td"] += num(r["receiving_tds"])
        if week_no in recent_weeks:
            pr = player_recent[r["player_id"]]
            pr[0] += fantasy_points(r, 1.0)
            pr[1] += 1

    teams = sorted({g["home_team"] for g in schedule} | {g["away_team"] for g in schedule})
    prev_opponent = {}
    for g in schedule:
        if int(g["week"]) == prev:
            prev_opponent[g["home_team"]] = g["away_team"]
            prev_opponent[g["away_team"]] = g["home_team"]

    # Defense profile per position and format.
    defense_info: dict[str, dict[str, dict]] = {pos: {} for pos in POSITIONS}
    for pos in POSITIONS:
        for d in teams:
            gp = games_played[d] or 1
            t = tot[(d, pos)]
            stat_src = tot[(d, "QB")] if pos == "QB" else t
            info = {
                "gp": games_played[d],
                "fppg": {f: round(t["pts_" + f] / gp, 2) for f in FORMATS},
                "stats": {k: round(stat_src[k] / gp, 3) for k, _, _ in COLUMNS[pos]},
            }
            if d not in prev_opponent:
                info["pa"] = None
            else:
                players = last_players[(d, pos)]
                total_ppr = last[(d, pos)]["ppr"]
                label = f"{prev_opponent[d]} {pos}"
                if players:
                    top, top_pts = max(players.items(), key=lambda kv: kv[1])
                    if pos == "QB" or pos == "WR" or total_ppr <= 0 or top_pts / total_ppr >= COMMITTEE_SHARE:
                        label = short_name(top)
                info["pa"] = {"pts": {f: round(last[(d, pos)][f], 1) for f in FORMATS}, "who": label,
                              "vs": prev_opponent[d]}
            defense_info[pos][d] = info
        for f in FORMATS:
            order = sorted(teams, key=lambda d: defense_info[pos][d]["fppg"][f])
            for i, d in enumerate(order, 1):
                defense_info[pos][d].setdefault("rank", {})[f] = i

    # This week's games.
    opponent: dict[str, tuple[str, bool, str]] = {}
    for g in schedule:
        if int(g["week"]) == target:
            kick = f'{g["gameday"]} {g["gametime"]}'.strip()
            opponent[g["home_team"]] = (g["away_team"], False, kick)
            opponent[g["away_team"]] = (g["home_team"], True, kick)

    def players_for(team: str, pos: str) -> list[dict]:
        # Skip anyone on injured reserve or no longer on the team, so the next healthy player moves up.
        healthy = [p for p in depth.get(team, {}).get(pos, [])
                   if roster_status.get(p["gsis_id"]) not in GONE_STATUSES | {"RES"}
                   and (injuries.get(p["gsis_id"]) or {}).get("status", "") != "Out"]
        lst = healthy[: DEPTH_SHOWN[pos]]
        if not lst:
            return []
        if pos == "QB":
            chosen = lst[:1]
        elif pos == "WR":
            chosen = lst
        else:
            # RB / TE: starter, plus the backup only if he is splitting work.
            chosen = lst[:1]
            if len(lst) > 1:
                a, b = player_recent.get(lst[0]["gsis_id"]), player_recent.get(lst[1]["gsis_id"])
                a_ppg = a[0] / a[1] if a and a[1] else 0
                b_ppg = b[0] / b[1] if b and b[1] else 0
                if b_ppg and (a_ppg == 0 or b_ppg >= COMMITTEE_SHARE * a_ppg):
                    chosen = lst[:2]
        return chosen

    positions_out = {}
    for pos in POSITIONS:
        rows = []
        for team in teams:
            chosen = players_for(team, pos)
            row = {"team": team, "players": [short_name(p["player_name"]) for p in chosen] or [f"{team} {pos}"],
                   "ids": [p["gsis_id"] for p in chosen]}
            if team in opponent:
                opp, away, kick = opponent[team]
                row.update({"opp": opp, "away": away, "kick": kick, "def": defense_info[pos][opp]})
            else:
                row["bye"] = True
            rows.append(row)
        positions_out[pos] = {
            "columns": [{"key": k, "label": lbl, "dp": dp} for k, lbl, dp in COLUMNS[pos]],
            "rows": rows,
        }

    snaps = load_snaps(season)
    pbp_player, pbp_team = load_pbp(season, set(completed))
    team_weeks = defaultdict(set)
    for g in completed.values():
        team_weeks[g["home_team"]].add(int(g["week"]))
        team_weeks[g["away_team"]].add(int(g["week"]))
    players_out = build_players(plog, depth, injuries, opponent, target, snaps, pbp_player, team_game, team_weeks, roster_status)
    weather = load_weather([g for g in schedule if int(g["week"]) == target])
    teams_out = build_teams(schedule, completed, target, pbp_team, teams, weather)
    league_avg = {pos: {f: round(sum(defense_info[pos][d]["fppg"][f] for d in teams) / len(teams), 2)
                        for f in FORMATS} for pos in POSITIONS}

    return {
        "season": season,
        "week": target,
        "prevWeek": prev,
        "statsThrough": max((int(g["week"]) for g in completed.values()), default=0),
        "updated": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "formats": {k: FORMAT_LABEL[k] for k in FORMATS},
        "positions": positions_out,
        "defenses": {pos: {d: {"rank": v["rank"], "fppg": v["fppg"]} for d, v in by.items()}
                     for pos, by in defense_info.items()},
        "leagueAvg": league_avg,
        "players": players_out,
        "logKeys": LOG_KEYS,
        "teams": teams_out,
        "injuryTeams": sorted(LAST_INJURY_INFO["teams"]),
    }


def build_teams(schedule, completed, target, pbp_team, teams, weather) -> dict:
    """Team context: this week's betting lines, scoring, pace, pass tendencies, remaining schedule."""
    out = {t: {"name": TEAM_NAMES.get(t, t), "sched": [], "pf": 0.0, "pa": 0.0, "g": 0} for t in teams}
    for g in completed.values():
        h, a = g["home_team"], g["away_team"]
        hs, as_ = num(g["home_score"]), num(g["away_score"])
        for t, f, ag in ((h, hs, as_), (a, as_, hs)):
            out[t]["pf"] += f
            out[t]["pa"] += ag
            out[t]["g"] += 1
    for g in schedule:
        wk = int(g["week"])
        h, a = g["home_team"], g["away_team"]
        if wk >= target:
            out[h]["sched"].append([wk, a, 0])
            out[a]["sched"].append([wk, h, 1])
        if wk == target:
            kick = f'{g["gameday"]} {g["gametime"]}'.strip()
            spread, total = g["spread_line"], g["total_line"]
            game = {"kick": kick, "roof": g["roof"] if g["roof"] not in ("", "NA") else ""}
            if g["game_id"] in weather:
                game["wx"] = weather[g["game_id"]]
            if spread not in ("", "NA") and total not in ("", "NA"):
                sp, tot = num(spread), num(total)   # spread_line > 0 means the home team is favored
                game.update({"total": tot})
                out[h].update(game, opp=a, away=False, spread=-sp, implied=round((tot + sp) / 2, 1))
                out[a].update(game, opp=h, away=True, spread=sp, implied=round((tot - sp) / 2, 1))
            else:
                out[h].update(game, opp=a, away=False)
                out[a].update(game, opp=h, away=True)
    agg = defaultdict(lambda: defaultdict(float))
    for (t, wk), v in pbp_team.items():
        for k, x in v.items():
            agg[t][k] += x
    for t, o in out.items():
        g = o["g"] or 1
        a = agg.get(t, {})
        o["ppg"] = round(o.pop("pf") / g, 1)
        o["papg"] = round(o.pop("pa") / g, 1)
        if a:
            o["plays"] = round(a["plays"] / g, 1)
            o["passRate"] = round(a["dropbacks"] / a["plays"], 3) if a["plays"] else None
            o["neutralPass"] = round(a["neutral_pass"] / a["neutral"], 3) if a["neutral"] else None
            o["proe"] = round(a["proe_sum"] / a["proe_n"], 1) if a["proe_n"] else None
            o["rzPlays"] = round(a["rz_plays"] / g, 1)
        o["sched"].sort()
    return out


USAGE_KEYS = {
    "QB": ["att", "pyd", "ptd", "int", "car", "ryd"],
    "RB": ["car", "ryd", "rtd", "tgt", "rec", "recyd"],
    "WR": ["tgt", "rec", "recyd", "rectd"],
    "TE": ["tgt", "rec", "recyd", "rectd"],
}
USAGE_SRC = {
    "att": "attempts", "pyd": "passing_yards", "ptd": "passing_tds", "int": "passing_interceptions",
    "car": "carries", "ryd": "rushing_yards", "rtd": "rushing_tds",
    "tgt": "targets", "rec": "receptions", "recyd": "receiving_yards", "rectd": "receiving_tds",
}


# One row per game in each player's log, in this order.
LOG_KEYS = ["wk", "opp", "snap", "pts", "ptsStd", "tgt", "rec", "recyd", "car", "ryd",
            "att", "pyd", "ptd", "int", "td", "rz", "tgtShare"]


def share(part: float, whole: float) -> float | None:
    return round(part / whole, 3) if whole else None


GONE_STATUSES = {"CUT", "RET", "RLS", "TRC", "EXE", "UFA", "UDF"}   # no longer on a team


def build_players(plog, depth, injuries, opponent, target, snaps, pbp_player, team_game, team_weeks, roster_status=None) -> list[dict]:
    roster_status = roster_status or {}
    """Per-player production, usage shares and game logs."""
    depth_team = {}
    for team, by_pos in depth.items():
        for pos, lst in by_pos.items():
            for i, p in enumerate(lst):
                depth_team.setdefault(p["gsis_id"], (team, pos, i + 1))
    out = []
    for pid, games in plog.items():
        games.sort(key=lambda g: g["week"])
        latest = games[-1]
        team, pos, depth_rank = depth_team.get(pid, (latest["team"], latest["pos"], None))
        if pos == "FB":
            pos = "RB"
        if pos not in POSITIONS:
            continue
        recent = games[-RECENT_GAMES:]
        n = len(games)
        ppg = {f: round(sum(g["pts"][f] for g in games) / n, 2) for f in ("ppr", "std")}
        # Keep anyone on a current depth chart or who has been playing lately and producing.
        active = depth_rank is not None or latest["week"] >= target - 3
        if not active or ppg["ppr"] < 2:
            continue

        def usage(gs):
            """Shares over a set of games: player total / team total in the games he played."""
            tt = {k: sum(team_game[(g["team"], g["week"])][k] for g in gs) for k in ("tgt", "air", "car")}
            pt = sum(g["use"]["tgt"] for g in gs)
            pa = sum(max(0.0, g["air"]) for g in gs)
            pc = sum(g["use"]["car"] for g in gs)
            sn = [snaps[(pid, g["week"])][0] for g in gs if (pid, g["week"]) in snaps]
            rz = [pbp_player.get((pid, g["week"]), {}) for g in gs]
            ts, ash = share(pt, tt["tgt"]), share(pa, tt["air"])
            return {
                "snap": round(sum(sn) / len(sn), 3) if sn else None,
                "tgtShare": ts, "airShare": ash,
                "wopr": round(1.5 * ts + 0.7 * ash, 3) if ts is not None and ash is not None else None,
                "rushShare": share(pc, tt["car"]),
                "rzTgt": round(sum(x.get("rz_tgt", 0) for x in rz) / len(gs), 2),
                "rzCar": round(sum(x.get("rz_car", 0) for x in rz) / len(gs), 2),
                "glCar": round(sum(x.get("gl_car", 0) for x in rz) / len(gs), 2),
                "deepTgt": round(sum(x.get("deep_tgt", 0) for x in rz) / len(gs), 2),
            }

        log = []
        for g in games:
            u, tg = g["use"], team_game[(g["team"], g["week"])]
            sn = snaps.get((pid, g["week"]))
            rz = pbp_player.get((pid, g["week"]), {})
            log.append([
                g["week"], g["opp"], round(sn[0], 2) if sn else None,
                round(g["pts"]["ppr"], 1), round(g["pts"]["std"], 1),
                int(u["tgt"]), int(u["rec"]), int(u["recyd"]), int(u["car"]), int(u["ryd"]),
                int(u["att"]), int(u["pyd"]), int(u["ptd"]), int(u["int"]), int(u["rtd"] + u["rectd"]),
                int(rz.get("rz_tgt", 0) + rz.get("rz_car", 0)), share(u["tgt"], tg["tgt"]),
            ])
        row = {
            "id": pid, "name": latest["name"], "pos": pos, "team": team, "depth": depth_rank, "g": n,
            "ppg": ppg,
            "l3": {f: round(sum(g["pts"][f] for g in recent) / len(recent), 2) for f in ("ppr", "std")},
            "use": {k: round(sum(g["use"][k] for g in games) / n, 1) for k in USAGE_KEYS[pos]},
            "l3use": {k: round(sum(g["use"][k] for g in recent) / len(recent), 1) for k in USAGE_KEYS[pos]},
            "lastWeek": latest["week"],
            # Team games played since his last appearance (e.g. 1 = sat out the most recent game).
            "missed": sum(1 for w in team_weeks.get(team, ()) if w > latest["week"]),
            "season": usage(games),
            "recent": usage(recent),
            "log": log,
        }
        if latest["headshot"]:
            # Ask the image CDN for a small thumbnail instead of the full-size photo.
            row["img"] = latest["headshot"].replace("/upload/f_auto,q_auto/", "/upload/f_auto,q_auto,w_120/")
        if team in opponent:
            opp, away, kick = opponent[team]
            row.update({"opp": opp, "away": away, "kick": kick})
        else:
            row["bye"] = True
        status = roster_status.get(pid)
        if status in GONE_STATUSES:
            continue
        if pid in injuries:
            row["inj"] = injuries[pid]
        elif row["missed"] >= 1 and pid in LAST_INJURY_INFO["prev"]:
            row["injPrev"] = LAST_INJURY_INFO["prev"][pid]      # why he sat out last week
        if status == "RES":     # injured reserve, PUP or another reserve list: out
            row["inj"] = {"status": "IR", "injury": (injuries.get(pid) or {}).get("injury", "")}
        out.append(row)
    out.sort(key=lambda p: -p["ppg"]["ppr"])
    return out


# --------------------------------------------------------------------------- output

# Every public page gets its own URL, title, description and crawlable fallback content.
# (route, title, description, h1, intro, indexable)
def site_routes(data: dict) -> list[tuple]:
    wk, season = data["week"], data["season"]
    pos_names = {"qb": "Quarterback", "rb": "Running Back", "wr": "Wide Receiver", "te": "Tight End"}
    routes = [("home", "The Sports Mattress · Fantasy Football Matchups, Start/Sit and Trade Analyzer",
               f"Free fantasy football tools for Week {wk}: color-coded matchup charts, start/sit calls, a trade analyzer, "
               "snap and target share, strength of schedule and kickoff weather. Updated every morning.",
               f"Week {wk} fantasy football matchups",
               "Every NFL defense ranked by the fantasy points it allows to quarterbacks, running backs, receivers and tight "
               "ends, plus start/sit calls, a trade analyzer, usage stats and rest-of-season schedules.", True)]
    for slug, name in pos_names.items():
        P = slug.upper()
        routes.append((slug, f"Week {wk} {P} Matchups: Fantasy Points Allowed by Defense · The Sports Mattress",
                       f"Week {wk} {name.lower()} matchup chart: every defense ranked by fantasy points allowed to {P}s, with "
                       f"per-game stats allowed, last week's results, team totals and kickoff weather. PPR, half PPR and standard.",
                       f"Week {wk} {P} matchups",
                       f"How each team's {name.lower()}s line up against this week's opponent, color-coded from tough to great.", True))
    routes += [
        ("start-sit", "Start/Sit Tool: Compare Two Players · The Sports Mattress",
         f"Who should you start in Week {wk}? Compare any two players with matchup-adjusted projections, usage, injuries, "
         "team totals and a clear verdict.", "Start / Sit", "Compare any two players, at any position, and get a verdict with the reasons.", True),
        ("my-team", "Fantasy Lineup Optimizer · The Sports Mattress",
         f"Add your fantasy roster and get your best Week {wk} lineup, ranked by matchup-adjusted projection. Supports 3 WR, 2 flex and superflex.",
         "My Team", "Build your roster and get this week's best lineup.", True),
        ("trade", "Fantasy Football Trade Analyzer · The Sports Mattress",
         "Analyze any fantasy football trade: rest-of-season and playoff value, buy-low and sell-high timing, hot and cold form, "
         "usage trends and strength of schedule for every player.", "Trade Analyzer",
         "Put in a trade and see who wins it, and whether now is the time to buy or sell.", True),
        ("players", "Player Usage: Snap Share, Target Share and WOPR · The Sports Mattress",
         f"{season} fantasy football usage stats: snap share, target share, air yards share, WOPR, rush share and red-zone "
         "opportunities for every fantasy-relevant player.", "Player usage", "Snap share, target share, air yards, WOPR and red-zone chances.", True),
        ("schedule", "Fantasy Football Strength of Schedule by Position · The Sports Mattress",
         "Rest-of-season strength of schedule for QB, RB, WR and TE: every remaining opponent colored by fantasy points allowed, "
         "with next-4 and fantasy playoff averages.", "Strength of schedule", "Who each team faces the rest of the way, by position.", True),
        ("teams", "NFL Team Tendencies: Pace, Pass Rate and Projected Points · The Sports Mattress",
         f"Week {wk} NFL team tendencies for fantasy football: projected points from betting lines, plays per game, pass rate, "
         "neutral pass rate and pass rate over expected.", "Team tendencies", "Which offenses run the most plays, throw the most and are projected to score.", True),
        ("about", "About · The Sports Mattress", "The Sports Mattress is a free fantasy football research site built around weekly matchup charts.",
         "About", "Matchups you can sleep on.", True),
        ("how-it-works", "How It Works: Methodology · The Sports Mattress",
         "How The Sports Mattress calculates matchup ranks, projections, start/sit calls, trade values, usage stats and strength of schedule.",
         "How It Works", "What every number on the site means and how it's calculated.", True),
        ("privacy", "Privacy · The Sports Mattress", "What The Sports Mattress stores, why, and how to delete it.", "Privacy", "", True),
        ("terms", "Terms of Use · The Sports Mattress", "Terms of use for The Sports Mattress.", "Terms of Use", "", True),
    ]
    for slug, t in (("login", "Log in"), ("signup", "Create account"), ("forgot", "Reset password"), ("reset", "Set new password"), ("account", "Your account")):
        routes.append((slug, f"{t} · The Sports Mattress", "Your free The Sports Mattress account.", t, "", False))
    return routes


def esc_html(text: str) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def render_html(downloads: bool, build_id: str, clean: bool = False, base: str = "", route=None, routes=None) -> str:
    html = (ROOT / "template" / "index.html").read_text()
    route = route or ("home", "The Sports Mattress", "", "", "", True)
    slug, title, desc, h1, intro, indexable = route
    url = SITE_URL if slug == "home" else f"{SITE_URL}{slug}/"
    html = html.replace("__TITLE__", esc_html(title)).replace("__DESC__", esc_html(desc)).replace("__CANONICAL__", url)
    html = html.replace("<!--__ROBOTS__-->", "" if indexable else '<meta name="robots" content="noindex, follow">')
    head_extra = ""
    if slug == "home":
        ld = {"@context": "https://schema.org", "@graph": [
            {"@type": "WebSite", "@id": SITE_URL + "#website", "name": "The Sports Mattress", "alternateName": "Sports Mattress",
             "url": SITE_URL, "description": desc, "inLanguage": "en-US", "publisher": {"@id": SITE_URL + "#org"}},
            {"@type": "Organization", "@id": SITE_URL + "#org", "name": "The Sports Mattress", "url": SITE_URL,
             "logo": {"@type": "ImageObject", "url": SITE_URL + "assets/icon-512.png", "width": 512, "height": 512}},
            {"@type": "WebApplication", "name": "The Sports Mattress", "url": SITE_URL, "applicationCategory": "SportsApplication",
             "operatingSystem": "Any", "offers": {"@type": "Offer", "price": "0", "priceCurrency": "USD"},
             "description": "Fantasy football matchup charts, start/sit tool, trade analyzer and usage stats."}]}
        head_extra = '<script type="application/ld+json">' + json.dumps(ld, separators=(",", ":")).replace("</", "<\\/") + "</script>"
    elif indexable:
        crumbs = {"@context": "https://schema.org", "@type": "BreadcrumbList", "itemListElement": [
            {"@type": "ListItem", "position": 1, "name": "Home", "item": SITE_URL},
            {"@type": "ListItem", "position": 2, "name": h1, "item": url}]}
        head_extra = '<script type="application/ld+json">' + json.dumps(crumbs, separators=(",", ":")) + "</script>"
    html = html.replace("<!--__HEAD_EXTRA__-->", head_extra)
    # Crawlable fallback shown until the app renders (and to clients without JavaScript).
    links = "".join(f'<li><a href="{base or "/"}{"" if r[0] == "home" else r[0] + "/"}">{esc_html(r[3])}</a></li>'
                    for r in (routes or []) if r[5] and r[0] not in ("privacy", "terms")) if clean else ""
    fallback = (f'<div class="seo-fallback"><h1>{esc_html(h1)}</h1>' + (f"<p>{esc_html(intro)}</p>" if intro else "")
                + '<p class="loading">Loading this week\'s data…</p>' + (f'<ul class="seo-links">{links}</ul>' if links else "")
                + "<noscript><p>The Sports Mattress needs JavaScript to show its charts and tools.</p></noscript></div>")
    html = html.replace("<!--__FALLBACK__-->", fallback)
    html = html.replace("__BUILD__", build_id).replace("__SITE_URL__", SITE_URL).replace("__BASE__", base)
    html = html.replace("/*__SUPABASE__*/null", json.dumps({"url": SUPABASE_URL, "key": SUPABASE_ANON_KEY, "site": SITE_URL}))
    html = html.replace("/*__CLEAN__*/false", "true" if clean else "false")
    html = html.replace("/*__TITLES__*/null", json.dumps({r[0]: r[1] for r in (routes or [])}).replace("</", "<\\/"))
    return html.replace("/*__DOWNLOADS__*/true", "true" if downloads else "false")


def write_ico(png_path: Path, ico_path: Path) -> None:
    """favicon.ico holding one 32x32 PNG (supported by every current browser)."""
    import struct
    png = png_path.read_bytes()
    header = struct.pack("<HHH", 0, 1, 1) + struct.pack("<BBBBHHII", 32, 32, 0, 0, 1, 32, len(png), 6 + 16)
    ico_path.write_bytes(header + png)


def write_site(data: dict, preview: Path | None) -> None:
    OUT.mkdir(exist_ok=True)
    build_id = data["updated"].replace(":", "").replace("-", "")
    payload = json.dumps(data, separators=(",", ":"))
    (OUT / "data.json").write_text(payload)
    shutil.copytree(ROOT / "template" / "assets", OUT / "assets", dirs_exist_ok=True)
    routes = site_routes(data)
    for r in routes:
        page = '<!doctype html>\n<html lang="en">\n' + render_html(True, build_id, clean=True, base="/", route=r, routes=routes) + "\n</html>\n"
        target = OUT / "index.html" if r[0] == "home" else OUT / r[0] / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(page)
    write_xlsx(data)
    write_ico(ROOT / "template" / "assets" / "icon-32.png", OUT / "favicon.ico")
    (OUT / "site.webmanifest").write_text(json.dumps({
        "name": "The Sports Mattress", "short_name": "Sports Mattress",
        "description": "Fantasy football matchup charts, start/sit, trade analyzer and usage stats.",
        "start_url": "/", "scope": "/", "display": "standalone", "background_color": "#111a2a", "theme_color": "#111a2a",
        "icons": [{"src": "/assets/icon-192.png", "sizes": "192x192", "type": "image/png"},
                  {"src": "/assets/icon-512.png", "sizes": "512x512", "type": "image/png"},
                  {"src": "/assets/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable"}],
    }, indent=1))
    today = dt.date.today().isoformat()
    (OUT / "robots.txt").write_text(f"User-agent: *\nAllow: /\nDisallow: /account/\n\nSitemap: {SITE_URL}sitemap.xml\n")
    prio = {"home": "1.0", "trade": "0.9", "qb": "0.9", "rb": "0.9", "wr": "0.9", "te": "0.9", "start-sit": "0.9", "my-team": "0.8",
            "players": "0.8", "schedule": "0.8", "teams": "0.7"}
    urls = "".join(f"  <url><loc>{SITE_URL if r[0] == 'home' else SITE_URL + r[0] + '/'}</loc><lastmod>{today}</lastmod>"
                   f"<changefreq>daily</changefreq><priority>{prio.get(r[0], '0.4')}</priority></url>\n" for r in routes if r[5])
    (OUT / "sitemap.xml").write_text('<?xml version="1.0" encoding="UTF-8"?>\n'
                                     '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls + "</urlset>\n")
    # Real 404 page (GitHub Pages serves it with a 404 status) with links back into the site.
    (OUT / "404.html").write_text(
        '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
        '<title>Page not found · The Sports Mattress</title><meta name="robots" content="noindex">'
        '<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="stylesheet" href="/assets/app.css">'
        '<style>.nf{max-width:640px;margin:0 auto;padding:80px 20px;display:grid;gap:16px}.nf a.btn{width:fit-content}</style></head>'
        '<body><main class="nf"><a class="wordmark" href="/" style="text-decoration:none;font-size:34px">The Sports Mattress</a>'
        '<h1>Page not found</h1><p class="lede">That page doesn\'t exist or has moved.</p>'
        '<p><a class="btn primary" href="/">Go to this week\'s matchups</a></p>'
        '<p class="muted">Or try the <a href="/trade/">Trade Analyzer</a>, <a href="/start-sit/">Start / Sit</a> or <a href="/qb/">matchup charts</a>.</p>'
        "</main></body></html>\n")
    print(f"Wrote {OUT / 'index.html'} and {len(routes) - 1} more pages", file=sys.stderr)
    if preview:
        # Body-only copy without download links, for hosts that wrap pages themselves (uses #routes).
        preview.mkdir(parents=True, exist_ok=True)
        (preview / "index.html").write_text(render_html(False, build_id, clean=False, base="", route=routes[0], routes=routes))
        (preview / "data.json").write_text(payload)
        shutil.copytree(ROOT / "template" / "assets", preview / "assets", dirs_exist_ok=True)
        print(f"Wrote preview to {preview}", file=sys.stderr)


def sorted_rows(rows: list[dict], fmt: str) -> list[dict]:
    playing = [r for r in rows if not r.get("bye")]
    playing.sort(key=lambda r: (-r["def"]["rank"][fmt], -r["def"]["fppg"][fmt]))
    return playing + [r for r in rows if r.get("bye")]


def write_xlsx(data: dict) -> None:
    try:
        from openpyxl import Workbook
        from openpyxl.formatting.rule import ColorScaleRule
        from openpyxl.styles import Alignment, Font, PatternFill
        from openpyxl.utils import get_column_letter
    except ImportError:
        print("openpyxl not installed; skipping .xlsx files", file=sys.stderr)
        return
    head_fill = PatternFill("solid", fgColor="A4C2F4")
    bye_fill = PatternFill("solid", fgColor="B7E1CD")
    bold = Font(bold=True)
    week, prev = data["week"], data["prevWeek"]
    for fmt, fmt_label in data["formats"].items():
        wb = Workbook()
        wb.remove(wb.active)
        for pos in POSITIONS:
            block = data["positions"][pos]
            ws = wb.create_sheet(pos)
            heads = [pos, "OPPONENT", "RANK", "FPPG ALLOWED", f"PA WK {prev}"] + [c["label"].upper() for c in block["columns"]]
            ws.append(heads)
            rows = sorted_rows(block["rows"], fmt)
            for r in rows:
                name = "/".join(r["players"])
                if r.get("bye"):
                    ws.append([name, "BYE", "BYE", "BYE", "BYE"])
                    for c in ws[ws.max_row][:5]:
                        c.fill = bye_fill
                    continue
                d = r["def"]
                pa = "BYE" if d["pa"] is None else f'{d["pa"]["pts"][fmt]:g} ({d["pa"]["who"]})'
                ws.append([name, ("@" if r["away"] else "") + r["opp"], d["rank"][fmt], d["fppg"][fmt], pa]
                          + [round(d["stats"][c["key"]], c["dp"]) for c in block["columns"]])
            n_play = sum(1 for r in rows if not r.get("bye"))
            for row in ws.iter_rows():
                for c in row:
                    c.font = bold
                    c.alignment = Alignment(horizontal="left" if c.column == 1 else "center")
            for c in ws[1]:
                c.fill = head_fill
            if n_play:
                last_row = n_play + 1
                ws.conditional_formatting.add(f"C2:D{last_row}", ColorScaleRule(
                    start_type="min", start_color="E67C73", mid_type="percentile", mid_value=50,
                    mid_color="F6B26B", end_type="max", end_color="57BB8A"))
                for col in range(6, len(heads) + 1):
                    L = get_column_letter(col)
                    ws.conditional_formatting.add(f"{L}2:{L}{last_row}", ColorScaleRule(
                        start_type="min", start_color="E67C73", mid_type="percentile", mid_value=50,
                        mid_color="FFD966", end_type="max", end_color="57BB8A"))
            ws.append([])
            ws.append([f"STATS ARE ALLOWED PER GAME BY THE OPPONENT TO {pos}s"])
            ws.append([f"1 = FEWEST {fmt_label.upper()} POINTS ALLOWED TO {pos}"])
            ws.append([f"32 = MOST {fmt_label.upper()} POINTS ALLOWED TO {pos}"])
            widths = [24, 11, 7, 14, 20] + [12] * len(block["columns"])
            for i, w in enumerate(widths, 1):
                ws.column_dimensions[get_column_letter(i)].width = w
            ws.freeze_panes = "B2"
        name = f"Week_{week}_Matchups_{FORMAT_LABEL[fmt].replace(' ', '_')}.xlsx"
        wb.save(OUT / name)


def default_season() -> int:
    today = dt.date.today()
    return today.year if today.month >= 3 else today.year - 1


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--season", type=int, default=default_season())
    ap.add_argument("--week", type=int)
    ap.add_argument("--preview", type=Path, help="also write a body-only preview site into this folder")
    args = ap.parse_args()
    data = build(args.season, args.week)
    write_site(data, args.preview)


if __name__ == "__main__":
    main()
