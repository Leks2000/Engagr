"""Reddit integration with cookie + asyncpraw auth methods."""

import asyncio
import json
import logging
from pathlib import Path
import requests
import asyncpraw
from asyncprawcore import Forbidden, OAuthException, ResponseException

from config import WEBSHARE_PROXY_URL, reddit_cookies_path, DATA_DIR
import storage

logger = logging.getLogger(__name__)

def _session() -> requests.Session:
    s = requests.Session()
    if WEBSHARE_PROXY_URL:
        s.proxies = {"https": WEBSHARE_PROXY_URL}
    return s

def _creds_path(user_id: str) -> Path:
    return DATA_DIR / str(user_id) / "reddit_credentials.json"

def _save_credentials(user_id: str, username: str, password: str):
    p = _creds_path(user_id); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"username": username, "password": password}, indent=2), encoding="utf-8")

def _load_credentials(user_id: str) -> dict:
    p = _creds_path(user_id)
    if not p.exists(): return {}
    try: return json.loads(p.read_text(encoding="utf-8"))
    except Exception: return {}

def save_cookies(user_id: str, reddit_session: str, token_v2: str):
    p = reddit_cookies_path(user_id); p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({"reddit_session": reddit_session, "token_v2": token_v2}, indent=2), encoding="utf-8")

def _load_cookies(user_id: str) -> dict:
    p = reddit_cookies_path(user_id)
    if not p.exists(): return {}
    try: return json.loads(p.read_text(encoding="utf-8"))
    except Exception: return {}

def verify_cookie_login(user_id: str, reddit_session: str, token_v2: str) -> tuple[bool, str]:
    try:
        r = _session().get("https://www.reddit.com/api/me.json", cookies={"reddit_session": reddit_session, "token_v2": token_v2}, headers={"User-Agent": "engagr-cookie-check/1.0"}, timeout=20)
        data = r.json() if r.status_code == 200 else {}
        if data.get("name"):
            save_cookies(user_id, reddit_session, token_v2)
            return True, data["name"]
    except Exception as e:
        logger.error("Reddit cookie verify failed user=%s err=%s", user_id, e)
    return False, ""

async def _build_client(user_id: str):
    creds = _load_credentials(user_id)
    if not creds.get("username") or not creds.get("password"): return None
    return asyncpraw.Reddit(client_id="", client_secret="", username=creds["username"], password=creds["password"], user_agent=f"engagr-bot:{user_id}:v1.0", check_for_async=False)

def check_login(user_id: str) -> bool:
    cookies = _load_cookies(user_id)
    if cookies.get("reddit_session") and cookies.get("token_v2"):
        ok,_ = verify_cookie_login(user_id, cookies["reddit_session"], cookies["token_v2"])
        if ok: return True
    async def _inner():
        client = await _build_client(user_id)
        if not client: return False
        try:
            return bool(await client.user.me())
        except Exception:
            return False
        finally:
            await client.close()
    return asyncio.run(_inner())

def login_with_playwright(user_id: str, username: str, password: str) -> tuple[bool, str]:
    async def _inner():
        c = asyncpraw.Reddit(client_id="", client_secret="", username=username, password=password, user_agent=f"engagr-bot:{user_id}:v1.0", check_for_async=False)
        try:
            me = await c.user.me()
            if me:
                _save_credentials(user_id, username, password)
                return True, me.name
            return False, "Login failed"
        except Exception:
            return False, "Login failed"
        finally:
            await c.close()
    return asyncio.run(_inner())

def scrape_posts(user_id: str, max_posts: int = 10) -> list[dict]:
    async def _inner():
        client = await _build_client(user_id)
        if not client: return []
        settings = storage.get_settings(user_id); rd = settings.get("reddit", {})
        subs = rd.get("subreddits", []); kws=[k.strip().lower() for k in rd.get("keywords",[]) if k.strip()]
        out=[]; seen=set()
        try:
            for sub_name in subs:
                sub = await client.subreddit(sub_name)
                async for s in sub.new(limit=20):
                    text = f"{s.title}\n\n{s.selftext or ''}".strip()
                    if len(text)<15: continue
                    if kws and not any(k in text.lower() for k in kws): continue
                    pid=f"rd_{s.id}"
                    if pid in seen: continue
                    seen.add(pid)
                    out.append({"id":pid,"platform":"reddit","reddit_id":s.id,"text":text[:500],"excerpt":text[:200],"url":f"https://reddit.com{s.permalink}","reactions":s.score,"author":str(s.author) if s.author else "","subreddit":sub_name})
                    if len(out)>=max_posts: return out
        except Exception as e:
            logger.error("Reddit scrape error user=%s err=%s", user_id, e)
        finally:
            await client.close()
        return out
    return asyncio.run(_inner())

def post_comment(user_id: str, reddit_id: str, comment: str) -> bool:
    async def _inner():
        c = await _build_client(user_id)
        if not c: return False
        try:
            s = await c.submission(id=reddit_id); await s.reply(comment); return True
        except Exception as e:
            logger.error("Reddit comment failed user=%s post=%s err=%s", user_id, reddit_id, e); return False
        finally:
            await c.close()
    return asyncio.run(_inner())

def upvote_post(user_id: str, reddit_id: str) -> bool:
    async def _inner():
        c = await _build_client(user_id)
        if not c: return False
        try:
            s = await c.submission(id=reddit_id); await s.upvote(); return True
        except Exception as e:
            logger.error("Reddit upvote failed user=%s post=%s err=%s", user_id, reddit_id, e); return False
        finally:
            await c.close()
    return asyncio.run(_inner())
