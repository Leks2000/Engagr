"""
Engagr — JWT Authentication Module

Handles:
  - Telegram initData signature verification
  - JWT token generation & validation
  - Extension token authentication middleware
  - User creation/lookup from Telegram ID

Security:
  - Extension NEVER trusts Mini App directly
  - Only backend issues JWT tokens
  - Telegram initData is cryptographically verified
  - All extension requests require Bearer token
"""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
import os
import time
from datetime import datetime, timezone
from functools import wraps
from typing import Any
from urllib.parse import parse_qs, unquote

import jwt  # PyJWT

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────

JWT_SECRET = os.environ.get("JWT_SECRET", os.environ.get("TELEGRAM_BOT_TOKEN", "engagr-dev-secret"))
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_SECONDS = 7 * 24 * 3600  # 7 days
TELEGRAM_BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")

# ─────────────────────────────────────────────────────────────────
# Telegram initData verification
# ─────────────────────────────────────────────────────────────────


def verify_telegram_init_data(init_data: str, bot_token: str | None = None) -> dict | None:
    """
    Verify Telegram WebApp initData signature.
    
    Returns parsed user data if valid, None otherwise.
    
    See: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    """
    token = bot_token or TELEGRAM_BOT_TOKEN
    if not token:
        logger.warning("No TELEGRAM_BOT_TOKEN set; skipping initData verification (dev mode)")
        # In dev mode without token, try to extract user data anyway
        return _parse_init_data_unverified(init_data)

    try:
        # Parse the query string
        parsed = parse_qs(init_data, keep_blank_values=True)
        
        # Extract hash
        received_hash = parsed.get("hash", [""])[0]
        if not received_hash:
            logger.debug("No hash in initData")
            return None

        # Build data-check-string (all params except hash, sorted alphabetically)
        check_params = []
        for key in sorted(parsed.keys()):
            if key == "hash":
                continue
            # Each value is a list; take the first
            value = parsed[key][0]
            check_params.append(f"{key}={value}")
        
        data_check_string = "\n".join(check_params)

        # Compute secret key: HMAC-SHA256(bot_token, "WebAppData")
        secret_key = hmac.new(
            b"WebAppData",
            token.encode("utf-8"),
            hashlib.sha256,
        ).digest()

        # Compute expected hash: HMAC-SHA256(secret_key, data_check_string)
        expected_hash = hmac.new(
            secret_key,
            data_check_string.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        if not hmac.compare_digest(received_hash, expected_hash):
            logger.warning("initData signature mismatch")
            return None

        # Check auth_date freshness (allow up to 1 hour)
        auth_date = int(parsed.get("auth_date", ["0"])[0])
        if auth_date and (time.time() - auth_date) > 3600:
            logger.warning("initData auth_date too old: %s", auth_date)
            # Still allow in dev, warn in production
            if os.environ.get("APP_ENV") == "production":
                return None

        # Parse user JSON
        user_raw = parsed.get("user", [""])[0]
        if user_raw:
            user_data = json.loads(unquote(user_raw))
            return {
                "id": str(user_data.get("id", "")),
                "first_name": user_data.get("first_name", ""),
                "last_name": user_data.get("last_name", ""),
                "username": user_data.get("username", ""),
                "language_code": user_data.get("language_code", "en"),
                "is_premium": user_data.get("is_premium", False),
                "verified": True,
            }

        return None

    except Exception as exc:
        logger.error("initData verification failed: %s", exc)
        return None


def _parse_init_data_unverified(init_data: str) -> dict | None:
    """
    Parse initData without verification (DEV MODE ONLY).
    Used when no bot token is configured.
    """
    try:
        parsed = parse_qs(init_data, keep_blank_values=True)
        user_raw = parsed.get("user", [""])[0]
        if user_raw:
            user_data = json.loads(unquote(user_raw))
            return {
                "id": str(user_data.get("id", "")),
                "first_name": user_data.get("first_name", ""),
                "last_name": user_data.get("last_name", ""),
                "username": user_data.get("username", ""),
                "language_code": user_data.get("language_code", "en"),
                "is_premium": user_data.get("is_premium", False),
                "verified": False,  # NOT verified
            }
    except Exception:
        pass
    return None


# ─────────────────────────────────────────────────────────────────
# JWT Token Management
# ─────────────────────────────────────────────────────────────────


def generate_token(user_id: str, extra_claims: dict | None = None) -> str:
    """
    Generate a JWT token for a user.
    
    Claims:
      - sub: user_id (Telegram user ID)
      - iat: issued at
      - exp: expiration
      - iss: "engagr"
    """
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + JWT_EXPIRY_SECONDS,
        "iss": "engagr",
    }
    if extra_claims:
        payload.update(extra_claims)

    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def verify_token(token: str) -> dict | None:
    """
    Verify and decode a JWT token.
    Returns decoded payload if valid, None otherwise.
    """
    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALGORITHM],
            issuer="engagr",
        )
        return payload
    except jwt.ExpiredSignatureError:
        logger.debug("JWT token expired")
        return None
    except jwt.InvalidTokenError as exc:
        logger.debug("JWT token invalid: %s", exc)
        return None


def get_user_id_from_token(token: str) -> str | None:
    """Extract user_id from a valid JWT token."""
    payload = verify_token(token)
    if payload:
        return payload.get("sub")
    return None


# ─────────────────────────────────────────────────────────────────
# Flask Middleware / Decorator
# ─────────────────────────────────────────────────────────────────


def require_auth(f):
    """
    Flask route decorator that requires valid JWT Bearer token.
    Injects `auth_user_id` into the request context.
    
    Usage:
        @app.route("/api/protected")
        @require_auth
        def protected_route():
            user_id = request.auth_user_id
            ...
    """
    from flask import request as flask_request, jsonify as flask_jsonify

    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = flask_request.headers.get("Authorization", "")
        
        if not auth_header.startswith("Bearer "):
            return flask_jsonify({"error": "Authorization header required", "code": "no_auth"}), 401

        token = auth_header[7:]  # Remove "Bearer " prefix
        payload = verify_token(token)
        
        if not payload:
            return flask_jsonify({"error": "Invalid or expired token", "code": "invalid_token"}), 401

        # Inject authenticated user_id into request
        flask_request.auth_user_id = payload.get("sub", "")
        flask_request.auth_payload = payload
        
        return f(*args, **kwargs)

    return decorated


def optional_auth(f):
    """
    Flask route decorator that optionally validates JWT token.
    If present and valid, injects auth_user_id.
    If absent or invalid, proceeds without auth (auth_user_id = None).
    """
    from flask import request as flask_request

    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = flask_request.headers.get("Authorization", "")
        
        flask_request.auth_user_id = None
        flask_request.auth_payload = None
        
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            payload = verify_token(token)
            if payload:
                flask_request.auth_user_id = payload.get("sub", "")
                flask_request.auth_payload = payload

        return f(*args, **kwargs)

    return decorated


# ─────────────────────────────────────────────────────────────────
# Extension Login Flow
# ─────────────────────────────────────────────────────────────────


def generate_extension_login_code(user_id: str) -> str:
    """
    Generate a short-lived login code for extension authentication.
    The user gets this code from Telegram Mini App and enters it in extension.
    
    The code is a JWT with short expiry (5 min) and special claim.
    """
    now = int(time.time())
    payload = {
        "sub": str(user_id),
        "iat": now,
        "exp": now + 300,  # 5 minutes
        "iss": "engagr",
        "purpose": "extension_login",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def validate_extension_login_code(code: str) -> str | None:
    """
    Validate an extension login code and return user_id if valid.
    Returns None if invalid or expired.
    """
    payload = verify_token(code)
    if payload and payload.get("purpose") == "extension_login":
        return payload.get("sub")
    return None
