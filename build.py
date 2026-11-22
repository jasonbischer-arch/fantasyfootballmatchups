#!/usr/bin/env python3
"""Build weekly fantasy football matchup charts.

Pulls free NFL data from nflverse (weekly player stats, schedule, depth charts),
works out what every defense allows to QBs, RBs, WRs and TEs, and writes:

  site/index.html                      the website (data embedded)
  site/data.json                       the same data as JSON
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
CACHE = ROOT / ".cache"
OUT = ROOT / "site"

NFLVERSE = "https://github.com/nflverse/nflverse-data/releases/download"
URL_STATS = NFLVERSE + "/stats_player/stats_player_week_{season}.csv"
URL_SCHEDULE = NFLVERSE + "/schedules/games.csv"
URL_DEPTH = NFLVERSE + "/depth_charts/depth_charts_{season}.csv"
URL_INJURIES = NFLVERSE + "/injuries/injuries_{season}.csv"

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


def load_injuries(season: int, week: int) -> dict[str, dict]:
    """This week's official injury report: {gsis_id: {"status", "injury"}}. Empty if unavailable."""
    try:
        path = fetch(URL_INJURIES.format(season=season), f"injuries_{season}.csv")
    except Exception as e:  # the injury file is a nice-to-have
        print(f"  injuries unavailable: {e}", file=sys.stderr)
        return {}
    out = {}
    with open(path, newline="") as f:
        for r in csv.DictReader(f):
            if r["week"] == str(week) and r["game_type"] == "REG" and r["report_status"] not in ("", "NA"):
                out[r["gsis_id"]] = {"status": r["report_status"], "injury": r["report_primary_injury"]}
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

    for r in stats:
        if r["game_id"] not in completed:
            continue
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
            "week": week_no, "team": r["team"], "name": r["player_display_name"], "pos": pos,
            "pts": {f: fantasy_points(r, rp) for f, rp in FORMATS.items()},
            "use": {k: num(r[src]) for k, src in USAGE_SRC.items()},
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

    def players_for(team: str, pos: str) -> list[str]:
        lst = depth.get(team, {}).get(pos, [])[: DEPTH_SHOWN[pos]]
        if not lst:
            return [f"{team} {pos}"]
        if pos == "QB":
            return [short_name(lst[0]["player_name"])]
        if pos == "WR":
            return [short_name(p["player_name"]) for p in lst]
        # RB / TE: starter, plus the backup only if he is splitting work.
        names = [short_name(lst[0]["player_name"])]
        if len(lst) > 1:
            a, b = player_recent.get(lst[0]["gsis_id"]), player_recent.get(lst[1]["gsis_id"])
            a_ppg = a[0] / a[1] if a and a[1] else 0
            b_ppg = b[0] / b[1] if b and b[1] else 0
            if b_ppg and (a_ppg == 0 or b_ppg >= COMMITTEE_SHARE * a_ppg):
                names.append(short_name(lst[1]["player_name"]))
        return names

    positions_out = {}
    for pos in POSITIONS:
        rows = []
        for team in teams:
            row = {"team": team, "players": players_for(team, pos)}
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

    players_out = build_players(plog, depth, injuries, opponent, target)
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
    }


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


def build_players(plog, depth, injuries, opponent, target) -> list[dict]:
    """Per-player season and recent production, for the start/sit comparer."""
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
        if not active or ppg["ppr"] < 3:
            continue
        row = {
            "id": pid, "name": latest["name"], "pos": pos, "team": team, "depth": depth_rank, "g": n,
            "ppg": ppg,
            "l3": {f: round(sum(g["pts"][f] for g in recent) / len(recent), 2) for f in ("ppr", "std")},
            "use": {k: round(sum(g["use"][k] for g in games) / n, 1) for k in USAGE_KEYS[pos]},
            "l3use": {k: round(sum(g["use"][k] for g in recent) / len(recent), 1) for k in USAGE_KEYS[pos]},
            "lastWeek": latest["week"],
        }
        if team in opponent:
            opp, away, kick = opponent[team]
            row.update({"opp": opp, "away": away, "kick": kick})
        else:
            row["bye"] = True
        if pid in injuries:
            row["inj"] = injuries[pid]
        out.append(row)
    out.sort(key=lambda p: -p["ppg"]["ppr"])
    return out


# --------------------------------------------------------------------------- output

def render_html(data: dict, downloads: bool) -> str:
    html = (ROOT / "template" / "index.html").read_text()
    payload = json.dumps(data, separators=(",", ":")).replace("</", "<\\/")
    html = html.replace("/*__DATA__*/null", payload)
    return html.replace("/*__DOWNLOADS__*/true", "true" if downloads else "false")


def write_site(data: dict, preview: Path | None) -> None:
    OUT.mkdir(exist_ok=True)
    (OUT / "data.json").write_text(json.dumps(data, separators=(",", ":")))
    (OUT / "index.html").write_text('<!doctype html>\n<html lang="en">\n' + render_html(data, True) + "\n</html>\n")
    write_xlsx(data)
    print(f"Wrote {OUT / 'index.html'}", file=sys.stderr)
    if preview:
        # Body-only page without download links, for hosts that wrap pages themselves.
        preview.write_text(render_html(data, False))
        print(f"Wrote {preview}", file=sys.stderr)


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
    ap.add_argument("--preview", type=Path, help="also write a body-only preview page to this path")
    args = ap.parse_args()
    data = build(args.season, args.week)
    write_site(data, args.preview)


if __name__ == "__main__":
    main()
