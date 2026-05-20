"""
Engagr — LinkedIn Automation via Playwright
Handles: cookie login, post scraping, commenting, liking, and connection requests.
Uses per-user saved cookies for authentication.
"""

import json
import random
import asyncio
import time
import logging
from pathlib import Path

from config import COOKIES_PATH, linkedin_cookies_path, DELAYS, DAILY_LIMITS, DATA_DIR
import storage

logger = logging.getLogger(__name__)

_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)


# ── Playwright Login (one-time, from Flask endpoint) ──

def login_with_playwright(user_id: str, email: str, password: str) -> tuple[bool, str]:
    """
    Use Playwright (sync) to log in to LinkedIn and save cookies.
    Called from the Flask API endpoint.
    Returns (success, error_message).
    """
    from playwright.sync_api import sync_playwright

    cpath = linkedin_cookies_path(user_id)
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

            page.goto("https://www.linkedin.com/login", wait_until="domcontentloaded", timeout=30000)
            time.sleep(2)

            # Fill credentials
            page.fill("#username", email)
            page.fill("#password", password)
            time.sleep(0.5)

            # Submit
            page.click('button[type="submit"]')
            time.sleep(5)

            current_url = page.url

            # Check for verification/challenge page
            if "challenge" in current_url or "checkpoint" in current_url:
                browser.close()
                return False, "LinkedIn requires verification (CAPTCHA or 2FA). Try again later."

            if "/login" in current_url or "/authwall" in current_url:
                browser.close()
                return False, "Login failed — check email and password"

            # Save cookies
            cookies = context.cookies()
            cpath.write_text(json.dumps(cookies, indent=2), encoding="utf-8")

            # Also save to legacy path for backward compat
            COOKIES_PATH.parent.mkdir(parents=True, exist_ok=True)
            COOKIES_PATH.write_text(json.dumps(cookies, indent=2), encoding="utf-8")

            browser.close()
            logger.info(f"LinkedIn login OK for user {user_id}")
            return True, ""

    except Exception as e:
        logger.error(f"LinkedIn Playwright login error: {e}")
        return False, str(e)


# ── Browser Management ────────────────────────────────

async def _get_browser_context(playwright, user_id: str = None):
    """Launch browser and load saved cookies."""
    browser = await playwright.chromium.launch(
        headless=True,
        args=["--no-sandbox", "--disable-dev-shm-usage"]
    )
    context = await browser.new_context(
        viewport={"width": 1280, "height": 800},
        user_agent=_USER_AGENT,
    )

    # Try per-user cookies first, then fallback to legacy
    cookies_path = linkedin_cookies_path(user_id) if user_id else COOKIES_PATH
    if not cookies_path.exists():
        cookies_path = COOKIES_PATH

    if cookies_path.exists():
        cookies = json.loads(cookies_path.read_text(encoding="utf-8"))
        await context.add_cookies(cookies)
        logger.info("LinkedIn cookies loaded successfully")
    else:
        logger.warning("No LinkedIn cookies found")

    return browser, context


async def check_login(playwright, user_id: str = None) -> bool:
    """Verify if LinkedIn cookies are still valid."""
    try:
        browser, context = await _get_browser_context(playwright, user_id)
        page = await context.new_page()
        await page.goto("https://www.linkedin.com/feed/", wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(3)

        # Check if redirected to login
        is_logged_in = "/login" not in page.url and "/authwall" not in page.url

        await browser.close()
        return is_logged_in
    except Exception as e:
        logger.error(f"Login check failed: {e}")
        return False


# ── Post Scraping ─────────────────────────────────────

async def scrape_posts(playwright, keywords: list[str], max_posts: int = 10, user_id: str = None) -> list[dict]:
    """
    Scrape LinkedIn feed posts matching given keywords.
    Returns list of dicts with: id, text, url, reactions, author.
    Filters out hiring/spam posts and posts with < 5 reactions.
    """
    posts = []
    browser = None

    try:
        browser, context = await _get_browser_context(playwright, user_id)
        page = await context.new_page()

        for keyword in keywords[:5]:  # Limit keyword searches
            try:
                search_url = f"https://www.linkedin.com/search/results/content/?keywords={keyword}&sortBy=%22date_posted%22"
                await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
                await asyncio.sleep(random.uniform(3, 6))

                # Scroll to load more posts
                for _ in range(3):
                    await page.evaluate("window.scrollBy(0, 800)")
                    await asyncio.sleep(random.uniform(1, 2.5))

                # Extract posts
                post_elements = await page.query_selector_all("div.feed-shared-update-v2")

                for el in post_elements[:max_posts]:
                    try:
                        text_el = await el.query_selector("span.break-words")
                        text = await text_el.inner_text() if text_el else ""

                        if not text or len(text) < 30:
                            continue

                        # Skip hiring/spam
                        skip_words = ["hiring", "we're hiring", "job opening", "apply now",
                                     "dm me", "link in bio", "#hiring"]
                        if any(w in text.lower() for w in skip_words):
                            continue

                        # Get reaction count
                        reaction_el = await el.query_selector("span.social-details-social-counts__reactions-count")
                        reaction_text = await reaction_el.inner_text() if reaction_el else "0"
                        reactions = int("".join(filter(str.isdigit, reaction_text)) or "0")

                        if reactions < 5:
                            continue

                        # Get post URL
                        link_el = await el.query_selector("a.app-aware-link[href*='activity']")
                        post_url = await link_el.get_attribute("href") if link_el else ""

                        # Get author
                        author_el = await el.query_selector("span.update-components-actor__name")
                        author = await author_el.inner_text() if author_el else "Unknown"

                        post_id = post_url.split("activity:")[-1].split("?")[0] if "activity:" in post_url else str(random.randint(100000, 999999))

                        posts.append({
                            "id": f"li_{post_id}",
                            "platform": "linkedin",
                            "text": text[:500],
                            "excerpt": text[:200],
                            "url": post_url,
                            "reactions": reactions,
                            "author": author.strip(),
                            "keyword": keyword,
                        })

                    except Exception as e:
                        logger.debug(f"Error extracting post: {e}")
                        continue

                # Random delay between keyword searches
                await asyncio.sleep(random.uniform(5, 12))

            except Exception as e:
                logger.error(f"Error searching keyword '{keyword}': {e}")
                continue

    except Exception as e:
        logger.error(f"LinkedIn scraping error: {e}")
    finally:
        if browser:
            await browser.close()

    # Deduplicate
    seen_ids = set()
    unique_posts = []
    for p in posts:
        if p["id"] not in seen_ids:
            seen_ids.add(p["id"])
            unique_posts.append(p)

    logger.info(f"Scraped {len(unique_posts)} LinkedIn posts")
    return unique_posts


# ── Actions ───────────────────────────────────────────

async def post_comment(playwright, post_url: str, comment: str, user_id: str = None) -> bool:
    """Post a comment on a LinkedIn post."""
    browser = None
    try:
        browser, context = await _get_browser_context(playwright, user_id)
        page = await context.new_page()

        await page.goto(post_url, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(random.uniform(3, 5))

        # Click comment button
        comment_btn = await page.query_selector("button[aria-label*='Comment']")
        if comment_btn:
            await comment_btn.click()
            await asyncio.sleep(random.uniform(1, 2))

        # Type comment
        comment_box = await page.query_selector("div.ql-editor[contenteditable='true']")
        if comment_box:
            await comment_box.click()
            await asyncio.sleep(0.5)
            # Type like a human with random delays
            for char in comment:
                await page.keyboard.type(char, delay=random.uniform(30, 80))
            await asyncio.sleep(random.uniform(1, 2))

            # Submit
            submit_btn = await page.query_selector("button.comments-comment-box__submit-button")
            if submit_btn:
                await submit_btn.click()
                await asyncio.sleep(2)
                logger.info(f"Comment posted on {post_url}")
                return True

        logger.warning(f"Could not find comment box on {post_url}")
        return False

    except Exception as e:
        logger.error(f"Error posting comment: {e}")
        return False
    finally:
        if browser:
            await browser.close()


async def like_post(playwright, post_url: str, user_id: str = None) -> bool:
    """Like a LinkedIn post."""
    browser = None
    try:
        browser, context = await _get_browser_context(playwright, user_id)
        page = await context.new_page()

        await page.goto(post_url, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(random.uniform(2, 4))

        like_btn = await page.query_selector("button[aria-label*='Like']")
        if like_btn:
            aria_pressed = await like_btn.get_attribute("aria-pressed")
            if aria_pressed != "true":
                await like_btn.click()
                await asyncio.sleep(1)
                logger.info(f"Liked post: {post_url}")
                return True
            else:
                logger.info(f"Post already liked: {post_url}")

        return False

    except Exception as e:
        logger.error(f"Error liking post: {e}")
        return False
    finally:
        if browser:
            await browser.close()


async def add_connection(playwright, user_id: str, keywords: list[str]) -> dict | None:
    """
    Search for people by keywords and send a connection request.
    Skips already connected profiles.
    Returns profile info dict or None.
    """
    browser = None
    try:
        connected = storage.get_connected_profiles(user_id)
        browser, context = await _get_browser_context(playwright, user_id)
        page = await context.new_page()

        keyword = random.choice(keywords) if keywords else "developer"
        search_url = f"https://www.linkedin.com/search/results/people/?keywords={keyword}&origin=GLOBAL_SEARCH_HEADER"

        await page.goto(search_url, wait_until="domcontentloaded", timeout=30000)
        await asyncio.sleep(random.uniform(3, 6))

        # Find connect buttons
        results = await page.query_selector_all("div.entity-result")

        for result in results:
            try:
                link_el = await result.query_selector("a.app-aware-link[href*='/in/']")
                profile_url = await link_el.get_attribute("href") if link_el else ""

                if not profile_url or profile_url in connected:
                    continue

                name_el = await result.query_selector("span.entity-result__title-text")
                name = await name_el.inner_text() if name_el else "Unknown"

                connect_btn = await result.query_selector("button[aria-label*='connect' i], button[aria-label*='Connect' i]")
                if connect_btn:
                    await connect_btn.click()
                    await asyncio.sleep(random.uniform(1, 2))

                    # Click Send without note
                    send_btn = await page.query_selector("button[aria-label='Send without a note']")
                    if not send_btn:
                        send_btn = await page.query_selector("button[aria-label='Send now']")
                    if send_btn:
                        await send_btn.click()
                        await asyncio.sleep(2)

                        storage.add_connected_profile(user_id, profile_url)
                        logger.info(f"Connection request sent to {name}")

                        return {
                            "name": name.strip(),
                            "url": profile_url,
                        }

            except Exception as e:
                logger.debug(f"Error processing profile: {e}")
                continue

        return None

    except Exception as e:
        logger.error(f"Error adding connection: {e}")
        return None
    finally:
        if browser:
            await browser.close()
