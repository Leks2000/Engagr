"""
Engagr — AI Comment Generation via Groq
Uses llama-3.3-70b-versatile to generate short, human-sounding comments.
"""

import logging
from groq import Groq

from config import GROQ_API_KEY, GROQ_MODEL, GROQ_SYSTEM_PROMPT

logger = logging.getLogger(__name__)

_client = None


def _get_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=GROQ_API_KEY)
    return _client


def generate_comment(post_text: str, platform: str = "linkedin") -> str:
    """
    Generate a short, genuine comment for a social media post.
    The AI automatically matches the language of the post.
    
    Args:
        post_text: The text content of the post (first ~500 chars)
        platform: 'linkedin' or 'reddit'
    
    Returns:
        Generated comment string
    """
    try:
        client = _get_client()

        user_prompt = (
            f"Platform: {platform.upper()}\n"
            f"Post content:\n{post_text[:500]}\n\n"
            f"Write your comment (3-20 words, match post language):"
        )

        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": GROQ_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.8,
            max_tokens=100,
            top_p=0.9,
        )

        comment = response.choices[0].message.content.strip()
        # Remove quotes if the model wraps the comment
        comment = comment.strip('"').strip("'").strip(""").strip(""")
        
        logger.info(f"Generated comment for {platform}: {comment}")
        return comment

    except Exception as e:
        logger.error(f"Groq API error: {e}")
        raise


def regenerate_comment(post_text: str, previous_comment: str, platform: str = "linkedin") -> str:
    """
    Regenerate a different comment, explicitly avoiding the previous one.
    """
    try:
        client = _get_client()

        user_prompt = (
            f"Platform: {platform.upper()}\n"
            f"Post content:\n{post_text[:500]}\n\n"
            f"Previous comment (write something DIFFERENT): {previous_comment}\n\n"
            f"Write a new comment (3-20 words, match post language):"
        )

        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": GROQ_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.9,
            max_tokens=100,
            top_p=0.95,
        )

        comment = response.choices[0].message.content.strip()
        comment = comment.strip('"').strip("'").strip(""").strip(""")
        
        logger.info(f"Regenerated comment for {platform}: {comment}")
        return comment

    except Exception as e:
        logger.error(f"Groq API regeneration error: {e}")
        raise
