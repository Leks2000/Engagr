"""
Engagr — Stage 4: Analytics funnel.

Builds the real engagement funnel from the user's queue history:
    N found → M published → K declined/failed → CTR → AI cost → action history

All data is derived from the existing per-user queue.json (lifecycle timestamps)
plus stats.json. No new storage schema required — this is a read-only view.

Public API
----------
build_funnel(user_id, days=7) -> dict
    Returns the full funnel payload used by the Mini App Dashboard.

CTR definition (product decision):
    CTR = published / (published + declined + failed + skipped)
    i.e. of everything the user *decided on*, what fraction actually went live.
    "Found but ignored" (still pending/new_post) is reported separately as
    `open` so the user sees the full pipeline, but it is not penalized in CTR.

AI cost tracking:
    Every item that triggered Groq (generate_comment_variants / regenerate /
    translate) accumulates an estimated token cost in stats.json under
    `ai_cost_usd` and `ai_tokens`. This module sums those for the window.
"""

from __future__ import annotations

import logging
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from typing import Any

import storage

logger = logging.getLogger("engagr.analytics")

# Groq llama-3.3-70b-versatile pricing (USD per 1M tokens) — used for estimates.
# These are conservative defaults; the real billing lives in stats.json as the
# authoritative source, this is only a fallback when stats are missing.
GROQ_PRICE_IN_PER_1M = 0.59
GROQ_PRICE_OUT_PER_1M = 0.79

# Estimated tokens per AI action (used only when stats.json has no recorded cost)
_EST_TOKENS_PER_VARIANT = 650   # 3 variants ≈ 1950 tokens round-trip
_EST_TOKENS_PER_REGEN = 250
_EST_TOKENS_PER_TRANSLATE = 400


def _within(iso_ts: str, since: datetime) -> bool:
    if not iso_ts:
        return False
    try:
        ts = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        return ts >= since
    except Exception:
        return False


def _estimate_item_ai_cost(item: dict) -> float:
    """Rough USD cost of the AI work behind one queue item."""
    tokens = 0
    variants = item.get("comment_variants") or []
    if variants:
        tokens += _EST_TOKENS_PER_VARIANT
    # If regenerate happened (retry_count or extra variants beyond 3)
    extra = max(0, len(variants) - 3)
    tokens += extra * _EST_TOKENS_PER_REGEN
    if item.get("translations") or item.get("post_text_translated"):
        tokens += _EST_TOKENS_PER_TRANSLATE
    # split 60/40 in/out
    out_tokens = int(tokens * 0.4)
    in_tokens = tokens - out_tokens
    return round((in_tokens / 1_000_000) * GROQ_PRICE_IN_PER_1M
                 + (out_tokens / 1_000_000) * GROQ_PRICE_OUT_PER_1M, 6)


def build_funnel(user_id: str, days: int = 7) -> dict:
    """Return the full Stage 4 funnel payload for the Mini App Dashboard."""
    try:
        days = max(1, min(int(days), 90))
    except Exception:
        days = 7
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)

    queue = storage.get_queue(user_id)
    stats = storage.get_stats(user_id)

    # ── Stage counts ──────────────────────────────────────────────────────
    found = 0          # posts discovered in window (created_at)
    published = 0
    declined = 0
    failed = 0
    skipped = 0
    approved = 0
    executing = 0
    open_pending = 0   # still awaiting decision (new_post / pending)

    # per-platform + per-status breakdowns
    by_platform_status: dict[str, Counter] = defaultdict(Counter)
    by_day: dict[str, Counter] = defaultdict(Counter)  # date -> status counts

    action_history: list[dict] = []

    for q in queue:
        created = q.get("created_at") or ""
        if not _within(created, since):
            # Even out-of-window terminal items don't count in the funnel
            continue
        found += 1
        status = q.get("status") or "pending"
        platform = q.get("platform") or "unknown"
        by_platform_status[platform][status] += 1

        day = (created or "")[:10]
        by_day[day][status] += 1

        if status == "published":
            published += 1
        elif status == "declined":
            declined += 1
        elif status == "failed":
            failed += 1
        elif status == "skipped":
            skipped += 1
        elif status == "approved":
            approved += 1
        elif status == "executing":
            executing += 1
        elif status in ("new_post", "pending"):
            open_pending += 1

        # Action history entry (compact, most recent first assembled later)
        action_history.append({
            "id": q.get("id"),
            "platform": platform,
            "author": q.get("author") or q.get("author_name") or "",
            "status": status,
            "relevance_score": q.get("relevance_score"),
            "created_at": created,
            "approved_at": q.get("approved_at"),
            "published_at": q.get("published_at"),
            "failed_at": q.get("failed_at"),
            "declined_at": q.get("declined_at"),
            "execution_error": q.get("execution_error") or "",
            "retry_count": q.get("retry_count") or 0,
            "post_url": q.get("post_url") or "",
        })

    decided = published + declined + failed + skipped
    ctr = round(published / decided, 4) if decided > 0 else 0.0
    success_rate = round(published / (published + failed), 4) if (published + failed) > 0 else 0.0

    # ── AI cost ───────────────────────────────────────────────────────────
    # Prefer authoritative stats.json accumulation; fall back to per-item est.
    ai_cost_usd = float(stats.get("ai_cost_usd", 0) or 0)
    ai_tokens = int(stats.get("ai_tokens", 0) or 0)
    if ai_cost_usd == 0:
        # Sum estimates only for items in window that used AI
        est = 0.0
        for q in queue:
            if not _within(q.get("created_at") or "", since):
                continue
            if q.get("comment_variants") or q.get("translations"):
                est += _estimate_item_ai_cost(q)
        ai_cost_usd = round(est, 4)

    # ── Per-platform summary ──────────────────────────────────────────────
    platforms = {}
    for plat, counter in by_platform_status.items():
        plat_published = counter.get("published", 0)
        plat_decided = sum(counter.get(s, 0) for s in ("published", "declined", "failed", "skipped"))
        platforms[plat] = {
            "found": sum(counter.values()),
            "published": plat_published,
            "declined": counter.get("declined", 0),
            "failed": counter.get("failed", 0),
            "skipped": counter.get("skipped", 0),
            "open": counter.get("new_post", 0) + counter.get("pending", 0),
            "ctr": round(plat_published / plat_decided, 4) if plat_decided else 0.0,
        }

    # ── Daily series (for the dashboard chart) ────────────────────────────
    daily = []
    for day in sorted(by_day.keys()):
        c = by_day[day]
        daily.append({
            "date": day,
            "found": sum(c.values()),
            "published": c.get("published", 0),
            "declined": c.get("declined", 0),
            "failed": c.get("failed", 0),
            "skipped": c.get("skipped", 0),
        })

    # Action history: newest first, cap to 50 for UI sanity
    action_history.sort(key=lambda x: x.get("created_at") or "", reverse=True)
    action_history = action_history[:50]

    return {
        "user_id": user_id,
        "window_days": days,
        "generated_at": now.isoformat(),
        "funnel": {
            "found": found,
            "open": open_pending,
            "approved": approved,
            "executing": executing,
            "published": published,
            "declined": declined,
            "failed": failed,
            "skipped": skipped,
            "decided": decided,
            "ctr": ctr,
            "success_rate": success_rate,
        },
        "ai_cost_usd": ai_cost_usd,
        "ai_tokens": ai_tokens,
        "platforms": platforms,
        "daily": daily,
        "action_history": action_history,
    }
