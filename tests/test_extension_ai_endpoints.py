"""Tests for WebBridge extension AI comment endpoints."""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "backend"))

import main  # noqa: E402


def test_extension_linkedin_comment_generates_variants(monkeypatch):
    monkeypatch.setattr(main.storage, "get_settings", lambda _user_id: {
        "language": "en",
        "linkedin": {"tone": "friendly"},
    })

    def fake_generate(post_text, user_language="en", platform="linkedin", tone="friendly"):
        assert post_text == "Building a useful Chrome extension."
        assert user_language == "en"
        assert platform == "linkedin"
        assert tone == "friendly"
        return {
            "variants": ["Useful direction.", "This feels practical.", "Nice execution."],
            "post_language": "en",
            "translations": None,
        }

    monkeypatch.setattr(main.ai_comment, "generate_comment_variants", fake_generate)

    client = main.api.test_client()
    response = client.post("/api/extension/linkedin/comment/u1", json={
        "author": "Ada",
        "post": "Building a useful Chrome extension.",
        "url": "https://www.linkedin.com/feed/update/urn:li:activity:1/",
    })

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "generated"
    assert data["provider"] == "groq"
    assert data["variants"] == ["Useful direction.", "This feels practical.", "Nice execution."]
    assert data["selected_comment"] == "Useful direction."


def test_extension_linkedin_regenerate_returns_single_comment(monkeypatch):
    monkeypatch.setattr(main.storage, "get_settings", lambda _user_id: {
        "linkedin": {"tone": "expert"},
    })

    def fake_regenerate(post_text, previous_comment, platform="linkedin", tone="friendly"):
        assert post_text == "AI comments need human review."
        assert previous_comment == "True."
        assert platform == "linkedin"
        assert tone == "expert"
        return "Human review keeps this safer."

    monkeypatch.setattr(main.ai_comment, "regenerate_comment", fake_regenerate)

    client = main.api.test_client()
    response = client.post("/api/extension/linkedin/regenerate/u1", json={
        "post": "AI comments need human review.",
        "previous_comment": "True.",
    })

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "regenerated"
    assert data["comment"] == "Human review keeps this safer."
    assert data["variants"] == ["Human review keeps this safer."]


def test_extension_linkedin_comment_requires_post_text():
    client = main.api.test_client()
    response = client.post("/api/extension/linkedin/comment/u1", json={"post": ""})

    assert response.status_code == 400
    assert response.get_json()["error"] == "Post text is required"
