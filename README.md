# The Sports Mattress

Fantasy football matchup charts and tools that rebuild themselves every week.
Live at **https://jasonbischer-arch.github.io/fantasyfootballmatchups/**

The logo is a quilted mattress whose panels run from red (tough matchup) to green (great matchup),
the same scale used across the site.

## Pages

| Page | What it does |
|---|---|
| **Home** | Best matchups at each position, the game slate with projected team points from betting lines, usage risers, injury watch. |
| **Matchups** | The color-coded QB / RB / WR / TE matchup charts: opponent, rank (by fantasy points allowed), team projected points, last week's points allowed and to whom, plus per-game stats the defense allows. Downloadable as `.xlsx`. |
| **Start / Sit** | Compare any two players (any positions). Verdict with reasons, matchup-adjusted projection, matchup rank, usage, injuries. |
| **My Team** | Enter your roster (saved in your browser) and get the best lineup for the week. Supports 3 WR, 2 flex and superflex. |
| **Trade Analyzer** | Put players on each side of a trade and get a verdict: rest-of-season and playoff value (schedule, injuries and 2-for-1 depth included), a value meter, reasons, and players to ask for to balance it. Each player gets a card with trade timing (sell high / buy low), hot or cold form, usage trends, boom/bust rate, touchdown dependence and the next 4 and playoff opponents, plus a color-coded head-to-head table. |
| **Players** | Snap %, target share, air yards share, WOPR, rush share, red-zone opportunities, per-game volume, and next opponent for every fantasy-relevant player. Click anyone for a game log and chart. |
| **Schedule** | Rest-of-season strength of schedule by position: each week's opponent colored by how much it allows, with next-4, rest-of-season and Weeks 15–17 (fantasy playoffs) averages. |
| **Teams** | Projected points, spread, total, points scored/allowed, plays per game, pass rate, neutral-situation pass rate, pass rate over expected, red-zone plays. |

Scoring format (PPR / Half PPR / Standard) switches everywhere from the header.

## Accounts

Optional free accounts run on [Supabase](https://supabase.com/) (project `the-sports-mattress`). The site stays a
static GitHub Pages site; the browser talks to Supabase directly.

- **What's saved:** profile (display name), settings (scoring format, league size, superflex), teams (several per
  account, each with a roster and lineup format), saved trades and a watchlist. Logged-out visitors keep using
  browser-only storage, and a team built before signing up is imported on first login.
- **Security:** every table has row level security so users can only read and change their own rows. The anon key in
  `build.py` is meant to be public. `delete_my_account()` lets a signed-in user delete their own account.
- **Sessions** persist in the browser and refresh automatically, so users stay logged in until they log out.
- **Email:** Supabase's built-in mailer only sends to your Supabase team's addresses and is rate-limited. Before
  launch, either turn off **Authentication → Sign In / Providers → Email → Confirm email**, or set up custom SMTP
  (Authentication → Emails → SMTP Settings, e.g. with Resend or Postmark). Password-reset emails need custom SMTP.
- Set **Authentication → URL Configuration → Site URL** to the site's address so email links come back to it.
- `template/assets/vendor/supabase-2.119.0.js` is the Supabase browser client (MIT), hosted with the site.

## Data

All free from [nflverse](https://github.com/nflverse/nflverse-data), no API keys: weekly player stats,
schedules and betting lines, depth charts, injury reports, snap counts, and play-by-play (for red-zone
usage and team tendencies).

## How it updates

`.github/workflows/update.yml` rebuilds and publishes the site to GitHub Pages every
**every day at 5am** (US Eastern), and on every push to `main`.
To rebuild by hand: **Actions → Update matchup charts → Run workflow** (you can force a week).

## Run it locally

```bash
pip install -r requirements.txt
python build.py            # upcoming week
python build.py --week 12  # or a specific week
cd site && python -m http.server 8000
```

Then open http://localhost:8000. The page loads `data.json`, so open it through a local server
rather than double-clicking the file.

## Files

- `build.py` downloads the data and writes `site/` (`index.html`, `data.json`, `assets/`, `.xlsx` files).
- `template/index.html` is the page shell; `template/assets/app.js` renders every page; `app.css` is the design;
  `logo.svg` and `mark.svg` are the logo and icon.

## Launch details

- `SITE_URL` in `build.py` is the public address used for link previews, `sitemap.xml`, `robots.txt` and the 404 page.
  Change it if you move to a custom domain.
- `template/assets/og.png` is the image shown when the site is shared (1200×630); `icon-180.png` and `icon-32.png`
  are the phone and browser icons.
- About, How It Works, Privacy and Terms pages live at `#about`, `#how-it-works`, `#privacy` and `#terms`.

## Tweaking

In `build.py`:

- `DEPTH_SHOWN`: players listed per team on the matchup charts (QB 1, RB 2, WR 3, TE 2).
- `COMMITTEE_SHARE`: a backup RB/TE is listed when he scores at least this share of the starter's points over the last 3 games.
- `COLUMNS`: defensive stats shown per position.
- `fantasy_points()`: the scoring rules (4 pt passing TD by default).

In `template/assets/app.js`:

- `project()`: the start/sit projection (60% season, 40% last 3 games, matchup effect halved and capped at ±25%).
- `SLOT_SETS`: lineup formats on My Team.
- `PLAYOFF_WEEKS`: weeks highlighted on the schedule and valued separately in the Trade Analyzer.
- `rosValue()`, `DEPTH_WEIGHTS`, `timingOf()`: the Trade Analyzer's value model and buy/sell signals.
