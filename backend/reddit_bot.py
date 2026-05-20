"""
Engagr — Reddit Automation via Cookie Session
Handles: post scraping, commenting, and upvoting.
Uses saved browser cookies — no Reddit app / OAuth required.
Playwright logs in once → cookies saved → requests.Session for everything.
"""

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
    session.headers.update({
        "User-Agent": _USER_AGENT,
    })

    for c in cookies_list:
        session.cookies.set(
            c["name"], c["value"],
            domain=c.get("domain", ".reddit.com"),
            path=c.get("path", "/"),
        )

    return session


def _get_modhash(session: http_requests.Session) -> str:
    """Fetch modhash (CSRF token) required for POST requests."""
    try:
        resp = session.get("https://www.reddit.com/api/me.json", timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            return data.get("data", {}).get("modhash", "")
    except Exception as e:
        logger.error(f"Failed to get modhash: {e}")
    return ""


def check_login(user_id: str) -> bool:
    """Verify if Reddit cookies are still valid."""
    session = _get_session(user_id)
    if not session:
        return False
    try:
        resp = session.get("https://www.reddit.com/api/me.json", timeout=15)
        if resp.status_code == 200:
            data = resp.json()
            name = data.get("data", {}).get("name", "")
            return bool(name)
    except Exception as e:
        logger.error(f"Reddit login check failed: {e}")
    return False


# ── Playwright Login (one-time) ──────────────────────

def login_with_playwright(user_id: str, username: str, password: str) -> tuple[bool, str]:
    """
    Use Playwright (sync) to log in to Reddit and save cookies.
    Called from the Flask API endpoint.
    Returns (success, error_message).
    """
    from playwright.sync_api import sync_playwright

    cpath = reddit_cookies_path(user_id)
    cpath.parent.mkdir(parents=True, exist_ok=True)

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(
                headless=True,
                args=["--no-sandbox", "--disable-dev-shm-usage"],
            )
            context = browser.new_context(
                viewport={"width": 1280, "height": 800},
                user_agent=_USER_AGENT,
            )
            page = context.new_page()

            # Go to Reddit login
            page.goto("https://www.reddit.com/login", wait_until="domcontentloaded", timeout=30000)
            time.sleep(2)

            # Fill credentials
            page.fill('input[name="username"]', username)
            page.fill('input[name="password"]', password)
            time.sleep(0.5)

            # Submit
            page.click('button[type="submit"]')
            time.sleep(5)

            # Check result
            current_url = page.url
            if "/login" in current_url:
                # Try the new Reddit login form (different selectors)
                try:
                    error_el = page.query_selector('[class*="error"], [class*="Error"]')
                    error_text = error_el.inner_text() if error_el else ""
                except Exception:
                    error_text = ""
                browser.close()
                return False, error_text or "Login failed — check credentials"

            # Save cookies
            cookies = context.cookies()
            cpath.write_text(json.dumps(cookies, indent=2), encoding="utf-8")

            # Get username to confirm
            reddit_name = ""
            try:
                page.goto("https://www.reddit.com/api/me.json", wait_until="domcontentloaded", timeout=15000)
                time.sleep(1)
                body = page.inner_text("body")
                me_data = json.loads(body)
                reddit_name = me_data.get("data", {}).get("name", "")
            except Exception:
                reddit_name = username

            browser.close()
            logger.info(f"Reddit login OK for user {user_id} as u/{reddit_name}")
            return True, reddit_name

    except Exception as e:
        logger.error(f"Reddit Playwright login error: {e}")
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
    headers = {"User-Agent": _USER_AGENT}

    for sub_name in subreddits:
        try:
            if keywords:
                for keyword in keywords[:3]:
                    url = (
                        f"https://www.reddit.com/r/{sub_name}/search.json"
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
                url = f"https://www.reddit.com/r/{sub_name}/hot.json?limit=10"
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
            "https://www.reddit.com/api/comment",
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
            "https://www.reddit.com/api/vote",
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
