"""
twitter_bot.py — Step 10: X / Twitter integration for Engagr.

Architecture (extension-first, no server-side browser):
  - Trend discovery via X API v2 (no auth needed for public trends endpoint)
  - Reply & thread idea generation via Groq (same AI provider pattern)
  - Queue integration: generated replies/threads go to the same approval queue
  - Extension bridge: approved X items are executed via extension content script
    (future: x_actions.js) in the same pattern as LinkedIn

Public endpoints used (no OAuth required):
  - GET https://api.twitter.com/2/trends/by/woeid/{woeid}?bearer_token=...  (v1.1 fallback)
  - Nitter public RSS feeds as fallback for trend scraping (no API key)
  - X API v2 bearer token (optional): enables higher rate limits

Personal MVP scope (v0.1):
  - Trend discovery (topic ideas only, no posting via API)
  - Reply generation: AI generates reply text → approval queue → user posts manually
  - Thread ideation: AI drafts thread → user posts manually
  - XSettings.jsx: connect / status / keywords / tone / daily limits
  - No OAuth 1.0a in v0.1 (no server-side posting)
"""

from __future__ import annotations

import hashlib
import logging
import time
from datetime import datetime, timezone
from typing import Any

import requests

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

TWITTER_BEARER_TOKEN_ENV = "TWITTER_BEARER_TOKEN"  # optional
NITTER_INSTANCES = [
    "https://nitter.net",
    "https://nitter.privacydev.net",
    "https://nitter.1d4.us",
]

TREND_CACHE_TTL = 900  # 15 min
_trend_cache: dict[str, Any] = {}

CATEGORY_ALL = "all"
CATEGORY_TECH = "tech"
CATEGORY_STARTUP = "startup"
CATEGORY_AI = "ai"
CATEGORY_CRYPTO = "crypto"

TECH_KEYWORDS = {
    "tech", "ai", "ml", "llm", "gpt", "openai", "github", "python", "javascript",
    "startup", "saas", "product", "launch", "vc", "funding", "crypto", "web3",
    "react", "nextjs", "vercel", "cloud", "devops", "kubernetes", "rust",
}

# ---------------------------------------------------------------------------
# Trend discovery helpers
# ---------------------------------------------------------------------------


def _now_ts() -> float:
    return time.time()


def _cache_key(scope: str) -> str:
    return hashlib.md5(scope.encode()).hexdigest()


def _is_fresh(entry: dict) -> bool:
    return _now_ts() - entry.get("ts", 0) < TREND_CACHE_TTL


def _try_twitter_api_trends(bearer_token: str) -> list[dict]:
    """Fetch trending topics from X API v2 (requires Bearer Token)."""
    try:
        # X API v2: search recent tweets for trending hashtags
        headers = {"Authorization": f"Bearer {bearer_token}"}
        # Use search/recent to find high-volume topics
        url = "https://api.twitter.com/2/tweets/search/recent"
        params = {
            "query": "(#AI OR #startup OR #tech OR #SaaS OR #buildinpublic) lang:en -is:retweet",
            "max_results": 100,
            "tweet.fields": "public_metrics,created_at,entities",
        }
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        if resp.status_code != 200:
            logger.warning("X API returned %s", resp.status_code)
            return []

        data = resp.json()
        tweets = data.get("data", [])
        tag_counts: dict[str, int] = {}

        for tweet in tweets:
            entities = tweet.get("entities", {})
            for hashtag in entities.get("hashtags", []):
                tag = f"#{hashtag.get('tag', '')}".lower()
                if tag and len(tag) > 2:
                    tag_counts[tag] = tag_counts.get(tag, 0) + 1

        results = []
        for tag, count in sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:20]:
            results.append({
                "id": f"x_tag_{tag.lstrip('#')}",
                "title": tag,
                "source": "X API",
                "source_key": "x_api",
                "url": f"https://twitter.com/search?q={tag}&src=trend_click",
                "score": count,
                "category": _categorize(tag),
                "fetched_at": datetime.now(timezone.utc).isoformat(),
            })

        return results

    except Exception as exc:
        logger.error("X API trends error: %s", exc)
        return []


def _try_nitter_trends() -> list[dict]:
    """Scrape trending hashtags from a Nitter public instance."""
    for base in NITTER_INSTANCES:
        try:
            resp = requests.get(f"{base}/search?f=tweets&q=%23AI+%23startup&since_id=0", timeout=8)
            if resp.status_code != 200:
                continue

            import re
            # Extract hashtags from Nitter search results
            hashtags = re.findall(r'<span class="hashtag">#([A-Za-z0-9_]+)</span>', resp.text)
            tag_counts: dict[str, int] = {}
            for tag in hashtags:
                key = f"#{tag.lower()}"
                tag_counts[key] = tag_counts.get(key, 0) + 1

            results = []
            for tag, count in sorted(tag_counts.items(), key=lambda x: x[1], reverse=True)[:15]:
                results.append({
                    "id": f"nitter_{tag.lstrip('#')}",
                    "title": tag,
                    "source": "X Trends",
                    "source_key": "x_public",
                    "url": f"https://twitter.com/hashtag/{tag.lstrip('#')}",
                    "score": count,
                    "category": _categorize(tag),
                    "fetched_at": datetime.now(timezone.utc).isoformat(),
                })

            if results:
                return results

        except Exception as exc:
            logger.debug("Nitter instance %s failed: %s", base, exc)
            continue

    return []


def _get_curated_trends(keywords: list[str] | None = None) -> list[dict]:
    """
    Curated/fallback trending topics for tech/startup audience.
    Used when neither X API nor Nitter is available.
    Enriched with user keywords for personalization.
    """
    base_topics = [
        {
            "id": "x_fallback_buildinpublic",
            "title": "#BuildInPublic",
            "source": "X Trending",
            "source_key": "x_curated",
            "url": "https://twitter.com/hashtag/BuildInPublic",
            "score": 95,
            "category": CATEGORY_STARTUP,
            "comment_angle": "Share your current build journey — what's working, what failed this week",
            "content_idea": "Thread: 3 lessons from building in public for 30 days",
        },
        {
            "id": "x_fallback_ai",
            "title": "#AI",
            "source": "X Trending",
            "source_key": "x_curated",
            "url": "https://twitter.com/hashtag/AI",
            "score": 98,
            "category": CATEGORY_AI,
            "comment_angle": "Contrarian take: what AI still can't replace in your workflow",
            "content_idea": "Thread: 5 AI tools I actually use daily vs 10 I tried and dropped",
        },
        {
            "id": "x_fallback_indiemakers",
            "title": "#IndieHackers",
            "source": "X Trending",
            "source_key": "x_curated",
            "url": "https://twitter.com/hashtag/IndieHackers",
            "score": 88,
            "category": CATEGORY_STARTUP,
            "comment_angle": "Revenue milestone post or revenue transparency update",
            "content_idea": "Thread: How I got from $0 to first $1k MRR — exact steps",
        },
        {
            "id": "x_fallback_saas",
            "title": "#SaaS",
            "source": "X Trending",
            "source_key": "x_curated",
            "url": "https://twitter.com/hashtag/SaaS",
            "score": 82,
            "category": CATEGORY_STARTUP,
            "comment_angle": "Churn prevention insight or retention metric you track",
            "content_idea": "Thread: Our churn rate was 12% — here's what fixed it",
        },
        {
            "id": "x_fallback_oss",
            "title": "#OpenSource",
            "source": "X Trending",
            "source_key": "x_curated",
            "url": "https://twitter.com/hashtag/OpenSource",
            "score": 79,
            "category": CATEGORY_TECH,
            "comment_angle": "Why you open-sourced (or didn't) your project — the real reason",
            "content_idea": "Thread: Open-sourcing our core got us 800 GitHub stars in a week — what we learned",
        },
        {
            "id": "x_fallback_llm",
            "title": "#LLM",
            "source": "X Trending",
            "source_key": "x_curated",
            "url": "https://twitter.com/hashtag/LLM",
            "score": 91,
            "category": CATEGORY_AI,
            "comment_angle": "Specific use case where LLMs surprised you (good or bad)",
            "content_idea": "Thread: I tested 6 LLMs on the same prompt for 30 days — here are the results",
        },
        {
            "id": "x_fallback_productlaunch",
            "title": "#ProductLaunch",
            "source": "X Trending",
            "source_key": "x_curated",
            "url": "https://twitter.com/hashtag/ProductLaunch",
            "score": 76,
            "category": CATEGORY_STARTUP,
            "comment_angle": "One thing you'd do differently in your next launch",
            "content_idea": "Thread: Our ProductHunt launch got 400 upvotes. Here's the playbook.",
        },
        {
            "id": "x_fallback_web3",
            "title": "#Web3",
            "source": "X Trending",
            "source_key": "x_curated",
            "url": "https://twitter.com/hashtag/Web3",
            "score": 65,
            "category": CATEGORY_CRYPTO,
            "comment_angle": "Honest take on what web3 delivered vs hype in your sector",
            "content_idea": "Thread: I've been building in web3 for 2 years — real user numbers",
        },
    ]

    if keywords:
        kw_lower = [k.lower() for k in keywords if k]
        scored = []
        for topic in base_topics:
            title_lower = topic["title"].lower()
            bonus = sum(2 for kw in kw_lower if kw in title_lower)
            scored.append((topic["score"] + bonus * 5, topic))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [t for _, t in scored]

    return base_topics


def _categorize(tag: str) -> str:
    t = tag.lower().lstrip("#")
    if any(k in t for k in ["ai", "ml", "llm", "gpt", "claude", "openai"]):
        return CATEGORY_AI
    if any(k in t for k in ["crypto", "bitcoin", "eth", "web3", "defi", "nft"]):
        return CATEGORY_CRYPTO
    if any(k in t for k in ["startup", "saas", "indiemaker", "buildinpublic", "launch", "founder"]):
        return CATEGORY_STARTUP
    return CATEGORY_TECH


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------


def get_x_trends(
    user_id: str,
    keywords: list[str] | None = None,
    bearer_token: str | None = None,
    refresh: bool = False,
) -> list[dict]:
    """
    Return trending X topics, enriched with angle/idea suggestions.
    Priority: X API (if bearer_token) → Nitter → curated fallback.
    Results are cached for TREND_CACHE_TTL seconds.
    """
    cache_key = _cache_key(f"{user_id}:{','.join(sorted(keywords or []))}")

    if not refresh and cache_key in _trend_cache and _is_fresh(_trend_cache[cache_key]):
        return _trend_cache[cache_key]["data"]

    trends: list[dict] = []

    if bearer_token:
        trends = _try_twitter_api_trends(bearer_token)

    if not trends:
        trends = _try_nitter_trends()

    if not trends:
        trends = _get_curated_trends(keywords)

    # Enrich with AI angles if not already present
    for t in trends:
        if not t.get("comment_angle"):
            t["comment_angle"] = f"Share your experience with {t['title']} — what's your contrarian take?"
        if not t.get("content_idea"):
            t["content_idea"] = f"Thread: My honest take on {t['title']} after 30 days"

    # Personalise scores by user keywords
    if keywords:
        kw_lower = [k.lower() for k in keywords if k]
        for t in trends:
            text = f"{t.get('title','')} {t.get('comment_angle','')} {t.get('content_idea','')}".lower()
            matches = sum(1 for kw in kw_lower if kw in text)
            t["relevance"] = min(100, t.get("score", 50) + matches * 8)
            t["relevant"] = matches > 0
        trends.sort(key=lambda x: x.get("relevance", 0), reverse=True)
    else:
        for t in trends:
            t["relevance"] = t.get("score", 50)
            t["relevant"] = False

    _trend_cache[cache_key] = {"ts": _now_ts(), "data": trends}
    return trends


def generate_x_reply(
    post_text: str,
    post_author: str,
    post_url: str,
    user_memory: dict | None = None,
    groq_api_key: str | None = None,
    language: str = "en",
) -> dict:
    """
    Generate an AI reply for an X/Twitter post.
    Uses Groq (same pattern as LinkedIn/Reddit AI comments).
    Returns: { variants: [...], selected_comment: "...", post_language: "en", provider: "groq" }
    """
    try:
        from ai_comment import generate_comment_variants  # type: ignore
    except ImportError:
        logger.warning("ai_comment module not available; returning stub reply")
        return {
            "variants": [f"Great point about {post_author}'s post! Worth exploring further."],
            "selected_comment": f"Great point about {post_author}'s post! Worth exploring further.",
            "post_language": language,
            "provider": "stub",
        }

    platform_context = "X/Twitter reply — short, punchy, conversational tone. Max 240 chars. No hashtag spam. No generic praise."
    return generate_comment_variants(
        post_text=post_text,
        author=post_author,
        platform="x",
        user_memory=user_memory,
        groq_api_key=groq_api_key,
        extra_context=platform_context,
        language=language,
    )


def generate_x_thread(
    topic: str,
    angle: str,
    user_memory: dict | None = None,
    groq_api_key: str | None = None,
    language: str = "en",
    tweet_count: int = 5,
) -> dict:
    """
    Draft a Twitter thread for a given topic/angle.
    Returns: { tweets: ["tweet1", "tweet2", ...], topic, angle }
    """
    if not groq_api_key:
        return {
            "tweets": [
                f"🧵 Thread: {topic}",
                f"1/ {angle}",
                "2/ Here's what I found...",
                "3/ The key insight is...",
                f"4/ If you're building in this space, watch for...",
                f"5/ TL;DR: {topic} matters because... Follow for more 🧵",
            ],
            "topic": topic,
            "angle": angle,
            "provider": "stub",
        }

    try:
        from groq import Groq  # type: ignore

        client = Groq(api_key=groq_api_key)

        memory_context = ""
        if user_memory:
            project = user_memory.get("project_description", "")
            audience = user_memory.get("target_audience", "")
            tone = user_memory.get("tone", "professional")
            if project or audience:
                memory_context = f"\nContext: {project}. Audience: {audience}. Tone: {tone}."

        system_prompt = (
            "You are an expert Twitter/X content creator. "
            "Write punchy, high-signal threads that founders and tech professionals love. "
            "Each tweet must be under 240 characters. "
            "Start with a hook tweet (numbered 1/). "
            "End with a summary tweet. "
            "No hashtag spam — max 1 hashtag per tweet. "
            "No generic filler. Be specific and valuable."
        )

        user_prompt = (
            f"Topic: {topic}\n"
            f"Angle: {angle}\n"
            f"Tweet count: {tweet_count}\n"
            f"{memory_context}\n"
            f"Language: {language}\n\n"
            "Write a Twitter thread. Return each tweet on a new line, prefixed with '---'."
        )

        response = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            max_tokens=600,
            temperature=0.85,
        )

        raw = response.choices[0].message.content or ""
        lines = [line.lstrip("- ").strip() for line in raw.split("---") if line.strip()]
        tweets = [t for t in lines if len(t) > 5][:tweet_count + 1]

        return {
            "tweets": tweets or [f"🧵 Thread on {topic}: {angle}"],
            "topic": topic,
            "angle": angle,
            "provider": "groq",
        }

    except Exception as exc:
        logger.error("Thread generation failed: %s", exc)
        return {
            "tweets": [f"🧵 Thread: {topic}\n{angle}"],
            "topic": topic,
            "angle": angle,
            "provider": "error",
            "error": str(exc),
        }


def get_x_stats(user_id: str, storage_module=None) -> dict:
    """Return X engagement statistics for a user."""
    if storage_module is None:
        return {
            "replies_generated": 0,
            "threads_drafted": 0,
            "items_queued": 0,
            "last_activity": None,
        }

    try:
        stats = storage_module.load_stats(user_id) or {}
        x_stats = stats.get("x", {})
        return {
            "replies_generated": x_stats.get("replies_generated", 0),
            "threads_drafted": x_stats.get("threads_drafted", 0),
            "items_queued": x_stats.get("items_queued", 0),
            "last_activity": x_stats.get("last_activity"),
        }
    except Exception:
        return {"replies_generated": 0, "threads_drafted": 0, "items_queued": 0, "last_activity": None}
