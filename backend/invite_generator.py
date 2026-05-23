"""
Engagr — Invite Generator Module
Generates personalized LinkedIn connection request messages (max 300 chars).
Copy-to-clipboard friendly for semi-automated workflow.
"""

import logging
from groq import Groq

from config import GROQ_API_KEY, GROQ_MODEL

logger = logging.getLogger(__name__)

_client = None

INVITE_SYSTEM_PROMPT = (
    "You are a professional networking assistant. Generate a personalized LinkedIn "
    "connection request message. Rules:\n"
    "- MUST be under 300 characters (LinkedIn limit)\n"
    "- Sound genuine and human\n"
    "- Reference the person's post topic if provided\n"
    "- Be specific, not generic\n"
    "- No emojis, no hashtags\n"
    "- Match the language of the post/context\n"
    "- Don't be overly formal or salesy\n"
    "- Include their first name naturally"
)


def _get_client() -> Groq:
    global _client
    if _client is None:
        _client = Groq(api_key=GROQ_API_KEY)
    return _client


def generate_invite_message(
    author_name: str,
    post_text: str = "",
    post_topic: str = "",
    user_role: str = "",
    platform: str = "linkedin",
    tone: str = "friendly",
    language: str = "en",
    previous_interaction: str = "",
) -> dict:
    """
    Generate a personalized connection invite message.
    
    Args:
        author_name: Full name of the person to connect with
        post_text: Text of the post that triggered the invite
        post_topic: Summary topic of the post
        user_role: The user's professional role (for context)
        platform: Target platform (linkedin/reddit)
        tone: Tone of the message
        language: Target language code
        previous_interaction: Context from previous interactions
    
    Returns:
        {
            "message": str (the invite text, max 300 chars),
            "char_count": int,
            "variants": [str, str] (2 alternative messages)
        }
    """
    try:
        client = _get_client()
        
        first_name = author_name.split()[0] if author_name else "there"
        
        context_parts = []
        if post_text:
            context_parts.append(f"Their recent post: \"{post_text[:200]}\"")
        if post_topic:
            context_parts.append(f"Post topic: {post_topic}")
        if user_role:
            context_parts.append(f"My role: {user_role}")
        if previous_interaction:
            context_parts.append(f"Previous interaction: {previous_interaction}")
        
        context = "\n".join(context_parts) if context_parts else "No specific context."
        
        user_prompt = (
            f"Person's name: {author_name}\n"
            f"First name: {first_name}\n"
            f"Language: {language}\n"
            f"Tone: {tone}\n"
            f"Context:\n{context}\n\n"
            f"Generate exactly 3 different connection request messages. "
            f"Each MUST be under 300 characters. "
            f"Format:\n"
            f"1. <message 1>\n"
            f"2. <message 2>\n"
            f"3. <message 3>"
        )
        
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": INVITE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.85,
            max_tokens=500,
            top_p=0.9,
        )
        
        raw = response.choices[0].message.content.strip()
        
        # Parse variants
        variants = []
        for line in raw.split("\n"):
            line = line.strip()
            if line and line[0].isdigit() and "." in line[:3]:
                msg = line.split(".", 1)[1].strip()
                # Clean quotes
                for q in ['"', "'", "\u201c", "\u201d"]:
                    msg = msg.strip(q)
                # Enforce 300 char limit
                if len(msg) > 300:
                    msg = msg[:297] + "..."
                if msg:
                    variants.append(msg)
        
        if not variants:
            # Fallback: use entire response as one message
            fallback = raw[:300]
            variants = [fallback]
        
        # Ensure at least 2 variants
        while len(variants) < 2:
            variants.append(variants[0])
        
        primary = variants[0]
        
        return {
            "message": primary,
            "char_count": len(primary),
            "variants": variants[:3],
        }
    
    except Exception as e:
        logger.error("Invite generation error: %s", e)
        # Fallback message
        first_name = author_name.split()[0] if author_name else "there"
        fallback = f"Hi {first_name}! Your recent post caught my attention. Would love to connect and exchange ideas."
        return {
            "message": fallback,
            "char_count": len(fallback),
            "variants": [fallback],
        }


def generate_followup_invite(
    author_name: str,
    previous_comment: str = "",
    interaction_count: int = 0,
    language: str = "en",
) -> dict:
    """
    Generate invite for someone we've already commented on.
    References previous interaction for stronger connection.
    """
    try:
        client = _get_client()
        
        first_name = author_name.split()[0] if author_name else "there"
        
        user_prompt = (
            f"Person's name: {author_name}\n"
            f"Language: {language}\n"
            f"I already left this comment on their post: \"{previous_comment[:150]}\"\n"
            f"We've interacted {interaction_count} time(s) before.\n\n"
            f"Generate a connection request that naturally references our previous interaction. "
            f"Must be under 300 characters.\n"
            f"Format:\n"
            f"1. <message>"
        )
        
        response = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": INVITE_SYSTEM_PROMPT},
                {"role": "user", "content": user_prompt},
            ],
            temperature=0.8,
            max_tokens=200,
        )
        
        msg = response.choices[0].message.content.strip()
        # Clean up
        if msg[0].isdigit() and "." in msg[:3]:
            msg = msg.split(".", 1)[1].strip()
        for q in ['"', "'", "\u201c", "\u201d"]:
            msg = msg.strip(q)
        if len(msg) > 300:
            msg = msg[:297] + "..."
        
        return {"message": msg, "char_count": len(msg), "variants": [msg]}
    
    except Exception as e:
        logger.error("Followup invite generation error: %s", e)
        first_name = author_name.split()[0] if author_name else "there"
        fallback = f"Hi {first_name}! Enjoyed our recent exchange in the comments. Let's stay connected!"
        return {"message": fallback, "char_count": len(fallback), "variants": [fallback]}
