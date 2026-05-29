"""LinkedIn cookie jar helpers."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from linkedin import _build_linkedin_cookie_jar, _clean_cookie_value, verify_li_at  # noqa: E402


def test_clean_cookie_strips_quotes():
    assert _clean_cookie_value('  "ajax:123"  ') == "ajax:123"


def test_cookie_jar_has_jsessionid():
    jar = _build_linkedin_cookie_jar("li_at_value", "ajax:999")
    names = [c.name for c in jar]
    assert "li_at" in names
    assert "JSESSIONID" in names


def test_verify_requires_jsessionid():
    ok, err = verify_li_at("u1", "some_li_at", "")
    assert ok is False
    assert "JSESSIONID" in err


def test_clean_cookie_extracts_name_value_fragment():
    assert _clean_cookie_value('JSESSIONID="ajax:123"; Path=/', "JSESSIONID") == "ajax:123"
    assert _clean_cookie_value("li_at=AQED123; bcookie=ignored", "li_at") == "AQED123"
