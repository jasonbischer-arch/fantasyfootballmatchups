# The Sports Mattress

Fantasy football matchup charts and tools that rebuild themselves every week.
Live at **https://sportsmattress.io/**

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

## Blog

- **Blog** (`/blog/`): posts live in Supabase (`posts` table, images in the public `blog` storage bucket). Admins write at
  `/write/` (Markdown editor with preview, cover upload, drafts, publish/unpublish). Published posts appear immediately;
  every build (every 3 hours) also pre-renders `/blog/<slug>/` with the full article, Open Graph tags, BlogPosting data and
  "More articles" links, adds it to the sitemap and to the RSS feed at `/blog/feed.xml`. The latest posts show on the home page.
- **Admins** are rows in `public.admins`, which can only be changed in the Supabase dashboard/SQL:
  `insert into public.admins (user_id) select id from auth.users where email = 'you@example.com';`
- The old `/news/` address redirects to `/blog/`.

## Reliability, off-season and keep-alive

- **Retries and fallback:** every download is retried with growing waits. The workflow caches the last run's
  downloads, so if a source is still down the build uses yesterday's copy (listed in `data.json` as `staleSources`).
- **Alerts:** if a scheduled update fails, uses stale data, or the Supabase keep-alive fails, the workflow opens a
  GitHub issue labeled `site-update-alert` (GitHub emails you) and closes it after the next good run. A failed build
  never replaces the live site.
- **Season detection:** the season is the latest one with finished regular-season games, read from the schedule.
  After Week 18 the site switches to **off-season mode**: final defense rankings, season leaders, full-season trade
  values and "returns in Week 1" notices, with next season's kickoff date once the schedule is published. It moves to
  the new season automatically once its first games are final. To preview it: `python build.py --season 2025`.
- **Supabase keep-alive:** each scheduled run makes one small read from the database so the free project never pauses.

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

## Domain and SEO

- The site is served at **https://sportsmattress.io/** (Porkbun DNS → GitHub Pages; `www` redirects to the bare domain).
  `SITE_URL` in `build.py` must match it.
- Every page has a real URL (`/qb/`, `/trade/`, `/players/` …). `build.py` writes one HTML file per page with its own
  title, description, canonical link, Open Graph / Twitter tags and crawlable fallback content; old `/#page` links
  redirect. Account pages (`/login/`, `/account/` …) are `noindex`.
- `sitemap.xml`, `robots.txt`, a real `404.html`, `favicon.ico`, `site.webmanifest` and JSON-LD structured data
  (WebSite, Organization, WebApplication on the home page; breadcrumbs elsewhere) are generated on every build.
- **Player pages** (`/player/<name>/`, every fantasy-relevant player) and **team pages** (`/team/<abbr>/`) are pre-built
  with a written summary, usage, game log and upcoming schedule, so searches like "Ja'Marr Chase matchup" can land on them.
  Player names across the site link to these pages (and still open the quick panel on click).
- In season, each player page is aimed at "start or sit [player] week N" searches: the title, description and headline ask
  that question, and a **Week N verdict** box answers it (Start / Flex or Streamer / Sit) from the same projection as the
  Start/Sit tool, ranked against every player at his position (`START_LINES` in `build.py` and `app.js` set the cutoffs).
  `/start-sit/` adds a Week N cheat sheet that links to every player page. URLs stay the same week to week.
- `/qb/`, `/rb/`, `/wr/`, `/te/` include the full matchup table in the page HTML for search engines.
- `template/assets/og.png` is the share image; `icon-*.png` are the app icons.

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
