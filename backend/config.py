"""
Engagr — Configuration
Loads env vars, defines constants and daily hard limits.
"""

import os
from pathlib import Path
from dotenv import load_dotenv

# Load .env from project root
ROOT_DIR = Path(__file__).resolve().parent.parent
load_dotenv(ROOT_DIR / ".env")

# ── Telegram ──────────────────────────────────────────
TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "")
TELEGRAM_CHAT_ID = os.getenv("TELEGRAM_CHAT_ID", "")

# ── Groq AI ───────────────────────────────────────────
GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GROQ_MODEL = "llama-3.3-70b-versatile"

GROQ_SYSTEM_PROMPT = (
    "You are a developer and indie hacker. Write a genuine comment for this post. "
    "Rules: 3–20 words, match post language, sound human, no hashtags, no emojis, "
    "no self-promotion, add real value or ask a genuine question."
)

# ── Reddit (Cookie-login — no app needed) ────────────
# OAuth fields kept for backward compatibility but no longer required
REDDIT_CLIENT_ID = os.getenv("REDDIT_CLIENT_ID", "")
REDDIT_CLIENT_SECRET = os.getenv("REDDIT_CLIENT_SECRET", "")
REDDIT_REDIRECT_URI = os.getenv("REDDIT_REDIRECT_URI", "")


# ── LinkedIn OAuth / Proxy ─────────────────────────
LINKEDIN_CLIENT_ID = os.getenv("LINKEDIN_CLIENT_ID", "864tm25k93bj1r")
LINKEDIN_CLIENT_SECRET = os.getenv("LINKEDIN_CLIENT_SECRET", "")
LINKEDIN_REDIRECT_URI = os.getenv("LINKEDIN_REDIRECT_URI", "https://engagr-production.up.railway.app/api/linkedin/callback")
WEBSHARE_PROXY_URL = os.getenv("WEBSHARE_PROXY_URL", "")

# ── App ───────────────────────────────────────────────
APP_ENV = os.getenv("APP_ENV", "development")
MINI_APP_URL = os.getenv("MINI_APP_URL", "")

# ── Paths ─────────────────────────────────────────────
DATA_DIR = ROOT_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
COOKIES_PATH = DATA_DIR / "cookies.json"  # legacy global path


def linkedin_cookies_path(user_id: str) -> Path:
    """Per-user LinkedIn cookies."""
    return DATA_DIR / str(user_id) / "linkedin_cookies.json"


def reddit_cookies_path(user_id: str) -> Path:
    """Per-user Reddit cookies."""
    return DATA_DIR / str(user_id) / "reddit_cookies.json"

# ── Daily Hard Limits (never exceeded) ────────────────
DAILY_LIMITS = {
    "linkedin_comments": 15,
    "linkedin_likes": 5,
    "linkedin_adds": 5,
    "reddit_comments": 15,
    "reddit_upvotes": 5,
}

# ── Anti-spam Delay Ranges (seconds) ─────────────────
DELAYS = {
    "comment": (300, 1800),     # 5–30 min
    "like": (120, 420),         # 2–7 min
    "connection": (180, 600),   # 3–10 min
}

# ── Default User Settings ────────────────────────────
DEFAULT_SETTINGS = {
    "language": "en",
    "session_active": True,
    "linkedin": {
        "connected": False,
        "proxy_url": "",
        "keywords": [],
        "comments_per_day": 5,
        "daily_comment_hard_limit": 10,
        "tone": "friendly",
        "session_jitter_minutes": [3, 17],
        "warmup_mode": True,
        "warmup_started_at": "",
        "cta_templates": [],
        "likes_per_day": 5,
        "people_add_range": [1, 3],
        "add_people_by_keywords": False,
        "add_people_keywords": [],
        "session_times": ["09:00", "14:00", "19:00"],
        "warmup_mode": False,
        "warmup_day": 1,
        "cta_templates": [],
        "smart_schedule_enabled": False,
    },
    "onboarding_completed": False,
    "reddit": {
        "connected": False,
        "reddit_username": "",
        "subreddits": [],
        "keywords": [],
        "comments_per_day": 5,
        "daily_comment_hard_limit": 10,
        "tone": "friendly",
        "session_jitter_minutes": [3, 17],
        "warmup_mode": True,
        "warmup_started_at": "",
        "cta_templates": [],
        "upvotes_per_day": 5,
        "session_times": ["09:00", "14:00", "19:00"],
    },
    "nested_replies_enabled": True,
    "news_grounding_enabled": True,
}

# ── Default Daily Stats ──────────────────────────────
DEFAULT_STATS = {
    "linkedin_comments": 0,
    "linkedin_likes": 0,
    "linkedin_adds": 0,
    "reddit_comments": 0,
    "reddit_upvotes": 0,
    "date": "",
}
