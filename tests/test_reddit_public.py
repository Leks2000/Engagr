"""Tests for Reddit public parser."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from reddit_public import is_relevant, score_post, suggest_subreddits  # noqa: E402


def test_is_relevant_matches_keyword():
    post = {
        "post_id": "abc",
        "title": "Built a chrome extension for prompts",
        "text": "side project launch",
        "age_hours": 5,
        "comments": 10,
    }
    ok, reason = is_relevant(post, set(), ["prompt", "chrome extension"])
    assert ok is True
    assert "matches" in reason


def test_is_relevant_rejects_old():
    post = {
        "post_id": "old",
        "title": "chatgpt workflow",
        "text": "",
        "age_hours": 72,
        "comments": 2,
    }
    ok, _ = is_relevant(post, set(), ["chatgpt"])
    assert ok is False


def test_score_post_fresh_gets_bonus():
    fresh = {"age_hours": 1, "comments": 5, "ups": 50, "title": "prompt", "text": ""}
    stale = {"age_hours": 40, "comments": 5, "ups": 50, "title": "prompt", "text": ""}
    assert score_post(fresh) > score_post(stale)


def test_suggest_subreddits_from_ai_keywords():
    suggestions = suggest_subreddits(["ai", "vibe coding", "automation"], limit=12)
    assert "ChatGPT" in suggestions
    assert "automation" in suggestions
    assert "webdev" in suggestions
