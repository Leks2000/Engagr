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
import reddit_public
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

def add_session_log(user_id: str, message: str):
    """Add a user-visible diagnostic line to the session log."""
    _log(user_id, message)


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
    import daily_digest

    existing_jobs = scheduler.get_jobs()
    for job in existing_jobs:
        if job.id.startswith(f"session_{user_id}_") or job.id == f"digest_{user_id}":
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
    
    # Schedule Reddit sessions (discovery works without Reddit API login)
    rd_settings = settings.get("reddit", {})
    if rd_settings.get("connected", False) or rd_settings.get("subreddits"):
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

    if settings.get("session_active", True) and settings.get("news_grounding_enabled", True):
        try:
            digest_time = daily_digest.get_digest_schedule_time(user_id)
            dh, dm = map(int, digest_time.split(":"))
            scheduler.add_job(
                run_daily_digest_job,
                CronTrigger(hour=dh, minute=dm),
                id=f"digest_{user_id}",
                args=[user_id],
                replace_existing=True,
                misfire_grace_time=600,
            )
            logger.info("Scheduled daily digest for user %s at %s UTC", user_id, digest_time)
        except (ValueError, AttributeError) as e:
            logger.error("Invalid digest time for user %s: %s", user_id, e)


def reschedule_all_users():
    """Re-register cron jobs for every user data folder (on server boot)."""
    from config import DATA_DIR

    if not DATA_DIR.exists():
        return
    count = 0
    for user_dir in DATA_DIR.iterdir():
        if user_dir.is_dir() and user_dir.name.isdigit():
            schedule_user_sessions(user_dir.name)
            count += 1
    logger.info("Rescheduled sessions for %s users", count)


async def run_daily_digest_job(user_id: str):
    import daily_digest
    await daily_digest.send_daily_digest(user_id)


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
        linkedin.ensure_client(user_id)
        if not await linkedin.check_login(user_id=user_id):
            if _send_queue_item:
                await _send_queue_item(user_id, {
                    "type": "error",
                    "message": "⚠️ LinkedIn not connected. Add li_at cookie in the Mini App (Settings → LinkedIn).",
                })
            return

        posts = await linkedin.scrape_posts(None, keywords, user_id=user_id)
        if not posts:
            auth = linkedin._load_auth(user_id)
            if auth.get("access_token") and not auth.get("li_at"):
                _log(user_id, "Feed empty — OAuth cannot search global feed. Add li_at cookie for discovery.")
        
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
                comment = ai_comment.generate_comment(post["text"], "linkedin", tone=li_settings.get("tone", "friendly"), user_id=user_id)
                if cta:
                    comment = f"{comment} {cta}".strip()
                _log(user_id, f"Post found by keyword. Generated {li_settings.get('tone', 'friendly')} comment.")
                
                queue_item = {
                    "id": str(uuid.uuid4()),
                    "platform": "linkedin",
                    "action": "comment",
                    "post_id": post["id"],
                    "post_url": post.get("url", ""),
                    "post_excerpt": post.get("excerpt", post.get("text", "")[:200]),
                    "post_text": post["text"],
                    "comment": comment,
                    "status": "pending",
                    "author": post.get("author", "") or post.get("author_name", ""),
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
        
        # Suggest likes (human approval in DM)
        remaining_likes = min(
            li_settings.get("likes_per_day", 5),
            DAILY_LIMITS["linkedin_likes"] - stats.get("linkedin_likes", 0),
        )
        liked_urls = {q.get("post_url") for q in storage.get_queue(user_id) if q.get("action") == "like"}
        like_candidates = [p for p in posts if p.get("url") and p["url"] not in liked_urls]

        for post in like_candidates[:remaining_likes]:
            try:
                like_item = {
                    "id": str(uuid.uuid4()),
                    "platform": "linkedin",
                    "action": "like",
                    "post_id": post.get("id", ""),
                    "post_url": post.get("url", ""),
                    "post_excerpt": post.get("excerpt", post.get("text", "")[:200]),
                    "post_text": post.get("text", ""),
                    "comment": "",
                    "status": "pending",
                    "author": post.get("author", "") or post.get("author_name", ""),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                storage.add_to_queue(user_id, like_item)
                if _send_queue_item:
                    await _send_queue_item(user_id, like_item)
                await asyncio.sleep(random.uniform(2, 5))
            except Exception as e:
                logger.error("Error queueing LinkedIn like: %s", e)
        
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
        configured_subs = rd_settings.get("subreddits") or []
        configured_keywords = rd_settings.get("keywords") or []
        if not configured_keywords:
            configured_keywords = (settings.get("linkedin") or {}).get("keywords") or []
        _log(
            user_id,
            "🔍 Reddit parsing: "
            f"subreddits={', '.join(configured_subs[:5]) if configured_subs else 'auto'}; "
            f"keywords={', '.join(configured_keywords[:5]) if configured_keywords else 'default'}",
        )
        posts = reddit_public.scrape_posts(user_id, max_posts=rd_settings.get("comments_per_day", 5) * 3)
        diagnostics = reddit_public.get_last_diagnostics(user_id)
        if diagnostics:
            _log(
                user_id,
                "📄 Reddit parsed "
                f"{diagnostics.get('parsed', 0)} posts from {len(diagnostics.get('subreddits', []))} subreddits; "
                f"relevant={diagnostics.get('relevant', 0)}; returning={diagnostics.get('returning', 0)}",
            )
            if diagnostics.get("reject_reasons") and diagnostics.get("returning", 0) == 0:
                top_reasons = sorted(
                    diagnostics["reject_reasons"].items(),
                    key=lambda item: item[1],
                    reverse=True,
                )[:3]
                _log(user_id, "ℹ️ Reddit filtered out: " + ", ".join(f"{reason}={count}" for reason, count in top_reasons))
        if not posts and reddit_bot.has_posting_credentials(user_id):
            _log(user_id, "⚠️ Public Reddit parser found 0 posts; trying account-cookie fallback.")
            posts = reddit_bot.scrape_posts(user_id)
        
        # Calculate remaining comments
        remaining_comments = min(
            rd_settings.get("comments_per_day", 5),
            DAILY_LIMITS["reddit_comments"] - stats.get("reddit_comments", 0)
        )
        
        if not posts:
            _log(user_id, "⚠️ Reddit queued 0 items. Check subreddits/keywords or parser diagnostics above.")

        # Generate comments and add to queue
        queued_comments = 0
        for post in posts[:remaining_comments]:
            try:
                comment = ai_comment.generate_comment(post["text"], "reddit", user_id=user_id)
                
                queue_item = {
                    "id": str(uuid.uuid4()),
                    "platform": "reddit",
                    "action": "comment",
                    "post_id": post.get("id", post.get("post_id", "")),
                    "reddit_id": post.get("reddit_id", post.get("post_id", "")),
                    "post_url": post.get("url") or post.get("link", ""),
                    "post_excerpt": post.get("excerpt", post.get("text", "")[:200]),
                    "post_text": post.get("text", ""),
                    "comment": comment,
                    "status": "pending",
                    "author": post.get("author", ""),
                    "subreddit": post.get("subreddit", post.get("sub", "")),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                
                storage.add_to_queue(user_id, queue_item)
                queued_comments += 1
                
                if _send_queue_item:
                    await _send_queue_item(user_id, queue_item)
                
                await asyncio.sleep(random.uniform(3, 8))
                
            except Exception as e:
                logger.error(f"Error generating Reddit comment: {e}")
                continue
        
        if queued_comments:
            _log(user_id, f"✅ Reddit queued {queued_comments} comments for review.")

        remaining_upvotes = min(
            rd_settings.get("upvotes_per_day", 5),
            DAILY_LIMITS["reddit_upvotes"] - stats.get("reddit_upvotes", 0),
        )
        upvote_ids = {
            q.get("reddit_id") for q in storage.get_queue(user_id) if q.get("action") == "upvote"
        }

        for post in posts[:remaining_upvotes]:
            rid = post.get("reddit_id", post.get("post_id", ""))
            if not rid or rid in upvote_ids:
                continue
            try:
                upvote_item = {
                    "id": str(uuid.uuid4()),
                    "platform": "reddit",
                    "action": "upvote",
                    "post_id": post.get("id", f"rd_{rid}"),
                    "reddit_id": rid,
                    "post_url": post.get("url") or post.get("link", ""),
                    "post_excerpt": post.get("excerpt", post.get("text", "")[:200]),
                    "post_text": post.get("text", ""),
                    "comment": "",
                    "status": "pending",
                    "author": post.get("author", ""),
                    "subreddit": post.get("subreddit", post.get("sub", "")),
                    "created_at": datetime.now(timezone.utc).isoformat(),
                }
                storage.add_to_queue(user_id, upvote_item)
                if _send_queue_item:
                    await _send_queue_item(user_id, upvote_item)
                await asyncio.sleep(random.uniform(2, 5))
            except Exception as e:
                logger.error("Error queueing Reddit upvote: %s", e)
        
        logger.info(f"Reddit session completed for user {user_id}")
        
    except Exception as e:
        logger.error(f"Reddit session error for user {user_id}: {e}")
        if _send_queue_item:
            await _send_queue_item(user_id, {
                "type": "error",
                "message": f"❌ Reddit session error: {str(e)[:200]}"
            })
