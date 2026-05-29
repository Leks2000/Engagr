"""LinkedIn cookie jar helpers."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

from linkedin import (  # noqa: E402
    _build_linkedin_cookie_jar,
    _clean_cookie_value,
    _fetch_current_profile,
    _voyager_error_message,
    verify_li_at,
)


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


def test_cookie_jar_uses_linkedin_parent_domain():
    jar = _build_linkedin_cookie_jar("li_at_value", '"ajax:999"')
    cookies = {c.name: c for c in jar}
    assert cookies["li_at"].domain == ".linkedin.com"
    assert cookies["JSESSIONID"].domain == ".linkedin.com"
    assert cookies["JSESSIONID"].value == '"ajax:999"'


def test_voyager_error_message_handles_missing_message_field():
    assert _voyager_error_message({"status": 401, "serviceErrorCode": 65600}) == (
        "LinkedIn Voyager API returned status 401 (serviceErrorCode 65600)."
    )


def test_fetch_current_profile_rejects_status_without_keyerror():
    class FakeClient:
        def get_user_profile(self, use_cache=False):
            return {"status": 401}

    try:
        _fetch_current_profile(FakeClient())
    except ValueError as exc:
        assert "status 401" in str(exc)
    else:
        raise AssertionError("Expected rejected LinkedIn status to raise ValueError")
