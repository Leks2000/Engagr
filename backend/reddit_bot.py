"""Engagr — Reddit automation via OAuth2 + requests (no browser)."""

import json
import random
import logging
import time

import requests as http_requests

from config import reddit_cookies_path, DAILY_LIMITS, DATA_DIR
import storage

logger = logging.getLogger(__name__)

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


# ── Cookie-based session ─────────────────────────────

def _get_session(user_id: str) -> http_requests.Session | None:
    """Build a requests.Session using saved Reddit cookies."""
    cpath = reddit_cookies_path(user_id)
    if not cpath.exists():
        logger.warning(f"No Reddit cookies for user {user_id}")
        return None

    try:
        cookies_list = json.loads(cpath.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        logger.error(f"Error reading Reddit cookies: {e}")
        return None

    session = http_requests.Session()
    session.headers.update({"User-Agent": _USER_AGENT})

    for c in cookies_list:
        session.cookies.set(
            c["name"], c["value"],
            domain=c.get("domain", ".reddit.com"),
            path=c.get("path", "/"),
        )

    return session




def check_login(user_id: str) -> bool:
    """Verify if Reddit cookies are still valid."""
    session = _get_session(user_id)
    if not session:
        return False
    try:
        token = session.cookies.get("oauth_token")
        headers = {"Authorization": f"bearer {token}", "User-Agent": _USER_AGENT}
        resp = session.get("https://oauth.reddit.com/api/v1/me", headers=headers, timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            name = data.get("name", "")
            return bool(name)
    except Exception as e:
        logger.error(f"Reddit login check failed: {e}")
    return False


# ── Playwright Login (one-time) ──────────────────────

def login_with_playwright(user_id: str, username: str, password: str) -> tuple[bool, str]:
    """Backward-compatible name; now performs OAuth2 password grant login."""
    session = http_requests.Session()
    session.headers.update({"User-Agent": _USER_AGENT})
    try:
        resp = session.post(
            "https://www.reddit.com/api/v1/access_token",
            auth=http_requests.auth.HTTPBasicAuth("", ""),
            data={
                "grant_type": "password",
                "username": username,
                "password": password,
                "scope": "identity history read submit vote",
            },
            headers={"User-Agent": _USER_AGENT},
            timeout=20,
        )
        if resp.status_code != 200:
            return False, "Login failed — check credentials"
        token = resp.json().get("access_token")
        if not token:
            return False, "Login failed — no access token"

        # Fetch username from OAuth API
        oauth_headers = {"Authorization": f"bearer {token}", "User-Agent": _USER_AGENT}
        me = session.get("https://oauth.reddit.com/api/v1/me", headers=oauth_headers, timeout=15)
        if me.status_code != 200:
            return False, "Login failed — unable to fetch profile"
        reddit_name = me.json().get("name", username)

        cpath = reddit_cookies_path(user_id)
        cpath.parent.mkdir(parents=True, exist_ok=True)
        cpath.write_text(json.dumps([{"name": "oauth_token", "value": token, "domain": "oauth.reddit.com", "path": "/"}], indent=2), encoding="utf-8")
        logger.info(f"Reddit login OK for user {user_id} as u/{reddit_name}")
        return True, reddit_name
    except Exception as e:
        logger.error(f"Reddit OAuth login error: {e}")
        return False, str(e)


# ── Post Scraping ────────────────────────────────────

def scrape_posts(user_id: str, max_posts: int = 10) -> list[dict]:
    """
    Scrape Reddit posts from user's configured subreddits matching keywords.
    Uses requests + cookies (JSON API).
    """
    session = _get_session(user_id)
    if not session:
        return []

    settings = storage.get_settings(user_id)
    reddit_cfg = settings.get("reddit", {})
    subreddits = reddit_cfg.get("subreddits", [])
    keywords = reddit_cfg.get("keywords", [])

    if not subreddits:
        logger.warning(f"No subreddits configured for user {user_id}")
        return []

    posts = []
    token = session.cookies.get("oauth_token")
    headers = {"User-Agent": _USER_AGENT, "Authorization": f"bearer {token}"}

    for sub_name in subreddits:
        try:
            if keywords:
                for keyword in keywords[:3]:
                    url = (
                        f"https://oauth.reddit.com/r/{sub_name}/search"
                        f"?q={keyword}&sort=new&t=day&restrict_sr=on&limit=5"
                    )
                    try:
                        resp = session.get(url, headers=headers, timeout=15)
                        if resp.status_code != 200:
                            continue
                        data = resp.json()
                        children = data.get("data", {}).get("children", [])
                        for child in children:
                            post = child.get("data", {})
                            posts.append(_parse_post(post, sub_name))
                        time.sleep(random.uniform(1, 3))
                    except Exception as e:
                        logger.debug(f"Search error in r/{sub_name}: {e}")
            else:
                url = f"https://oauth.reddit.com/r/{sub_name}/hot?limit=10"
                resp = session.get(url, headers=headers, timeout=15)
                if resp.status_code == 200:
                    data = resp.json()
                    children = data.get("data", {}).get("children", [])
                    for child in children:
                        post = child.get("data", {})
                        posts.append(_parse_post(post, sub_name))

            time.sleep(random.uniform(1, 3))

        except Exception as e:
            logger.error(f"Error scraping r/{sub_name}: {e}")
            continue

    # Filter valid + deduplicate
    seen_ids = set()
    unique = []
    for p in posts:
        if p and p["id"] not in seen_ids:
            seen_ids.add(p["id"])
            unique.append(p)

    random.shuffle(unique)
    unique = unique[:max_posts]
    logger.info(f"Scraped {len(unique)} Reddit posts for user {user_id}")
    return unique


def _parse_post(post: dict, sub_name: str) -> dict | None:
    """Parse a single Reddit JSON post into our format."""
    try:
        if post.get("stickied"):
            return None
        if post.get("score", 0) < 5:
            return None
        if not post.get("author"):
            return None

        title = post.get("title", "")
        selftext = post.get("selftext", "")
        text = title
        if selftext:
            text += "\n\n" + selftext

        if not text or len(text) < 15:
            return None

        # Skip hiring/spam
        title_lower = title.lower()
        skip_words = ["hiring", "job opening", "looking for", "[hiring]"]
        if any(w in title_lower for w in skip_words):
            return None

        return {
            "id": f"rd_{post['id']}",
            "platform": "reddit",
            "reddit_id": post["id"],
            "text": text[:500],
            "excerpt": text[:200],
            "url": f"https://reddit.com{post.get('permalink', '')}",
            "reactions": post.get("score", 0),
            "author": post.get("author", ""),
            "subreddit": sub_name,
        }
    except Exception:
        return None


# ── Actions ──────────────────────────────────────────

def post_comment(user_id: str, reddit_id: str, comment: str) -> bool:
    """Post a comment on a Reddit submission using cookies."""
    session = _get_session(user_id)
    if not session:
        return False

    modhash = _get_modhash(session)
    if not modhash:
        logger.error("No modhash — cookies may be expired")
        return False

    try:
        resp = session.post(
            "https://oauth.reddit.com/api/comment",
            data={
                "thing_id": f"t3_{reddit_id}",
                "text": comment,
                "uh": modhash,
            },
            headers={"User-Agent": _USER_AGENT, "X-Modhash": modhash},
            timeout=15,
        )

        if resp.status_code == 200:
            result = resp.json()
            if not result.get("json", {}).get("errors"):
                logger.info(f"Comment posted on reddit t3_{reddit_id}")
                return True
            else:
                logger.error(f"Reddit comment errors: {result['json']['errors']}")
        else:
            logger.error(f"Reddit comment failed: {resp.status_code}")

        return False

    except Exception as e:
        logger.error(f"Error posting Reddit comment: {e}")
        return False


def upvote_post(user_id: str, reddit_id: str) -> bool:
    """Upvote a Reddit submission using cookies."""
    session = _get_session(user_id)
    if not session:
        return False

    modhash = _get_modhash(session)
    if not modhash:
        return False

    try:
        resp = session.post(
            "https://oauth.reddit.com/api/vote",
            data={
                "id": f"t3_{reddit_id}",
                "dir": 1,
                "uh": modhash,
            },
            headers={"User-Agent": _USER_AGENT, "X-Modhash": modhash},
            timeout=15,
        )

        if resp.status_code == 200:
            logger.info(f"Upvoted reddit post {reddit_id}")
            return True
        return False

    except Exception as e:
        logger.error(f"Error upvoting Reddit post: {e}")
        return False
