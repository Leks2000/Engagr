"""
Engagr — User Memory Module
Stores project context, target audience, goals, and tone profile
to personalize AI comment generation across all platforms.
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

from config import DATA_DIR

logger = logging.getLogger(__name__)

DEFAULT_MEMORY = {
    "project_name": "",
    "project_description": "",
    "target_audience": "",
    "goals": "",
    "unique_value": "",
    "tone_keywords": [],
    "avoid_topics": [],
    "expertise_areas": [],
    "personal_context": "",
    "language_preference": "auto",
    "comment_style_notes": "",
    "updated_at": None,
}


def _memory_path(user_id: str) -> Path:
    """Path to user's memory profile file."""
    p = DATA_DIR / str(user_id) / "user_memory.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def get_memory(user_id: str) -> dict:
    """Get user memory profile. Returns defaults if not yet configured."""
    path = _memory_path(user_id)
    if path.exists():
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return {**DEFAULT_MEMORY, **data}
        except (json.JSONDecodeError, OSError):
            pass
    return dict(DEFAULT_MEMORY)


def load_memory(user_id: str) -> dict:
    """Backward-compatible alias for get_memory."""
    return get_memory(user_id)


def save_memory(user_id: str, memory: dict) -> dict:
    """Save or update user memory profile."""
    path = _memory_path(user_id)
    current = get_memory(user_id)

    # Update only provided fields
    for key in DEFAULT_MEMORY:
        if key in memory and memory[key] is not None:
            current[key] = memory[key]

    current["updated_at"] = datetime.now(timezone.utc).isoformat()
    path.write_text(json.dumps(current, indent=2, ensure_ascii=False), encoding="utf-8")
    logger.info("User memory saved for user=%s", user_id)
    return current


def clear_memory(user_id: str) -> dict:
    """Reset user memory to defaults."""
    path = _memory_path(user_id)
    if path.exists():
        path.unlink()
    logger.info("User memory cleared for user=%s", user_id)
    return dict(DEFAULT_MEMORY)


def build_ai_context(user_id: str) -> str:
    """
    Build a context string from user memory for AI comment prompts.
    Returns empty string if no meaningful memory is configured.
    """
    memory = get_memory(user_id)

    parts = []

    if memory.get("project_name"):
        desc = memory.get("project_description", "")
        parts.append(f"Author's project: {memory['project_name']}" + (f" — {desc}" if desc else ""))

    if memory.get("target_audience"):
        parts.append(f"Target audience: {memory['target_audience']}")

    if memory.get("goals"):
        parts.append(f"Engagement goals: {memory['goals']}")

    if memory.get("unique_value"):
        parts.append(f"Unique value/expertise: {memory['unique_value']}")

    if memory.get("expertise_areas"):
        areas = memory["expertise_areas"]
        if isinstance(areas, list) and areas:
            parts.append(f"Expert in: {', '.join(areas[:8])}")

    if memory.get("tone_keywords"):
        keywords = memory["tone_keywords"]
        if isinstance(keywords, list) and keywords:
            parts.append(f"Tone style: {', '.join(keywords[:6])}")

    if memory.get("avoid_topics"):
        avoid = memory["avoid_topics"]
        if isinstance(avoid, list) and avoid:
            parts.append(f"Avoid mentioning: {', '.join(avoid[:6])}")

    if memory.get("personal_context"):
        parts.append(f"Personal note: {memory['personal_context']}")

    if memory.get("comment_style_notes"):
        parts.append(f"Comment style: {memory['comment_style_notes']}")

    if not parts:
        return ""

    return "Author profile context:\n" + "\n".join(f"- {p}" for p in parts)


def is_configured(user_id: str) -> bool:
    """Check if user has any meaningful memory configured."""
    memory = get_memory(user_id)
    return bool(
        memory.get("project_name")
        or memory.get("target_audience")
        or memory.get("goals")
        or memory.get("expertise_areas")
    )
