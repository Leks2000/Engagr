"""
Engagr — AI Comment Generation via Groq
Uses llama-3.3-70b-versatile to generate short, human-sounding comments.
Generates 3 variants per post with automatic language detection.
"""

import logging
from groq import Groq

from config import GROQ_API_KEY, GROQ_MODEL

logger = logging.getLogger(__name__)

_client = None

SYSTEM_PROMPT = (
    "You are a developer and indie hacker. Write a genuine comment. "
    "Rules: 3-20 words, match post language exactly, sound human, "
    "no hashtags, no emojis, no self-promotion, add real value."
)


def _get_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=GROQ_API_KEY)
    return _client


def _clean_comment(text: str) -> str:
    """Remove surrounding quotes from generated comment."""
    text = text.strip()
    for q in ['"', "'", "\u201c", "\u201d", "\u2018", "\u2019"]:
        text = text.strip(q)
    return text.strip()


def generate_comment(post_text: str, platform: str = "linkedin") -> str:
    """
    Generate a single short, genuine comment for a social media post.
    The AI automatically matches the language of the post.
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
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.8,
            max_tokens=100,
            top_p=0.9,
        )

        comment = _clean_comment(response.choices[0].message.content)
        logger.info(f"Generated comment for {platform}: {comment}")
        return comment

    except Exception as e:
        logger.error(f"Groq API error: {e}")
        raise


def generate_comment_variants(
    post_text: str, user_language: str = "en", platform: str = "linkedin"
) -> dict:
    """
    Generate 3 comment variants for a post with language detection.
    
    Returns:
        {
            "variants": [str, str, str],
            "post_language": str,
            "translations": [str, str, str] or None
        }
    """
    try:
        client = _get_client()

        # Step 1: Detect language and generate 3 variants
        user_prompt = (
            f"Platform: {platform.upper()}\n"
            f"Post content:\n{post_text[:500]}\n\n"
            f"Tasks:\n"
            f"1. Detect the language of this post (output language code like 'en', 'ru', 'es', etc.)\n"
            f"2. Write exactly 3 different comment variants in the POST'S language (3-20 words each)\n\n"
            f"Format your response EXACTLY like this:\n"
            f"LANGUAGE: <code>\n"
            f"1. <comment variant 1>\n"
            f"2. <comment variant 2>\n"
            f"3. <comment variant 3>"
        )

        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.85,
            max_tokens=300,
            top_p=0.9,
        )

        raw = response.choices[0].message.content.strip()
        logger.info(f"Raw variants response: {raw}")

        # Parse response
        lines = raw.split("\n")
        post_language = "en"
        variants = []

        for line in lines:
            line = line.strip()
            if line.upper().startswith("LANGUAGE:"):
                post_language = line.split(":", 1)[1].strip().lower()[:5]
            elif line and (line[0].isdigit() and "." in line[:3]):
                # Extract comment after "1. " or "2. " etc.
                comment = line.split(".", 1)[1].strip() if "." in line else line
                comment = _clean_comment(comment)
                if comment:
                    variants.append(comment)

        # Ensure we have at least 1 variant
        if not variants:
            # Fallback: use the whole response as one comment
            fallback = _clean_comment(raw)
            variants = [fallback]

        # Pad to 3 if needed
        while len(variants) < 3:
            try:
                extra = generate_comment(post_text, platform)
                variants.append(extra)
            except Exception:
                variants.append(variants[0] if variants else "Great insight!")

        variants = variants[:3]

        # Step 2: Generate translations if post language differs from user language
        translations = None
        if post_language != user_language and user_language:
            try:
                translate_prompt = (
                    f"Translate these 3 comments to {user_language}. "
                    f"Keep them short (3-20 words). Output only the translations:\n"
                    f"1. {variants[0]}\n"
                    f"2. {variants[1]}\n"
                    f"3. {variants[2]}"
                )
                tr_response = client.chat.completions.create(
                    model=GROQ_MODEL,
                    messages=[
                        {"role": "system", "content": "You are a translator. Translate concisely."},
                        {"role": "user", "content": translate_prompt},
                    ],
                    temperature=0.3,
                    max_tokens=200,
                )
                tr_raw = tr_response.choices[0].message.content.strip()
                translations = []
                for line in tr_raw.split("\n"):
                    line = line.strip()
                    if line and (line[0].isdigit() and "." in line[:3]):
                        tr = line.split(".", 1)[1].strip()
                        translations.append(_clean_comment(tr))
                    elif line:
                        translations.append(_clean_comment(line))
                translations = translations[:3] if translations else None
            except Exception as e:
                logger.warning(f"Translation failed: {e}")

        return {
            "variants": variants,
            "post_language": post_language,
            "translations": translations,
        }

    except Exception as e:
        logger.error(f"Groq API generate_comment_variants error: {e}")
        # Fallback: try single comment generation
        try:
            single = generate_comment(post_text, platform)
            return {"variants": [single, single, single], "post_language": "en", "translations": None}
        except Exception:
            return {"variants": ["Great insight!", "Thanks for sharing this.", "Really valuable perspective."], "post_language": "en", "translations": None}


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
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.9,
            max_tokens=100,
            top_p=0.95,
        )

        comment = _clean_comment(response.choices[0].message.content)
        logger.info(f"Regenerated comment for {platform}: {comment}")
        return comment

    except Exception as e:
        logger.error(f"Groq API regeneration error: {e}")
        raise
