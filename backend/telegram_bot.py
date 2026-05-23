"""
Engagr — Telegram Bot
Handles: commands, approval flow with inline buttons, Mini App integration.
"""

import random
import asyncio
import logging

from telegram import (
    Update, InlineKeyboardButton, InlineKeyboardMarkup,
    WebAppInfo, MenuButtonWebApp, BotCommand,
)
from telegram.ext import (
    Application, CommandHandler, CallbackQueryHandler,
    MessageHandler, ContextTypes, filters,
)

from config import TELEGRAM_BOT_TOKEN, MINI_APP_URL, DELAYS, DAILY_LIMITS
import storage
import ai_comment
import linkedin
import reddit_bot
import scheduler as sched_module

logger = logging.getLogger(__name__)

# Track users in "edit mode" — awaiting custom comment text
_edit_mode: dict[str, str] = {}  # user_id -> queue_item_id


# ── Commands ──────────────────────────────────────────

async def cmd_start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    
    # Handle deep link payload from LinkedIn OAuth redirect
    if context.args and context.args[0].startswith("linkedin_connected_"):
        payload_user_id = context.args[0].replace("linkedin_connected_", "")
        # Verify user matches or update settings for the payload user
        target_user = payload_user_id if payload_user_id else user_id
        storage.update_settings(target_user, {"linkedin": {"connected": True}})
        
        await update.message.reply_text(
            "✅ *LinkedIn connected successfully!*\n\n"
            "Your account is linked. Open the Mini App to start engaging.",
            parse_mode="Markdown",
        )
        
        # Send inline button to open Mini App
        if MINI_APP_URL:
            keyboard = InlineKeyboardMarkup([
                [InlineKeyboardButton("🚀 Open Engagr", web_app=WebAppInfo(url=MINI_APP_URL))]
            ])
            await update.message.reply_text(
                "Tap below to return to the app:",
                reply_markup=keyboard,
            )
        return
    
    # Initialize user data
    storage.get_settings(user_id)
    storage.get_stats(user_id)
    
    welcome = (
        "👋 *Welcome to Engagr!*\n\n"
        "Automate your LinkedIn & Reddit engagement with AI-powered comments.\n\n"
        "🔧 *Quick Setup:*\n"
        "1. /settings — Configure platforms\n"
        "2. /linkedin — Connect LinkedIn\n"
        "3. /reddit — Connect Reddit\n"
        "4. /dashboard — View today's stats\n"
        "5. /queue — See pending comments\n\n"
        "💡 Open the Mini App for the full experience!"
    )
    
    # Set up Mini App menu button if URL is configured
    if MINI_APP_URL:
        try:
            await context.bot.set_chat_menu_button(
                chat_id=update.effective_chat.id,
                menu_button=MenuButtonWebApp(
                    text="Open Engagr",
                    web_app=WebAppInfo(url=MINI_APP_URL),
                ),
            )
        except Exception as e:
            logger.error(f"Error setting menu button: {e}")
    
    await update.message.reply_text(welcome, parse_mode="Markdown")


async def cmd_dashboard(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    stats = storage.get_stats(user_id)
    settings = storage.get_settings(user_id)
    
    status_emoji = "🟢" if settings.get("session_active", True) else "🔴"
    status_text = "Active" if settings.get("session_active", True) else "Paused"
    
    dashboard = (
        f"📊 *Dashboard — Today*\n\n"
        f"*LinkedIn:*\n"
        f"  💬 Comments: {stats.get('linkedin_comments', 0)}/{DAILY_LIMITS['linkedin_comments']}\n"
        f"  👍 Likes: {stats.get('linkedin_likes', 0)}/{DAILY_LIMITS['linkedin_likes']}\n"
        f"  🤝 People Added: {stats.get('linkedin_adds', 0)}/{DAILY_LIMITS['linkedin_adds']}\n\n"
        f"*Reddit:*\n"
        f"  💬 Comments: {stats.get('reddit_comments', 0)}/{DAILY_LIMITS['reddit_comments']}\n"
        f"  ⬆️ Upvotes: {stats.get('reddit_upvotes', 0)}/{DAILY_LIMITS['reddit_upvotes']}\n\n"
        f"*Session:* {status_emoji} {status_text}"
    )
    
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton(
                "⏸ Pause" if settings.get("session_active") else "▶️ Resume",
                callback_data="toggle_session"
            )
        ]
    ])
    
    await update.message.reply_text(dashboard, parse_mode="Markdown", reply_markup=keyboard)


async def cmd_linkedin(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🔗 *LinkedIn Setup*\n\n"
        "To connect LinkedIn, run the setup script on your server:\n"
        "```\npython backend/setup.py\n```\n\n"
        "This opens a browser window where you log in to LinkedIn.\n"
        "Cookies are saved automatically for future sessions.",
        parse_mode="Markdown",
    )


async def cmd_reddit(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🤖 *Reddit Setup*\n\n"
        "Connect your Reddit account via OAuth:\n\n"
        "1. Open the Mini App (Settings → Reddit)\n"
        "2. Click *Connect via Reddit OAuth*\n"
        "3. Authorize Engagr in the popup\n"
        "4. Done! No passwords needed ✅\n\n"
        "💡 Your account is connected securely using OAuth tokens.",
        parse_mode="Markdown",
    )


async def cmd_settings(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if MINI_APP_URL:
        keyboard = InlineKeyboardMarkup([
            [InlineKeyboardButton("⚙️ Open Settings", web_app=WebAppInfo(url=MINI_APP_URL))]
        ])
        await update.message.reply_text(
            "Open the Mini App to configure your settings:",
            reply_markup=keyboard,
        )
    else:
        await update.message.reply_text(
            "⚙️ Settings are available via the Mini App.\n"
            "Set MINI_APP_URL in your environment to enable it."
        )


async def cmd_queue(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    queue = storage.get_queue(user_id)
    pending = [q for q in queue if q.get("status") == "pending"]
    
    if not pending:
        await update.message.reply_text("📭 No pending comments in queue.")
        return
    
    await update.message.reply_text(f"📋 *Queue:* {len(pending)} pending comments\n", parse_mode="Markdown")
    
    # Send first 5 items
    for item in pending[:5]:
        await _send_queue_card(update.effective_chat.id, item, context)


async def cmd_pause(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    storage.update_settings(user_id, {"session_active": False})
    sched_module.schedule_user_sessions(user_id)
    await update.message.reply_text("⏸ Sessions paused. Use /resume to restart.")


async def cmd_resume(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    storage.update_settings(user_id, {"session_active": True})
    sched_module.schedule_user_sessions(user_id)
    await update.message.reply_text("▶️ Sessions resumed!")


async def cmd_digest(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Trigger daily digest manually."""
    user_id = str(update.effective_user.id)
    import daily_digest as dd
    dd.set_send_callback(send_queue_item_to_user)
    await dd.send_daily_digest(user_id)


async def cmd_connections(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Show top connections (CRM view)."""
    user_id = str(update.effective_user.id)
    import interaction_memory
    top = interaction_memory.get_top_connections(user_id, limit=10)
    
    if not top:
        await update.message.reply_text(
            "📇 *Networking CRM*\n\n"
            "No interactions recorded yet. Start engaging with posts!",
            parse_mode="Markdown",
        )
        return
    
    lines = ["📇 *Your Top Connections*\n"]
    for i, c in enumerate(top, 1):
        lines.append(
            f"{i}. *{c.get('author_name', '?')}* — {c.get('interaction_count', 0)} interactions"
        )
    
    await update.message.reply_text("\n".join(lines), parse_mode="Markdown")


# ── Queue Card (Telegram Approval Flow) ──────────────

async def _send_queue_card(chat_id, item: dict, context: ContextTypes.DEFAULT_TYPE):
    """Send a queue item as a formatted card with action buttons."""
    platform = item.get("platform", "").upper()
    platform_badge = "📍 LINKEDIN" if platform == "LINKEDIN" else "📍 REDDIT"
    
    text = (
        f"{platform_badge}\n"
        f"📝 {item.get('post_excerpt', '')[:200]}\n\n"
        f"💬 {item.get('comment', '')}\n"
    )
    
    item_id = item.get("id", "")
    keyboard = InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ Post", callback_data=f"approve_{item_id}"),
            InlineKeyboardButton("✏️ Edit", callback_data=f"edit_{item_id}"),
        ],
        [
            InlineKeyboardButton("❌ Skip", callback_data=f"skip_{item_id}"),
            InlineKeyboardButton("🔄 Regenerate", callback_data=f"regen_{item_id}"),
        ],
    ])
    
    await context.bot.send_message(chat_id=chat_id, text=text, reply_markup=keyboard)


# ── Callback Handler (Button Presses) ────────────────

async def handle_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    
    user_id = str(update.effective_user.id)
    data = query.data
    
    if data == "toggle_session":
        settings = storage.get_settings(user_id)
        new_state = not settings.get("session_active", True)
        storage.update_settings(user_id, {"session_active": new_state})
        sched_module.schedule_user_sessions(user_id)
        
        status = "▶️ Sessions resumed!" if new_state else "⏸ Sessions paused."
        await query.edit_message_text(status)
        return
    
    # Parse action_itemId
    parts = data.split("_", 1)
    if len(parts) != 2:
        return
    
    action, item_id = parts[0], parts[1]
    item = storage.get_queue_item(user_id, item_id)
    
    if not item:
        await query.edit_message_text("❌ Item not found or already processed.")
        return
    
    if action == "approve":
        await _approve_item(user_id, item, query, context)
    elif action == "edit":
        _edit_mode[user_id] = item_id
        await query.edit_message_text(
            f"✏️ Send your custom comment for this post:\n\n"
            f"📝 {item.get('post_excerpt', '')[:200]}"
        )
    elif action == "skip":
        storage.remove_from_queue(user_id, item_id)
        await query.edit_message_text("❌ Comment skipped.")
    elif action == "regen":
        await _regenerate_item(user_id, item, query, context)


async def _approve_item(user_id: str, item: dict, query, context):
    """Approve and schedule posting of a comment."""
    platform = item.get("platform", "")
    
    # Random delay before posting
    delay = random.uniform(*DELAYS["comment"])
    await query.edit_message_text(
        f"✅ Approved! Will post in ~{int(delay/60)} minutes.\n\n"
        f"💬 {item.get('comment', '')}"
    )
    
    # Schedule the actual posting
    await asyncio.sleep(delay)
    
    success = False
    if platform == "linkedin":
        pw = sched_module._playwright
        if pw and item.get("post_url"):
            success = await linkedin.post_comment(pw, item["post_url"], item["comment"])
        if success:
            storage.increment_stat(user_id, "linkedin_comments")
    elif platform == "reddit":
        reddit_id = item.get("reddit_id", "")
        if reddit_id:
            success = reddit_bot.post_comment(user_id, reddit_id, item["comment"])
        if success:
            storage.increment_stat(user_id, "reddit_comments")
    
    storage.remove_from_queue(user_id, item["id"])
    
    status = "✅ Comment posted!" if success else "❌ Failed to post comment."
    try:
        await context.bot.send_message(chat_id=int(user_id), text=status)
    except Exception as e:
        logger.error(f"Error sending post status: {e}")


async def _regenerate_item(user_id: str, item: dict, query, context):
    """Regenerate the AI comment for a queue item."""
    try:
        new_comment = ai_comment.regenerate_comment(
            item.get("post_text", ""),
            item.get("comment", ""),
            item.get("platform", "linkedin"),
        )
        
        storage.update_queue_item(user_id, item["id"], {"comment": new_comment})
        item["comment"] = new_comment
        
        platform_badge = "📍 LINKEDIN" if item.get("platform") == "linkedin" else "📍 REDDIT"
        text = (
            f"🔄 *Regenerated comment:*\n\n"
            f"{platform_badge}\n"
            f"📝 {item.get('post_excerpt', '')[:200]}\n\n"
            f"💬 {new_comment}\n"
        )
        
        item_id = item.get("id", "")
        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("✅ Post", callback_data=f"approve_{item_id}"),
                InlineKeyboardButton("✏️ Edit", callback_data=f"edit_{item_id}"),
            ],
            [
                InlineKeyboardButton("❌ Skip", callback_data=f"skip_{item_id}"),
                InlineKeyboardButton("🔄 Regenerate", callback_data=f"regen_{item_id}"),
            ],
        ])
        
        await query.edit_message_text(text, parse_mode="Markdown", reply_markup=keyboard)
        
    except Exception as e:
        await query.edit_message_text(f"❌ Regeneration failed: {str(e)[:200]}")


# ── Text Message Handler (for edit mode) ─────────────

async def handle_text(update: Update, context: ContextTypes.DEFAULT_TYPE):
    user_id = str(update.effective_user.id)
    
    if user_id not in _edit_mode:
        return
    
    item_id = _edit_mode.pop(user_id)
    custom_comment = update.message.text.strip()
    
    item = storage.get_queue_item(user_id, item_id)
    if not item:
        await update.message.reply_text("❌ Item not found or already processed.")
        return
    
    storage.update_queue_item(user_id, item_id, {"comment": custom_comment})
    item["comment"] = custom_comment
    
    # Re-send with action buttons
    await _send_queue_card(update.effective_chat.id, item, context)
    await update.message.reply_text("✏️ Comment updated! Use the buttons above to post or skip.")


# ── Send Queue Item (called from scheduler) ──────────

async def send_queue_item_to_user(user_id: str, item: dict):
    """Send a queue item or error message to user via Telegram."""
    try:
        app = _bot_app
        if not app:
            logger.error("Bot application not initialized")
            return
        
        if item.get("type") == "error":
            await app.bot.send_message(chat_id=int(user_id), text=item["message"])
            return
        
        if item.get("type") == "digest_header":
            await app.bot.send_message(
                chat_id=int(user_id),
                text=item["message"],
                parse_mode="Markdown",
            )
            return
        
        if item.get("type") == "digest_item":
            # Daily digest item with copy-to-clipboard action
            idx = item.get("index", 0)
            text = (
                f"*{idx}. {item.get('title', '')}*\n"
                f"_{item.get('source', '')}_ | [Open Link]({item.get('url', '')})\n\n"
                f"💬 Suggested comment:\n`{item.get('comment', '')}`\n"
            )
            keyboard = InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("📋 Copy Comment", callback_data=f"digest_copy_{idx}"),
                    InlineKeyboardButton("🔗 Open Post", url=item.get("url", "https://linkedin.com")),
                ],
                [InlineKeyboardButton("🔄 Regenerate", callback_data=f"digest_regen_{idx}")],
            ])
            await app.bot.send_message(
                chat_id=int(user_id),
                text=text,
                parse_mode="Markdown",
                reply_markup=keyboard,
                disable_web_page_preview=True,
            )
            return
        
        platform_badge = "LINKEDIN" if item.get("platform") == "linkedin" else "REDDIT"
        text = (
            f"📍 {platform_badge}\n"
            f"📝 {item.get('post_excerpt', '')[:200]}\n\n"
            f"💬 {item.get('comment', '')}\n"
        )
        
        item_id = item.get("id", "")
        keyboard = InlineKeyboardMarkup([
            [
                InlineKeyboardButton("✅ Post", callback_data=f"approve_{item_id}"),
                InlineKeyboardButton("✏️ Edit", callback_data=f"edit_{item_id}"),
            ],
            [
                InlineKeyboardButton("❌ Skip", callback_data=f"skip_{item_id}"),
                InlineKeyboardButton("🔄 Regenerate", callback_data=f"regen_{item_id}"),
            ],
        ])
        
        await app.bot.send_message(chat_id=int(user_id), text=text, reply_markup=keyboard)
        
    except Exception as e:
        logger.error(f"Error sending queue item to user {user_id}: {e}")


# ── Bot Setup ─────────────────────────────────────────

_bot_app: Application | None = None


def create_bot() -> Application:
    """Create and configure the Telegram bot application."""
    global _bot_app
    
    app = Application.builder().token(TELEGRAM_BOT_TOKEN).build()
    
    # Commands
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("dashboard", cmd_dashboard))
    app.add_handler(CommandHandler("linkedin", cmd_linkedin))
    app.add_handler(CommandHandler("reddit", cmd_reddit))
    app.add_handler(CommandHandler("settings", cmd_settings))
    app.add_handler(CommandHandler("queue", cmd_queue))
    app.add_handler(CommandHandler("pause", cmd_pause))
    app.add_handler(CommandHandler("resume", cmd_resume))
    app.add_handler(CommandHandler("digest", cmd_digest))
    app.add_handler(CommandHandler("connections", cmd_connections))
    
    # Callback queries (button presses)
    app.add_handler(CallbackQueryHandler(handle_callback))
    
    # Text messages (for edit mode)
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handle_text))
    
    _bot_app = app
    
    # Set scheduler callback
    sched_module.set_send_callback(send_queue_item_to_user)
    
    return app
