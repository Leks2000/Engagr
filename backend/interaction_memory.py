"""
Engagr — Interaction Memory Module
Remembers previous interactions with authors across LinkedIn/Reddit.
Enables context-aware engagement and relationship building.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from config import DATA_DIR

logger = logging.getLogger(__name__)


def _memory_path(user_id: str) -> Path:
    """Path to user's interaction memory file."""
    p = DATA_DIR / str(user_id) / "interaction_memory.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def get_all_interactions(user_id: str) -> dict:
    """
    Get all interaction memory for a user.
    Returns dict keyed by author identifier (name or profile URL).
    """
    path = _memory_path(user_id)
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {}


def _save_interactions(user_id: str, interactions: dict):
    """Save interactions to file."""
    path = _memory_path(user_id)
    path.write_text(json.dumps(interactions, ensure_ascii=False, indent=2), encoding="utf-8")


def record_interaction(
    user_id: str,
    author_name: str,
    author_profile_url: str,
    platform: str,
    interaction_type: str,  # "comment", "like", "connection_request", "reply"
    context: str = "",
    post_url: str = "",
    our_message: str = "",
):
    """
    Record an interaction with an author.
    """
    interactions = get_all_interactions(user_id)
    
    # Use author name as key (normalized)
    key = author_name.strip().lower() if author_name else author_profile_url
    if not key:
        return
    
    if key not in interactions:
        interactions[key] = {
            "author_name": author_name,
            "profile_url": author_profile_url,
            "platform": platform,
            "first_interaction": datetime.now(timezone.utc).isoformat(),
            "interaction_count": 0,
            "interactions": [],
        }
    
    record = interactions[key]
    record["interaction_count"] += 1
    record["last_interaction"] = datetime.now(timezone.utc).isoformat()
    record["interactions"].append({
        "type": interaction_type,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "post_url": post_url,
        "our_message": our_message[:500],
        "context": context[:200],
    })
    
    # Keep only last 20 interactions per author
    record["interactions"] = record["interactions"][-20:]
    
    # Keep max 500 tracked authors
    if len(interactions) > 500:
        # Remove oldest authors (by last_interaction)
        sorted_keys = sorted(
            interactions.keys(),
            key=lambda k: interactions[k].get("last_interaction", ""),
        )
        for old_key in sorted_keys[:50]:
            del interactions[old_key]
    
    _save_interactions(user_id, interactions)
    logger.info(
        "Recorded interaction user=%s author=%s type=%s count=%d",
        user_id, author_name, interaction_type, record["interaction_count"]
    )


def get_author_history(user_id: str, author_name: str) -> dict | None:
    """
    Get interaction history with a specific author.
    Returns None if no previous interaction.
    """
    interactions = get_all_interactions(user_id)
    key = author_name.strip().lower() if author_name else ""
    return interactions.get(key)


def has_previous_interaction(user_id: str, author_name: str) -> bool:
    """Check if we've interacted with this author before."""
    return get_author_history(user_id, author_name) is not None


def get_interaction_context_for_ai(user_id: str, author_name: str) -> str:
    """
    Build context string for AI to personalize comments based on previous interactions.
    """
    history = get_author_history(user_id, author_name)
    if not history:
        return ""
    
    count = history.get("interaction_count", 0)
    last = history.get("last_interaction", "")
    recent_msgs = [
        i.get("our_message", "")
        for i in (history.get("interactions") or [])[-3:]
        if i.get("our_message")
    ]
    
    context = f"[Previous relationship with {author_name}: {count} interactions. "
    if recent_msgs:
        context += f"Last messages: {'; '.join(recent_msgs[-2:])}. "
    context += "Reference previous conversation naturally if appropriate.]"
    
    return context


def get_repeat_authors_in_queue(user_id: str, posts: list[dict]) -> list[dict]:
    """
    Identify posts from authors we've already interacted with.
    Returns enriched posts with interaction hints.
    """
    interactions = get_all_interactions(user_id)
    enriched = []
    
    for post in posts:
        author = (post.get("author_name") or post.get("author") or "").strip().lower()
        if author and author in interactions:
            record = interactions[author]
            post["has_previous_interaction"] = True
            post["interaction_count"] = record.get("interaction_count", 0)
            post["interaction_hint"] = (
                f"You've engaged with {record['author_name']} "
                f"{record['interaction_count']} time(s) before. "
                f"Keep building this relationship!"
            )
        else:
            post["has_previous_interaction"] = False
            post["interaction_count"] = 0
            post["interaction_hint"] = ""
        enriched.append(post)
    
    return enriched


def get_top_connections(user_id: str, limit: int = 10) -> list[dict]:
    """
    Get top connections by interaction frequency.
    Useful for CRM-like overview.
    """
    interactions = get_all_interactions(user_id)
    sorted_authors = sorted(
        interactions.values(),
        key=lambda x: x.get("interaction_count", 0),
        reverse=True,
    )
    return sorted_authors[:limit]
