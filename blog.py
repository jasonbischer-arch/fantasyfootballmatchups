"""Blog for The Sports Mattress.

Posts are Markdown files in blog/ named YYYY-MM-DD-slug.md, with a small front-matter block:

    ---
    title: Week 12 Matchups to Target
    description: One-sentence summary used for search results and share previews.
    date: 2026-11-26
    tags: matchups, week 12
    ---
    Markdown body...

build.py calls write_blog() to publish them as static pages:

  site/blog/index.html          list of posts, newest first
  site/blog/<slug>/index.html   one page per post
  site/blog/feed.xml            RSS feed

The marketing agent (separate repository) adds one post a week by committing a file to blog/.
"""
from __future__ import annotations

import datetime as dt
import json
import re
from email.utils import format_datetime
from pathlib import Path

import markdown

FRONT = re.compile(r"\A---\s*\n(.*?)\n---\s*\n", re.S)
NAME = re.compile(r"^(\d{4}-\d{2}-\d{2})-([a-z0-9][a-z0-9-]*)\.md$")


def esc(text: str) -> str:
    return (text or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def load_posts(folder: Path) -> list[dict]:
    posts = []
    for path in sorted(folder.glob("*.md")):
        m = NAME.match(path.name)
        if not m:
            continue
        text = path.read_text(encoding="utf-8")
        meta: dict[str, str] = {}
        fm = FRONT.match(text)
        if fm:
            for line in fm.group(1).splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    meta[k.strip().lower()] = v.strip().strip('"')
            text = text[fm.end():]
        date = meta.get("date") or m.group(1)
        try:
            day = dt.date.fromisoformat(date)
        except ValueError:
            continue
        if day > dt.date.today() + dt.timedelta(days=1):   # scheduled for later
            continue
        body = markdown.markdown(text, extensions=["tables", "sane_lists"], output_format="html")
        posts.append({
            "slug": m.group(2), "date": day, "title": meta.get("title") or m.group(2).replace("-", " ").title(),
            "description": meta.get("description", ""), "tags": [t.strip() for t in meta.get("tags", "").split(",") if t.strip()],
            "html": body,
        })
    posts.sort(key=lambda p: (p["date"], p["slug"]), reverse=True)
    return posts


STYLE = """
.blog{max-width:760px;margin:0 auto;padding:28px 16px 64px}
.blog-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:28px}
.blog-top .wordmark{text-decoration:none;color:var(--ink);font-size:30px}
.blog-top nav{display:flex;gap:16px;flex-wrap:wrap;font-weight:600}
.blog-top nav a{text-decoration:none}
.blog h1{font:800 clamp(30px,5vw,44px)/1.05 var(--display);text-transform:uppercase;margin:6px 0 10px}
.blog .meta{color:var(--muted);font-size:14px;margin:0 0 24px}
.post{font-size:17px;line-height:1.7}
.post h2{font:700 26px/1.15 var(--display);text-transform:uppercase;margin:34px 0 8px}
.post h3{font-size:19px;margin:26px 0 6px}
.post table{border-collapse:collapse;width:100%;font-size:15px;margin:16px 0;display:block;overflow-x:auto}
.post th,.post td{border:1px solid var(--line);padding:6px 10px;text-align:left}
.post th{background:var(--surface-2)}
.post blockquote{border-left:4px solid var(--accent);margin:16px 0;padding:4px 16px;color:var(--muted)}
.cta{margin:36px 0 0;padding:18px 20px}
.cta p{margin:0 0 10px}
.list{list-style:none;padding:0;margin:0;display:grid;gap:14px}
.list li{padding:18px 20px}
.list h2{font:700 24px/1.15 var(--display);text-transform:uppercase;margin:0 0 4px}
.list h2 a{text-decoration:none;color:var(--ink)}
.list p{margin:4px 0 0}
.blog-foot{margin-top:48px;color:var(--muted);font-size:14px}
"""


def page(site_url: str, title: str, desc: str, canonical: str, body: str, head_extra: str, gtm_head: str, gtm_body: str,
         og_type: str = "website") -> str:
    fonts = "https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700;800&family=Figtree:wght@400;500;600;700;800&display=swap"
    return (
        '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">' + gtm_head
        + '<meta name="viewport" content="width=device-width, initial-scale=1">'
        f"<title>{esc(title)}</title><meta name=\"description\" content=\"{esc(desc)}\">"
        f'<link rel="canonical" href="{canonical}"><meta name="theme-color" content="#111a2a">'
        f'<meta property="og:type" content="{og_type}"><meta property="og:site_name" content="The Sports Mattress">'
        f'<meta property="og:title" content="{esc(title)}"><meta property="og:description" content="{esc(desc)}">'
        f'<meta property="og:url" content="{canonical}"><meta property="og:image" content="{site_url}assets/og.png">'
        '<meta name="twitter:card" content="summary_large_image">'
        f'<link rel="alternate" type="application/rss+xml" title="The Sports Mattress blog" href="{site_url}blog/feed.xml">'
        '<link rel="icon" href="/favicon.ico" sizes="32x32"><link rel="icon" type="image/svg+xml" href="/assets/mark.svg">'
        f'<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>'
        f'<link rel="stylesheet" href="{fonts}"><link rel="stylesheet" href="/assets/app.css">'
        f"<style>{STYLE}</style>{head_extra}</head><body>{gtm_body}"
        '<main class="blog"><div class="blog-top"><a class="wordmark" href="/">The Sports Mattress</a>'
        '<nav aria-label="Main"><a href="/qb/">Matchups</a><a href="/start-sit/">Start / Sit</a>'
        '<a href="/trade/">Trade Analyzer</a><a href="/blog/">Blog</a></nav></div>'
        + body
        + '<p class="blog-foot">© The Sports Mattress · Matchups you can sleep on. · Not affiliated with the NFL or any team.</p>'
        "</main></body></html>\n"
    )


CTA = ('<div class="panel cta"><p><strong>Check this week\'s numbers yourself.</strong> The matchup charts, start/sit tool and '
       'trade analyzer rebuild every morning with the latest stats, injuries and betting lines.</p>'
       '<a class="btn primary" href="/qb/">See this week\'s matchups</a></div>')


def write_blog(folder: Path, out: Path, site_url: str, gtm_head: str = "", gtm_body: str = "") -> list[tuple[str, str]]:
    """Write the blog pages. Returns (url, lastmod) pairs for the sitemap."""
    posts = load_posts(folder) if folder.exists() else []
    root = out / "blog"
    root.mkdir(parents=True, exist_ok=True)
    urls = [(f"{site_url}blog/", (posts[0]["date"] if posts else dt.date.today()).isoformat())]

    for p in posts:
        url = f"{site_url}blog/{p['slug']}/"
        ld = {"@context": "https://schema.org", "@type": "BlogPosting", "headline": p["title"], "description": p["description"],
              "datePublished": p["date"].isoformat(), "dateModified": p["date"].isoformat(), "mainEntityOfPage": url,
              "image": f"{site_url}assets/og.png", "author": {"@type": "Organization", "name": "The Sports Mattress", "url": site_url},
              "publisher": {"@type": "Organization", "name": "The Sports Mattress",
                            "logo": {"@type": "ImageObject", "url": f"{site_url}assets/icon-512.png"}}}
        head = '<script type="application/ld+json">' + json.dumps(ld, separators=(",", ":")).replace("</", "<\\/") + "</script>"
        body = (f'<article><p class="eyebrow">Blog</p><h1>{esc(p["title"])}</h1>'
                f'<p class="meta">{p["date"].strftime("%B %-d, %Y")}' + (" · " + esc(", ".join(p["tags"][:3])) if p["tags"] else "")
                + f'</p><div class="post">{p["html"]}</div>{CTA}</article>')
        target = root / p["slug"] / "index.html"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(page(site_url, f"{p['title']} · The Sports Mattress", p["description"], url, body, head,
                               gtm_head, gtm_body, og_type="article"))
        urls.append((url, p["date"].isoformat()))

    items = "".join(
        f'<li class="panel"><h2><a href="/blog/{p["slug"]}/">{esc(p["title"])}</a></h2>'
        f'<p class="muted">{p["date"].strftime("%B %-d, %Y")}</p><p>{esc(p["description"])}</p></li>' for p in posts
    ) or '<li class="panel"><p>The first post is on its way.</p></li>'
    body = ('<p class="eyebrow">Blog</p><h1>Fantasy football matchups, explained</h1>'
            '<p class="lede">Weekly breakdowns built on the same numbers as our matchup charts.</p>'
            f'<ul class="list" style="margin-top:24px">{items}</ul>')
    (root / "index.html").write_text(page(site_url, "Fantasy Football Blog: Weekly Matchup Breakdowns · The Sports Mattress",
                                          "Weekly fantasy football breakdowns: matchups to target and avoid, usage trends, "
                                          "start/sit calls and trade advice, built on The Sports Mattress data.",
                                          f"{site_url}blog/", body, "", gtm_head, gtm_body))

    rss_items = "".join(
        f"<item><title>{esc(p['title'])}</title><link>{site_url}blog/{p['slug']}/</link>"
        f"<guid>{site_url}blog/{p['slug']}/</guid><description>{esc(p['description'])}</description>"
        f"<pubDate>{format_datetime(dt.datetime.combine(p['date'], dt.time(12), dt.timezone.utc))}</pubDate></item>"
        for p in posts[:20])
    (root / "feed.xml").write_text(
        '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel><title>The Sports Mattress blog</title>'
        f"<link>{site_url}blog/</link><description>Weekly fantasy football matchup breakdowns.</description>{rss_items}"
        "</channel></rss>\n")
    return urls
