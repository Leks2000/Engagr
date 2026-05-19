"""
Engagr — JSON-based Storage
Per-user settings, stats, and queue management keyed by telegram user_id.
Thread-safe with file locking via a simple lock dict.
"""

import json
import copy
import threading
from pathlib import Path
from datetime import datetime, timezone

from config import DATA_DIR, DEFAULT_SETTINGS, DEFAULT_STATS

_locks: dict[str, threading.Lock] = {}
_global_lock = threading.Lock()


def _get_lock(user_id: str) -> threading.Lock:
    with _global_lock:
        if user_id not in _locks:
            _locks[user_id] = threading.Lock()
        return _locks[user_id]


def _user_dir(user_id: str) -> Path:
    p = DATA_DIR / str(user_id)
    p.mkdir(parents=True, exist_ok=True)
    return p


def _read_json(path: Path, default: dict) -> dict:
    if path.exists():
        try:
            return json.loads(path.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return copy.deepcopy(default)


def _write_json(path: Path, data: dict):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


# ── Settings ──────────────────────────────────────────

def get_settings(user_id: str) -> dict:
    with _get_lock(user_id):
        path = _user_dir(user_id) / "settings.json"
        settings = _read_json(path, DEFAULT_SETTINGS)
        # Merge any new default keys
        merged = copy.deepcopy(DEFAULT_SETTINGS)
        _deep_merge(merged, settings)
        return merged


def save_settings(user_id: str, settings: dict):
    with _get_lock(user_id):
        path = _user_dir(user_id) / "settings.json"
        _write_json(path, settings)


def update_settings(user_id: str, updates: dict):
    settings = get_settings(user_id)
    _deep_merge(settings, updates)
    save_settings(user_id, settings)


def _deep_merge(base: dict, override: dict):
    for k, v in override.items():
        if k in base and isinstance(base[k], dict) and isinstance(v, dict):
            _deep_merge(base[k], v)
        else:
            base[k] = v


# ── Stats ─────────────────────────────────────────────

def get_stats(user_id: str) -> dict:
    with _get_lock(user_id):
        path = _user_dir(user_id) / "stats.json"
        stats = _read_json(path, DEFAULT_STATS)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if stats.get("date") != today:
            stats = copy.deepcopy(DEFAULT_STATS)
            stats["date"] = today
            _write_json(path, stats)
        return stats


def increment_stat(user_id: str, key: str, amount: int = 1):
    with _get_lock(user_id):
        path = _user_dir(user_id) / "stats.json"
        stats = _read_json(path, DEFAULT_STATS)
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        if stats.get("date") != today:
            stats = copy.deepcopy(DEFAULT_STATS)
            stats["date"] = today
        stats[key] = stats.get(key, 0) + amount
        _write_json(path, stats)


# ── Queue ─────────────────────────────────────────────

def get_queue(user_id: str) -> list[dict]:
    with _get_lock(user_id):
        path = _user_dir(user_id) / "queue.json"
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        return []


def save_queue(user_id: str, queue: list[dict]):
    with _get_lock(user_id):
        path = _user_dir(user_id) / "queue.json"
        path.write_text(json.dumps(queue, indent=2, ensure_ascii=False), encoding="utf-8")


def add_to_queue(user_id: str, item: dict):
    queue = get_queue(user_id)
    queue.append(item)
    save_queue(user_id, queue)


def remove_from_queue(user_id: str, item_id: str):
    queue = get_queue(user_id)
    queue = [q for q in queue if q.get("id") != item_id]
    save_queue(user_id, queue)


def get_queue_item(user_id: str, item_id: str) -> dict | None:
    queue = get_queue(user_id)
    for item in queue:
        if item.get("id") == item_id:
            return item
    return None


def update_queue_item(user_id: str, item_id: str, updates: dict):
    queue = get_queue(user_id)
    for item in queue:
        if item.get("id") == item_id:
            item.update(updates)
            break
    save_queue(user_id, queue)


# ── Connected Profiles Tracking ──────────────────────

def get_connected_profiles(user_id: str) -> list[str]:
    with _get_lock(user_id):
        path = _user_dir(user_id) / "connected_profiles.json"
        if path.exists():
            try:
                return json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        return []


def add_connected_profile(user_id: str, profile_url: str):
    with _get_lock(user_id):
        path = _user_dir(user_id) / "connected_profiles.json"
        profiles = []
        if path.exists():
            try:
                profiles = json.loads(path.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                pass
        if profile_url not in profiles:
            profiles.append(profile_url)
            path.write_text(json.dumps(profiles, ensure_ascii=False), encoding="utf-8")
