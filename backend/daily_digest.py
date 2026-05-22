"""
Engagr — Daily Digest Module
Sends daily top-3 posts to user's Telegram with ready-to-use action buttons.
"""

import logging
import random
from datetime import datetime, timezone

import storage
import ai_comment
import news_grounding
import humanness_scorer

logger = logging.getLogger(__name__)

_send_callback = None


def set_send_callback(callback):
    """Set the Telegram bot send function."""
    global _send_callback
    _send_callback = callback


async def generate_daily_digest(user_id: str) -> list[dict]:
    """
    Generate top-3 posts for daily digest based on user's keywords and interests.
    Filters by humanness score and prioritizes by engagement potential.
    
    Returns list of digest items ready for Telegram delivery.
    """
    settings = storage.get_settings(user_id)
    language = settings.get("language", "en")
    
    li_cfg = settings.get("linkedin", {})
    rd_cfg = settings.get("reddit", {})
    
    keywords = (li_cfg.get("keywords", []) or []) + (rd_cfg.get("keywords", []) or [])
    tone = li_cfg.get("tone", "friendly")
    
    digest_items = []
    
    # Get trending news as post candidates
    try:
        news = news_grounding.get_trending_news(keywords[:5], limit=10)
        for item in news[:5]:
            digest_items.append({
                "source": item.get("source", ""),
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "score": item.get("score", 0),
                "platform": "linkedin",
                "text": item.get("title", ""),
            })
    except Exception as e:
        logger.error("Failed to fetch news for digest: %s", e)
    
    # Score and filter by humanness
    if digest_items:
        digest_items = humanness_scorer.filter_human_posts(digest_items, threshold=0.4)
    
    # Sort by engagement potential (score)
    digest_items.sort(key=lambda x: x.get("score", 0), reverse=True)
    
    # Take top 3
    top_items = digest_items[:3]
    
    # Generate AI comments for each
    result = []
    for item in top_items:
        try:
            comment_data = ai_comment.generate_comment_variants(
                item["text"], language, item.get("platform", "linkedin"), tone=tone, keywords=keywords[:3]
            )
            variants = comment_data.get("variants", ["Great insight!"])
            
            result.append({
                "title": item.get("title", ""),
                "url": item.get("url", ""),
                "source": item.get("source", ""),
                "platform": item.get("platform", "linkedin"),
                "comment_variants": variants,
                "selected_comment": variants[0] if variants else "",
            })
        except Exception as e:
            logger.error("Digest comment generation failed: %s", e)
    
    return result


async def send_daily_digest(user_id: str):
    """
    Generate and send the daily digest to user's Telegram.
    Called by scheduler at optimal time.
    """
    global _send_callback
    
    if not _send_callback:
        logger.warning("No send callback set for daily digest")
        return
    
    try:
        items = await generate_daily_digest(user_id)
        
        if not items:
            logger.info("No digest items for user %s", user_id)
            return
        
        settings = storage.get_settings(user_id)
        language = settings.get("language", "en")
        
        # Send header
        if language == "ru":
            header = "📰 *Ежедневный дайджест*\n\n3 лучших поста для комментирования сегодня:"
        elif language == "es":
            header = "📰 *Resumen diario*\n\n3 mejores publicaciones para comentar hoy:"
        elif language == "de":
            header = "📰 *Tägliche Zusammenfassung*\n\n3 beste Beiträge zum Kommentieren heute:"
        else:
            header = "📰 *Daily Digest*\n\nTop 3 posts to comment on today:"
        
        await _send_callback(user_id, {
            "type": "digest_header",
            "message": header,
        })
        
        # Send each item as actionable card
        for i, item in enumerate(items, 1):
            await _send_callback(user_id, {
                "type": "digest_item",
                "index": i,
                "title": item["title"],
                "url": item["url"],
                "source": item["source"],
                "platform": item["platform"],
                "comment": item["selected_comment"],
                "comment_variants": item["comment_variants"],
            })
        
        logger.info("Daily digest sent to user %s (%d items)", user_id, len(items))
        
    except Exception as e:
        logger.error("Failed to send daily digest to user %s: %s", user_id, e)


def get_digest_schedule_time(user_id: str) -> str:
    """
    Get optimal digest delivery time (usually 30 min before first session).
    """
    settings = storage.get_settings(user_id)
    li_times = settings.get("linkedin", {}).get("session_times", ["09:00"])
    
    if li_times:
        first_time = li_times[0]
        try:
            hour, minute = map(int, first_time.split(":"))
            # Send digest 30 min before first session
            total_min = hour * 60 + minute - 30
            if total_min < 0:
                total_min += 24 * 60
            return f"{(total_min // 60) % 24:02d}:{total_min % 60:02d}"
        except (ValueError, AttributeError):
            pass
    
    return "08:30"  # Default
