"""
Engagr — Nested Replies Module
Monitors replies to AI-generated comments and notifies user
with option to continue the discussion via AI.
"""

import logging
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from config import DATA_DIR
import storage

logger = logging.getLogger(__name__)


def _replies_path(user_id: str) -> Path:
    """Path to user's reply tracking file."""
    p = DATA_DIR / str(user_id) / "reply_threads.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def get_tracked_threads(user_id: str) -> list[dict]:
    """Get all tracked reply threads for a user."""
    path = _replies_path(user_id)
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return []


def save_tracked_threads(user_id: str, threads: list[dict]):
    """Save tracked threads."""
    path = _replies_path(user_id)
    path.write_text(json.dumps(threads, ensure_ascii=False, indent=2), encoding="utf-8")


def track_posted_comment(user_id: str, item: dict):
    """
    After a comment is posted, start tracking it for replies.
    Called when a queue item is approved and posted.
    """
    threads = get_tracked_threads(user_id)
    thread = {
        "id": item.get("id", ""),
        "platform": item.get("platform", ""),
        "post_url": item.get("post_url", ""),
        "post_id": item.get("post_id", ""),
        "our_comment": item.get("comment", item.get("selected_comment", "")),
        "author_name": item.get("author_name", ""),
        "posted_at": datetime.now(timezone.utc).isoformat(),
        "replies": [],
        "reply_notified": False,
        "status": "tracking",  # tracking, replied, dismissed
    }
    threads.append(thread)
    # Keep only last 50 threads
    threads = threads[-50:]
    save_tracked_threads(user_id, threads)
    logger.info("Tracking thread for user=%s post_id=%s", user_id, item.get("post_id"))


def add_reply_to_thread(user_id: str, thread_id: str, reply: dict):
    """
    Add a detected reply to a tracked thread.
    """
    threads = get_tracked_threads(user_id)
    for thread in threads:
        if thread["id"] == thread_id:
            thread["replies"].append({
                "author": reply.get("author", "Unknown"),
                "text": reply.get("text", ""),
                "detected_at": datetime.now(timezone.utc).isoformat(),
            })
            thread["reply_notified"] = False
            thread["status"] = "replied"
            break
    save_tracked_threads(user_id, threads)


def get_pending_reply_notifications(user_id: str) -> list[dict]:
    """
    Get threads that have unnotified replies.
    After fetching, marks them as notified.
    """
    threads = get_tracked_threads(user_id)
    pending = []
    for thread in threads:
        if thread.get("status") == "replied" and not thread.get("reply_notified"):
            pending.append(thread)
            thread["reply_notified"] = True
    if pending:
        save_tracked_threads(user_id, threads)
    return pending


def generate_reply_suggestion(thread: dict, tone: str = "friendly") -> Optional[str]:
    """
    Generate an AI-suggested reply to continue the discussion.
    """
    try:
        import ai_comment

        context = (
            f"Original post context: {thread.get('post_url', '')}\n"
            f"Our previous comment: {thread.get('our_comment', '')}\n"
            f"Their reply: {thread['replies'][-1]['text'] if thread.get('replies') else ''}\n\n"
            f"Generate a natural, {tone} follow-up reply (3-25 words) that continues this discussion "
            f"without being pushy or self-promotional."
        )

        reply = ai_comment.generate_comment(context, thread.get("platform", "linkedin"), tone=tone)
        return reply
    except Exception as e:
        logger.error("Failed to generate reply suggestion: %s", e)
        return None


def get_reply_queue(user_id: str) -> list[dict]:
    """
    Get threads awaiting user decision on continuing discussion.
    Returns threads with replies that haven't been addressed.
    """
    threads = get_tracked_threads(user_id)
    reply_queue = []
    for thread in threads:
        if thread.get("status") == "replied" and thread.get("replies"):
            reply_queue.append({
                "thread_id": thread["id"],
                "platform": thread["platform"],
                "post_url": thread["post_url"],
                "our_comment": thread["our_comment"],
                "author_name": thread["author_name"],
                "latest_reply": thread["replies"][-1],
                "reply_count": len(thread["replies"]),
            })
    return reply_queue


def dismiss_reply_thread(user_id: str, thread_id: str):
    """Mark a thread as dismissed (user doesn't want to reply)."""
    threads = get_tracked_threads(user_id)
    for thread in threads:
        if thread["id"] == thread_id:
            thread["status"] = "dismissed"
            break
    save_tracked_threads(user_id, threads)
