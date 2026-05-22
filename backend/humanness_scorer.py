"""
Engagr — Humanness Scorer Module
Heuristic scoring of posts to filter out AI-generated/spam content.
Comments should only be left on posts written by real humans.
"""

import re
import logging

logger = logging.getLogger(__name__)

# AI/bot cliche phrases (case-insensitive patterns)
AI_CLICHES = [
    r"i am thrilled to announce",
    r"in today'?s fast-paced world",
    r"i'?m excited to share",
    r"leveraging cutting-edge",
    r"game-?changer",
    r"paradigm shift",
    r"synerg(y|ies|ize)",
    r"at the end of the day",
    r"it'?s not just about",
    r"let that sink in",
    r"here'?s the thing",
    r"unpopular opinion:?\s",
    r"hot take:?\s",
    r"this\.\s*so much this",
    r"1000%\s",
    r"couldn'?t agree more",
    r"(?:agree|disagree)\??$",
    r"drop a .+ if you",
    r"who else (?:agrees|thinks|feels)",
    r"am i the only one",
    r"thoughts\??\s*$",
    r"absolutely\!?\s*$",
    r"this is the way",
    r"just my two cents",
    r"food for thought",
    r"let me break it down",
    r"here are \d+ (?:key|essential|critical|important)",
    r"without further ado",
    r"in conclusion",
    r"to summarize",
    r"are you ready\??",
    r"buckle up",
    r"stay tuned",
    r"share if you agree",
    r"repost if",
    r"double tap if",
    r"follow me for more",
    r"link in (?:bio|comments|first comment)",
]

# Structural patterns typical of AI posts
STRUCTURAL_PATTERNS = [
    r"(?:\n\s*[-•→✅❌🔥⚡]\s*){4,}",     # 4+ bullet points with emojis
    r"(?:\n\s*\d+[.)]\s*){5,}",            # 5+ numbered list items
    r"(?:\n\n){5,}",                        # Excessive paragraph breaks
    r"(?:#\w+\s*){5,}",                     # 5+ hashtags
]

# Emoji spam patterns
EMOJI_OVERUSE_THRESHOLD = 8  # more than this many unique emojis = suspicious


def _count_emojis(text: str) -> int:
    """Count emoji characters in text."""
    emoji_pattern = re.compile(
        r"[\U0001F600-\U0001F64F\U0001F300-\U0001F5FF"
        r"\U0001F680-\U0001F6FF\U0001F1E0-\U0001F1FF"
        r"\U00002702-\U000027B0\U000024C2-\U0001F251"
        r"\U0001F900-\U0001F9FF\U0001FA00-\U0001FA6F"
        r"\U0001FA70-\U0001FAFF\U00002600-\U000026FF]+",
        flags=re.UNICODE,
    )
    return len(emoji_pattern.findall(text))


def _detect_repetitive_structure(text: str) -> float:
    """Detect if post has robotic repetitive structure."""
    lines = [l.strip() for l in text.split("\n") if l.strip()]
    if len(lines) < 3:
        return 0.0
    
    # Check if most lines start with the same pattern
    starts = [l[:3] for l in lines if len(l) >= 3]
    if starts:
        from collections import Counter
        most_common_start, count = Counter(starts).most_common(1)[0]
        if count / len(starts) > 0.6 and len(lines) > 4:
            return 0.3
    
    # Check for very uniform line lengths (AI often generates uniform bullets)
    lengths = [len(l) for l in lines if len(l) > 10]
    if len(lengths) >= 4:
        avg_len = sum(lengths) / len(lengths)
        variance = sum((l - avg_len) ** 2 for l in lengths) / len(lengths)
        if variance < 100 and avg_len > 30:  # Very uniform lengths
            return 0.2
    
    return 0.0


def score_humanness(text: str) -> dict:
    """
    Score a post's 'humanness' on a scale from 0.0 (definitely AI) to 1.0 (definitely human).
    
    Returns:
        {
            "score": float (0.0 - 1.0),
            "is_human": bool (score >= 0.5),
            "flags": list of detected issues,
            "recommendation": str
        }
    """
    if not text or len(text.strip()) < 20:
        return {"score": 0.5, "is_human": True, "flags": ["too_short_to_analyze"], "recommendation": "skip"}
    
    text_lower = text.lower()
    score = 1.0  # Start with fully human, deduct for suspicious patterns
    flags = []
    
    # 1. Check AI cliches
    cliche_count = 0
    for pattern in AI_CLICHES:
        if re.search(pattern, text_lower):
            cliche_count += 1
    
    if cliche_count >= 4:
        score -= 0.4
        flags.append(f"ai_cliches_heavy ({cliche_count})")
    elif cliche_count >= 2:
        score -= 0.2
        flags.append(f"ai_cliches ({cliche_count})")
    elif cliche_count == 1:
        score -= 0.05
    
    # 2. Check structural patterns
    for pattern in STRUCTURAL_PATTERNS:
        if re.search(pattern, text):
            score -= 0.15
            flags.append("robotic_structure")
            break
    
    # 3. Check emoji overuse
    emoji_count = _count_emojis(text)
    if emoji_count > EMOJI_OVERUSE_THRESHOLD:
        score -= 0.15
        flags.append(f"emoji_spam ({emoji_count})")
    
    # 4. Check for repetitive structure
    rep_penalty = _detect_repetitive_structure(text)
    if rep_penalty > 0:
        score -= rep_penalty
        flags.append("repetitive_format")
    
    # 5. Check for engagement bait
    bait_patterns = [
        r"(?:comment|like|share|repost|save)\s+(?:if|this)",
        r"(?:who|how many)\s+(?:else|of you)",
        r"tag\s+(?:someone|a friend|your)",
    ]
    for pattern in bait_patterns:
        if re.search(pattern, text_lower):
            score -= 0.15
            flags.append("engagement_bait")
            break
    
    # 6. Very long posts with perfect grammar tend to be AI
    word_count = len(text.split())
    if word_count > 300 and not any(c in text for c in ["...", "haha", "lol", "btw", "ngl"]):
        score -= 0.1
        flags.append("overly_polished_long_post")
    
    # 7. All-caps lines for emphasis (common in LinkedIn bait posts)
    caps_lines = [l for l in text.split("\n") if l.strip() and l.strip().isupper() and len(l.strip()) > 5]
    if len(caps_lines) >= 2:
        score -= 0.1
        flags.append("caps_emphasis")
    
    # Clamp score
    score = max(0.0, min(1.0, score))
    is_human = score >= 0.5
    
    # Recommendation
    if score >= 0.7:
        recommendation = "engage"  # Good target for commenting
    elif score >= 0.5:
        recommendation = "cautious"  # Might be human, engage if relevant
    else:
        recommendation = "skip"  # Likely AI, skip
    
    return {
        "score": round(score, 2),
        "is_human": is_human,
        "flags": flags,
        "recommendation": recommendation,
    }


def filter_human_posts(posts: list[dict], threshold: float = 0.5) -> list[dict]:
    """
    Filter a list of posts, keeping only those that pass the humanness threshold.
    Adds humanness_score to each post.
    """
    filtered = []
    for post in posts:
        text = post.get("text", "") or post.get("post_text", "")
        result = score_humanness(text)
        post["humanness_score"] = result["score"]
        post["humanness_flags"] = result["flags"]
        
        if result["score"] >= threshold:
            filtered.append(post)
        else:
            logger.info(
                "Filtered AI post: score=%.2f flags=%s text_preview=%s",
                result["score"],
                result["flags"],
                text[:80],
            )
    
    return filtered
