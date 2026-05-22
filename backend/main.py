"""
Engagr — Main Entry Point
Starts the Telegram bot, Flask API, and APScheduler.
"""

import os
import sys
import asyncio
import logging
import threading
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

# ── Logging ───────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("engagr")

LINKEDIN_PROXY_POOL = [
    "http://jgonrihk:waie52nyin2x@23.95.150.145:6114",
    "http://jgonrihk:waie52nyin2x@38.154.203.95:5863",
    "http://jgonrihk:waie52nyin2x@198.23.243.226:6361",
    "http://jgonrihk:waie52nyin2x@209.127.138.10:5784",
    "http://jgonrihk:waie52nyin2x@38.154.185.97:6370",
    "http://jgonrihk:waie52nyin2x@50.114.82.8:6992",
    "http://jgonrihk:waie52nyin2x@198.105.121.200:6462",
    "http://jgonrihk:waie52nyin2x@64.137.96.74:6641",
    "http://jgonrihk:waie52nyin2x@84.247.60.125:6095",
    "http://jgonrihk:waie52nyin2x@142.111.67.146:5611",
]


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

        new_comment = ai_comment.regenerate_comment(
            item.get("post_text", ""),
            item.get("comment", ""),
            item.get("platform", "linkedin"),
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
    if not user_id or not li_at:
        return jsonify({"error": "user_id and li_at are required"}), 400
    ok = linkedin.verify_li_at(user_id, li_at)
    if ok:
        storage.update_settings(user_id, {"linkedin": {"connected": True}})
        sched_module.schedule_user_sessions(user_id)
        return jsonify({"connected": True})
    return jsonify({"connected": False, "error": "invalid_cookie"}), 400


@api.route("/api/linkedin/check/<user_id>", methods=["GET"])
def linkedin_check(user_id):
    import linkedin
    connected = asyncio.run(linkedin.check_login(user_id=user_id))
    storage.update_settings(user_id, {"linkedin": {"connected": connected}})
    return jsonify({"connected": connected})


@api.route("/api/reddit/auth/<user_id>", methods=["GET"])
def reddit_auth(user_id):
    return jsonify({"error": "Reddit OAuth not implemented", "url": ""}), 501


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
    connected = reddit_bot.check_login(user_id)
    storage.update_settings(user_id, {"reddit": {"connected": connected}})
    return jsonify({"connected": connected})


@api.route("/api/session/run/<user_id>", methods=["POST"])
def run_session_now(user_id):
    import linkedin
    import ai_comment

    try:
        settings = storage.get_settings(user_id)
        li_cfg = settings.get("linkedin", {})
        keywords = li_cfg.get("keywords", []) or []
        max_posts = li_cfg.get("comments_per_day", 5)
        user_language = settings.get("language", "en")

        posts = linkedin.scrape_posts_oauth(user_id, keywords, max_posts=max_posts)
        queued = 0
        now = datetime.now(timezone.utc).isoformat()
        result_posts = []

        for post in posts:
            post_text = post.get("text", "")
            if not post_text:
                continue

            # Generate 3 comment variants with language detection
            comment_data = ai_comment.generate_comment_variants(
                post_text, user_language, "linkedin"
            )
            variants = comment_data.get("variants", [])
            if not variants:
                continue

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
            })
            queued += 1
            result_posts.append({
                "url": post.get("url", ""),
                "excerpt": post.get("excerpt", ""),
                "author": post.get("author_name", ""),
            })

        return jsonify({"queued": queued, "posts": result_posts})
    except Exception as e:
        logger.error("manual session run failed user=%s err=%s", user_id, e)
        return jsonify({"error": str(e)}), 500


# ── Background Posting ────────────────────────────────

async def _post_item_delayed(user_id: str, item: dict):
    """Post an approved item after a random delay."""
    import random
    from config import DELAYS

    delay = random.uniform(*DELAYS["comment"])
    logger.info(f"Posting item {item['id']} in {int(delay/60)} minutes")
    await asyncio.sleep(delay)

    success = False
    platform = item.get("platform", "")

    if platform == "linkedin":
        import linkedin
        pw = sched_module._playwright
        if pw and item.get("post_url"):
            success = await linkedin.post_comment(pw, item["post_url"], item["comment"], user_id)
        if success:
            storage.increment_stat(user_id, "linkedin_comments")
    elif platform == "reddit":
        import reddit_bot
        reddit_id = item.get("reddit_id", "")
        if reddit_id:
            success = reddit_bot.post_comment(user_id, reddit_id, item["comment"])
        if success:
            storage.increment_stat(user_id, "reddit_comments")

    storage.remove_from_queue(user_id, item["id"])

    # Notify user
    try:
        status_msg = "✅ Comment posted successfully!" if success else "❌ Failed to post comment."
        await telegram_bot.send_queue_item_to_user(user_id, {"type": "error", "message": status_msg})
    except Exception:
        pass


# ── Main ──────────────────────────────────────────────

_loop = None


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

    # Start polling
    await bot_app.updater.start_polling(drop_pending_updates=True)

    logger.info("✅ Engagr is running!")

    # Keep running
    try:
        while True:
            await asyncio.sleep(3600)
    except (KeyboardInterrupt, SystemExit):
        logger.info("Shutting down...")
        sched_module.stop_scheduler()
        await bot_app.updater.stop()
        await bot_app.stop()
        await bot_app.shutdown()


if __name__ == "__main__":
    asyncio.run(main())
