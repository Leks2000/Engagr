"""
Execute approved queue items (comments, likes, upvotes).
"""

from __future__ import annotations

import logging

import linkedin
import reddit_bot
import reddit_public
import storage

logger = logging.getLogger(__name__)


async def execute_queue_item(user_id: str, item: dict) -> tuple[bool, str]:
    """
    Run an approved queue action.
    Returns (success, user-facing status message).
    """
    action = item.get("action", "comment")
    platform = item.get("platform", "")

    if platform == "linkedin":
        if not await linkedin.check_login(user_id=user_id):
            return False, "LinkedIn session expired. Reconnect via li_at cookie in the app."

        if action == "like":
            url = item.get("post_url", "")
            if not url:
                return False, "Missing post URL."
            ok = await linkedin.like_post(None, url, user_id=user_id)
            if ok:
                storage.increment_stat(user_id, "linkedin_likes")
            return ok, "Like posted!" if ok else "Failed to like post."

        if action == "connect":
            keywords = item.get("keywords") or []
            ok = await linkedin.add_connection(None, user_id, keywords)
            if ok:
                storage.increment_stat(user_id, "linkedin_adds")
            return ok, "Connection request sent!" if ok else "Failed to send connection."

        url = item.get("post_url", "")
        comment = item.get("comment", "")
        if not url or not comment:
            return False, "Missing post URL or comment."
        ok = await linkedin.post_comment(None, url, comment, user_id=user_id)
        if ok:
            storage.increment_stat(user_id, "linkedin_comments")
        return ok, "Comment posted!" if ok else "Failed to post comment."

    if platform == "reddit":
        reddit_id = item.get("reddit_id", "")
        if action == "upvote":
            if reddit_bot.has_posting_credentials(user_id) and reddit_id:
                ok = reddit_bot.upvote_post(user_id, reddit_id)
                if ok:
                    storage.increment_stat(user_id, "reddit_upvotes")
                    reddit_public.mark_seen(user_id, reddit_id)
                return ok, "Upvoted!" if ok else "Failed to upvote."
            return False, _reddit_manual_message(item, "upvote")

        comment = item.get("comment", "")
        if reddit_bot.has_posting_credentials(user_id) and reddit_id and comment:
            ok = reddit_bot.post_comment(user_id, reddit_id, comment)
            if ok:
                storage.increment_stat(user_id, "reddit_comments")
                reddit_public.mark_seen(user_id, reddit_id)
            return ok, "Comment posted!" if ok else "Failed to post comment."
        return False, _reddit_manual_message(item, "comment")

    return False, "Unknown platform."


def _reddit_manual_message(item: dict, action: str) -> str:
  url = item.get("post_url") or item.get("url", "")
  comment = item.get("comment", "")
  if action == "upvote":
    return (
      f"No Reddit login — upvote manually:\n{url}"
    )
  return (
    "No Reddit API login — post manually:\n"
    f"{url}\n\n"
    f"Suggested comment:\n{comment}"
  )
