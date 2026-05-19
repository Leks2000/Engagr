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


# ── Onboarding ────────────────────────────────────────

@api.route("/api/onboarding/reddit", methods=["POST"])
def onboarding_reddit():
    try:
        data = request.get_json()
        user_id = data.get("user_id", "")
        
        if not user_id:
            return jsonify({"error": "user_id is required"}), 400
        
        reddit_settings = {
            "reddit": {
                "connected": True,
                "client_id": data.get("client_id", ""),
                "client_secret": data.get("client_secret", ""),
                "username": data.get("username", ""),
                "password": data.get("password", ""),
            }
        }
        
        storage.update_settings(user_id, reddit_settings)
        sched_module.schedule_user_sessions(user_id)
        
        return jsonify({"status": "connected"})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@api.route("/api/onboarding/linkedin/status/<user_id>", methods=["GET"])
def linkedin_status(user_id):
    from config import COOKIES_PATH
    connected = COOKIES_PATH.exists()
    if connected:
        storage.update_settings(user_id, {"linkedin": {"connected": True}})
    return jsonify({"connected": connected})


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
            success = await linkedin.post_comment(pw, item["post_url"], item["comment"])
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
    
    # Initialize Playwright (if available)
    try:
        from playwright.async_api import async_playwright
        pw = await async_playwright().start()
        sched_module.set_playwright(pw)
        logger.info("Playwright initialized")
    except Exception as e:
        logger.warning(f"Playwright not available: {e}")
    
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
