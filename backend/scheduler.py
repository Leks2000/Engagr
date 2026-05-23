"""
Engagr — Scheduler
APScheduler-based session management.
Triggers scraping + comment generation at user-configured times.
"""

import random
import asyncio
import logging
import uuid
from datetime import datetime, timezone

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

from config import DAILY_LIMITS, DELAYS
import storage
import linkedin
import reddit_bot
import ai_comment

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")
_session_logs: dict[str, list[str]] = {}

# Reference to the bot's send function (set from telegram_bot.py)
_send_queue_item = None
_playwright = None


def set_send_callback(callback):
    global _send_queue_item
    _send_queue_item = callback


def set_playwright(pw):
    global _playwright
    _playwright = pw

def _log(user_id: str, message: str):
    line = f"[{datetime.now(timezone.utc).strftime('%H:%M:%S')}] {message}"
    logger.info("session[%s] %s", user_id, message)
    logs = _session_logs.setdefault(user_id, [])
    logs.append(line)
    if len(logs) > 200:
        del logs[:-200]

def get_session_logs(user_id: str) -> list[str]:
    return _session_logs.get(user_id, [])


def start_scheduler():
    """Start the APScheduler."""
    if not scheduler.running:
        scheduler.start()
        logger.info("Scheduler started")


def stop_scheduler():
    if scheduler.running:
        scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")


def schedule_user_sessions(user_id: str):
    """
    Schedule sessions for a user based on their settings.
    Removes old jobs and creates new ones.
    """
    # Remove existing jobs for this user
    existing_jobs = scheduler.get_jobs()
    for job in existing_jobs:
        if job.id.startswith(f"session_{user_id}_"):
            scheduler.remove_job(job.id)
    
    settings = storage.get_settings(user_id)
    
    if not settings.get("session_active", True):
        logger.info(f"Sessions paused for user {user_id}")
        return
    
    # Schedule LinkedIn sessions
    li_settings = settings.get("linkedin", {})
    if li_settings.get("connected", False):
        for i, time_str in enumerate(li_settings.get("session_times", [])):
            try:
                hour, minute = map(int, time_str.split(":"))
                jitter = li_settings.get("session_jitter_minutes", [3, 17])
                jitter_min = int(jitter[0]) if isinstance(jitter, list) and len(jitter) > 0 else 3
                jitter_max = int(jitter[1]) if isinstance(jitter, list) and len(jitter) > 1 else max(jitter_min, 17)
                offset = random.randint(min(jitter_min, jitter_max), max(jitter_min, jitter_max))
                total_minutes = hour * 60 + minute + offset
                hour = (total_minutes // 60) % 24
                minute = total_minutes % 60
                job_id = f"session_{user_id}_linkedin_{i}"
                scheduler.add_job(
                    run_linkedin_session,
                    CronTrigger(hour=hour, minute=minute),
                    id=job_id,
                    args=[user_id],
                    replace_existing=True,
                    misfire_grace_time=300,
                )
                logger.info(f"Scheduled LinkedIn session for user {user_id} at {time_str}")
            except (ValueError, AttributeError) as e:
                logger.error(f"Invalid time format '{time_str}': {e}")
    
    # Schedule Reddit sessions
    rd_settings = settings.get("reddit", {})
    if rd_settings.get("connected", False):
        for i, time_str in enumerate(rd_settings.get("session_times", [])):
            try:
                hour, minute = map(int, time_str.split(":"))
                job_id = f"session_{user_id}_reddit_{i}"
                scheduler.add_job(
                    run_reddit_session,
                    CronTrigger(hour=hour, minute=minute),
                    id=job_id,
                    args=[user_id],
                    replace_existing=True,
                    misfire_grace_time=300,
                )
                logger.info(f"Scheduled Reddit session for user {user_id} at {time_str}")
            except (ValueError, AttributeError) as e:
                logger.error(f"Invalid time format '{time_str}': {e}")


# ── Session Runners ───────────────────────────────────

async def run_linkedin_session(user_id: str):
    """Run a full LinkedIn engagement session."""
    logger.info(f"Starting LinkedIn session for user {user_id}")
    
    settings = storage.get_settings(user_id)
    if not settings.get("session_active", True):
        return
    
    stats = storage.get_stats(user_id)
    li_settings = settings.get("linkedin", {})
    keywords = li_settings.get("keywords", [])
    
    if not keywords:
        logger.warning(f"No LinkedIn keywords configured for user {user_id}")
        return
    
    try:
        # Check login
        if _playwright and not await linkedin.check_login(_playwright, user_id):
            if _send_queue_item:
                await _send_queue_item(user_id, {
                    "type": "error",
                    "message": "⚠️ LinkedIn cookies expired. Please re-login through the app."
                })
            return
        
        # Scrape posts
        posts = await linkedin.scrape_posts(_playwright, keywords, user_id=user_id) if _playwright else []
        
        # Calculate how many comments we can still post today
        configured_comments = li_settings.get("comments_per_day", 5)
        if li_settings.get("warmup_mode", False):
            started = li_settings.get("warmup_started_at") or datetime.now(timezone.utc).date().isoformat()
            try:
                start_dt = datetime.fromisoformat(started)
            except Exception:
                start_dt = datetime.now(timezone.utc)
            days = max((datetime.now(timezone.utc) - start_dt).days, 0)
            configured_comments = min(configured_comments, 1 + (days // 3))
            _log(user_id, f"Warm-up mode active: daily comments cap={configured_comments}")

        remaining_comments = min(
            configured_comments,
            li_settings.get("daily_comment_hard_limit", 10),
            DAILY_LIMITS["linkedin_comments"] - stats.get("linkedin_comments", 0)
        )
        _log(user_id, f"Found {len(posts)} posts. Planning up to {remaining_comments} comments.")
        
        # Generate comments and add to queue
        for post in posts[:remaining_comments]:
            try:
                cta = ""
                generated_so_far = stats.get("linkedin_comments", 0) + len([q for q in storage.get_queue(user_id) if q.get("platform") == "linkedin"])
                templates = li_settings.get("cta_templates", []) or []
                if templates and (generated_so_far + 1) % 10 == 0:
                    cta = random.choice(templates)
                comment = ai_comment.generate_comment(post["text"], "linkedin", tone=li_settings.get("tone", "friendly"))
                if cta:
                    comment = f"{comment} {cta}".strip()
                _log(user_id, f"Post found by keyword. Generated {li_settings.get('tone', 'friendly')} comment.")
                
                queue_item = {
                    "id": str(uuid.uuid4()),
                    "platform": "linkedin",
                    "post_id": post["id"],
                    "post_url": post.get("url", ""),
                    "post_excerpt": post["excerpt"],
                    "post_text": post["text"],
                    "comment": comment,
                    "status": "pending",
                    "author": post.get("author", ""),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                
                storage.add_to_queue(user_id, queue_item)
                
                # Send to Telegram for approval
                if _send_queue_item:
                    await _send_queue_item(user_id, queue_item)
                
                # Random delay between generating comments
                delay = random.uniform(3, 8)
                _log(user_id, f"Added random generation delay: {int(delay)} sec.")
                await asyncio.sleep(delay)
                
            except Exception as e:
                logger.error(f"Error generating comment for post: {e}")
                continue
        
        # Like posts
        remaining_likes = min(
            li_settings.get("likes_per_day", 5),
            DAILY_LIMITS["linkedin_likes"] - stats.get("linkedin_likes", 0)
        )
        
        for post in posts[:remaining_likes]:
            if post.get("url") and _playwright:
                try:
                    success = await linkedin.like_post(_playwright, post["url"], user_id=user_id)
                    if success:
                        storage.increment_stat(user_id, "linkedin_likes")
                    await asyncio.sleep(random.uniform(*DELAYS["like"]))
                except Exception as e:
                    logger.error(f"Error liking post: {e}")
        
        # Add connections
        if li_settings.get("add_people_by_keywords", False):
            add_range = li_settings.get("people_add_range", [1, 3])
            remaining_adds = min(
                random.randint(add_range[0], add_range[1]),
                DAILY_LIMITS["linkedin_adds"] - stats.get("linkedin_adds", 0)
            )
            
            add_keywords = li_settings.get("add_people_keywords", keywords)
            
            for _ in range(remaining_adds):
                if _playwright:
                    try:
                        result = await linkedin.add_connection(_playwright, user_id, add_keywords)
                        if result:
                            storage.increment_stat(user_id, "linkedin_adds")
                        await asyncio.sleep(random.uniform(*DELAYS["connection"]))
                    except Exception as e:
                        logger.error(f"Error adding connection: {e}")
        
        logger.info(f"LinkedIn session completed for user {user_id}")
        
    except Exception as e:
        logger.error(f"LinkedIn session error for user {user_id}: {e}")
        if _send_queue_item:
            await _send_queue_item(user_id, {
                "type": "error",
                "message": f"❌ LinkedIn session error: {str(e)[:200]}"
            })


async def run_reddit_session(user_id: str):
    """Run a full Reddit engagement session."""
    logger.info(f"Starting Reddit session for user {user_id}")
    
    settings = storage.get_settings(user_id)
    if not settings.get("session_active", True):
        return
    
    stats = storage.get_stats(user_id)
    rd_settings = settings.get("reddit", {})
    
    try:
        # Scrape posts
        posts = reddit_bot.scrape_posts(user_id)
        
        # Calculate remaining comments
        remaining_comments = min(
            rd_settings.get("comments_per_day", 5),
            DAILY_LIMITS["reddit_comments"] - stats.get("reddit_comments", 0)
        )
        
        # Generate comments and add to queue
        for post in posts[:remaining_comments]:
            try:
                comment = ai_comment.generate_comment(post["text"], "reddit")
                
                queue_item = {
                    "id": str(uuid.uuid4()),
                    "platform": "reddit",
                    "post_id": post["id"],
                    "reddit_id": post.get("reddit_id", ""),
                    "post_url": post.get("url", ""),
                    "post_excerpt": post["excerpt"],
                    "post_text": post["text"],
                    "comment": comment,
                    "status": "pending",
                    "author": post.get("author", ""),
                    "subreddit": post.get("subreddit", ""),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                
                storage.add_to_queue(user_id, queue_item)
                
                if _send_queue_item:
                    await _send_queue_item(user_id, queue_item)
                
                await asyncio.sleep(random.uniform(3, 8))
                
            except Exception as e:
                logger.error(f"Error generating Reddit comment: {e}")
                continue
        
        # Upvote posts
        remaining_upvotes = min(
            rd_settings.get("upvotes_per_day", 5),
            DAILY_LIMITS["reddit_upvotes"] - stats.get("reddit_upvotes", 0)
        )
        
        for post in posts[:remaining_upvotes]:
            try:
                success = reddit_bot.upvote_post(user_id, post.get("reddit_id", ""))
                if success:
                    storage.increment_stat(user_id, "reddit_upvotes")
                await asyncio.sleep(random.uniform(*DELAYS["like"]))
            except Exception as e:
                logger.error(f"Error upvoting Reddit post: {e}")
        
        logger.info(f"Reddit session completed for user {user_id}")
        
    except Exception as e:
        logger.error(f"Reddit session error for user {user_id}: {e}")
        if _send_queue_item:
            await _send_queue_item(user_id, {
                "type": "error",
                "message": f"❌ Reddit session error: {str(e)[:200]}"
            })
