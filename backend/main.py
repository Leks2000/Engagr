"""
Engagr — Main Entry Point
Starts the Telegram bot, Flask API, and APScheduler.
"""

import os
import sys
import asyncio
import logging
import threading
from pathlib import Path

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

        storage.update_queue_item(user_id, item_id, {"comment": new_comment})
        return jsonify({"status": "updated"})
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

    cookies_path = linkedin_cookies_path(user_id)
    connected = cookies_path.exists() or COOKIES_PATH.exists()

    if connected:
        storage.update_settings(user_id, {"linkedin": {"connected": True}})

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
