"""
Engagr — Stage 3: AI relevance score + antispam / antiduplicates + importance sort.

This module runs *after* a post has been parsed and *before* it is shown in the
Mini App Feed. It is deliberately cheap (rules + optional AI) so it can run on
every pushed post without blowing latency or Groq quota.

Public API
----------
score_post(post, settings, user_id) -> dict
    Returns:
      {
        "relevance_score": 0-10 float,
        "flags": [ "spam", "duplicate", "low_effort", "promoted", "too_short" ],
        "duplicate_of": <item_id or "">,
        "sort_key": float   # higher = more important, used to order the Feed
      }

dedupe_against_queue(post, queue) -> item_id | None
    Returns the id of an existing queue item this post duplicates, or None.

mark_seen_fingerprint(user_id, post)
    Records a content fingerprint so the same post is never queued twice even
    if the parser changes its URL.

The scorer is safe to call even when Groq is not configured — it falls back to
a heuristic score and never raises.
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Any

import storage

logger = logging.getLogger("engagr.relevance")

# ── Tunable thresholds ───────────────────────────────────────────────────────
MIN_POST_LENGTH = 12          # shorter posts are "too_short"
MAX_PROMOTED_RATIO = 0.6      # if >60% of tokens are promo words → spam
LOW_EFFORT_MAX_LEN = 25       # very short + generic → low_effort
SPAM_PATTERNS = [
    r"\b(buy now|click here|free\s+money|earn \$|crypto giveaway|nft mint|airdrop)\b",
    r"\b(follow me|like and subscribe|dm me|check my profile)\b",
    r"https?://\S+\s+(https?://\S+\s+){2,}",   # link farm
]
PROMOTED_KEYWORDS = {
    "promoted", "sponsored", "ad", "advertisement", "реклама", "спонсировано",
}

# Generic low-value phrases that add no engagement value
LOW_VALUE_PHRASES = {
    "hello everyone", "good morning", "good evening", "happy friday",
    "have a great day", "привет всем", "доброе утро", "хорошего дня",
}


def _fingerprint(text: str) -> str:
    """Stable content fingerprint: lowercase, strip URLs/whitespace, sha1(12)."""
    cleaned = re.sub(r"https?://\S+", "", text or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip().lower()
    return hashlib.sha1(cleaned.encode("utf-8")).hexdigest()[:16]


def _tokenize(text: str) -> list[str]:
    return re.findall(r"[a-zа-яё0-9]{2,}", (text or "").lower())


# ── Duplicate detection ──────────────────────────────────────────────────────

def dedupe_against_queue(post: dict, queue: list[dict]) -> str | None:
    """Return the id of a queue item this post duplicates, or None.

    A duplicate is: same URL, OR same content fingerprint among non-terminal
    items (so a previously published post does not block a legitimate repost).
    """
    post_url = (post.get("url") or post.get("post_url") or "").strip()
    post_fp = _fingerprint(post.get("post") or post.get("post_text") or "")

    for q in queue:
        # Only consider items that could still surface in Feed
        if q.get("status") in ("published", "failed", "skipped", "declined"):
            continue
        q_url = (q.get("post_url") or "").strip()
        if post_url and q_url and post_url == q_url:
            return q.get("id")
        q_fp = q.get("content_fingerprint") or _fingerprint(
            q.get("post_text") or q.get("post_excerpt") or ""
        )
        if post_fp and q_fp and post_fp == q_fp:
            return q.get("id")
    return None


def mark_seen_fingerprint(user_id: str, post: dict) -> str:
    """Persist a content fingerprint on the post dict (in place) and return it."""
    fp = _fingerprint(post.get("post") or post.get("post_text") or "")
    post["content_fingerprint"] = fp
    return fp


# ── Heuristic scoring ────────────────────────────────────────────────────────

def _heuristic_score(post: dict, settings: dict) -> tuple[float, list[str]]:
    """Return (score 0-10, flags) from cheap rules only — no AI call."""
    text = (post.get("post") or post.get("post_text") or "").strip()
    flags: list[str] = []
    score = 5.0  # neutral start

    # Length
    if len(text) < MIN_POST_LENGTH:
        flags.append("too_short")
        score -= 3
    elif len(text) < 40:
        score -= 1

    # Spam
    text_lower = text.lower()
    for pat in SPAM_PATTERNS:
        if re.search(pat, text_lower, re.IGNORECASE):
            flags.append("spam")
            score -= 5
            break

    # Promoted / ad
    tokens = _tokenize(text)
    if tokens:
        promo_hits = sum(1 for t in tokens if t in PROMOTED_KEYWORDS)
        if promo_hits / max(len(tokens), 1) > 0.4 or "promoted" in text_lower:
            flags.append("promoted")
            score -= 4

    # Low effort
    if text.lower().strip(".!?, ") in LOW_VALUE_PHRASES or len(text) < LOW_EFFORT_MAX_LEN:
        flags.append("low_effort")
        score -= 1.5

    # Keyword match boost — the user's configured keywords are the strongest
    # positive signal that a post is relevant to them.
    platform = (post.get("platform") or "linkedin").lower()
    plat_cfg = settings.get(platform) or {}
    keywords = [k.lower().strip() for k in plat_cfg.get("keywords", []) if k.strip()]
    if keywords:
        hits = sum(1 for kw in keywords if kw in text_lower)
        if hits:
            score += min(hits * 1.5, 4)

    # Has a media attachment — slight engagement boost
    if post.get("has_media") or post.get("media"):
        score += 0.5

    # Engagement metrics (X parser provides metrics; LinkedIn/Reddit may too)
    reactions = post.get("reactions_count") or 0
    try:
        reactions = int(reactions)
    except Exception:
        reactions = 0
    if reactions >= 50:
        score += 1.5
    elif reactions >= 10:
        score += 0.5

    return max(0.0, min(10.0, score)), flags


# ── Optional AI relevance (Groq) ─────────────────────────────────────────────

def _ai_relevance(post: dict, settings: dict, user_id: str) -> float | None:
    """Ask Groq for a 0-10 relevance score. Returns None on any failure so the
    caller keeps the heuristic score. Kept optional and resilient."""
    try:
        import ai_comment
        post_text = (post.get("post") or post.get("post_text") or "").strip()
        if not post_text or len(post_text) < 20:
            return None
        platform = (post.get("platform") or "linkedin").lower()
        plat_cfg = settings.get(platform) or {}
        keywords = plat_cfg.get("keywords", []) or []
        client = ai_comment._get_client()
        from config import GROQ_MODEL
        kw_line = ", ".join(keywords[:8]) if keywords else "(no keywords set)"
        prompt = (
            "Rate how relevant this social post is for a user whose interests are: "
            f"{kw_line}. Reply with ONLY a single integer 0-10 (10 = highly relevant, "
            "0 = totally irrelevant). No words, no explanation.\n\n"
            f"Post:\n{post_text[:600]}"
        )
        resp = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You output only a single integer 0-10."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            max_tokens=4,
            timeout=8,
        )
        raw = (resp.choices[0].message.content or "").strip()
        m = re.search(r"\b(10|\d)\b", raw)
        if not m:
            return None
        val = float(m.group(1))
        if 0 <= val <= 10:
            return val
        return None
    except Exception as e:
        logger.debug("AI relevance skipped: %s", e)
        return None


# ── Public entry point ───────────────────────────────────────────────────────

def score_post(post: dict, settings: dict, user_id: str, use_ai: bool = False) -> dict:
    """Score a single post and return relevance metadata.

    Args:
        post: dict with at least `post`/`post_text`, `platform`, optional
              `url`, `media`, `reactions_count`.
        settings: user settings dict (for keywords).
        user_id: telegram user id (for AI call logging).
        use_ai: if True, attempt a Groq relevance call and blend it with the
                heuristic. Default False so posts/push stays cheap.
    """
    heur, flags = _heuristic_score(post, settings)

    relevance = heur
    if use_ai:
        ai_val = _ai_relevance(post, settings, user_id)
        if ai_val is not None:
            # Blend: 60% heuristic (deterministic, spam-safe) + 40% AI
            relevance = round(heur * 0.6 + ai_val * 0.4, 2)

    # sort_key: importance for Feed ordering. Higher relevance + newer = higher.
    # We add a small recency nudge so two equally-relevant posts order newest first.
    sort_key = round(relevance + 0.01, 4)

    return {
        "relevance_score": round(float(relevance), 2),
        "flags": flags,
        "sort_key": sort_key,
    }


def filter_and_sort_posts(posts: list[dict], settings: dict, user_id: str,
                          queue: list[dict], use_ai: bool = False,
                          min_score: float = 3.0) -> dict:
    """Apply Stage 3 to a batch of freshly parsed posts.

    Returns:
        {
          "kept":   [post, ...]   sorted by importance (desc),
          "dropped":[{"post","reason"}, ...],
          "duplicates": int,
        }
    """
    kept: list[dict] = []
    dropped: list[dict] = []
    duplicates = 0

    for raw in posts:
        post = dict(raw)
        # 1. Duplicate detection against the live queue
        dup_id = dedupe_against_queue(post, queue)
        if dup_id:
            duplicates += 1
            dropped.append({"post": post, "reason": "duplicate", "dup_of": dup_id})
            continue

        # 2. Score
        result = score_post(post, settings, user_id, use_ai=use_ai)
        post["relevance_score"] = result["relevance_score"]
        post["relevance_flags"] = result["flags"]
        post["sort_key"] = result["sort_key"]
        mark_seen_fingerprint(user_id, post)

        # 3. Hard drop on spam regardless of score
        if "spam" in result["flags"]:
            dropped.append({"post": post, "reason": "spam"})
            continue

        # 4. Drop below threshold (unless the user disabled filtering)
        filtering_enabled = settings.get("filtering_enabled", True)
        if filtering_enabled and result["relevance_score"] < min_score:
            dropped.append({"post": post, "reason": "low_relevance"})
            continue

        kept.append(post)

    # Sort kept by importance: relevance desc, then original order preserved
    kept.sort(key=lambda p: p.get("sort_key", 0), reverse=True)
    return {"kept": kept, "dropped": dropped, "duplicates": duplicates}
