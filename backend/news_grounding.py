"""
Engagr — News Grounding Module
Parses fresh news from TechCrunch, Product Hunt, and HackerNews
to provide AI with current industry context for more relevant comments.
"""

import logging
import time
import json
import re
from datetime import datetime, timezone
from typing import Optional

import requests

logger = logging.getLogger(__name__)

# Cache: { source: { "items": [...], "fetched_at": timestamp } }
_news_cache: dict[str, dict] = {}
CACHE_TTL = 1800  # 30 minutes


def _is_cache_valid(source: str) -> bool:
    entry = _news_cache.get(source)
    if not entry:
        return False
    return (time.time() - entry["fetched_at"]) < CACHE_TTL


def fetch_hackernews_top(limit: int = 10) -> list[dict]:
    """Fetch top stories from HackerNews."""
    if _is_cache_valid("hackernews"):
        return _news_cache["hackernews"]["items"][:limit]

    try:
        resp = requests.get(
            "https://hacker-news.firebaseio.com/v0/topstories.json",
            timeout=10,
        )
        story_ids = resp.json()[:limit]

        items = []
        for sid in story_ids:
            try:
                story = requests.get(
                    f"https://hacker-news.firebaseio.com/v0/item/{sid}.json",
                    timeout=5,
                ).json()
                if story and story.get("title"):
                    items.append({
                        "title": story["title"],
                        "url": story.get("url", f"https://news.ycombinator.com/item?id={sid}"),
                        "score": story.get("score", 0),
                        "source": "HackerNews",
                    })
            except Exception:
                continue

        _news_cache["hackernews"] = {"items": items, "fetched_at": time.time()}
        logger.info("Fetched %d HackerNews stories", len(items))
        return items
    except Exception as e:
        logger.error("HackerNews fetch error: %s", e)
        return _news_cache.get("hackernews", {}).get("items", [])[:limit]


def fetch_producthunt_top(limit: int = 10) -> list[dict]:
    """Fetch trending products from Product Hunt (via RSS-like scraping)."""
    if _is_cache_valid("producthunt"):
        return _news_cache["producthunt"]["items"][:limit]

    try:
        # Use Product Hunt's public feed
        resp = requests.get(
            "https://www.producthunt.com/feed",
            headers={"User-Agent": "Engagr/1.0 (news aggregator)"},
            timeout=10,
        )
        items = []
        # Simple XML parsing for RSS items
        titles = re.findall(r"<title><!\[CDATA\[(.*?)\]\]></title>", resp.text)
        links = re.findall(r"<link>(https://www\.producthunt\.com/posts/[^<]+)</link>", resp.text)

        for i, title in enumerate(titles[:limit]):
            items.append({
                "title": title,
                "url": links[i] if i < len(links) else "https://www.producthunt.com",
                "score": 0,
                "source": "ProductHunt",
            })

        if not items:
            # Fallback: basic scraping approach
            items = [{"title": "Product Hunt trending", "url": "https://www.producthunt.com", "score": 0, "source": "ProductHunt"}]

        _news_cache["producthunt"] = {"items": items, "fetched_at": time.time()}
        logger.info("Fetched %d ProductHunt items", len(items))
        return items
    except Exception as e:
        logger.error("ProductHunt fetch error: %s", e)
        return _news_cache.get("producthunt", {}).get("items", [])[:limit]


def fetch_techcrunch_top(limit: int = 10) -> list[dict]:
    """Fetch latest TechCrunch articles via RSS."""
    if _is_cache_valid("techcrunch"):
        return _news_cache["techcrunch"]["items"][:limit]

    try:
        resp = requests.get(
            "https://techcrunch.com/feed/",
            headers={"User-Agent": "Engagr/1.0 (news aggregator)"},
            timeout=10,
        )
        items = []
        titles = re.findall(r"<title><!\[CDATA\[(.*?)\]\]></title>", resp.text)
        if not titles:
            titles = re.findall(r"<title>(.*?)</title>", resp.text)
        links = re.findall(r"<link>(https://techcrunch\.com/\d{4}/[^<]+)</link>", resp.text)

        for i, title in enumerate(titles[:limit]):
            if title in ("TechCrunch", "Comments on:"):
                continue
            items.append({
                "title": title,
                "url": links[i] if i < len(links) else "https://techcrunch.com",
                "score": 0,
                "source": "TechCrunch",
            })

        _news_cache["techcrunch"] = {"items": items, "fetched_at": time.time()}
        logger.info("Fetched %d TechCrunch articles", len(items))
        return items[:limit]
    except Exception as e:
        logger.error("TechCrunch fetch error: %s", e)
        return _news_cache.get("techcrunch", {}).get("items", [])[:limit]


def get_trending_news(keywords: list[str] = None, limit: int = 5) -> list[dict]:
    """
    Get aggregated trending news from all sources, optionally filtered by keywords.
    Returns top items most relevant to the given keywords.
    """
    all_items = []
    all_items.extend(fetch_hackernews_top(15))
    all_items.extend(fetch_techcrunch_top(10))
    all_items.extend(fetch_producthunt_top(10))

    if keywords:
        # Score items by keyword relevance
        kw_lower = [k.lower() for k in keywords]
        scored = []
        for item in all_items:
            title_lower = item["title"].lower()
            relevance = sum(1 for kw in kw_lower if kw in title_lower)
            if relevance > 0:
                scored.append((relevance + item.get("score", 0) / 1000, item))

        scored.sort(key=lambda x: x[0], reverse=True)
        if scored:
            return [item for _, item in scored[:limit]]

    # If no keyword match, return top by score
    all_items.sort(key=lambda x: x.get("score", 0), reverse=True)
    return all_items[:limit]


def build_news_context(keywords: list[str] = None) -> str:
    """
    Build a news context string for the AI to reference in comments.
    Used to ground AI-generated comments in current events.
    """
    news = get_trending_news(keywords, limit=5)
    if not news:
        return ""

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    lines = [f"[Today's industry news ({today}):"]
    for item in news:
        lines.append(f"- {item['title']} ({item['source']})")
    lines.append("]")

    return "\n".join(lines)
