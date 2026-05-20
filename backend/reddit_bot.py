"""
Engagr — Reddit Automation via PRAW (OAuth)
Handles: post scraping, commenting, and upvoting.
Uses OAuth2 refresh tokens — no passwords stored.
"""

import random
import logging
import praw

from config import (
    REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET,
    REDDIT_REDIRECT_URI, DAILY_LIMITS
)
import storage

logger = logging.getLogger(__name__)


def _get_reddit(user_id: str) -> praw.Reddit | None:
    """Get PRAW Reddit instance using per-user OAuth refresh token."""
    settings = storage.get_settings(user_id)
    reddit_cfg = settings.get("reddit", {})

    refresh_token = reddit_cfg.get("refresh_token", "")

    if not refresh_token:
        logger.warning(f"Reddit not connected for user {user_id} (no refresh token)")
        return None

    if not all([REDDIT_CLIENT_ID, REDDIT_CLIENT_SECRET]):
        logger.warning("Reddit app credentials (CLIENT_ID/SECRET) not configured")
        return None

    try:
        reddit = praw.Reddit(
            client_id=REDDIT_CLIENT_ID,
            client_secret=REDDIT_CLIENT_SECRET,
            refresh_token=refresh_token,
            redirect_uri=REDDIT_REDIRECT_URI,
            user_agent="Engagr:v1.0 (OAuth2)",
        )
        # Verify auth
        reddit.user.me()
        return reddit
    except Exception as e:
        logger.error(f"Reddit auth failed for user {user_id}: {e}")
        return None


def scrape_posts(user_id: str, max_posts: int = 10) -> list[dict]:
    """
    Scrape Reddit posts from user's configured subreddits matching keywords.
    Filters out: posts with < 5 upvotes, stickied posts.
    """
    reddit = _get_reddit(user_id)
    if not reddit:
        return []

    settings = storage.get_settings(user_id)
    reddit_cfg = settings.get("reddit", {})
    subreddits = reddit_cfg.get("subreddits", [])
    keywords = reddit_cfg.get("keywords", [])

    if not subreddits:
        logger.warning(f"No subreddits configured for user {user_id}")
        return []

    posts = []

    for sub_name in subreddits:
        try:
            subreddit = reddit.subreddit(sub_name)

            # Search by keywords if provided, otherwise get hot posts
            submissions = []
            if keywords:
                for keyword in keywords[:3]:
                    try:
                        results = subreddit.search(keyword, sort="new", time_filter="day", limit=5)
                        submissions.extend(list(results))
                    except Exception as e:
                        logger.debug(f"Search error in r/{sub_name} for '{keyword}': {e}")
            else:
                submissions = list(subreddit.hot(limit=10))

            for submission in submissions:
                try:
                    # Skip stickied, low engagement, or self-deleted
                    if submission.stickied:
                        continue
                    if submission.score < 5:
                        continue
                    if submission.author is None:
                        continue
                    if submission.is_self and not submission.selftext:
                        continue

                    # Skip hiring/spam
                    title_lower = submission.title.lower()
                    skip_words = ["hiring", "job opening", "looking for", "[hiring]"]
                    if any(w in title_lower for w in skip_words):
                        continue

                    text = submission.title
                    if submission.is_self and submission.selftext:
                        text += "\n\n" + submission.selftext

                    posts.append({
                        "id": f"rd_{submission.id}",
                        "platform": "reddit",
                        "reddit_id": submission.id,
                        "text": text[:500],
                        "excerpt": text[:200],
                        "url": f"https://reddit.com{submission.permalink}",
                        "reactions": submission.score,
                        "author": str(submission.author),
                        "subreddit": sub_name,
                    })

                except Exception as e:
                    logger.debug(f"Error processing submission: {e}")
                    continue

        except Exception as e:
            logger.error(f"Error scraping r/{sub_name}: {e}")
            continue

    # Deduplicate
    seen_ids = set()
    unique_posts = []
    for p in posts:
        if p["id"] not in seen_ids:
            seen_ids.add(p["id"])
            unique_posts.append(p)

    # Shuffle and limit
    random.shuffle(unique_posts)
    unique_posts = unique_posts[:max_posts]

    logger.info(f"Scraped {len(unique_posts)} Reddit posts for user {user_id}")
    return unique_posts


def post_comment(user_id: str, reddit_id: str, comment: str) -> bool:
    """Post a comment on a Reddit submission."""
    reddit = _get_reddit(user_id)
    if not reddit:
        return False

    try:
        submission = reddit.submission(id=reddit_id)
        submission.reply(comment)
        logger.info(f"Comment posted on reddit.com/r/{submission.subreddit}/{reddit_id}")
        return True
    except Exception as e:
        logger.error(f"Error posting Reddit comment: {e}")
        return False


def upvote_post(user_id: str, reddit_id: str) -> bool:
    """Upvote a Reddit submission."""
    reddit = _get_reddit(user_id)
    if not reddit:
        return False

    try:
        submission = reddit.submission(id=reddit_id)
        submission.upvote()
        logger.info(f"Upvoted reddit post {reddit_id}")
        return True
    except Exception as e:
        logger.error(f"Error upvoting Reddit post: {e}")
        return False
