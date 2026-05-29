"""Tests for daily digest generation."""

import sys
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import daily_digest  # noqa: E402
import ai_comment  # noqa: E402


def test_generate_comment_variants_accepts_digest_call():
    """Regression: digest must not pass unsupported kwargs to Groq helper."""
    with patch.object(ai_comment, "generate_comment_variants") as mock_gen:
        mock_gen.return_value = {
            "variants": ["Nice post!", "Thanks for sharing.", "Great point."],
            "post_language": "en",
        }
        with patch("news_grounding.get_trending_news", return_value=[
            {"title": "AI startup tools", "url": "https://example.com", "score": 10, "source": "HN"},
        ]):
            with patch("reddit_public.scrape_posts", return_value=[]):
                import asyncio
                items = asyncio.run(daily_digest.generate_daily_digest("test_user"))
        mock_gen.assert_called()
        call_kwargs = mock_gen.call_args.kwargs
        assert "keywords" not in call_kwargs
        assert len(items) >= 1
