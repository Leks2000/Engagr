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


def _session() -> requests.Session:
    s = requests.Session()
    if WEBSHARE_PROXY_URL:
        s.proxies = {"https": WEBSHARE_PROXY_URL}
    return s


def _save_auth(user_id: str, data: dict):
    path = linkedin_cookies_path(user_id)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def _load_auth(user_id: str) -> dict:
    path = linkedin_cookies_path(user_id)
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def verify_li_at(user_id: str, li_at: str) -> bool:
    try:
        s = _session()
        resp = s.get(
            "https://www.linkedin.com/voyager/api/me",
            headers={"li-at": li_at, "Cookie": f"li_at={li_at}", "accept": "application/json"},
            timeout=20,
        )
        if resp.status_code == 200:
            _save_auth(user_id, {"auth_method": "cookie", "li_at": li_at})
            return True
    except Exception as e:
        logger.error("LinkedIn cookie verify failed user=%s err=%s", user_id, e)
    return False


def _extract_activity_urn(post_url: str) -> str | None:
    m = re.search(r"activity:(\d{8,})", post_url)
    if m:
        return m.group(1)
    m = re.search(r"/(?:feed/update|posts)/[^\s]*?(\d{8,})", post_url)
    return m.group(1) if m else None


def _post_url_from_urn(activity_urn: str) -> str:
    return f"https://www.linkedin.com/feed/update/urn:li:activity:{activity_urn}/"


def login_with_playwright(user_id: str, email: str, password: str) -> tuple[bool, str]:
    try:
        client = Linkedin(email, password)
        profile = client.get_profile("me")
        _clients[user_id] = client
        _profile_ids[user_id] = profile.get("profile_id") or profile.get("public_id") or ""
        _save_auth(user_id, {"auth_method": "password", "email": email, "password": password})
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
    return False


async def scrape_posts(_playwright_unused, keywords: list[str], max_posts: int = 10, user_id: str | None = None) -> list[dict]:
    client = _clients.get(user_id or "")
    if not client:
        return []
    posts = []
    try:
        for item in client.get_feed_posts(limit=max(20, max_posts * 3), exclude_promoted_posts=True):
            urn = item.get("urn_id") or item.get("urn") or ""
            activity_urn = re.sub(r"\D", "", str(urn)) if urn else ""
            text = ((item.get("commentary") or {}).get("text") or {}).get("text") or item.get("text") or ""
            if not text:
                continue
            if keywords and not any(k.lower() in text.lower() for k in keywords):
                continue
            posts.append({
                "id": f"li_{activity_urn}",
                "text": text[:1000],
                "url": _post_url_from_urn(activity_urn),
                "author": ((item.get("actor") or {}).get("name") or {}).get("text", ""),
                "reactions": ((item.get("socialDetail") or {}).get("totalSocialActivityCounts") or {}).get("numLikes", 0),
                "excerpt": text[:200],
                "platform": "linkedin",
            })
            if len(posts) >= max_posts:
                break
    except Exception as e:
        logger.error("LinkedIn scrape error user=%s: %s", user_id, e)
    return posts[:max_posts]


async def post_comment(_playwright_unused, post_url: str, comment: str, user_id: str | None = None) -> bool:
    client = _clients.get(user_id or "")
    if not client:
        return False
    urn = _extract_activity_urn(post_url)
    if not urn:
        return False
    try:
        resp = client._post(f"/voyagerSocialDashFeedUpdates/{urn}/comments", data={"message": {"text": comment, "attributes": []}})
        return resp.status_code in (200, 201)
    except Exception as e:
        logger.error("LinkedIn comment failed user=%s err=%s", user_id, e)
        return False


async def like_post(_playwright_unused, post_url: str, user_id: str | None = None) -> bool:
    client = _clients.get(user_id or "")
    if not client:
        return False
    urn = _extract_activity_urn(post_url)
    if not urn:
        return False
    try:
        return not client.react_to_post(urn, reaction_type="LIKE")
    except Exception as e:
        logger.error("LinkedIn like failed user=%s err=%s", user_id, e)
        return False


async def add_connection(_playwright_unused, user_id: str, keywords: list[str]):
    client = _clients.get(user_id or "")
    if not client:
        return False
    try:
        for kw in keywords[:5]:
            for person in client.search_people(keywords=kw, limit=10):
                target = person.get("public_id") or person.get("profile_id")
                if target and (client.add_connection(str(target)) is False):
                    return True
    except Exception as e:
        logger.error("LinkedIn add_connection failed user=%s err=%s", user_id, e)
    return False
