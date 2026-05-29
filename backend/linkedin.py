"""LinkedIn integration with oauth/cookie auth and linkedin-api actions."""

import json
import logging
import re
import requests
from linkedin_api import Linkedin
from requests.exceptions import TooManyRedirects

from config import WEBSHARE_PROXY_URL, linkedin_cookies_path
import storage

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


def _clean_cookie_value(value: str, cookie_name: str = "") -> str:
    """Strip whitespace/quotes and tolerate pasted ``name=value`` cookie rows."""
    v = (value or "").strip()
    if "\n" in v:
        v = v.split("\n")[0].strip()

    if cookie_name:
        # Users often paste the whole DevTools row/header fragment, e.g.
        # `JSESSIONID="ajax:..."; Path=/` instead of just the value.
        match = re.search(rf"(?:^|[;\s]){re.escape(cookie_name)}\s*=\s*([^;\s]+)", v, re.IGNORECASE)
        if match:
            v = match.group(1).strip()

    return v.strip().strip('"').strip("'")


def _build_linkedin_cookie_jar(li_at: str, jsessionid: str = "") -> requests.cookies.RequestsCookieJar:
    """
    linkedin-api requires li_at + JSESSIONID (sets csrf-token from JSESSIONID).
    Passing only li_at always fails with KeyError.
    """
    jar = requests.cookies.RequestsCookieJar()
    domain = ".linkedin.com"
    jar.set("li_at", _clean_cookie_value(li_at, "li_at"), domain=domain, path="/")
    js = _clean_cookie_value(jsessionid, "JSESSIONID")
    if js:
        jar.set("JSESSIONID", f'"{js}"', domain=domain, path="/")
    return jar


def _voyager_error_message(data: dict, status_code: int | None = None) -> str:
    """Return a human-readable LinkedIn Voyager error without raising KeyError."""
    if not isinstance(data, dict):
        return "LinkedIn returned a non-JSON response while checking cookies."

    message = data.get("message") or data.get("error") or data.get("error_description")
    status = data.get("status") or status_code
    service_code = data.get("serviceErrorCode")

    if message:
        return str(message)
    if status:
        suffix = f" (serviceErrorCode {service_code})" if service_code else ""
        return f"LinkedIn Voyager API returned status {status}{suffix}."
    return "LinkedIn rejected these cookies without an error message."


def _fetch_current_profile(client: Linkedin) -> dict:
    """Fetch the current account profile using the safer /me endpoint."""
    try:
        profile = client.get_user_profile(use_cache=False)
    except TooManyRedirects as exc:
        raise ValueError(
            "LinkedIn redirected the cookie session to login too many times. "
            "Cookies are expired or were copied from a different browser/IP session; "
            "refresh linkedin.com and copy fresh li_at + JSESSIONID."
        ) from exc
    if not isinstance(profile, dict) or not profile:
        raise ValueError("LinkedIn returned empty profile")
    status = profile.get("status")
    if status and status != 200:
        raise ValueError(_voyager_error_message(profile))
    if not (profile.get("miniProfile") or profile.get("plainId") or profile.get("publicIdentifier")):
        raise ValueError(_voyager_error_message(profile))
    return profile


def ensure_client(user_id: str) -> bool:
    """Load linkedin-api client from saved li_at if not in memory."""
    if user_id in _clients:
        return True
    auth = _load_auth(user_id)
    if auth.get("li_at"):
        ok, _ = verify_li_at(user_id, auth["li_at"], auth.get("jsessionid", ""))
        return ok
    return False


def verify_li_at(user_id: str, li_at: str, jsessionid: str = "") -> tuple[bool, str]:
    li_at = _clean_cookie_value(li_at, "li_at")
    jsessionid = _clean_cookie_value(jsessionid, "JSESSIONID")
    if not li_at:
        return False, "li_at cookie is empty"
    if not jsessionid:
        return False, "JSESSIONID is required — copy it from DevTools next to li_at (value starts with ajax:)"

    last_error = "unknown error"
    attempts: list[tuple[str, dict | None]] = [("direct", None)]
    proxy = _proxy_dict(user_id)
    if proxy:
        attempts.append(("proxy", proxy))

    for label, proxies in attempts:
        try:
            jar = _build_linkedin_cookie_jar(li_at, jsessionid)
            client = Linkedin("", "", cookies=jar, proxies=proxies or {})
            profile = _fetch_current_profile(client)
            mini_profile = profile.get("miniProfile") or {}
            _clients[user_id] = client
            _profile_ids[user_id] = (
                profile.get("plainId")
                or mini_profile.get("publicIdentifier")
                or profile.get("publicIdentifier")
                or ""
            )
            _save_auth(user_id, {
                "auth_method": "cookie",
                "li_at": li_at,
                "jsessionid": jsessionid,
            })
            logger.info("LinkedIn cookie auth OK user=%s via %s", user_id, label)
            return True, ""
        except KeyError as e:
            missing = str(e).strip("'\"")
            if missing.lower() == "jsessionid":
                last_error = "JSESSIONID is missing or malformed — copy it from DevTools next to li_at (value starts with ajax:)."
            else:
                last_error = f"LinkedIn response was missing field '{missing}'. The pasted cookies were rejected; refresh linkedin.com and copy fresh li_at + JSESSIONID."
        except Exception as e:
            last_error = str(e) or repr(e)
            logger.error("LinkedIn verify_li_at failed user=%s mode=%s: %s", user_id, label, last_error)

    if "CHALLENGE" in last_error.upper() or "captcha" in last_error.lower():
        return False, "LinkedIn wants verification — open linkedin.com in browser, then copy fresh cookies."
    if "401" in last_error or "Unauthorized" in last_error:
        return False, "Cookies expired — log in to linkedin.com again and copy fresh li_at + JSESSIONID."
    if "999" in last_error or "Request denied" in last_error:
        return False, "LinkedIn blocked the server IP/session. Use OAuth or configure a trusted residential proxy, then copy fresh cookies."
    if not last_error or last_error == "unknown error":
        return False, "LinkedIn rejected these cookies. Open linkedin.com, confirm there is no checkpoint/CAPTCHA, then copy fresh li_at + JSESSIONID."
    return False, last_error[:220]


def _proxy_url(user_id: str) -> str:
    try:
        settings = storage.get_settings(user_id)
        user_proxy = ((settings.get("linkedin") or {}).get("proxy_url") or "").strip()
        if user_proxy:
            return user_proxy
    except Exception:
        pass
    return (WEBSHARE_PROXY_URL or "").strip()


def _proxy_dict(user_id: str) -> dict | None:
    proxy = _proxy_url(user_id)
    if not proxy:
        return None
    return {"http": proxy, "https": proxy}


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


def _keyword_matches(text: str, keywords: list[str]) -> bool:
    """Flexible keyword match: full phrase or any significant word."""
    if not keywords:
        return True
    lower = text.lower()
    for kw in keywords:
        k = kw.strip().lower()
        if not k:
            continue
        if k in lower:
            return True
        for word in k.split():
            if len(word) > 2 and word in lower:
                return True
    return False


def _normalize_feed_post(item: dict) -> dict | None:
    urn = item.get("urn_id") or item.get("urn") or ""
    activity_urn = re.sub(r"\D", "", str(urn)) if urn else ""
    commentary = item.get("commentary") or {}
    text = (commentary.get("text") or {}).get("text") or item.get("text") or ""
    if not text or not activity_urn:
        return None
    actor = item.get("actor") or {}
    author = ""
    if isinstance(actor, dict):
        name = actor.get("name") or {}
        if isinstance(name, dict):
            author = name.get("text", "") or ""
        elif isinstance(name, str):
            author = name
    reactions = 0
    sd = item.get("socialDetail") or {}
    counts = sd.get("totalSocialActivityCounts") or {}
    reactions = counts.get("numLikes", 0) or 0
    return {
        "id": f"li_{activity_urn}",
        "text": text[:1000],
        "url": _post_url_from_urn(activity_urn),
        "author": author,
        "author_name": author,
        "reactions": reactions,
        "reactions_count": reactions,
        "excerpt": text[:200],
        "platform": "linkedin",
    }


def _scrape_via_search(client: Linkedin, keywords: list[str], max_posts: int) -> list[dict]:
    """Fallback: LinkedIn global search for posts by keywords."""
    if not keywords:
        return []
    query = " ".join(k.strip() for k in keywords[:3] if k.strip())
    if not query:
        return []
    posts = []
    try:
        results = client.search(
            {
                "keywords": query,
                "origin": "GLOBAL_SEARCH_HEADER",
            },
            limit=max(20, max_posts * 3),
        )
        for hit in results or []:
            if not isinstance(hit, dict):
                continue
            text = hit.get("headline", "") or hit.get("summary", "") or hit.get("title", "") or ""
            if isinstance(text, dict):
                text = text.get("text", "") or ""
            if not text:
                continue
            url = hit.get("url", "") or hit.get("navigationUrl", "") or ""
            if not url and hit.get("entityUrn"):
                urn = re.sub(r"\D", "", str(hit.get("entityUrn", "")))
                if urn:
                    url = _post_url_from_urn(urn)
            pid = re.sub(r"\D", "", str(hit.get("entityUrn", hit.get("trackingUrn", "")))) or str(len(posts))
            posts.append({
                "id": f"li_search_{pid}",
                "text": str(text)[:1000],
                "url": url or f"https://www.linkedin.com/search/results/content/?keywords={query}",
                "author": hit.get("title", "") if isinstance(hit.get("title"), str) else "",
                "author_name": "",
                "reactions": 0,
                "reactions_count": 0,
                "excerpt": str(text)[:200],
                "platform": "linkedin",
            })
            if len(posts) >= max_posts:
                break
    except Exception as e:
        logger.warning("LinkedIn search fallback failed: %s", e)
    return posts[:max_posts]


def login_with_playwright(user_id: str, email: str, password: str) -> tuple[bool, str]:
    try:
        client = Linkedin(email, password, proxies=_proxy_dict(user_id))
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
            profile = _fetch_current_profile(_clients[uid])
            mini_profile = profile.get("miniProfile") or {}
            _profile_ids[uid] = (
                profile.get("plainId")
                or mini_profile.get("publicIdentifier")
                or profile.get("publicIdentifier")
                or ""
            )
            return True
        except Exception as e:
            logger.warning("LinkedIn cached client check failed user=%s: %s", uid, e)
            _clients.pop(uid, None)
    auth = _load_auth(uid)
    if auth.get("li_at"):
        ok, _ = verify_li_at(uid, auth["li_at"], auth.get("jsessionid", ""))
        return ok
    if auth.get("access_token"):
        headers = {"Authorization": f"Bearer {auth['access_token']}"}
        proxies = _proxy_dict(uid)
        try:
            resp = requests.get("https://api.linkedin.com/v2/me", headers=headers, timeout=20, proxies=proxies)
            return resp.status_code == 200
        except Exception:
            return False
    return False


async def scrape_posts(_playwright_unused, keywords: list[str], max_posts: int = 10, user_id: str | None = None) -> list[dict]:
    uid = user_id or ""
    if uid and uid not in _clients:
        ensure_client(uid)
    client = _clients.get(uid)
    if not client:
        auth = _load_auth(uid)
        logger.warning(
            "LinkedIn scrape skipped user=%s: no li_at client (has_oauth=%s). Paste li_at cookie.",
            uid,
            bool(auth.get("access_token")),
        )
        return []

    posts = []
    feed_raw = 0
    try:
        feed_items = client.get_feed_posts(limit=max(30, max_posts * 5), exclude_promoted_posts=True) or []
        feed_raw = len(feed_items)
        matched = []
        for item in feed_items:
            norm = _normalize_feed_post(item)
            if not norm:
                continue
            if _keyword_matches(norm["text"], keywords):
                matched.append(norm)
        posts = matched[:max_posts]
        logger.info(
            "LinkedIn feed user=%s raw=%s keyword_matches=%s keywords=%r",
            uid, feed_raw, len(matched), keywords[:5],
        )

        if not posts and feed_raw > 0 and keywords:
            logger.info("LinkedIn user=%s: 0 keyword hits in feed; using top feed posts (relaxed)", uid)
            for item in feed_items:
                norm = _normalize_feed_post(item)
                if norm:
                    posts.append(norm)
                if len(posts) >= max_posts:
                    break

        if not posts and keywords:
            search_posts = _scrape_via_search(client, keywords, max_posts)
            logger.info("LinkedIn search fallback user=%s found=%s", uid, len(search_posts))
            posts = search_posts

    except Exception as e:
        logger.error("LinkedIn scrape error user=%s: %s", user_id, e)
        if keywords:
            try:
                posts = _scrape_via_search(client, keywords, max_posts)
            except Exception:
                pass
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
    """Scrape posts using OAuth token.
    
    Fetches from LinkedIn API, filters by keywords, excludes posts with < 3 reactions.
    Returns list of {id, text, excerpt, url, author_name, reactions_count, platform}.
    """
    auth = _load_auth(user_id)
    token = auth.get("access_token")
    if not token:
        return []

    normalized_keywords = [k.strip() for k in (keywords or []) if str(k).strip()]
    keyword_query = " OR ".join(normalized_keywords)

    headers = {
        "Authorization": f"Bearer {token}",
        "X-Restli-Protocol-Version": "2.0.0",
    }
    proxies = _proxy_dict(user_id)

    all_items = []
    me_id = ""
    me_urn = ""

    logger.info(
        "linkedin oauth scrape start user=%s keyword_count=%s query=%r max_posts=%s has_proxy=%s",
        user_id,
        len(normalized_keywords),
        keyword_query,
        max_posts,
        bool(proxies),
    )

    # Resolve member id first to build valid author/owner filters.
    try:
        me_endpoint = "https://api.linkedin.com/v2/me"
        me_resp = requests.get(me_endpoint, headers=headers, timeout=20, proxies=proxies)
        me_preview = me_resp.text[:800].replace("\n", " ")
        logger.info(
            "linkedin oauth endpoint=%s status=%s body_preview=%r",
            me_endpoint,
            me_resp.status_code,
            me_preview,
        )
        if me_resp.status_code == 200:
            me_id = (me_resp.json() or {}).get("id", "")
            me_urn = f"urn:li:person:{me_id}" if me_id else ""
    except Exception as e:
        logger.error("LinkedIn /me fetch failed user=%s: %s", user_id, e)

    # Fetch user's feed posts (ugcPosts)
    try:
        ugc_endpoint = "https://api.linkedin.com/v2/ugcPosts"
        ugc_params = {"q": "authors", "count": 50}
        if me_urn:
            ugc_params["authors"] = f"List({me_urn})"
        logger.info(
            "linkedin oauth request endpoint=%s params=%s keywords=%r",
            ugc_endpoint,
            ugc_params,
            normalized_keywords,
        )
        resp = requests.get(
            ugc_endpoint,
            headers=headers,
            params=ugc_params,
            timeout=20,
            proxies=proxies,
        )
        ugc_preview = resp.text[:1200].replace("\n", " ")
        logger.info(
            "linkedin oauth response endpoint=%s status=%s body_preview=%r",
            ugc_endpoint,
            resp.status_code,
            ugc_preview,
        )
        if resp.status_code == 200:
            all_items.extend(resp.json().get("elements", []))
        else:
            logger.warning(
                "linkedin oauth ugcPosts non-200 user=%s status=%s; this token may not have required product scope",
                user_id,
                resp.status_code,
            )
    except Exception as e:
        logger.error("LinkedIn ugcPosts fetch failed user=%s: %s", user_id, e)

    # Also try fetching feed/shares for broader content
    try:
        shares_endpoint = "https://api.linkedin.com/v2/shares"
        shares_params = {"q": "owners", "count": 20}
        if me_urn:
            shares_params["owners"] = f"List({me_urn})"
        logger.info(
            "linkedin oauth request endpoint=%s params=%s",
            shares_endpoint,
            shares_params,
        )
        resp2 = requests.get(
            shares_endpoint,
            headers=headers,
            params=shares_params,
            timeout=20,
            proxies=proxies,
        )
        shares_preview = resp2.text[:1200].replace("\n", " ")
        logger.info(
            "linkedin oauth response endpoint=%s status=%s body_preview=%r",
            shares_endpoint,
            resp2.status_code,
            shares_preview,
        )
        if resp2.status_code == 200:
            all_items.extend(resp2.json().get("elements", []))
    except Exception as e:
        logger.debug("LinkedIn shares fetch failed (non-critical): %s", e)

    logger.info(
        "linkedin oauth aggregate user=%s total_items=%s me_id=%s me_urn=%s",
        user_id,
        len(all_items),
        bool(me_id),
        me_urn or "(empty)",
    )

    posts = []
    seen_ids = set()
    empty_text_count = 0
    keyword_filtered_count = 0
    duplicate_count = 0
    low_reaction_filtered_count = 0

    for item in all_items:
        # Extract text from UGC format
        text = (
            item.get("specificContent", {})
            .get("com.linkedin.ugc.ShareContent", {})
            .get("shareCommentary", {})
            .get("text", "")
        )
        # Fallback to share format
        if not text:
            text = item.get("text", {}).get("text", "") if isinstance(item.get("text"), dict) else ""

        if not text:
            empty_text_count += 1
            continue

        # Filter by keywords
        if normalized_keywords and not any(k.lower() in text.lower() for k in normalized_keywords):
            keyword_filtered_count += 1
            continue

        post_id = item.get("id", "")
        if post_id in seen_ids:
            duplicate_count += 1
            continue
        seen_ids.add(post_id)

        # Extract author info
        author_name = ""
        author_urn = item.get("author", "")
        if author_urn:
            # Try to get the name from the profile
            try:
                profile_resp = requests.get(
                    f"https://api.linkedin.com/v2/people/{author_urn.split(':')[-1]}",
                    headers=headers,
                    timeout=10,
                    proxies=proxies,
                )
                if profile_resp.status_code == 200:
                    pdata = profile_resp.json()
                    first = pdata.get("localizedFirstName", "")
                    last = pdata.get("localizedLastName", "")
                    author_name = f"{first} {last}".strip()
            except Exception:
                pass

        # Extract reactions count
        reactions_count = 0
        social_detail = item.get("socialDetail", {})
        if social_detail:
            reactions_count = social_detail.get("totalSocialActivityCounts", {}).get("numLikes", 0)

        # Filter out posts with less than 3 reactions (skip for now if we can't get count)
        # Only filter if we actually got social data
        if social_detail and reactions_count < 3:
            low_reaction_filtered_count += 1
            continue

        posts.append({
            "id": post_id,
            "text": text[:1000],
            "excerpt": text[:200],
            "url": f"https://www.linkedin.com/feed/update/{post_id}",
            "author_name": author_name,
            "reactions_count": reactions_count,
            "platform": "linkedin",
        })

        if len(posts) >= max_posts:
            break

    if not posts:
        logger.warning(
            "linkedin oauth posts empty user=%s reason_stats={all_items:%s, empty_text:%s, keyword_filtered:%s, duplicates:%s, low_reactions:%s, keywords:%r}. "
            "OAuth member tokens often return only the member's own posts (not global keyword search).",
            user_id,
            len(all_items),
            empty_text_count,
            keyword_filtered_count,
            duplicate_count,
            low_reaction_filtered_count,
            normalized_keywords,
        )
    else:
        logger.info("linkedin oauth posts built user=%s posts=%s", user_id, len(posts))

    return posts[:max_posts]


def get_profile_picture(user_id: str) -> str:
    auth = _load_auth(user_id)
    token = auth.get("access_token")
    if not token:
        return ""

    headers = {"Authorization": f"Bearer {token}"}
    proxies = _proxy_dict(user_id)
    try:
        resp = requests.get(
            "https://api.linkedin.com/v2/me?projection=(id,profilePicture(displayImage~:playableStreams))",
            headers=headers,
            timeout=20,
            proxies=proxies,
        )
        if resp.status_code != 200:
            return ""
        data = resp.json()
        elements = data["profilePicture"]["displayImage~"]["elements"]
        return elements[-1]["identifiers"][0]["identifier"]
    except Exception:
        return ""
