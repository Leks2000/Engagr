"""
Engagr — Smart Schedule Module
Automatically determines the best posting times based on audience activity patterns.
Analyzes historical engagement data and platform-specific peak hours.
"""

import logging
import random
from datetime import datetime, timezone, timedelta
from collections import defaultdict

import storage

logger = logging.getLogger(__name__)

# Platform-specific default peak hours (UTC) based on industry research
LINKEDIN_PEAK_HOURS = [8, 9, 10, 12, 13, 17, 18]  # Tue-Thu mornings/lunch/evening
REDDIT_PEAK_HOURS = [9, 10, 13, 14, 17, 18, 20, 21]  # Spread across day

# Day-of-week multipliers (0=Mon, 6=Sun)
LINKEDIN_DAY_WEIGHTS = {
    0: 0.8,   # Mon
    1: 1.0,   # Tue
    2: 1.0,   # Wed
    3: 0.95,  # Thu
    4: 0.7,   # Fri
    5: 0.3,   # Sat
    6: 0.3,   # Sun
}

REDDIT_DAY_WEIGHTS = {
    0: 0.85,
    1: 0.9,
    2: 0.95,
    3: 0.9,
    4: 0.85,
    5: 1.0,   # Weekend Reddit is active
    6: 1.0,
}


def get_activity_history(user_id: str) -> list[dict]:
    """Get user's historical activity from stats history file."""
    try:
        from pathlib import Path
        from config import DATA_DIR
        history_path = DATA_DIR / str(user_id) / "stats_history.json"
        if history_path.exists():
            import json
            return json.loads(history_path.read_text(encoding="utf-8"))
    except Exception as e:
        logger.error("Failed to load activity history: %s", e)
    return []


def save_activity_record(user_id: str, record: dict):
    """Save a daily activity record for historical analysis."""
    try:
        import json
        from pathlib import Path
        from config import DATA_DIR

        history_path = DATA_DIR / str(user_id) / "stats_history.json"
        history_path.parent.mkdir(parents=True, exist_ok=True)

        history = []
        if history_path.exists():
            try:
                history = json.loads(history_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        history.append(record)
        # Keep last 90 days
        history = history[-90:]
        history_path.write_text(json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as e:
        logger.error("Failed to save activity record: %s", e)


def calculate_optimal_times(user_id: str, platform: str = "linkedin", num_slots: int = 3) -> list[str]:
    """
    Calculate optimal posting times based on:
    1. Historical engagement data
    2. Platform-specific peak hours
    3. User's timezone patterns
    
    Returns list of time strings like ["09:15", "13:30", "18:00"]
    """
    history = get_activity_history(user_id)

    # Score each hour slot
    hour_scores = defaultdict(float)

    if platform == "linkedin":
        peak_hours = LINKEDIN_PEAK_HOURS
        day_weights = LINKEDIN_DAY_WEIGHTS
    else:
        peak_hours = REDDIT_PEAK_HOURS
        day_weights = REDDIT_DAY_WEIGHTS

    # Base scores from platform peaks
    for hour in range(24):
        if hour in peak_hours:
            hour_scores[hour] += 10.0
        else:
            hour_scores[hour] += 1.0

    # Adjust based on historical performance
    if history:
        for record in history[-30:]:  # Last 30 days
            hour = record.get("best_hour")
            engagement = record.get("engagement_score", 0)
            if hour is not None and engagement > 0:
                hour_scores[hour] += engagement * 2

    # Apply day-of-week weighting for today
    today_dow = datetime.now(timezone.utc).weekday()
    day_multiplier = day_weights.get(today_dow, 0.8)

    for hour in hour_scores:
        hour_scores[hour] *= day_multiplier

    # Sort hours by score
    sorted_hours = sorted(hour_scores.items(), key=lambda x: x[1], reverse=True)

    # Pick top N hours, ensuring minimum 2-hour gap between sessions
    selected_hours = []
    for hour, score in sorted_hours:
        if len(selected_hours) >= num_slots:
            break
        # Ensure at least 2 hours gap from any already selected
        if all(abs(hour - h) >= 2 for h in selected_hours):
            selected_hours.append(hour)

    selected_hours.sort()

    # Add random minutes for natural timing (avoid :00 exactly)
    times = []
    for hour in selected_hours:
        minute = random.randint(5, 55)
        times.append(f"{hour:02d}:{minute:02d}")

    return times if times else ["09:00", "13:00", "18:00"]


def get_weekly_analytics(user_id: str) -> dict:
    """
    Get weekly analytics data for the dashboard chart.
    Returns day-by-day breakdown of engagement.
    """
    history = get_activity_history(user_id)
    today = datetime.now(timezone.utc).date()

    # Last 7 days
    weekly = []
    for i in range(6, -1, -1):
        day = today - timedelta(days=i)
        day_str = day.isoformat()
        day_record = next((r for r in history if r.get("date") == day_str), None)

        weekly.append({
            "date": day_str,
            "day_name": day.strftime("%a"),
            "linkedin_comments": day_record.get("linkedin_comments", 0) if day_record else 0,
            "linkedin_likes": day_record.get("linkedin_likes", 0) if day_record else 0,
            "reddit_comments": day_record.get("reddit_comments", 0) if day_record else 0,
            "reddit_upvotes": day_record.get("reddit_upvotes", 0) if day_record else 0,
            "total": (
                (day_record.get("linkedin_comments", 0) if day_record else 0) +
                (day_record.get("linkedin_likes", 0) if day_record else 0) +
                (day_record.get("reddit_comments", 0) if day_record else 0) +
                (day_record.get("reddit_upvotes", 0) if day_record else 0)
            ),
        })

    return {"weekly": weekly, "period": f"{(today - timedelta(days=6)).isoformat()} — {today.isoformat()}"}


def get_monthly_analytics(user_id: str) -> dict:
    """
    Get monthly analytics data (last 30 days).
    """
    history = get_activity_history(user_id)
    today = datetime.now(timezone.utc).date()

    monthly = []
    for i in range(29, -1, -1):
        day = today - timedelta(days=i)
        day_str = day.isoformat()
        day_record = next((r for r in history if r.get("date") == day_str), None)

        monthly.append({
            "date": day_str,
            "linkedin_comments": day_record.get("linkedin_comments", 0) if day_record else 0,
            "linkedin_likes": day_record.get("linkedin_likes", 0) if day_record else 0,
            "reddit_comments": day_record.get("reddit_comments", 0) if day_record else 0,
            "reddit_upvotes": day_record.get("reddit_upvotes", 0) if day_record else 0,
            "total": (
                (day_record.get("linkedin_comments", 0) if day_record else 0) +
                (day_record.get("linkedin_likes", 0) if day_record else 0) +
                (day_record.get("reddit_comments", 0) if day_record else 0) +
                (day_record.get("reddit_upvotes", 0) if day_record else 0)
            ),
        })

    total_actions = sum(d["total"] for d in monthly)
    avg_per_day = round(total_actions / 30, 1)
    best_day = max(monthly, key=lambda d: d["total"]) if monthly else None

    return {
        "monthly": monthly,
        "total_actions": total_actions,
        "avg_per_day": avg_per_day,
        "best_day": best_day,
        "period": f"{(today - timedelta(days=29)).isoformat()} — {today.isoformat()}",
    }
