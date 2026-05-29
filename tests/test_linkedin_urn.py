"""Tests for LinkedIn URL parsing."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from linkedin import _extract_activity_urn  # noqa: E402


def test_extract_from_feed_update_url():
    url = "https://www.linkedin.com/feed/update/urn:li:activity:7123456789012345678/"
    assert _extract_activity_urn(url) == "7123456789012345678"


def test_extract_from_activity_token():
    url = "urn:li:activity:7999888777666555444"
    assert _extract_activity_urn(url) == "7999888777666555444"
