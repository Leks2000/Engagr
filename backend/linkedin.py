"""LinkedIn integration via unofficial linkedin-api (no browser automation)."""

import logging
from linkedin_api import Linkedin

logger = logging.getLogger(__name__)

_clients: dict[str, Linkedin] = {}


def _verification_required(exc: Exception) -> bool:
    text = str(exc).lower()
    return any(k in text for k in ["challenge", "checkpoint", "verify", "verification", "security"])


def login_with_playwright(user_id: str, email: str, password: str) -> tuple[bool, str]:
    """Backward-compatible name; now uses linkedin-api HTTP session login."""
    try:
        client = Linkedin(email, password)
        _ = client.get_profile("me")
        _clients[user_id] = client
        logger.info("LinkedIn login OK for user %s", user_id)
        return True, ""
    except Exception as e:
        logger.error("LinkedIn login error: %s", e)
        if _verification_required(e):
            return False, "verification_required"
        return False, "Login failed — check email/password"


async def check_login(_playwright_unused=None, user_id: str | None = None) -> bool:
    client = _clients.get(user_id or "")
    if not client:
        return False
    try:
        client.get_profile("me")
        return True
    except Exception:
        return False


async def scrape_posts(_playwright_unused, keywords: list[str], max_posts: int = 10, user_id: str | None = None) -> list[dict]:
    """Best-effort feed replacement: returns empty list when post search is unavailable."""
    client = _clients.get(user_id or "")
    if not client:
        return []
    posts: list[dict] = []
    try:
        for kw in keywords[:5]:
            try:
                # linkedin-api does not reliably expose public content search across all accounts.
                # Keep compatibility by returning no posts when unavailable.
                _ = client.search_people(keywords=kw, limit=1)
            except Exception:
                continue
            if len(posts) >= max_posts:
                break
    except Exception as e:
        logger.error("LinkedIn scrape error: %s", e)
    return posts[:max_posts]


async def post_comment(_playwright_unused, post_url: str, comment: str, user_id: str | None = None) -> bool:
    logger.warning("LinkedIn comment not supported with current HTTP-only implementation. url=%s", post_url)
    return False


async def like_post(_playwright_unused, post_url: str, user_id: str | None = None) -> bool:
    logger.warning("LinkedIn like not supported with current HTTP-only implementation. url=%s", post_url)
    return False


async def add_connection(_playwright_unused, user_id: str, keywords: list[str]):
    logger.warning("LinkedIn add_connection not supported with current HTTP-only implementation. keywords=%s", keywords)
    return None
