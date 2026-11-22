# Weekly Fantasy Matchup Charts

A website that rebuilds QB, RB, WR and TE matchup charts automatically each week.
It shows each team's starters, their opponent, how that defense ranks in fantasy
points allowed to the position, what the defense gave up last week (and to whom),
and per-game stats the defense allows. Cells are color-coded red (tough) to green (great).

Data comes free from [nflverse](https://github.com/nflverse/nflverse-data): weekly player
stats, the schedule, daily depth charts, and injury reports. No API keys.

## What's on each chart

| Position | Columns (allowed per game by the opponent to that position) |
|---|---|
| QB | Rank, FPPG, PA last week, Pass Y/G, Pass TD/G, INT/G |
| RB | Rank, FPPG, PA last week, Rush Y/G, Rush TD/G, Rec/G, Rec Y/G, Rec TD/G |
| WR | Rank, FPPG, PA last week, Tgt/G, Rec/G, Rec Y/G, Rec TD/G |
| TE | Rank, FPPG, PA last week, Tgt/G, Rec/G, Rec Y/G, Rec TD/G |

Rank 1 = fewest fantasy points allowed, 32 = most. Switch between PPR, Half PPR and Standard
on the page. Teams on bye are listed at the bottom. Each build also writes `.xlsx` spreadsheets
in the same style as the original hand-made charts.

## Start / Sit

The **Start / Sit** tab compares any two players, at any position, so it works for flex spots. It gives a verdict
with plain-language reasons and a side-by-side breakdown:

- **Projection:** the player's own points per game (60% season average, 40% last 3 games), adjusted for how
  many points his opponent allows to his position compared with the league average. The matchup effect
  is halved and capped at ±25% because defensive samples are small. Under 1 point apart is called a toss-up.
- **Matchup:** opponent, matchup rank, points allowed per game, and the size of the adjustment.
- **Production and usage:** points per game, last 3 games, and per-game usage (targets, carries, yards, TDs).
- **Injuries:** status from the official weekly injury report. Players who are out or on bye can't be started.

## Run it locally

```bash
pip install -r requirements.txt
python build.py            # upcoming week
python build.py --week 12  # or a specific week
```

Then open `site/index.html`.

## Publish it (free, updates itself)

1. Create a GitHub repository and push this folder to `main`.
2. In the repo, go to **Settings → Pages** and set **Source** to **GitHub Actions**.
3. The workflow in `.github/workflows/update.yml` runs every **Wednesday at 10am** and **Sunday at 5am** (US Eastern) and on every push,
   and publishes to `https://<your-user>.github.io/<repo>/`.
4. To rebuild by hand, open **Actions → Update matchup charts → Run workflow**.

## Tweaking

Settings at the top of `build.py`:

- `DEPTH_SHOWN`: how many players to list per team (QB 1, RB 2, WR 3, TE 2).
- `COMMITTEE_SHARE`: a backup RB/TE is listed when he scores at least this share of the starter's points over the last 3 games.
- `COLUMNS`: which defensive stats appear per position.
- `fantasy_points()`: the scoring rules (4 pt passing TD by default).
