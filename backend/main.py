"""
Engagr — Main Entry Point
Starts the Telegram bot, Flask API, and APScheduler.
"""

import os
import sys
import asyncio
import logging
import threading
import fcntl
import requests
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode

from flask import Flask, jsonify, request
from flask_cors import CORS
from telegram import BotCommand

# Add backend dir to path
sys.path.insert(0, str(Path(__file__).resolve().parent))

from config import TELEGRAM_BOT_TOKEN, APP_ENV, DATA_DIR
import storage
import scheduler as sched_module
import telegram_bot
import smart_schedule
import nested_replies
import news_grounding
import humanness_scorer
import interaction_memory
import invite_generator
import daily_digest

# ── Logging ───────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("engagr")

LINKEDIN_PROXY_POOL = [
    # Proxies loaded from environment or configured per-user in settings
    p.strip()
    for p in (os.getenv("LINKEDIN_PROXY_POOL", "")).split(",")
    if p.strip()
]


def _linkedin_cookie_error_code(message: str) -> str:
    text = (message or "").lower()
    if "jsessionid" in text:
        return "missing_jsessionid"
    if "verification" in text or "captcha" in text or "checkpoint" in text:
        return "linkedin_checkpoint"
    if "expired" in text or "401" in text or "unauthorized" in text:
        return "cookies_expired"
    if "blocked" in text or "request denied" in text or "999" in text:
        return "linkedin_blocked"
    return "cookie_rejected"


def _linkedin_proxies(user_id: str) -> dict | None:
    try:
        settings = storage.get_settings(user_id)
        proxy = ((settings.get("linkedin") or {}).get("proxy_url") or "").strip()
        if proxy:
            return {"http": proxy, "https": proxy}
    except Exception:
        pass
    return None


def _pick_working_linkedin_proxy(user_id: str) -> str:
    settings = storage.get_settings(user_id)
    saved_proxy = ((settings.get("linkedin") or {}).get("proxy_url") or "").strip()
    candidates = [saved_proxy] if saved_proxy else []
    candidates.extend([p for p in LINKEDIN_PROXY_POOL if p != saved_proxy])
    for proxy in candidates:
        try:
            resp = requests.get(
                "https://www.linkedin.com/oauth/v2/authorization",
                params={"response_type": "code", "client_id": "ping", "redirect_uri": "https://example.com", "state": "ping"},
                timeout=8,
                proxies={"http": proxy, "https": proxy},
                allow_redirects=True,
            )
            if resp.status_code in (200, 301, 302, 303):
                storage.update_settings(user_id, {"linkedin": {"proxy_url": proxy}})
                logger.info("LinkedIn proxy selected user=%s proxy=%s", user_id, proxy)
                return proxy
        except Exception:
            continue
    return saved_proxy

# ── Flask API (for Mini App) ──────────────────────────

api = Flask(__name__)
CORS(api, origins=["*"])


@api.route("/health")
def health():
    return jsonify({"status": "ok", "service": "engagr"})


# ── Settings Endpoints ────────────────────────────────

@api.route("/api/settings/<user_id>", methods=["GET"])
def get_settings(user_id):
    try:
        settings = storage.get_settings(user_id)
        return jsonify(settings)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/settings/<user_id>", methods=["PUT"])
def update_settings(user_id):
    try:
        data = request.get_json()
        storage.update_settings(user_id, data)
        # Reschedule sessions with new settings
        sched_module.schedule_user_sessions(user_id)
        return jsonify({"status": "ok"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Stats Endpoints ───────────────────────────────────

@api.route("/api/stats/<user_id>", methods=["GET"])
def get_stats(user_id):
    try:
        stats = storage.get_stats(user_id)
        return jsonify(stats)
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@api.route("/api/session/logs/<user_id>", methods=["GET"])
def session_logs(user_id):
    try:
        return jsonify({"logs": sched_module.get_session_logs(user_id)})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Queue Endpoints ───────────────────────────────────

@api.route("/api/queue/<user_id>", methods=["GET"])
def get_queue(user_id):
    try:
        queue = storage.get_queue(user_id)
        pending = [q for q in queue if q.get("status") == "pending"]
        return jsonify(pending)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/queue/<user_id>/<item_id>/approve", methods=["POST"])
def approve_item(user_id, item_id):
    try:
        item = storage.get_queue_item(user_id, item_id)
        if not item:
            return jsonify({"error": "Item not found"}), 404

        storage.update_queue_item(user_id, item_id, {"status": "approved"})

        # Schedule posting in background
        asyncio.run_coroutine_threadsafe(
            _post_item_delayed(user_id, item),
            _loop
        )

        return jsonify({"status": "approved"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/queue/<user_id>/<item_id>/skip", methods=["POST"])
def skip_item(user_id, item_id):
    try:
        storage.remove_from_queue(user_id, item_id)
        return jsonify({"status": "skipped"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/queue/<user_id>/<item_id>/edit", methods=["POST"])
def edit_item(user_id, item_id):
    try:
        data = request.get_json()
        new_comment = data.get("comment", "")
        if not new_comment:
            return jsonify({"error": "Comment is required"}), 400

        storage.update_queue_item(user_id, item_id, {
            "comment": new_comment,
            "selected_comment": new_comment,
        })
        return jsonify({"status": "updated"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/queue/<user_id>/<item_id>/select", methods=["POST"])
def select_variant(user_id, item_id):
    """Select a specific comment variant."""
    try:
        data = request.get_json()
        variant_index = data.get("variant_index", 0)
        item = storage.get_queue_item(user_id, item_id)
        if not item:
            return jsonify({"error": "Item not found"}), 404

        variants = item.get("comment_variants", [])
        if variant_index < 0 or variant_index >= len(variants):
            return jsonify({"error": "Invalid variant index"}), 400

        selected = variants[variant_index]
        storage.update_queue_item(user_id, item_id, {
            "comment": selected,
            "selected_comment": selected,
        })
        return jsonify({"status": "selected", "comment": selected})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/queue/<user_id>/<item_id>/regenerate", methods=["POST"])
def regenerate_item(user_id, item_id):
    try:
        import ai_comment

        item = storage.get_queue_item(user_id, item_id)
        if not item:
            return jsonify({"error": "Item not found"}), 404

        settings = storage.get_settings(user_id)
        tone = ((settings.get("linkedin") or {}).get("tone", "friendly"))
        new_comment = ai_comment.regenerate_comment(
            item.get("post_text", ""),
            item.get("comment", ""),
            item.get("platform", "linkedin"),
            tone=tone,
        )

        storage.update_queue_item(user_id, item_id, {"comment": new_comment})
        return jsonify({"status": "regenerated", "comment": new_comment})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Session Control ───────────────────────────────────

@api.route("/api/session/<user_id>/pause", methods=["POST"])
def pause_session(user_id):
    try:
        storage.update_settings(user_id, {"session_active": False})
        sched_module.schedule_user_sessions(user_id)
        return jsonify({"status": "paused"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/session/<user_id>/resume", methods=["POST"])
def resume_session(user_id):
    try:
        storage.update_settings(user_id, {"session_active": True})
        sched_module.schedule_user_sessions(user_id)
        return jsonify({"status": "resumed"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── LinkedIn Login (credentials from Mini App) ───────

@api.route("/api/linkedin/login", methods=["POST"])
def linkedin_login():
    """Login to LinkedIn using email/password via linkedin-api."""
    import linkedin

    try:
        data = request.get_json()
        user_id = data.get("user_id", "")
        email = data.get("email", "")
        password = data.get("password", "")

        if not user_id or not email or not password:
            return jsonify({"error": "user_id, email, and password are required"}), 400

        # Run Playwright sync login (blocks this request, ~10s)
        success, msg = linkedin.login_with_playwright(user_id, email, password)

        if success:
            # Mark LinkedIn as connected
            storage.update_settings(user_id, {"linkedin": {"connected": True}})
            sched_module.schedule_user_sessions(user_id)
            return jsonify({"status": "ok", "connected": True})
        else:
            if msg == "verification_required":
                return jsonify({"error": "verification_required"}), 401
            return jsonify({"error": msg or "Login failed"}), 400

    except Exception as e:
        logger.error(f"LinkedIn login error: {e}")
        return jsonify({"error": str(e)}), 500


@api.route("/api/linkedin/status/<user_id>", methods=["GET"])
def linkedin_status(user_id):
    """Check if LinkedIn is connected for a user."""
    from config import linkedin_cookies_path, COOKIES_PATH
    import linkedin

    cookies_path = linkedin_cookies_path(user_id)
    auth = linkedin._load_auth(user_id)
    connected = cookies_path.exists() or COOKIES_PATH.exists() or bool(auth.get("access_token"))

    storage.update_settings(user_id, {"linkedin": {"connected": connected}})
    return jsonify({"connected": connected})

@api.route("/api/linkedin/proxy-health/<user_id>", methods=["GET"])
def linkedin_proxy_health(user_id):
    import time
    proxy = (_linkedin_proxies(user_id) or {}).get("http")
    if not proxy:
        return jsonify({"ok": False, "message": "No proxy configured"})
    try:
        started = time.perf_counter()
        resp = requests.get("https://www.linkedin.com", timeout=10, proxies={"http": proxy, "https": proxy})
        latency_ms = int((time.perf_counter() - started) * 1000)
        trust = max(50, min(99, 99 - latency_ms // 80))
        return jsonify({"ok": resp.status_code < 500, "latency_ms": latency_ms, "trust_score": trust, "status": "Safe" if trust >= 80 else "Risky"})
    except Exception as e:
        return jsonify({"ok": False, "message": str(e)}), 500


@api.route("/api/linkedin/disconnect/<user_id>", methods=["POST"])
def linkedin_disconnect(user_id):
    """Disconnect LinkedIn for a user."""
    from config import linkedin_cookies_path

    try:
        cookies_path = linkedin_cookies_path(user_id)
        if cookies_path.exists():
            cookies_path.unlink()

        storage.update_settings(user_id, {"linkedin": {"connected": False}})
        return jsonify({"status": "disconnected"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Reddit Login (credentials from Mini App) ─────────

@api.route("/api/reddit/login", methods=["POST"])
def reddit_login():
    """Login to Reddit using OAuth2 password grant HTTP requests."""
    import reddit_bot

    try:
        data = request.get_json()
        user_id = data.get("user_id", "")
        username = data.get("username", "")
        password = data.get("password", "")

        if not user_id or not username or not password:
            return jsonify({"error": "user_id, username, and password are required"}), 400

        success, result = reddit_bot.login_with_playwright(user_id, username, password)

        if success:
            # result contains the confirmed username
            reddit_username = result or username
            storage.update_settings(user_id, {
                "reddit": {
                    "connected": True,
                    "reddit_username": reddit_username,
                }
            })
            sched_module.schedule_user_sessions(user_id)
            return jsonify({
                "status": "ok",
                "connected": True,
                "username": reddit_username,
            })
        else:
            return jsonify({"error": result or "Login failed"}), 400

    except Exception as e:
        logger.error(f"Reddit login error: {e}")
        return jsonify({"error": str(e)}), 500


@api.route("/api/reddit/status/<user_id>", methods=["GET"])
def reddit_status(user_id):
    """Check if Reddit is connected for a user."""
    settings = storage.get_settings(user_id)
    reddit_cfg = settings.get("reddit", {})
    return jsonify({
        "connected": reddit_cfg.get("connected", False),
        "username": reddit_cfg.get("reddit_username", ""),
    })


@api.route("/api/reddit/disconnect/<user_id>", methods=["POST"])
def reddit_disconnect(user_id):
    """Disconnect Reddit for a user."""
    from config import reddit_cookies_path

    try:
        cookies_path = reddit_cookies_path(user_id)
        if cookies_path.exists():
            cookies_path.unlink()

        storage.update_settings(user_id, {
            "reddit": {
                "connected": False,
                "reddit_username": "",
            }
        })
        return jsonify({"status": "disconnected"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/linkedin/auth/<user_id>", methods=["GET"])
def linkedin_auth(user_id):
    from config import LINKEDIN_CLIENT_ID, LINKEDIN_REDIRECT_URI
    selected_proxy = _pick_working_linkedin_proxy(user_id)
    params = urlencode({"response_type": "code", "client_id": LINKEDIN_CLIENT_ID, "redirect_uri": LINKEDIN_REDIRECT_URI, "state": user_id, "scope": "openid profile email w_member_social"})
    return jsonify({"url": f"https://www.linkedin.com/oauth/v2/authorization?{params}", "proxy": selected_proxy})


@api.route("/api/linkedin/callback", methods=["GET"])
def linkedin_callback():
    import linkedin
    from flask import redirect as flask_redirect
    from config import LINKEDIN_CLIENT_ID, LINKEDIN_CLIENT_SECRET, LINKEDIN_REDIRECT_URI, MINI_APP_URL
    code = request.args.get("code", "")
    user_id = request.args.get("state", "")
    if not code or not user_id:
        return jsonify({"error": "code and state are required"}), 400
    try:
        resp = requests.post("https://www.linkedin.com/oauth/v2/accessToken", data={"grant_type": "authorization_code", "code": code, "redirect_uri": LINKEDIN_REDIRECT_URI, "client_id": LINKEDIN_CLIENT_ID, "client_secret": LINKEDIN_CLIENT_SECRET}, timeout=20, proxies=_linkedin_proxies(user_id))
        data = resp.json()
        token = data.get("access_token", "")
        if not token:
            return jsonify({"error": "token_exchange_failed", "details": data}), 400
        linkedin._save_auth(user_id, {"auth_method": "oauth2", "access_token": token, "raw": data})
        storage.update_settings(user_id, {"linkedin": {"connected": True}})
        # Redirect back to Telegram via deep link so user returns to bot
        return flask_redirect(f"tg://resolve?domain=Engagr_bot&start=linkedin_connected_{user_id}")
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/linkedin/profile/<user_id>", methods=["GET"])
def linkedin_profile(user_id):
    import linkedin

    try:
        auth = linkedin._load_auth(user_id)
        token = auth.get("access_token", "")
        if not token:
            return jsonify({"connected": False, "name": "", "headline": "", "email": "", "picture_url": ""})

        headers = {"Authorization": f"Bearer {token}"}
        proxies = _linkedin_proxies(user_id)
        me_resp = requests.get("https://api.linkedin.com/v2/me", headers=headers, timeout=20, proxies=proxies)
        if me_resp.status_code != 200:
            return jsonify({"connected": False, "name": "", "headline": "", "email": "", "picture_url": ""})

        me_data = me_resp.json()
        email_resp = requests.get(
            "https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))",
            headers=headers,
            timeout=20,
            proxies=proxies,
        )

        email = ""
        if email_resp.status_code == 200:
            email_data = email_resp.json()
            email = (((email_data.get("elements") or [{}])[0]).get("handle~") or {}).get("emailAddress", "")

        first_name = (me_data.get("localizedFirstName") or "").strip()
        last_name = (me_data.get("localizedLastName") or "").strip()
        full_name = f"{first_name} {last_name}".strip()

        return jsonify({
            "connected": True,
            "name": full_name,
            "headline": me_data.get("headline", ""),
            "email": email,
            "picture_url": linkedin.get_profile_picture(user_id),
        })
    except Exception as e:
        logger.error(f"linkedin profile fetch failed user={user_id}: {e}")
        return jsonify({"connected": False, "name": "", "headline": "", "email": "", "picture_url": ""})


@api.route("/api/linkedin/cookie", methods=["POST"])
def linkedin_cookie():
    import linkedin
    data = request.get_json() or {}
    user_id = data.get("user_id", "")
    li_at = data.get("li_at", "")
    jsessionid = data.get("jsessionid", data.get("JSESSIONID", ""))
    if not user_id or not li_at:
        return jsonify({"error": "user_id and li_at are required"}), 400
    ok, err = linkedin.verify_li_at(user_id, li_at, jsessionid)
    if ok:
        storage.update_settings(user_id, {"linkedin": {"connected": True}})
        sched_module.add_session_log(user_id, "LinkedIn cookie login OK")
        sched_module.schedule_user_sessions(user_id)
        return jsonify({"connected": True})
    message = err or "LinkedIn rejected these cookies. Copy fresh li_at + JSESSIONID from linkedin.com."
    logger.warning("LinkedIn cookie login failed user=%s: %s", user_id, message)
    sched_module.add_session_log(user_id, f"LinkedIn cookie login failed: {message}")
    return jsonify({
        "connected": False,
        "error": message,
        "error_code": _linkedin_cookie_error_code(message),
    }), 400


@api.route("/api/linkedin/check/<user_id>", methods=["GET"])
def linkedin_check(user_id):
    import linkedin
    connected = asyncio.run(linkedin.check_login(user_id=user_id))
    storage.update_settings(user_id, {"linkedin": {"connected": connected}})
    return jsonify({"connected": connected})


@api.route("/api/reddit/auth/<user_id>", methods=["GET"])
def reddit_auth(user_id):
    return jsonify({
        "error": "Reddit OAuth not available",
        "message": "Use public feed discovery — add subreddits in settings.",
        "url": "",
    }), 501


@api.route("/api/reddit/discovery/<user_id>", methods=["POST"])
def reddit_enable_discovery(user_id):
    """Enable Reddit discovery without API credentials."""
    try:
        storage.update_settings(user_id, {"reddit": {"connected": True, "discovery_only": True}})
        sched_module.schedule_user_sessions(user_id)
        return jsonify({"connected": True, "mode": "discovery"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/reddit/cookie", methods=["POST"])
def reddit_cookie():
    import reddit_bot
    data = request.get_json() or {}
    user_id = data.get("user_id", "")
    rs = data.get("reddit_session", "")
    tv2 = data.get("token_v2", "")
    if not user_id or not rs or not tv2:
        return jsonify({"error": "user_id, reddit_session and token_v2 are required"}), 400
    ok, name = reddit_bot.verify_cookie_login(user_id, rs, tv2)
    if ok:
        storage.update_settings(user_id, {"reddit": {"connected": True, "reddit_username": name}})
        sched_module.schedule_user_sessions(user_id)
        return jsonify({"connected": True})
    return jsonify({"connected": False, "error": "invalid_cookies"}), 400


@api.route("/api/reddit/check/<user_id>", methods=["GET"])
def reddit_check(user_id):
    import reddit_bot
    settings = storage.get_settings(user_id)
    rd = settings.get("reddit", {})
    has_api = reddit_bot.check_login(user_id)
    has_discovery = bool(rd.get("subreddits")) or rd.get("discovery_only", False)
    connected = has_api or has_discovery or rd.get("connected", False)
    storage.update_settings(user_id, {"reddit": {"connected": connected}})
    return jsonify({
        "connected": connected,
        "discovery": has_discovery,
        "api_login": has_api,
    })


@api.route("/api/linkedin/warmup/<user_id>", methods=["POST"])
def linkedin_warmup_tick(user_id):
    """Advance warm-up day counter and adjust comments_per_day."""
    try:
        from datetime import datetime, timezone
        settings = storage.get_settings(user_id)
        li_cfg = settings.get("linkedin", {})
        if not li_cfg.get("warmup_mode", False):
            return jsonify({"status": "warmup_disabled"})
        current_day = li_cfg.get("warmup_day", 1)
        new_day = current_day + 1
        # Every 3 days, increment target by 1 (max 15)
        base_target = li_cfg.get("warmup_base_target", 1)
        new_target = min(base_target + (new_day // 3), 15)
        storage.update_settings(user_id, {
            "linkedin": {
                **li_cfg,
                "warmup_day": new_day,
                "comments_per_day": new_target,
                "warmup_started_at": li_cfg.get("warmup_started_at", datetime.now(timezone.utc).date().isoformat()),
            }
        })
        sched_module.schedule_user_sessions(user_id)
        return jsonify({"status": "ok", "warmup_day": new_day, "comments_per_day": new_target})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/session/simulate/<user_id>", methods=["POST"])
def simulate_session(user_id):
    """Generate simulated queue items for demo/testing."""
    import ai_comment, uuid
    from datetime import datetime, timezone

    try:
        settings = storage.get_settings(user_id)
        user_language = settings.get("language", "en")
        li_cfg = settings.get("linkedin", {})
        tone = li_cfg.get("tone", "friendly")

        # Sample posts for simulation
        sample_posts = [
            {"text": "Building in public is the best marketing strategy for B2B SaaS founders. Transparency wins trust and customers.", "author": "Александр Иванов", "platform": "linkedin"},
            {"text": "AI is not replacing developers, it is making us 10x more productive. The future is human+AI collaboration.", "author": "Maria Schmidt", "platform": "reddit"},
            {"text": "The secret to PMF is talking to 100 customers before writing a single line of code. No shortcuts.", "author": "John Doe", "platform": "linkedin"},
        ]
        now = datetime.now(timezone.utc).isoformat()
        queued = 0
        for post in sample_posts:
            try:
                comment_data = ai_comment.generate_comment_variants(
                    post["text"], user_language, post["platform"], tone=tone
                )
                variants = comment_data.get("variants", [post["text"][:100]])
                item_id = f"sim_{uuid.uuid4().hex[:8]}"
                storage.add_to_queue(user_id, {
                    "id": item_id,
                    "platform": post["platform"],
                    "post_text": post["text"],
                    "post_excerpt": post["text"][:150],
                    "author_name": post["author"],
                    "reactions_count": 42,
                    "post_url": "https://www.linkedin.com/feed/update/sim",
                    "comment_variants": variants,
                    "selected_comment": variants[0] if variants else "",
                    "comment": variants[0] if variants else "",
                    "user_language": user_language,
                    "post_language": "en",
                    "status": "pending",
                    "created_at": now,
                    "simulated": True,
                })
                queued += 1
            except Exception as e:
                logger.error("simulate item error: %s", e)
        return jsonify({"queued": queued})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/session/run/<user_id>", methods=["POST"])
def run_session_now(user_id):
    import linkedin
    import ai_comment

    try:
        settings = storage.get_settings(user_id)
        li_cfg = settings.get("linkedin", {})
        keywords = li_cfg.get("keywords", []) or []
        max_posts = min(li_cfg.get("comments_per_day", 5), li_cfg.get("daily_comment_hard_limit", 10))
        user_language = settings.get("language", "en")

        # Apply warm-up mode limit. Do not import datetime in this function: it
        # shadows the module-level import and breaks non-warmup sessions later.
        if li_cfg.get("warmup_mode", False):
            started = li_cfg.get("warmup_started_at") or datetime.now(timezone.utc).date().isoformat()
            try:
                start_dt = datetime.fromisoformat(started)
                if start_dt.tzinfo is None:
                    start_dt = start_dt.replace(tzinfo=timezone.utc)
            except Exception:
                start_dt = datetime.now(timezone.utc)
            days = max((datetime.now(timezone.utc) - start_dt).days, 0)
            warmup_limit = min(1 + (days // 3), 15)
            max_posts = min(max_posts, warmup_limit)
            sched_module._log(user_id, f"[Warm-up Day {days+1}] Daily comment limit: {max_posts}")

        sched_module._log(user_id, f"🔍 Searching posts by keywords: {', '.join(keywords[:3])}...")
        auth = linkedin._load_auth(user_id)
        logger.info(
            "run_session_now user=%s auth_method=%s has_li_at=%s has_access_token=%s",
            user_id, auth.get("auth_method", ""), bool(auth.get("li_at")), bool(auth.get("access_token")),
        )
        has_li_at = bool(auth.get("li_at"))
        linkedin.ensure_client(user_id)
        if not linkedin._clients.get(user_id) and not has_li_at:
            sched_module._log(
                user_id,
                "⚠️ No li_at cookie — feed scrape unavailable. Mini App → LinkedIn → Paste li_at.",
            )
        posts = asyncio.run(linkedin.scrape_posts(None, keywords, max_posts=max_posts, user_id=user_id))
        if not posts and auth.get("access_token") and not has_li_at:
            sched_module._log(user_id, "⚠️ Trying OAuth (usually only your own posts)...")
            posts = linkedin.scrape_posts_oauth(user_id, keywords, max_posts=max_posts)
        sched_module._log(user_id, f"📄 Found {len(posts)} posts matching keywords.")
        if not posts:
            if has_li_at:
                sched_module._log(
                    user_id,
                    "💡 LinkedIn cookie mode scans your home feed/search fallback, not the whole public web. "
                    "Try broader keywords, follow/comment on relevant creators, or run again after refreshing cookies.",
                )
            elif auth.get("access_token"):
                sched_module._log(
                    user_id,
                    "💡 OAuth mode usually returns only your own LinkedIn content; paste li_at + JSESSIONID for discovery.",
                )

        # Apply humanness filter — skip AI-generated posts
        pre_filter_count = len(posts)
        posts = humanness_scorer.filter_human_posts(posts, threshold=0.5)
        filtered_out = pre_filter_count - len(posts)
        if filtered_out > 0:
            sched_module._log(user_id, f"🤖 Filtered {filtered_out} AI-generated posts. {len(posts)} human posts remain.")

        # Enrich with interaction memory
        posts = interaction_memory.get_repeat_authors_in_queue(user_id, posts)
        logger.info("run_session_now user=%s scraped_posts=%s", user_id, len(posts))
        queued = 0
        now = datetime.now(timezone.utc).isoformat()
        result_posts = []

        for post in posts:
            post_text = post.get("text", "")
            if not post_text:
                continue

            author = post.get("author_name", "Unknown")
            sched_module._log(user_id, f"✍️ Post from {author}. Generating {user_language.upper()} comment ({li_cfg.get('tone', 'friendly')} tone)...")

            # Apply random delay before generating (anti-ban)
            import random as _random
            jitter = li_cfg.get("session_jitter_minutes", [3, 17])
            jitter_sec = _random.randint(5, 30)
            sched_module._log(user_id, f"⏳ Random delay before next action: {jitter_sec}s...")

            # Generate 3 comment variants with language detection
            comment_data = ai_comment.generate_comment_variants(
                post_text, user_language, "linkedin", tone=li_cfg.get("tone", "friendly")
            )
            variants = comment_data.get("variants", [])
            if not variants:
                sched_module._log(user_id, "❌ Comment generation failed for this post. Skipping.")
                continue

            sched_module._log(user_id, f"✅ Generated {len(variants)} comment variants. Added to review queue.")
            item_id = f"li_{post.get('id', queued)}_{queued}"
            storage.add_to_queue(user_id, {
                "id": item_id,
                "platform": "linkedin",
                "post_id": post.get("id", ""),
                "post_url": post.get("url", ""),
                "post_text": post_text,
                "post_excerpt": post.get("excerpt", ""),
                "author_name": post.get("author_name", ""),
                "reactions_count": post.get("reactions_count", 0),
                "comment_variants": variants,
                "selected_comment": variants[0] if variants else "",
                "comment": variants[0] if variants else "",
                "user_language": user_language,
                "post_language": comment_data.get("post_language", "en"),
                "status": "pending",
                "created_at": now,
                "humanness_score": post.get("humanness_score", 1.0),
                "has_previous_interaction": post.get("has_previous_interaction", False),
                "interaction_hint": post.get("interaction_hint", ""),
            })
            queued += 1
            result_posts.append({
                "url": post.get("url", ""),
                "excerpt": post.get("excerpt", ""),
                "author": post.get("author_name", ""),
            })

        if queued == 0:
            sched_module._log(user_id, f"⚠️ No comments queued (posts={len(posts)}, keywords={len(keywords)}). Check connection and keywords.")
            logger.warning("run_session_now user=%s queued=0 (posts=%s keywords=%s)", user_id, len(posts), len(keywords))
        else:
            sched_module._log(user_id, f"🎉 Session complete. {queued} items added to review queue.")
        return jsonify({"queued": queued, "posts": result_posts})
    except Exception as e:
        sched_module._log(user_id, f"❌ Session error: {str(e)[:120]}")
        logger.error("manual session run failed user=%s err=%s", user_id, e)
        return jsonify({"error": str(e)}), 500


@api.route("/api/reddit/session/run/<user_id>", methods=["POST"])
def run_reddit_session_now(user_id):
    """Manually trigger Reddit discovery session (public .json parser)."""
    try:
        asyncio.run_coroutine_threadsafe(
            sched_module.run_reddit_session(user_id),
            _loop,
        )
        return jsonify({"status": "started"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Smart Schedule Endpoints ─────────────────────────

@api.route("/api/smart-schedule/<user_id>/<platform>", methods=["GET"])
def get_smart_schedule(user_id, platform):
    """Calculate optimal posting times based on activity patterns."""
    try:
        times = smart_schedule.calculate_optimal_times(user_id, platform)
        return jsonify({"times": times, "platform": platform})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/smart-schedule/<user_id>/<platform>/apply", methods=["POST"])
def apply_smart_schedule(user_id, platform):
    """Apply smart schedule times to user settings."""
    try:
        times = smart_schedule.calculate_optimal_times(user_id, platform)
        if platform == "linkedin":
            storage.update_settings(user_id, {"linkedin": {"session_times": times}})
        else:
            storage.update_settings(user_id, {"reddit": {"session_times": times}})
        sched_module.schedule_user_sessions(user_id)
        return jsonify({"status": "ok", "times": times})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Analytics Endpoints ──────────────────────────────

@api.route("/api/analytics/<user_id>/weekly", methods=["GET"])
def get_weekly_analytics(user_id):
    """Get weekly analytics data for dashboard chart."""
    try:
        data = smart_schedule.get_weekly_analytics(user_id)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/analytics/<user_id>/monthly", methods=["GET"])
def get_monthly_analytics(user_id):
    """Get monthly analytics data."""
    try:
        data = smart_schedule.get_monthly_analytics(user_id)
        return jsonify(data)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Nested Replies Endpoints ─────────────────────────

@api.route("/api/replies/<user_id>", methods=["GET"])
def get_reply_queue(user_id):
    """Get pending reply threads."""
    try:
        queue = nested_replies.get_reply_queue(user_id)
        return jsonify({"replies": queue})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/replies/<user_id>/<thread_id>/suggest", methods=["POST"])
def suggest_reply(user_id, thread_id):
    """Generate AI suggestion for a reply."""
    try:
        threads = nested_replies.get_tracked_threads(user_id)
        thread = next((t for t in threads if t["id"] == thread_id), None)
        if not thread:
            return jsonify({"error": "Thread not found"}), 404

        settings = storage.get_settings(user_id)
        tone = (settings.get("linkedin") or {}).get("tone", "friendly")
        suggestion = nested_replies.generate_reply_suggestion(thread, tone=tone)
        return jsonify({"suggestion": suggestion or ""})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/replies/<user_id>/<thread_id>/dismiss", methods=["POST"])
def dismiss_reply(user_id, thread_id):
    """Dismiss a reply thread (won't reply)."""
    try:
        nested_replies.dismiss_reply_thread(user_id, thread_id)
        return jsonify({"status": "dismissed"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── News Grounding Endpoint ──────────────────────────

@api.route("/api/news/trending", methods=["GET"])
def get_trending_news():
    """Get current trending news from tech sources."""
    try:
        keywords = request.args.get("keywords", "").split(",")
        keywords = [k.strip() for k in keywords if k.strip()]
        news = news_grounding.get_trending_news(keywords, limit=8)
        return jsonify({"news": news})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Invite Generator Endpoints ────────────────────────

@api.route("/api/invite/<user_id>/generate", methods=["POST"])
def generate_invite(user_id):
    """Generate personalized connection invite message."""
    try:
        data = request.get_json() or {}
        author_name = data.get("author_name", "")
        post_text = data.get("post_text", "")
        post_topic = data.get("post_topic", "")

        if not author_name:
            return jsonify({"error": "author_name is required"}), 400

        settings = storage.get_settings(user_id)
        language = settings.get("language", "en")
        tone = (settings.get("linkedin") or {}).get("tone", "friendly")

        # Get previous interaction context
        prev_ctx = interaction_memory.get_interaction_context_for_ai(user_id, author_name)

        result = invite_generator.generate_invite_message(
            author_name=author_name,
            post_text=post_text,
            post_topic=post_topic,
            platform="linkedin",
            tone=tone,
            language=language,
            previous_interaction=prev_ctx,
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/invite/<user_id>/followup", methods=["POST"])
def generate_followup_invite(user_id):
    """Generate followup invite for an author we've already interacted with."""
    try:
        data = request.get_json() or {}
        author_name = data.get("author_name", "")
        previous_comment = data.get("previous_comment", "")

        if not author_name:
            return jsonify({"error": "author_name is required"}), 400

        settings = storage.get_settings(user_id)
        language = settings.get("language", "en")

        history = interaction_memory.get_author_history(user_id, author_name)
        count = history.get("interaction_count", 0) if history else 0

        result = invite_generator.generate_followup_invite(
            author_name=author_name,
            previous_comment=previous_comment,
            interaction_count=count,
            language=language,
        )
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Humanness Scoring Endpoint ───────────────────────

@api.route("/api/humanness/score", methods=["POST"])
def score_humanness(user_id=None):
    """Score a post's humanness to decide if it's worth commenting on."""
    try:
        data = request.get_json() or {}
        text = data.get("text", "")
        if not text:
            return jsonify({"error": "text is required"}), 400

        result = humanness_scorer.score_humanness(text)
        return jsonify(result)
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Interaction Memory Endpoints ─────────────────────

@api.route("/api/memory/<user_id>/interactions", methods=["GET"])
def get_interactions(user_id):
    """Get all interaction memory for user (CRM view)."""
    try:
        interactions = interaction_memory.get_all_interactions(user_id)
        top = interaction_memory.get_top_connections(user_id, limit=20)
        return jsonify({"total": len(interactions), "top_connections": top})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/memory/<user_id>/author/<author_name>", methods=["GET"])
def get_author_memory(user_id, author_name):
    """Get interaction history with a specific author."""
    try:
        history = interaction_memory.get_author_history(user_id, author_name)
        return jsonify({"history": history})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/memory/<user_id>/record", methods=["POST"])
def record_interaction_endpoint(user_id):
    """Record a new interaction with an author."""
    try:
        data = request.get_json() or {}
        interaction_memory.record_interaction(
            user_id=user_id,
            author_name=data.get("author_name", ""),
            author_profile_url=data.get("profile_url", ""),
            platform=data.get("platform", "linkedin"),
            interaction_type=data.get("type", "comment"),
            context=data.get("context", ""),
            post_url=data.get("post_url", ""),
            our_message=data.get("our_message", ""),
        )
        return jsonify({"status": "recorded"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Daily Digest Endpoint ─────────────────────────────

@api.route("/api/digest/<user_id>/preview", methods=["GET"])
def preview_digest(user_id):
    """Preview what the daily digest would look like."""
    try:
        import asyncio as _asyncio
        items = _asyncio.run(daily_digest.generate_daily_digest(user_id))
        return jsonify({"items": items})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/digest/<user_id>/send", methods=["POST"])
def send_digest_now(user_id):
    """Manually trigger daily digest send."""
    try:
        asyncio.run_coroutine_threadsafe(
            daily_digest.send_daily_digest(user_id), _loop
        )
        return jsonify({"status": "sending"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# ── Background Posting ────────────────────────────────

async def _post_item_delayed(user_id: str, item: dict):
    """Post an approved item after a random delay."""
    import random
    from config import DELAYS
    import queue_executor

    action = item.get("action", "comment")
    delay_key = "like" if action in ("like", "upvote") else "comment"
    delay = random.uniform(*DELAYS[delay_key])
    logger.info("Posting item %s action=%s in %s sec", item["id"], action, int(delay))
    await asyncio.sleep(delay)

    success, _msg = await queue_executor.execute_queue_item(user_id, item)
    storage.remove_from_queue(user_id, item["id"])

    platform = item.get("platform", "")

    if success:
        try:
            nested_replies.track_posted_comment(user_id, item)
        except Exception as e:
            logger.error("Failed to track posted comment: %s", e)

        try:
            interaction_memory.record_interaction(
                user_id=user_id,
                author_name=item.get("author_name", "") or item.get("author", ""),
                author_profile_url=item.get("post_url", ""),
                platform=platform,
                interaction_type=item.get("action", "comment"),
                post_url=item.get("post_url", ""),
                our_message=item.get("comment", ""),
            )
        except Exception as e:
            logger.error("Failed to record interaction: %s", e)

        # Save activity record for analytics
        try:
            from datetime import datetime, timezone
            stats = storage.get_stats(user_id)
            smart_schedule.save_activity_record(user_id, {
                "date": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
                "linkedin_comments": stats.get("linkedin_comments", 0),
                "linkedin_likes": stats.get("linkedin_likes", 0),
                "reddit_comments": stats.get("reddit_comments", 0),
                "reddit_upvotes": stats.get("reddit_upvotes", 0),
                "best_hour": datetime.now(timezone.utc).hour,
                "engagement_score": 1,
            })
        except Exception as e:
            logger.error("Failed to save activity record: %s", e)

    # Notify user
    try:
        status_msg = "Comment posted successfully!" if success else "Failed to post comment."
        await telegram_bot.send_queue_item_to_user(user_id, {"type": "error", "message": status_msg})
    except Exception:
        pass


# ── Main ──────────────────────────────────────────────

_loop = None
_bot_poll_lock_fp = None


def _try_acquire_bot_poll_lock() -> bool:
    """Prevent multiple app instances from polling Telegram simultaneously."""
    global _bot_poll_lock_fp
    lock_path = "/tmp/engagr_telegram_polling.lock"
    try:
        fp = open(lock_path, "w")
        fcntl.flock(fp.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        fp.write(str(os.getpid()))
        fp.flush()
        _bot_poll_lock_fp = fp
        logger.info("Telegram polling lock acquired path=%s pid=%s", lock_path, os.getpid())
        return True
    except OSError:
        logger.warning("Telegram polling lock already held path=%s; skipping polling in this instance", lock_path)
        return False


def run_flask():
    """Run Flask API in a separate thread."""
    port = int(os.environ.get("PORT", 5000))
    api.run(host="0.0.0.0", port=port, debug=False, use_reloader=False)


async def main():
    global _loop
    _loop = asyncio.get_event_loop()

    logger.info("=" * 50)
    logger.info("  Engagr — Starting up...")
    logger.info("=" * 50)

    # Validate config
    if not TELEGRAM_BOT_TOKEN:
        logger.error("TELEGRAM_BOT_TOKEN not set!")
        sys.exit(1)

    # Start Flask API in background thread
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()
    logger.info("Flask API started")

    # Start scheduler
    sched_module.start_scheduler()
    sched_module.reschedule_all_users()

    # Create and run Telegram bot
    bot_app = telegram_bot.create_bot()

    logger.info("Telegram bot starting...")

    # Initialize the bot
    await bot_app.initialize()
    await bot_app.start()

    # Set bot commands
    try:
        await bot_app.bot.set_my_commands([
            BotCommand("start", "Start and setup Engagr"),
            BotCommand("dashboard", "View today's stats"),
            BotCommand("queue", "View pending comments"),
            BotCommand("settings", "Open settings"),
            BotCommand("linkedin", "LinkedIn setup guide"),
            BotCommand("reddit", "Reddit setup guide"),
            BotCommand("pause", "Pause all sessions"),
            BotCommand("resume", "Resume sessions"),
        ])
    except Exception as e:
        logger.error(f"Error setting bot commands: {e}")

    # Start polling only if this process owns the lock (prevents Conflict from duplicate instances)
    polling_started = False
    if _try_acquire_bot_poll_lock():
        await bot_app.updater.start_polling(drop_pending_updates=True)
        polling_started = True

    logger.info("✅ Engagr is running!")

    # Keep running
    try:
        while True:
            await asyncio.sleep(3600)
    except (KeyboardInterrupt, SystemExit):
        logger.info("Shutting down...")
        sched_module.stop_scheduler()
        if polling_started:
            await bot_app.updater.stop()
        await bot_app.stop()
        await bot_app.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
