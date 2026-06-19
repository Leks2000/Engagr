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
import daily_digest
import queue_executor
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
        "1. Open Mini App → Settings → LinkedIn\n"
        "2. Paste your `li_at` cookie (DevTools → Application → Cookies)\n"
        "3. Add keywords and session times\n"
        "4. Approve comments/likes in this chat when the bot sends them\n\n"
        "OAuth alone finds only your own posts — use `li_at` for feed discovery.",
        parse_mode="Markdown",
    )


async def cmd_reddit(update: Update, context: ContextTypes.DEFAULT_TYPE):
    await update.message.reply_text(
        "🤖 *Reddit Setup*\n\n"
        "Discovery works *without* a Reddit app:\n"
        "1. Mini App → Reddit → add subreddits & keywords\n"
        "2. Enable discovery — bot parses public feeds\n"
        "3. Approve comments in this chat\n\n"
        "Optional: Reddit username/password in settings for auto-posting.",
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
    await update.message.reply_text("📰 Generating digest…")
    try:
        await dd.send_daily_digest(user_id)
    except Exception as e:
        logger.error("cmd_digest failed user=%s: %s", user_id, e)
        await update.message.reply_text(f"❌ Digest error: {str(e)[:200]}")


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

def _queue_card_text(item: dict) -> str:
    platform = item.get("platform", "linkedin")
    platform_badge = "📍 LINKEDIN" if platform == "linkedin" else "📍 REDDIT"
    action = item.get("action", "comment")

    if action == "like":
        return f"{platform_badge} — 👍 *Like this post?*\n\n📝 {item.get('post_excerpt', '')[:200]}"
    if action == "upvote":
        sub = item.get("subreddit", "")
        return f"{platform_badge} — ⬆️ *Upvote r/{sub}?*\n\n📝 {item.get('post_excerpt', '')[:200]}"
    if action == "connect":
        return f"{platform_badge} — 🤝 *Send connection request?*"

    return (
        f"{platform_badge}\n"
        f"📝 {item.get('post_excerpt', '')[:200]}\n\n"
        f"💬 {item.get('comment', '')}\n"
    )


def _queue_card_keyboard(item: dict) -> InlineKeyboardMarkup:
    item_id = item.get("id", "")
    action = item.get("action", "comment")
    post_url = item.get("post_url", "")

    if action in ("like", "upvote", "connect"):
        row1 = [InlineKeyboardButton("✅ Approve", callback_data=f"approve_{item_id}")]
        row2 = [InlineKeyboardButton("❌ Skip", callback_data=f"skip_{item_id}")]
        if post_url:
            row1.append(InlineKeyboardButton("🔗 Open", url=post_url))
        return InlineKeyboardMarkup([row1, row2])

    return InlineKeyboardMarkup([
        [
            InlineKeyboardButton("✅ Post", callback_data=f"approve_{item_id}"),
            InlineKeyboardButton("✏️ Edit", callback_data=f"edit_{item_id}"),
        ],
        [
            InlineKeyboardButton("❌ Skip", callback_data=f"skip_{item_id}"),
            InlineKeyboardButton("🔄 Regenerate", callback_data=f"regen_{item_id}"),
        ],
    ])


async def _send_queue_card(chat_id, item: dict, context: ContextTypes.DEFAULT_TYPE):
    """Send a queue item as a formatted card with action buttons."""
    await context.bot.send_message(
        chat_id=chat_id,
        text=_queue_card_text(item),
        reply_markup=_queue_card_keyboard(item),
        parse_mode="Markdown",
    )


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

    if data.startswith("digest_copy_"):
        try:
            idx = int(data.rsplit("_", 1)[-1]) - 1
            items = daily_digest.get_last_digest(user_id)
            if 0 <= idx < len(items):
                await query.answer("Comment copied below")
                await context.bot.send_message(
                    chat_id=int(user_id),
                    text=f"📋 `{items[idx].get('selected_comment', '')}`",
                    parse_mode="Markdown",
                )
            else:
                await query.answer("Run /digest to refresh")
        except Exception:
            await query.answer("Could not copy")
        return

    if data.startswith("digest_regen_"):
        try:
            idx = int(data.rsplit("_", 1)[-1]) - 1
            items = daily_digest.get_last_digest(user_id)
            if 0 <= idx < len(items):
                item = items[idx]
                settings = storage.get_settings(user_id)
                lang = settings.get("language", "en")
                tone = settings.get("linkedin", {}).get("tone", "friendly")
                new = ai_comment.regenerate_comment(
                    item.get("title", ""),
                    item.get("selected_comment", ""),
                    item.get("platform", "linkedin"),
                )
                item["selected_comment"] = new
                daily_digest.set_last_digest_item(user_id, idx, item)
                import html as html_module
                await query.edit_message_text(
                    f"🔄 Regenerated:\n\n<code>{html_module.escape(new)}</code>",
                    parse_mode="HTML",
                )
            else:
                await query.answer("Run /digest to refresh")
        except Exception as e:
            await query.answer(f"Failed: {str(e)[:80]}")
        return

    # ── Sprint 1: New post card callbacks ─────────────────

    if data.startswith("gen_comment_"):
        item_id = data[len("gen_comment_"):]
        await _handle_gen_comment(user_id, item_id, query, context)
        return

    if data.startswith("skip_post_"):
        item_id = data[len("skip_post_"):]
        item = storage.get_queue_item(user_id, item_id)
        if item:
            storage.remove_from_queue(user_id, item_id)
        await query.edit_message_text("❌ Пост пропущен.")
        return

    if data.startswith("post_comment_"):
        item_id = data[len("post_comment_"):]
        await _handle_post_comment(user_id, item_id, query, context)
        return

    if data.startswith("regen_post_"):
        item_id = data[len("regen_post_"):]
        await _handle_regen_post_comment(user_id, item_id, query, context)
        return

    # ── End Sprint 1 callbacks ────────────────────────────

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
        if item.get("action", "comment") != "comment":
            await query.edit_message_text("Regenerate is only available for comments.")
            return
        await _regenerate_item(user_id, item, query, context)


async def _approve_item(user_id: str, item: dict, query, context):
    """Approve and schedule posting after a random delay."""
    action = item.get("action", "comment")
    delay_key = "like" if action in ("like", "upvote") else "comment"
    delay = random.uniform(*DELAYS[delay_key])

    preview = item.get("comment", "") if action == "comment" else f"Action: {action}"
    await query.edit_message_text(
        f"✅ Approved! Will run in ~{max(1, int(delay / 60))} min.\n\n{preview[:300]}"
    )

    await asyncio.sleep(delay)

    success, status = await queue_executor.execute_queue_item(user_id, item)
    storage.remove_from_queue(user_id, item["id"])

    try:
        await context.bot.send_message(
            chat_id=int(user_id),
            text=f"{'✅' if success else '⚠️'} {status}",
        )
    except Exception as e:
        logger.error("Error sending post status: %s", e)


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
        text = f"🔄 *Regenerated comment:*\n\n{_queue_card_text(item)}"
        await query.edit_message_text(
            text, parse_mode="Markdown", reply_markup=_queue_card_keyboard(item)
        )
        
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
            import html as html_module
            idx = item.get("index", 0)
            title = html_module.escape(item.get("title", "")[:200])
            source = html_module.escape(item.get("source", ""))
            comment = html_module.escape(item.get("comment", ""))
            url = item.get("url", "https://linkedin.com")
            text = (
                f"<b>{idx}. {title}</b>\n"
                f"<i>{source}</i> · <a href=\"{url}\">Open</a>\n\n"
                f"💬 Suggested comment:\n<code>{comment}</code>"
            )
            keyboard = InlineKeyboardMarkup([
                [
                    InlineKeyboardButton("📋 Copy Comment", callback_data=f"digest_copy_{idx}"),
                    InlineKeyboardButton("🔗 Open Post", url=url),
                ],
                [InlineKeyboardButton("🔄 Regenerate", callback_data=f"digest_regen_{idx}")],
            ])
            await app.bot.send_message(
                chat_id=int(user_id),
                text=text,
                parse_mode="HTML",
                reply_markup=keyboard,
                disable_web_page_preview=True,
            )
            return
        
        await app.bot.send_message(
            chat_id=int(user_id),
            text=_queue_card_text(item),
            reply_markup=_queue_card_keyboard(item),
            parse_mode="Markdown",
        )
        
    except Exception as e:
        logger.error(f"Error sending queue item to user {user_id}: {e}")


# ── Sprint 1: Handler functions for new post callbacks ──

async def _handle_gen_comment(user_id: str, item_id: str, query, context):
    """Generate AI comment variants for a newly scanned post and show them."""
    item = storage.get_queue_item(user_id, item_id)
    if not item:
        await query.edit_message_text("❌ Пост не найден (уже обработан?).")
        return

    await query.edit_message_text(
        f"⏳ Генерирую комментарий...\n\n"
        f"📝 {item.get('post_excerpt', '')[:200]}",
        parse_mode=None,
    )

    try:
        settings = storage.get_settings(user_id)
        user_language = settings.get("language", "en")
        tone = (settings.get("linkedin") or {}).get("tone", "friendly")
        platform = item.get("platform", "linkedin")

        comment_data = ai_comment.generate_comment_variants(
            item.get("post_text") or item.get("post_excerpt") or "",
            user_language=user_language,
            platform=platform,
            tone=tone,
            user_id=user_id,
        )
        variants = comment_data.get("variants") or []
        selected = variants[0] if variants else ""

        if not selected:
            await query.edit_message_text("❌ Не удалось сгенерировать комментарий. Попробуйте позже.")
            return

        # Save variants to queue item
        storage.update_queue_item(user_id, item_id, {
            "comment": selected,
            "selected_comment": selected,
            "comment_variants": variants,
            "status": "pending",
        })
        item["comment"] = selected
        item["selected_comment"] = selected
        item["comment_variants"] = variants

        # Build message with variants
        import html as html_mod
        platform_badge = "💼 LinkedIn" if platform == "linkedin" else "🐦 X/Twitter"
        author = item.get("author") or "Unknown"
        excerpt = (item.get("post_excerpt") or item.get("post_text") or "")[:200]
        post_url = item.get("post_url") or ""

        text_parts = [
            f"<b>{platform_badge} — {html_mod.escape(author)}</b>",
            f"<i>{html_mod.escape(excerpt)}</i>",
            "",
            "💬 <b>Варианты комментария:</b>",
        ]
        for i, v in enumerate(variants[:3], 1):
            text_parts.append(f"\n<b>{i}.</b> <code>{html_mod.escape(v[:300])}</code>")

        buttons = []
        for i, v in enumerate(variants[:3], 1):
            buttons.append([
                InlineKeyboardButton(
                    f"✅ Отправить вариант {i}",
                    callback_data=f"post_comment_{item_id}",
                )
            ])

        # Store which variant is selected by default (first)
        buttons.append([
            InlineKeyboardButton("🔄 Перегенерировать", callback_data=f"regen_post_{item_id}"),
            InlineKeyboardButton("❌ Пропустить", callback_data=f"skip_post_{item_id}"),
        ])
        if post_url:
            buttons.append([InlineKeyboardButton("🔗 Открыть пост", url=post_url)])

        await query.edit_message_text(
            "\n".join(text_parts),
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(buttons),
            disable_web_page_preview=True,
        )

    except Exception as e:
        logger.error("_handle_gen_comment user=%s item=%s err=%s", user_id, item_id, e)
        await query.edit_message_text(f"❌ Ошибка генерации: {str(e)[:200]}")


async def _handle_post_comment(user_id: str, item_id: str, query, context):
    """Mark the generated comment as approved for posting by the extension."""
    item = storage.get_queue_item(user_id, item_id)
    if not item:
        await query.edit_message_text("❌ Пост не найден.")
        return

    comment = item.get("selected_comment") or item.get("comment") or ""
    post_url = item.get("post_url") or ""

    # Mark as approved — extension will pick it up and post
    storage.update_queue_item(user_id, item_id, {
        "status": "approved",
        "execution": "extension",
        "approved_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    })

    import html as html_mod
    platform = item.get("platform", "linkedin")
    platform_badge = "💼 LinkedIn" if platform == "linkedin" else "🐦 X/Twitter"

    confirm_text = (
        f"✅ <b>Комментарий одобрен!</b>\n\n"
        f"{platform_badge} — {html_mod.escape(item.get('author') or '')}\n\n"
        f"💬 <code>{html_mod.escape(comment[:400])}</code>\n\n"
        f"🔔 Расширение опубликует его автоматически."
    )
    if post_url:
        confirm_text += f"\n🔗 <a href=\"{post_url}\">Открыть пост</a>"

    await query.edit_message_text(confirm_text, parse_mode="HTML", disable_web_page_preview=True)


async def _handle_regen_post_comment(user_id: str, item_id: str, query, context):
    """Regenerate the AI comment for a post card."""
    item = storage.get_queue_item(user_id, item_id)
    if not item:
        await query.edit_message_text("❌ Пост не найден.")
        return

    await query.edit_message_text("🔄 Перегенерирую комментарий...")

    try:
        settings = storage.get_settings(user_id)
        user_language = settings.get("language", "en")
        tone = (settings.get("linkedin") or {}).get("tone", "friendly")
        platform = item.get("platform", "linkedin")

        new_comment = ai_comment.regenerate_comment(
            item.get("post_text") or item.get("post_excerpt") or "",
            item.get("comment") or "",
            platform=platform,
            tone=tone,
            user_id=user_id,
        )

        storage.update_queue_item(user_id, item_id, {
            "comment": new_comment,
            "selected_comment": new_comment,
            "comment_variants": [new_comment],
        })

        import html as html_mod
        post_url = item.get("post_url") or ""
        platform_badge = "💼 LinkedIn" if platform == "linkedin" else "🐦 X/Twitter"
        author = item.get("author") or "Unknown"
        excerpt = (item.get("post_excerpt") or item.get("post_text") or "")[:200]

        text = (
            f"<b>{platform_badge} — {html_mod.escape(author)}</b>\n"
            f"<i>{html_mod.escape(excerpt)}</i>\n\n"
            f"🔄 <b>Новый вариант:</b>\n"
            f"<code>{html_mod.escape(new_comment[:400])}</code>"
        )

        buttons = [
            [InlineKeyboardButton("✅ Отправить", callback_data=f"post_comment_{item_id}")],
            [
                InlineKeyboardButton("🔄 Ещё раз", callback_data=f"regen_post_{item_id}"),
                InlineKeyboardButton("❌ Пропустить", callback_data=f"skip_post_{item_id}"),
            ],
        ]
        if post_url:
            buttons.append([InlineKeyboardButton("🔗 Открыть пост", url=post_url)])

        await query.edit_message_text(
            text,
            parse_mode="HTML",
            reply_markup=InlineKeyboardMarkup(buttons),
            disable_web_page_preview=True,
        )

    except Exception as e:
        logger.error("_handle_regen_post_comment user=%s item=%s err=%s", user_id, item_id, e)
        await query.edit_message_text(f"❌ Ошибка: {str(e)[:200]}")


# ── Sprint 1: New Post Cards from Auto-Scan ──────────

def _new_post_card_text(item: dict) -> str:
    """Format a newly scanned post as a Telegram message card."""
    platform = item.get("platform", "linkedin")
    if platform == "x":
        badge = "🐦 X / TWITTER"
    elif platform == "linkedin":
        badge = "💼 LINKEDIN"
    else:
        badge = platform.upper()

    author = item.get("author") or item.get("author_name") or "Unknown"
    excerpt = (item.get("post_text") or item.get("post_excerpt") or "")[:300]
    post_url = item.get("post_url") or ""

    text = (
        f"📡 *Новый пост — {badge}*\n\n"
        f"👤 *{author}*\n\n"
        f"📝 {excerpt}\n"
    )
    if post_url:
        text += f"\n🔗 [Открыть пост]({post_url})"
    return text


def _new_post_card_keyboard(item: dict) -> InlineKeyboardMarkup:
    """Inline keyboard for a newly scanned post card."""
    item_id = item.get("id", "")
    post_url = item.get("post_url") or ""

    buttons = [
        [InlineKeyboardButton("💬 Сгенерировать комментарий", callback_data=f"gen_comment_{item_id}")],
        [InlineKeyboardButton("❌ Пропустить", callback_data=f"skip_post_{item_id}")],
    ]
    if post_url:
        buttons[0].append(InlineKeyboardButton("🔗 Открыть", url=post_url))

    return InlineKeyboardMarkup(buttons)


async def _send_new_post_card_with_media(app, user_id: str, item: dict) -> bool:
    """
    Send a post card with its first image/video attachment inline in Telegram.
    Uses sendPhoto for images, sendVideo for videos. Falls back to False if
    no usable media URL is present so the caller can send a plain text card.
    Returns True on a successful media send.
    """
    media = item.get("media") or []
    if not isinstance(media, list) or not media:
        return False
    caption = _new_post_card_text(item)
    # Telegram caption limits: 1024 chars for photos / videos.
    if len(caption) > 1024:
        caption = caption[:1020] + "…"
    keyboard = _new_post_card_keyboard(item)
    chat_id = int(user_id)

    for attachment in media:
        if not isinstance(attachment, dict):
            continue
        url = (attachment.get("url") or "").strip()
        thumb = (attachment.get("thumbnail") or "").strip()
        kind = (attachment.get("type") or "image").lower()

        # Videos: need a real video URL. Some parsers only capture a poster
        # thumbnail (e.g. Reddit/LinkedIn previews) — in that case send the
        # thumbnail as a photo so the user still sees the frame inline.
        if kind == "video" and url and url.startswith("http"):
            try:
                await app.bot.send_video(
                    chat_id=chat_id,
                    video=url,
                    caption=caption,
                    parse_mode="Markdown",
                    reply_markup=keyboard,
                )
                return True
            except Exception as e:
                logger.warning("send_video failed (will try thumbnail): %s", e)
                if thumb and thumb.startswith("http"):
                    try:
                        await app.bot.send_photo(
                            chat_id=chat_id,
                            photo=thumb,
                            caption=caption,
                            parse_mode="Markdown",
                            reply_markup=keyboard,
                        )
                        return True
                    except Exception as e2:
                        logger.warning("send_photo(thumbnail) failed: %s", e2)
                continue

        # Images (or video-with-only-thumbnail): send the image inline.
        img_url = url if (kind == "image" and url and url.startswith("http")) else thumb
        if img_url and img_url.startswith("http"):
            try:
                await app.bot.send_photo(
                    chat_id=chat_id,
                    photo=img_url,
                    caption=caption,
                    parse_mode="Markdown",
                    reply_markup=keyboard,
                )
                return True
            except Exception as e:
                logger.warning("send_photo failed: %s", e)
                continue
    return False


async def send_new_post_cards(user_id: str, items: list):
    """
    Send newly auto-scanned post cards to the user in Telegram.
    Each card has [Сгенерировать комментарий] and [Пропустить] buttons.
    If a post has media attachments, the card is sent via sendPhoto /
    sendVideo so the user sees the image/video inline in Telegram.
    Called from main.py after extension pushes new posts.
    """
    app = _bot_app
    if not app:
        logger.error("send_new_post_cards: bot not initialized")
        return

    sent = 0
    for item in items[:5]:  # max 5 per scan to avoid spam
        try:
            if not await _send_new_post_card_with_media(app, user_id, item):
                # No usable media → fall back to a plain text card
                await app.bot.send_message(
                    chat_id=int(user_id),
                    text=_new_post_card_text(item),
                    reply_markup=_new_post_card_keyboard(item),
                    parse_mode="Markdown",
                    disable_web_page_preview=True,
                )
            sent += 1
            # Small delay to avoid Telegram rate limits
            await asyncio.sleep(0.5)
        except Exception as e:
            logger.error("send_new_post_cards item=%s user=%s err=%s", item.get("id"), user_id, e)

    if sent > 0:
        try:
            from config import MINI_APP_URL
            if MINI_APP_URL:
                queue_url = f"{MINI_APP_URL.rstrip('/')}" if '?' not in MINI_APP_URL else f"{MINI_APP_URL.rstrip('/')}&screen=queue"
                if '?' not in queue_url:
                    queue_url = f"{MINI_APP_URL.rstrip('/')}/?screen=queue"
                keyboard = InlineKeyboardMarkup([
                    [InlineKeyboardButton("📋 Open Queue", web_app=WebAppInfo(url=queue_url))]
                ])
                await app.bot.send_message(
                    chat_id=int(user_id),
                    text=f"📡 *Авто-скан завершён* — найдено {len(items)} новых постов, показано {sent}.\n\nОткройте очередь чтобы проверить и одобрить комментарии.",
                    parse_mode="Markdown",
                    reply_markup=keyboard,
                )
            else:
                await app.bot.send_message(
                    chat_id=int(user_id),
                    text=f"📡 *Авто-скан завершён* — найдено {len(items)} новых постов, показано {sent}.",
                    parse_mode="Markdown",
                )
        except Exception:
            pass


async def send_execution_status(user_id: str, item: dict, status: str, error_msg: str = ""):
    """
    Notify user about comment execution result (published/failed).
    Called from extension after it posts a comment.
    """
    import html as html_mod

    app = _bot_app
    if not app:
        return

    platform = item.get("platform", "linkedin")
    platform_badge = "💼 LinkedIn" if platform == "linkedin" else "🐦 X/Twitter" if platform == "x" else "📍 Reddit"
    author = item.get("author") or item.get("author_name") or ""
    post_url = item.get("post_url") or ""

    if status == "published":
        text = (
            f"✅ *Комментарий опубликован!*\n\n"
            f"{platform_badge} — {html_mod.escape(author)}\n"
            f"💬 _{html_mod.escape((item.get('selected_comment') or item.get('comment') or '')[:200])}_"
        )
    else:
        text = (
            f"❌ *Ошибка публикации*\n\n"
            f"{platform_badge} — {html_mod.escape(author)}\n"
            f"{html_mod.escape(error_msg[:200]) if error_msg else 'Неизвестная ошибка'}"
        )

    buttons = []
    if post_url:
        buttons.append([InlineKeyboardButton("🔗 Открыть пост", url=post_url)])

    await app.bot.send_message(
        chat_id=int(user_id),
        text=text,
        parse_mode="Markdown",
        reply_markup=InlineKeyboardMarkup(buttons) if buttons else None,
        disable_web_page_preview=True,
    )


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
    
    sched_module.set_send_callback(send_queue_item_to_user)
    daily_digest.set_send_callback(send_queue_item_to_user)

    return app
