"""Engagr — Reddit posting via asyncpraw (optional; discovery uses reddit_public)."""

import asyncio
import json
import logging

import asyncpraw
from asyncprawcore import Forbidden, OAuthException, ResponseException

from config import reddit_cookies_path
import storage

logger = logging.getLogger(__name__)


def _creds_path(user_id: str):
    from config import DATA_DIR
    from pathlib import Path
    return Path(DATA_DIR) / str(user_id) / "reddit_credentials.json"


def _save_credentials(user_id: str, username: str, password: str):
    path = _creds_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"username": username, "password": password}, indent=2), encoding="utf-8")


def _load_credentials(user_id: str) -> dict | None:
    path = _creds_path(user_id)
    if not path.exists():
        return None
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        if data.get("username") and data.get("password"):
            return data
    except (OSError, json.JSONDecodeError):
        return None
    return None


def save_cookies(user_id: str, reddit_session: str, token_v2: str):
    path = reddit_cookies_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps({"reddit_session": reddit_session, "token_v2": token_v2}, indent=2),
        encoding="utf-8",
    )


def _load_cookies(user_id: str) -> dict:
    path = reddit_cookies_path(user_id)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}


def has_posting_credentials(user_id: str) -> bool:
    return bool(_load_credentials(user_id))


def verify_cookie_login(user_id: str, reddit_session: str, token_v2: str) -> tuple[bool, str]:
    """Save browser cookies for future posting; marks user as connected."""
    if not reddit_session or not token_v2:
        return False, ""
    save_cookies(user_id, reddit_session, token_v2)
    # Cookie-based HTTP posting can be added later; discovery does not need it.
    return True, "reddit_cookie"


async def _build_client(user_id: str):
    creds = _load_credentials(user_id)
    if not creds:
        return None
    return asyncpraw.Reddit(
        client_id="",
        client_secret="",
        username=creds["username"],
        password=creds["password"],
        user_agent=f"engagr-bot:{user_id}:v1.0",
        check_for_async=False,
    )


async def _verify_client(client):
    me = await client.user.me()
    return me.name if me else ""


def check_login(user_id: str) -> bool:
    async def _inner():
        client = await _build_client(user_id)
        if not client:
            return False
        try:
            return bool(await _verify_client(client))
        except (OAuthException, ResponseException, Forbidden) as e:
            logger.warning("Reddit auth invalid for user %s: %s", user_id, e)
            return False
        finally:
            await client.close()

    return asyncio.run(_inner())


def login_with_playwright(user_id: str, username: str, password: str) -> tuple[bool, str]:
    async def _inner():
        client = asyncpraw.Reddit(
            client_id="",
            client_secret="",
            username=username,
            password=password,
            user_agent=f"engagr-bot:{user_id}:v1.0",
            check_for_async=False,
        )
        try:
            profile_name = await _verify_client(client)
            if not profile_name:
                return False, "Login failed — unable to fetch profile"
            _save_credentials(user_id, username, password)
            logger.info("Reddit login OK for user %s as u/%s", user_id, profile_name)
            return True, profile_name
        except (OAuthException, ResponseException, Forbidden) as e:
            logger.error("Reddit login auth error: %s", e)
            return False, "Login failed — check username/password"
        except Exception as e:
            logger.error("Reddit login error: %s", e)
            return False, str(e)
        finally:
            await client.close()

    return asyncio.run(_inner())


def scrape_posts(user_id: str, max_posts: int = 10) -> list[dict]:
    async def _inner():
        client = await _build_client(user_id)
        if not client:
            return []
        settings = storage.get_settings(user_id)
        reddit_cfg = settings.get("reddit", {})
        subreddits = reddit_cfg.get("subreddits", [])
        keywords = [k.strip().lower() for k in reddit_cfg.get("keywords", []) if k.strip()]
        if not subreddits:
            return []
        posts, seen = [], set()
        try:
            for sub_name in subreddits:
                sub = await client.subreddit(sub_name)
                async for submission in sub.new(limit=20):
                    text = f"{submission.title}\n\n{submission.selftext or ''}".strip()
                    if len(text) < 15:
                        continue
                    if keywords and not any(k in text.lower() for k in keywords):
                        continue
                    pid = f"rd_{submission.id}"
                    if pid in seen:
                        continue
                    seen.add(pid)
                    posts.append({
                        "id": pid,
                        "platform": "reddit",
                        "reddit_id": submission.id,
                        "text": text[:500],
                        "excerpt": text[:200],
                        "url": f"https://reddit.com{submission.permalink}",
                        "reactions": submission.score,
                        "author": str(submission.author) if submission.author else "",
                        "subreddit": sub_name,
                    })
                    if len(posts) >= max_posts:
                        return posts
        except (OAuthException, ResponseException, Forbidden) as e:
            logger.error("Reddit scrape auth error for user %s: %s", user_id, e)
            return []
        except Exception as e:
            logger.error("Reddit scrape error for user %s: %s", user_id, e)
            return []
        finally:
            await client.close()
        return posts

    return asyncio.run(_inner())


def post_comment(user_id: str, reddit_id: str, comment: str) -> bool:
    async def _inner():
        client = await _build_client(user_id)
        if not client:
            return False
        try:
            submission = await client.submission(id=reddit_id)
            await submission.reply(comment)
            return True
        except (OAuthException, ResponseException, Forbidden) as e:
            logger.error("Reddit comment auth error user=%s post=%s err=%s", user_id, reddit_id, e)
            return False
        except Exception as e:
            logger.error("Reddit comment failed user=%s post=%s err=%s", user_id, reddit_id, e)
            return False
        finally:
            await client.close()

    return asyncio.run(_inner())


def upvote_post(user_id: str, reddit_id: str) -> bool:
    async def _inner():
        client = await _build_client(user_id)
        if not client:
            return False
        try:
            submission = await client.submission(id=reddit_id)
            await submission.upvote()
            return True
        except (OAuthException, ResponseException, Forbidden) as e:
            logger.error("Reddit upvote auth error user=%s post=%s err=%s", user_id, reddit_id, e)
            return False
        except Exception as e:
            logger.error("Reddit upvote failed user=%s post=%s err=%s", user_id, reddit_id, e)
            return False
        finally:
            await client.close()

    return asyncio.run(_inner())
