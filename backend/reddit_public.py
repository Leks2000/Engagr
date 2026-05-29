"""
Reddit discovery via public .json endpoints (no OAuth app required).
"""

from __future__ import annotations

import json
import logging
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urljoin

import requests

from config import DATA_DIR
import storage

logger = logging.getLogger(__name__)

USER_AGENT = "Mozilla/5.0 (compatible; EngagrBot/1.0; +https://github.com/Leks2000/Engagr)"

DEFAULT_SUBREDDITS = [
    "ChatGPT", "ClaudeAI", "OpenAI", "perplexity_ai",
    "SideProject", "indiehackers", "microsaas", "SaaS",
    "productivity", "workflow", "chrome_extensions",
    "copywriting", "marketing", "webdev",
]

DEFAULT_RELEVANT_KEYWORDS = [
    "prompt", "prompts", "chatgpt", "claude", "ai tool",
    "chrome extension", "productivity", "workflow",
    "automate", "save time", "launched", "built", "made",
    "created", "side project", "organize", "manage",
    "reuse", "template", "copy paste", "rewriting",
    "same thing every", "tired of typing",
]

EXCLUDE_KEYWORDS = [
    "nsfw", "politics", "meme", "funny", "rant", "drama",
]


def _seen_path(user_id: str) -> Path:
    return DATA_DIR / str(user_id) / "seen_reddit.json"


def load_seen_ids(user_id: str) -> set[str]:
    path = _seen_path(user_id)
    if not path.exists():
        return set()
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return set(data.get("post_ids", []))
    except (OSError, json.JSONDecodeError):
        return set()


def mark_seen(user_id: str, post_id: str) -> None:
    seen = load_seen_ids(user_id)
    seen.add(post_id)
    path = _seen_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"post_ids": sorted(seen)[-5000:]}, indent=2),
        encoding="utf-8",
    )


def fetch_subreddit(subreddit: str, limit: int = 25) -> list[dict]:
    url = f"https://www.reddit.com/r/{subreddit}/new.json?limit={limit}"
    headers = {"User-Agent": USER_AGENT}

    try:
        resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code == 429:
            time.sleep(30)
            resp = requests.get(url, headers=headers, timeout=15)
        if resp.status_code != 200:
            logger.warning("r/%s HTTP %s", subreddit, resp.status_code)
            return []
        data = resp.json()
    except Exception as e:
        logger.warning("r/%s fetch error: %s", subreddit, e)
        return []

    items = []
    for child in data.get("data", {}).get("children", []):
        d = child.get("data", {})
        if d.get("stickied"):
            continue
        created = d.get("created_utc", 0)
        age_hours = (datetime.now(timezone.utc).timestamp() - created) / 3600
        selftext = (d.get("selftext", "") or "")[:500]
        title = d.get("title", "")
        text = f"{title}\n\n{selftext}".strip()
        items.append({
            "post_id": d.get("id", ""),
            "reddit_id": d.get("id", ""),
            "id": f"rd_{d.get('id', '')}",
            "title": title,
            "subreddit": subreddit,
            "sub": subreddit,
            "url": urljoin("https://www.reddit.com", d.get("permalink", "")),
            "link": urljoin("https://www.reddit.com", d.get("permalink", "")),
            "date": datetime.fromtimestamp(created, tz=timezone.utc).isoformat(),
            "ups": d.get("ups", 0),
            "comments": d.get("num_comments", 0),
            "age_hours": round(age_hours, 1),
            "author": d.get("author", ""),
            "text": text,
            "excerpt": text[:200],
            "platform": "reddit",
            "reactions": d.get("ups", 0),
        })
    return items


def is_relevant(
    post: dict,
    posted_ids: set[str],
    relevant_keywords: list[str],
    max_age_hours: float = 48,
    max_comments: int = 80,
) -> tuple[bool, str]:
    title_lower = (post.get("title") or "").lower()
    text_lower = (post.get("text") or "").lower()
    combined = title_lower + " " + text_lower
    pid = post.get("post_id") or post.get("reddit_id", "")

    if pid in posted_ids:
        return False, "already seen"
    if post.get("age_hours", 999) > max_age_hours:
        return False, "too old"
    if post.get("comments", 0) > max_comments:
        return False, "too many comments"
    if any(kw in combined for kw in EXCLUDE_KEYWORDS):
        return False, "excluded topic"

    matches = [kw for kw in relevant_keywords if kw in combined]
    if not matches:
        return False, "no keyword match"

    return True, f"matches: {', '.join(matches[:3])}"


def score_post(post: dict) -> float:
    score = 0.0
    age = post.get("age_hours", 99)

    if age < 2:
        score += 30
    elif age < 6:
        score += 20
    elif age < 12:
        score += 10

    comments = post.get("comments", 0)
    if 3 <= comments <= 20:
        score += 25
    elif 1 <= comments <= 3:
        score += 15
    elif comments == 0:
        score += 5

    ups = post.get("ups", 0)
    if 10 <= ups <= 100:
        score += 20
    elif ups > 100:
        score += 10
    elif ups > 0:
        score += 5

    combined = ((post.get("title") or "") + " " + (post.get("text") or "")).lower()
    direct_keys = ["prompt", "chrome extension", "launched", "built my", "side project"]
    if any(k in combined for k in direct_keys):
        score += 15

    pain_keys = [
        "save prompts", "store prompts", "same prompt every",
        "rewriting the same", "tired of typing",
    ]
    if any(k in combined for k in pain_keys):
        score += 20

    return score


def scrape_posts(user_id: str, max_posts: int = 15) -> list[dict]:
    """Fetch and rank Reddit threads for a user (public API, no login)."""
    settings = storage.get_settings(user_id)
    rd = settings.get("reddit", {})
    subreddits = rd.get("subreddits") or DEFAULT_SUBREDDITS
    user_kw = [k.strip().lower() for k in rd.get("keywords", []) if k.strip()]
    relevant_keywords = user_kw or [k.lower() for k in DEFAULT_RELEVANT_KEYWORDS]
    limit_per_sub = min(int(rd.get("fetch_limit", 25)), 50)

    seen_ids = load_seen_ids(user_id)
    queue_ids = {
        q.get("reddit_id") or q.get("post_id", "").replace("rd_", "")
        for q in storage.get_queue(user_id)
        if q.get("platform") == "reddit"
    }
    skip_ids = seen_ids | queue_ids

    all_posts: list[dict] = []
    for sub in subreddits:
        posts = fetch_subreddit(sub, limit=limit_per_sub)
        all_posts.extend(posts)
        time.sleep(random.uniform(1.0, 2.0))

    relevant: list[dict] = []
    for post in all_posts:
        ok, reason = is_relevant(post, skip_ids, relevant_keywords)
        if ok:
            post["score"] = score_post(post)
            post["relevance_reason"] = reason
            relevant.append(post)

    relevant.sort(key=lambda x: x.get("score", 0), reverse=True)
    top = relevant[:max_posts]
    logger.info(
        "reddit_public user=%s parsed=%s relevant=%s returning=%s",
        user_id, len(all_posts), len(relevant), len(top),
    )
    return top
