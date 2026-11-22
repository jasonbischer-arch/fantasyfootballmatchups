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
| **Players** | Snap %, target share, air yards share, WOPR, rush share, red-zone opportunities, per-game volume, and next opponent for every fantasy-relevant player. Click anyone for a game log and chart. |
| **Schedule** | Rest-of-season strength of schedule by position: each week's opponent colored by how much it allows, with next-4, rest-of-season and Weeks 15–17 (fantasy playoffs) averages. |
| **Pro** ($10/month) | Mattress Pro command center: rankings with projections, floor/ceiling, tiers, A–F grades, boom/bust rates, matchup, team total, weather, usage and trend; one-click player reports; safe / balanced / upside modes; my-roster filter; waiver targets, buy-low and sell-high signals. |
| **Teams** | Projected points, spread, total, points scored/allowed, plays per game, pass rate, neutral-situation pass rate, pass rate over expected, red-zone plays. |

Scoring format (PPR / Half PPR / Standard) switches everywhere from the header.

## Mattress Pro (paywall)

Pro is unlocked with an **access code**. Payments go through a **Stripe Payment Link**, so no server is needed.
Settings live in `pro.json`:

```json
{ "price": 10, "checkoutUrl": "https://buy.stripe.com/...", "codeHashes": ["<sha256 of the code>"] }
```

Setup:

1. In Stripe, create a product "Mattress Pro" with a **$10/month recurring** price, then **Create payment link**.
2. In the payment link's **After payment** settings, choose **Show confirmation page** and add a custom message,
   for example: `Your Mattress Pro access code is SLEEP-XXXXXX. Enter it on the Pro tab of the site.`
3. Paste the payment link URL into `pro.json` as `checkoutUrl` and push. The Subscribe button goes live.
4. Turn on Stripe's **customer portal** so subscribers can cancel themselves.

Changing the code (do this monthly, or whenever a code leaks):

```bash
python tools/make_code_hash.py
```

Add the printed hash to `codeHashes` (keep the old one for a few days so current members aren't locked out,
then remove it), update the Stripe confirmation message, and email the new code to active subscribers.
Never commit the code itself, only its hash.

**Limits:** this is a static site, so the gate stops casual visitors, not determined ones: all data is in
`data.json`, and a code can be shared. For strict protection, move Pro data behind a small server
(for example a Cloudflare Worker) that checks the subscriber's Stripe status before serving it.

## Data

All free from [nflverse](https://github.com/nflverse/nflverse-data), no API keys: weekly player stats,
schedules and betting lines, depth charts, injury reports, snap counts, and play-by-play (for red-zone
usage and team tendencies).

## How it updates

`.github/workflows/update.yml` rebuilds and publishes the site to GitHub Pages every
**Wednesday at 10am** and **Sunday at 5am** (US Eastern), and on every push to `main`.
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
- `pro.json` holds the Pro price, Stripe link and access-code hashes; `tools/make_code_hash.py` makes new codes.
- `template/index.html` is the page shell; `template/assets/app.js` renders every page; `app.css` is the design;
  `logo.svg` and `mark.svg` are the logo and icon.

## Tweaking

In `build.py`:

- `DEPTH_SHOWN`: players listed per team on the matchup charts (QB 1, RB 2, WR 3, TE 2).
- `COMMITTEE_SHARE`: a backup RB/TE is listed when he scores at least this share of the starter's points over the last 3 games.
- `COLUMNS`: defensive stats shown per position.
- `fantasy_points()`: the scoring rules (4 pt passing TD by default).

In `template/assets/app.js`:

- `project()`: the start/sit projection (60% season, 40% last 3 games, matchup effect halved and capped at ±25%).
- `SLOT_SETS`: lineup formats on My Team.
- `PLAYOFF_WEEKS`: weeks highlighted on the schedule.
