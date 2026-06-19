"""
Engagr — AI Comment Generation via Groq
Uses llama-3.3-70b-versatile to generate short, human-sounding comments.
Generates 3 variants per post with automatic language detection.
Integrates with News Grounding for industry-relevant references.
"""

import logging
from groq import Groq

from config import GROQ_API_KEY, GROQ_MODEL
import user_memory

logger = logging.getLogger(__name__)

_client = None

SYSTEM_PROMPT = (
    "You are a developer and indie hacker. Write a genuine comment. "
    "Rules: 3-20 words, match post language exactly, sound human, "
    "no hashtags, no emojis, no self-promotion, add real value. "
    "If relevant trending news is provided, you may subtly reference it "
    "to make your comment feel more current and informed. "
    "If author profile context is provided, use it to write comments "
    "that align with their expertise and goals — but never mention "
    "their project name or explicitly promote it."
)

TONE_GUIDE = {
    "intellectual": "Analytical and thoughtful tone with nuanced insight.",
    "friendly": "Warm, supportive, and conversational tone.",
    "provocative": "Bold and attention-grabbing, but still respectful and non-toxic.",
    "concise": "Very short and direct wording.",
    "expert": "Confident specialist tone with practical authority.",
}


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


def _parse_numbered_lines(raw: str) -> list[str]:
    """Parse '1. ...\\n2. ...' formatted text into a list of cleaned strings."""
    out = []
    for line in raw.split("\n"):
        line = line.strip()
        if line and line[0].isdigit() and "." in line[:3]:
            out.append(_clean_comment(line.split(".", 1)[1].strip()))
        elif line:
            out.append(_clean_comment(line))
    return out


def translate_variants(variants: list[str], target_language: str) -> list[str] | None:
    """Translate a list of comment variants to target_language in one batch call.

    Returns a list aligned with `variants` (same length) or None on failure.
    Used for on-demand re-translation when the user switches their UI language.
    """
    if not variants or not target_language:
        return None
    try:
        client = _get_client()
        numbered = "\n".join(f"{i + 1}. {v}" for i, v in enumerate(variants))
        prompt = (
            f"Translate these {len(variants)} short comments to {target_language}. "
            f"Keep them short (3-20 words). Output only the translations, numbered:\n{numbered}"
        )
        resp = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You are a translator. Translate concisely. Output only numbered translations."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.3,
            max_tokens=300,
        )
        raw = resp.choices[0].message.content.strip()
        out = _parse_numbered_lines(raw)
        # Align length with input (pad/trim)
        if not out:
            return None
        while len(out) < len(variants):
            out.append(out[-1])
        return out[:len(variants)]
    except Exception as e:
        logger.warning(f"translate_variants failed ({target_language}): {e}")
        return None


def translate_text(text: str, target_language: str) -> str | None:
    """Translate arbitrary text to target_language (used for the post body).

    Returns the translated string, or None on failure. Keeps the meaning and
    natural tone of the original. Used so a user viewing the Mini App in RU can
    read an EN post in Russian — while the *comment* itself is still posted in
    the post's original language.
    """
    if not text or not target_language:
        return None
    try:
        client = _get_client()
        prompt = (
            f"Translate the following social media post to {target_language}. "
            f"Keep it natural and faithful to the original. "
            f"Output ONLY the translation, nothing else:\n\n{text[:1500]}"
        )
        resp = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You are a translator. Translate faithfully and concisely. Output only the translation."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.2,
            max_tokens=600,
        )
        tr = _clean_comment(resp.choices[0].message.content)
        return tr or None
    except Exception as e:
        logger.warning(f"translate_text failed ({target_language}): {e}")
        return None


def generate_comment(post_text: str, platform: str = "linkedin", tone: str = "friendly", user_id: str = "") -> str:
    """
    Generate a single short, genuine comment for a social media post.
    The AI automatically matches the language of the post.
    Integrates news grounding and user memory for more relevant comments.
    """
    try:
        client = _get_client()

        tone_hint = TONE_GUIDE.get((tone or "").lower(), TONE_GUIDE["friendly"])

        # Build user memory context if available
        memory_context = ""
        if user_id:
            memory_context = user_memory.build_ai_context(user_id)

        user_prompt = (
            f"Platform: {platform.upper()}\n"
            f"Requested tone: {(tone or 'friendly').lower()} ({tone_hint})\n"
            + (f"{memory_context}\n\n" if memory_context else "")
            + f"Post content:\n{post_text[:500]}\n\n"
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
    post_text: str, user_language: str = "en", platform: str = "linkedin", tone: str = "friendly", user_id: str = ""
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
        tone_hint = TONE_GUIDE.get((tone or "").lower(), TONE_GUIDE["friendly"])

        # Build user memory context if available
        memory_context = ""
        if user_id:
            memory_context = user_memory.build_ai_context(user_id)

        user_prompt = (
            f"Platform: {platform.upper()}\n"
            f"Requested tone: {(tone or 'friendly').lower()} ({tone_hint})\n"
            + (f"{memory_context}\n\n" if memory_context else "")
            + f"Post content:\n{post_text[:500]}\n\n"
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
                extra = generate_comment(post_text, platform, tone=tone)
                variants.append(extra)
            except Exception:
                variants.append(variants[0] if variants else "Great insight!")

        variants = variants[:3]

        # Step 2: Generate translations if post language differs from user language
        translations = None
        post_text_translated = None
        if post_language != user_language and user_language:
            # Translate the comment variants (so the user reads them in their UI language)
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
                translations = _parse_numbered_lines(tr_raw)[:3] or None
            except Exception as e:
                logger.warning(f"Translation failed: {e}")

            # Translate the POST BODY too (so the user reads the post in their UI
            # language). The original-language comment is still what gets posted.
            post_text_translated = translate_text(post_text, user_language)

        return {
            "variants": variants,
            "post_language": post_language,
            "translations": translations,
            "post_text_translated": post_text_translated,
        }

    except Exception as e:
        logger.error(f"Groq API generate_comment_variants error: {e}")
        # Fallback: try single comment generation
        try:
            single = generate_comment(post_text, platform, tone=tone)
            return {"variants": [single, single, single], "post_language": "en", "translations": None, "post_text_translated": None}
        except Exception:
            return {"variants": ["Great insight!", "Thanks for sharing this.", "Really valuable perspective."], "post_language": "en", "translations": None, "post_text_translated": None}


def regenerate_comment(post_text: str, previous_comment: str, platform: str = "linkedin", tone: str = "friendly", user_id: str = "") -> str:
    """
    Regenerate a different comment, explicitly avoiding the previous one.
    """
    try:
        client = _get_client()

        tone_hint = TONE_GUIDE.get((tone or "").lower(), TONE_GUIDE["friendly"])

        # Build user memory context if available
        memory_context = ""
        if user_id:
            memory_context = user_memory.build_ai_context(user_id)

        prev_instruction = (
            f"Previous comment (write something DIFFERENT): {previous_comment}\n\n"
            if previous_comment and previous_comment.strip()
            else ""
        )
        user_prompt = (
            f"Platform: {platform.upper()}\n"
            f"Requested tone: {(tone or 'friendly').lower()} ({tone_hint})\n"
            + (f"{memory_context}\n\n" if memory_context else "")
            + f"Post content:\n{post_text[:500]}\n\n"
            + prev_instruction
            + f"Write a new comment (3-20 words, match post language):"
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
