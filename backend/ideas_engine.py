"""
Engagr — Ideas Engine Module (Step 9)
AI/dev/startup news collection for content and comment ideas.

Aggregates trending topics from HackerNews, ProductHunt, TechCrunch,
Reddit, and Dev.to. Generates content ideas and comment angles for
each trending topic based on user's memory profile.
"""

import json
import logging
import time
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import requests

import news_grounding
import storage
import ai_comment
import user_memory as user_memory_module

logger = logging.getLogger(__name__)

# Cache for ideas (per user)
_ideas_cache: dict[str, dict] = {}
IDEAS_CACHE_TTL = 900  # 15 minutes

# Dev.to source
DEVTO_API = "https://dev.to/api/articles"


def fetch_devto_top(limit: int = 10, tag: str = None) -> list[dict]:
    """Fetch trending articles from Dev.to."""
    try:
        params = {"per_page": limit, "top": 7}  # top articles from last 7 days
        if tag:
            params["tag"] = tag
        resp = requests.get(
            DEVTO_API,
            params=params,
            headers={"User-Agent": "Engagr/1.0"},
            timeout=10,
        )
        if resp.status_code != 200:
            return []

        articles = resp.json()
        items = []
        for article in articles[:limit]:
            items.append({
                "title": article.get("title", ""),
                "url": article.get("url", ""),
                "score": article.get("positive_reactions_count", 0),
                "source": "Dev.to",
                "tags": article.get("tag_list", []),
                "author": article.get("user", {}).get("name", ""),
                "description": article.get("description", ""),
                "published_at": article.get("published_at", ""),
                "comments_count": article.get("comments_count", 0),
            })
        return items
    except Exception as e:
        logger.error("Dev.to fetch error: %s", e)
        return []


def fetch_github_trending(limit: int = 10) -> list[dict]:
    """Fetch trending repositories from GitHub (unofficial)."""
    try:
        # Use GitHub search API for recently created popular repos
        resp = requests.get(
            "https://api.github.com/search/repositories",
            params={
                "q": "stars:>50 created:>2024-01-01",
                "sort": "stars",
                "order": "desc",
                "per_page": limit,
            },
            headers={"User-Agent": "Engagr/1.0"},
            timeout=10,
        )
        if resp.status_code != 200:
            return []

        data = resp.json()
        items = []
        for repo in data.get("items", [])[:limit]:
            items.append({
                "title": f"{repo.get('full_name', '')} — {repo.get('description', '')[:100]}",
                "url": repo.get("html_url", ""),
                "score": repo.get("stargazers_count", 0),
                "source": "GitHub",
                "tags": repo.get("topics", [])[:5],
                "author": repo.get("owner", {}).get("login", ""),
                "description": repo.get("description", ""),
                "language": repo.get("language", ""),
            })
        return items
    except Exception as e:
        logger.error("GitHub trending fetch error: %s", e)
        return []


def _generate_idea_angles(topic: dict, memory: dict, language: str = "en") -> dict:
    """
    Generate content and comment idea angles for a given trending topic.
    Uses user memory to personalize suggestions.
    """
    project_ctx = ""
    if memory.get("project_name"):
        project_ctx = f"User's project: {memory['project_name']}. "
    if memory.get("target_audience"):
        project_ctx += f"Target audience: {memory['target_audience']}. "
    if memory.get("goals"):
        project_ctx += f"Goals: {memory['goals']}. "
    if memory.get("expertise_areas"):
        project_ctx += f"Expertise: {', '.join(memory['expertise_areas'])}. "

    # Generate comment angle
    comment_angle = ""
    content_idea = ""

    title = topic.get("title", "")
    description = topic.get("description", "")
    source = topic.get("source", "")

    # Simple rule-based idea generation (no API call needed for basic ideas)
    if source in ("HackerNews", "TechCrunch"):
        comment_angle = f"Share your experience with similar tech or challenge the assumptions in '{title[:60]}'"
        content_idea = f"Write a post about your take on this trend and how it relates to your work"
    elif source == "ProductHunt":
        comment_angle = f"Congratulate the maker and draw a parallel with your own product journey"
        content_idea = f"Create a 'lessons learned' post inspired by this launch"
    elif source == "Dev.to":
        comment_angle = f"Add a practical tip or alternative approach to '{title[:60]}'"
        content_idea = f"Write a follow-up tutorial or counterpoint article"
    elif source == "GitHub":
        comment_angle = f"Star the repo and share how you could use it in your stack"
        content_idea = f"Create a 'tools I discovered this week' roundup post"
    elif source == "Reddit":
        comment_angle = f"Share a personal story or data point related to this discussion"
        content_idea = f"Turn this trending topic into a LinkedIn post with your unique angle"
    else:
        comment_angle = f"Engage with a thoughtful, experience-based perspective"
        content_idea = f"Create content around this trending topic with your unique expertise"

    return {
        "comment_angle": comment_angle,
        "content_idea": content_idea,
        "relevance_reason": f"Trending on {source}" + (f" | Matches your focus" if project_ctx else ""),
    }


def get_ideas(user_id: str, force_refresh: bool = False, limit: int = 15) -> list[dict]:
    """
    Get personalized content and comment ideas for a user.
    Aggregates trending topics and generates idea angles.
    """
    # Check cache
    cache_key = str(user_id)
    if not force_refresh and cache_key in _ideas_cache:
        cached = _ideas_cache[cache_key]
        if time.time() - cached["fetched_at"] < IDEAS_CACHE_TTL:
            return cached["ideas"][:limit]

    # Get user context
    settings = storage.get_settings(user_id)
    memory = user_memory_module.get_memory(user_id)
    language = settings.get("language", "en")

    # Gather keywords from user settings and memory
    li_keywords = settings.get("linkedin", {}).get("keywords", []) or []
    rd_keywords = settings.get("reddit", {}).get("keywords", []) or []
    expertise = memory.get("expertise_areas", []) or []
    all_keywords = list(set(li_keywords + rd_keywords + expertise))[:10]

    # Fetch from all sources
    all_topics = []

    # News sources (already cached in news_grounding)
    try:
        hn_items = news_grounding.fetch_hackernews_top(10)
        all_topics.extend(hn_items)
    except Exception as e:
        logger.error("Ideas: HN fetch failed: %s", e)

    try:
        ph_items = news_grounding.fetch_producthunt_top(8)
        all_topics.extend(ph_items)
    except Exception as e:
        logger.error("Ideas: PH fetch failed: %s", e)

    try:
        tc_items = news_grounding.fetch_techcrunch_top(8)
        all_topics.extend(tc_items)
    except Exception as e:
        logger.error("Ideas: TC fetch failed: %s", e)

    # Dev.to
    try:
        devto_items = fetch_devto_top(8)
        all_topics.extend(devto_items)
    except Exception as e:
        logger.error("Ideas: Dev.to fetch failed: %s", e)

    # GitHub trending
    try:
        gh_items = fetch_github_trending(5)
        all_topics.extend(gh_items)
    except Exception as e:
        logger.error("Ideas: GitHub fetch failed: %s", e)

    # Score by relevance to user keywords
    scored_topics = []
    for topic in all_topics:
        title_lower = (topic.get("title", "") + " " + topic.get("description", "")).lower()
        relevance = 0

        for kw in all_keywords:
            kw_lower = kw.lower().strip()
            if kw_lower and kw_lower in title_lower:
                relevance += 3
            elif kw_lower:
                for word in kw_lower.split():
                    if len(word) > 2 and word in title_lower:
                        relevance += 1

        # Boost by engagement score
        base_score = topic.get("score", 0)
        if base_score > 100:
            relevance += 2
        elif base_score > 50:
            relevance += 1

        scored_topics.append((relevance, topic))

    # Sort: highest relevance first, then by source score
    scored_topics.sort(key=lambda x: (x[0], x[1].get("score", 0)), reverse=True)

    # Generate ideas with angles
    ideas = []
    seen_titles = set()

    for relevance, topic in scored_topics:
        title = topic.get("title", "").strip()
        if not title or title in seen_titles:
            continue
        seen_titles.add(title)

        angles = _generate_idea_angles(topic, memory, language)

        ideas.append({
            "id": f"idea_{hash(title) % 100000}",
            "title": title,
            "url": topic.get("url", ""),
            "source": topic.get("source", ""),
            "score": topic.get("score", 0),
            "relevance": relevance,
            "tags": topic.get("tags", []),
            "author": topic.get("author", ""),
            "description": topic.get("description", ""),
            "comment_angle": angles["comment_angle"],
            "content_idea": angles["content_idea"],
            "relevance_reason": angles["relevance_reason"],
            "fetched_at": datetime.now(timezone.utc).isoformat(),
        })

        if len(ideas) >= limit:
            break

    # Cache results
    _ideas_cache[cache_key] = {
        "ideas": ideas,
        "fetched_at": time.time(),
    }

    logger.info("Generated %d ideas for user %s (from %d topics)", len(ideas), user_id, len(all_topics))
    return ideas


def get_idea_categories(user_id: str) -> dict:
    """
    Get ideas grouped by category/source for the frontend tabs.
    """
    ideas = get_ideas(user_id, limit=30)

    categories = {
        "trending": [],
        "for_you": [],
        "news": [],
        "dev": [],
        "launches": [],
    }

    for idea in ideas:
        source = idea.get("source", "")
        relevance = idea.get("relevance", 0)

        # High relevance = "For You"
        if relevance >= 3:
            categories["for_you"].append(idea)

        # By source
        if source in ("HackerNews", "TechCrunch"):
            categories["news"].append(idea)
        elif source == "Dev.to":
            categories["dev"].append(idea)
        elif source in ("ProductHunt", "GitHub"):
            categories["launches"].append(idea)

        # Top scored = trending
        if idea.get("score", 0) > 20:
            categories["trending"].append(idea)

    # Limit each category
    for key in categories:
        categories[key] = categories[key][:10]

    return categories


def generate_comment_for_idea(user_id: str, idea_id: str, platform: str = "linkedin") -> dict:
    """
    Generate an AI comment for a specific idea, ready to use on the target platform.
    """
    ideas = get_ideas(user_id, limit=30)
    target_idea = None
    for idea in ideas:
        if idea.get("id") == idea_id:
            target_idea = idea
            break

    if not target_idea:
        return {"error": "Idea not found", "variants": []}

    settings = storage.get_settings(user_id)
    language = settings.get("language", "en")
    tone = settings.get("linkedin", {}).get("tone", "friendly")

    text = f"{target_idea['title']}. {target_idea.get('description', '')}"

    try:
        result = ai_comment.generate_comment_variants(
            text, language, platform, tone=tone
        )
        return {
            "idea_id": idea_id,
            "platform": platform,
            "variants": result.get("variants", []),
            "idea_title": target_idea["title"],
            "idea_url": target_idea.get("url", ""),
        }
    except Exception as e:
        logger.error("Failed to generate comment for idea %s: %s", idea_id, e)
        return {"error": str(e), "variants": []}


def save_idea_to_queue(user_id: str, idea_id: str, comment: str, platform: str = "linkedin") -> dict:
    """
    Save an idea with a prepared comment to the user's approval queue.
    """
    ideas = get_ideas(user_id, limit=30)
    target_idea = None
    for idea in ideas:
        if idea.get("id") == idea_id:
            target_idea = idea
            break

    if not target_idea:
        return {"error": "Idea not found"}

    queue_item = {
        "platform": platform,
        "post_text": target_idea["title"],
        "post_url": target_idea.get("url", ""),
        "author": target_idea.get("author", "Unknown"),
        "comment": comment,
        "source": f"ideas_engine:{target_idea['source']}",
        "status": "pending",
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    storage.add_to_queue(user_id, queue_item)
    logger.info("Saved idea to queue for user %s: %s", user_id, target_idea["title"][:50])
    return {"status": "ok", "message": "Idea saved to queue for approval"}


def get_ideas_stats(user_id: str) -> dict:
    """Get stats about ideas engine usage."""
    ideas = get_ideas(user_id, limit=30)
    sources = {}
    for idea in ideas:
        src = idea.get("source", "Unknown")
        sources[src] = sources.get(src, 0) + 1

    return {
        "total_ideas": len(ideas),
        "sources": sources,
        "high_relevance": sum(1 for i in ideas if i.get("relevance", 0) >= 3),
        "last_refresh": _ideas_cache.get(str(user_id), {}).get("fetched_at"),
    }
