"""LinkedIn integration with oauth/cookie auth and linkedin-api actions."""

import json
import logging
import re
import requests
from linkedin_api import Linkedin

from config import WEBSHARE_PROXY_URL, linkedin_cookies_path

logger = logging.getLogger(__name__)

_clients: dict[str, Linkedin] = {}
_profile_ids: dict[str, str] = {}


def _load_auth(user_id: str) -> dict:
    path = linkedin_cookies_path(user_id)
    if path.exists():
        try:
            return json.loads(path.read_text())
        except Exception:
            return {}
    return {}


def _save_auth(user_id: str, auth_data: dict) -> None:
    path = linkedin_cookies_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(auth_data))


def verify_li_at(user_id: str, li_at: str) -> bool:
    try:
        proxies = None
        if WEBSHARE_PROXY_URL:
            proxies = {"http": WEBSHARE_PROXY_URL, "https": WEBSHARE_PROXY_URL}
        client = Linkedin("", "", cookies={"li_at": li_at}, proxies=proxies)
        profile = client.get_profile("me")
        _clients[user_id] = client
        _profile_ids[user_id] = profile.get("profile_id") or profile.get("public_id") or ""
        _save_auth(user_id, {"auth_method": "cookie", "li_at": li_at})
        logger.info("LinkedIn cookie auth OK for user %s", user_id)
        return True
    except Exception as e:
        logger.error("LinkedIn verify_li_at failed user=%s: %s", user_id, e)
        return False


def _extract_activity_urn(post_url: str) -> str | None:
    m = re.search(r"/(?:feed/update|posts)/[^\s]*?(\d{8,})", post_url)
    if m:
        return m.group(1)
    m = re.search(r"activity:(\d{8,})", post_url)
    return m.group(1) if m else None


def _extract_profile_public_id(profile_id: str) -> str:
    profile_id = profile_id.strip()
    m = re.search(r"linkedin\.com/in/([^/?#]+)", profile_id)
    if m:
        return m.group(1)
    return profile_id


def _post_url_from_urn(activity_urn: str) -> str:
    return f"https://www.linkedin.com/feed/update/urn:li:activity:{activity_urn}/"


def login_with_playwright(user_id: str, email: str, password: str) -> tuple[bool, str]:
    try:
        client = Linkedin(email, password)
        profile = client.get_profile("me")
        _clients[user_id] = client
        _profile_ids[user_id] = profile.get("profile_id") or profile.get("public_id") or ""
        logger.info("LinkedIn login OK for user %s", user_id)
        return True, ""
    except Exception as e:
        logger.error("LinkedIn login error: %s", e)
        return False, "Login failed — check email/password"


async def check_login(_playwright_unused=None, user_id: str | None = None) -> bool:
    uid = user_id or ""
    if uid in _clients:
        try:
            profile = _clients[uid].get_profile("me")
            _profile_ids[uid] = profile.get("profile_id") or profile.get("public_id") or ""
            return True
        except Exception:
            pass
    auth = _load_auth(uid)
    if auth.get("li_at"):
        return verify_li_at(uid, auth["li_at"])
    if auth.get("access_token"):
        headers = {"Authorization": f"Bearer {auth['access_token']}"}
        try:
            resp = requests.get("https://api.linkedin.com/v2/me", headers=headers, timeout=20)
            return resp.status_code == 200
        except Exception:
            return False
    return False


async def scrape_posts(_playwright_unused, keywords: list[str], max_posts: int = 10, user_id: str | None = None) -> list[dict]:
    client = _clients.get(user_id or "")
    if not client:
        return []
    posts = []
    try:
        feed_items = client.get_feed_posts(limit=max(20, max_posts * 3), exclude_promoted_posts=True)
        for item in feed_items:
            urn = item.get("urn_id") or item.get("urn") or ""
            activity_urn = re.sub(r"\D", "", str(urn)) if urn else ""
            commentary = item.get("commentary") or {}
            text = (commentary.get("text") or {}).get("text") or item.get("text") or ""
            if not text:
                continue
            if keywords and not any(k.lower() in text.lower() for k in keywords):
                continue
            author = item.get("actor", {}).get("name", {}).get("text") if isinstance(item.get("actor"), dict) else ""
            reactions = item.get("socialDetail", {}).get("totalSocialActivityCounts", {}).get("numLikes", 0)
            if activity_urn:
                posts.append({
                    "id": f"li_{activity_urn}",
                    "text": text[:1000],
                    "url": _post_url_from_urn(activity_urn),
                    "author": author or "",
                    "reactions": reactions or 0,
                    "excerpt": text[:200],
                    "platform": "linkedin",
                })
            if len(posts) >= max_posts:
                break
    except Exception as e:
        logger.error("LinkedIn scrape error user=%s: %s", user_id, e)
        return []
    return posts[:max_posts]


async def post_comment(_playwright_unused, post_url: str, comment: str, user_id: str | None = None) -> bool:
    client = _clients.get(user_id or "")
    if not client:
        return False
    activity_urn = _extract_activity_urn(post_url)
    if not activity_urn:
        logger.error("LinkedIn comment failed: unable to parse activity urn from %s", post_url)
        return False
    try:
        payload = {"message": {"attributes": [], "text": comment}}
        resp = client._post(f"/voyagerSocialDashFeedUpdates/{activity_urn}/comments", data=payload)
        return resp.status_code in (200, 201)
    except Exception as e:
        logger.error("LinkedIn comment failed user=%s post=%s err=%s", user_id, post_url, e)
        return False


async def like_post(_playwright_unused, post_url: str, user_id: str | None = None) -> bool:
    client = _clients.get(user_id or "")
    if not client:
        return False
    activity_urn = _extract_activity_urn(post_url)
    if not activity_urn:
        logger.error("LinkedIn like failed: unable to parse activity urn from %s", post_url)
        return False
    try:
        had_error = client.react_to_post(activity_urn, reaction_type="LIKE")
        return not had_error
    except Exception as e:
        logger.error("LinkedIn like failed user=%s post=%s err=%s", user_id, post_url, e)
        return False


async def add_connection(_playwright_unused, user_id: str, keywords: list[str]):
    client = _clients.get(user_id or "")
    if not client:
        return False
    try:
        for kw in keywords[:5]:
            people = client.search_people(keywords=kw, limit=10)
            for person in people:
                target = person.get("public_id") or person.get("profile_id")
                if not target:
                    continue
                target = _extract_profile_public_id(str(target))
                try:
                    had_error = client.add_connection(target)
                    if had_error is False or had_error is None:
                        return True
                except Exception as e:
                    logger.error("LinkedIn add connection failed target=%s user=%s err=%s", target, user_id, e)
                    continue
    except Exception as e:
        logger.error("LinkedIn add_connection failed user=%s err=%s", user_id, e)
    return False


def scrape_posts_oauth(user_id: str, keywords: list[str], max_posts: int = 10) -> list[dict]:
    auth = _load_auth(user_id)
    token = auth.get("access_token")
    if not token:
        return []

    headers = {
        "Authorization": f"Bearer {token}",
        "X-Restli-Protocol-Version": "2.0.0",
    }
    try:
        resp = requests.get(
            "https://api.linkedin.com/v2/ugcPosts",
            headers=headers,
            params={"q": "authors", "count": 50},
            timeout=20,
        )
        if resp.status_code != 200:
            return []
    except Exception:
        return []

    posts = []
    for item in resp.json().get("elements", []):
        text = (
            item.get("specificContent", {})
            .get("com.linkedin.ugc.ShareContent", {})
            .get("shareCommentary", {})
            .get("text", "")
        )
        if not text:
            continue
        if keywords and not any(k.lower() in text.lower() for k in keywords):
            continue
        post_id = item.get("id", "")
        posts.append({
            "id": post_id,
            "text": text[:1000],
            "excerpt": text[:200],
            "url": f"https://www.linkedin.com/feed/update/{post_id}",
            "platform": "linkedin",
        })
    return posts[:max_posts]


def get_profile_picture(user_id: str) -> str:
    auth = _load_auth(user_id)
    token = auth.get("access_token")
    if not token:
        return ""

    headers = {"Authorization": f"Bearer {token}"}
    try:
        resp = requests.get(
            "https://api.linkedin.com/v2/me?projection=(id,profilePicture(displayImage~:playableStreams))",
            headers=headers,
            timeout=20,
        )
        if resp.status_code != 200:
            return ""
        data = resp.json()
        elements = data["profilePicture"]["displayImage~"]["elements"]
        return elements[-1]["identifiers"][0]["identifier"]
    except Exception:
        return ""
