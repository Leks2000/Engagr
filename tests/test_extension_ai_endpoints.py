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


def test_extension_linkedin_queue_adds_pending_item(monkeypatch):
    queue = []
    monkeypatch.setattr(main.storage, "get_settings", lambda _user_id: {"language": "ru"})
    monkeypatch.setattr(main.storage, "get_queue", lambda _user_id: queue)

    def fake_add(_user_id, item):
        queue.append(item)

    monkeypatch.setattr(main.storage, "add_to_queue", fake_add)

    client = main.api.test_client()
    response = client.post("/api/extension/linkedin/queue/u1", json={
        "posts": [{
            "author": "Ada",
            "post": "Building a useful Chrome extension.",
            "url": "https://www.linkedin.com/feed/update/urn:li:activity:1/",
            "aiComment": {
                "variants": ["Useful direction.", "Nice execution."],
                "selected_comment": "Useful direction.",
                "post_language": "en",
            },
        }],
    })

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "queued"
    assert data["queued"] == 1
    assert data["skipped"] == 0
    assert len(queue) == 1
    item = queue[0]
    assert item["platform"] == "linkedin"
    assert item["action"] == "comment"
    assert item["source"] == "extension"
    assert item["status"] == "pending"
    assert item["author"] == "Ada"
    assert item["comment"] == "Useful direction."
    assert item["comment_variants"] == ["Useful direction.", "Nice execution."]
    assert item["user_language"] == "ru"


def test_extension_linkedin_queue_deduplicates_pending_items(monkeypatch):
    post_url = "https://www.linkedin.com/feed/update/urn:li:activity:1/"
    queue = [{
        "platform": "linkedin",
        "action": "comment",
        "post_url": post_url,
        "status": "pending",
    }]
    monkeypatch.setattr(main.storage, "get_settings", lambda _user_id: {"language": "en"})
    monkeypatch.setattr(main.storage, "get_queue", lambda _user_id: queue)
    monkeypatch.setattr(main.storage, "add_to_queue", lambda _user_id, item: queue.append(item))

    client = main.api.test_client()
    response = client.post("/api/extension/linkedin/queue/u1", json={
        "author": "Ada",
        "post": "Building a useful Chrome extension.",
        "url": post_url,
        "comment": "Useful direction.",
    })

    assert response.status_code == 200
    data = response.get_json()
    assert data["queued"] == 0
    assert data["skipped"] == 1
    assert len(queue) == 1


def test_extension_linkedin_queue_requires_comment(monkeypatch):
    monkeypatch.setattr(main.storage, "get_settings", lambda _user_id: {"language": "en"})
    monkeypatch.setattr(main.storage, "get_queue", lambda _user_id: [])
    monkeypatch.setattr(main.storage, "add_to_queue", lambda _user_id, item: None)

    client = main.api.test_client()
    response = client.post("/api/extension/linkedin/queue/u1", json={
        "post": "Building a useful Chrome extension.",
        "url": "https://www.linkedin.com/feed/update/urn:li:activity:1/",
    })

    assert response.status_code == 200
    data = response.get_json()
    assert data["queued"] == 0
    assert data["skipped"] == 1


# ── Step 6: LinkedIn browser-side actions ────────────


def _extension_item(item_id="item-1", status="approved", action="comment"):
    return {
        "id": item_id,
        "platform": "linkedin",
        "action": action,
        "source": "extension",
        "status": status,
        "author": "Ada",
        "post_url": "https://www.linkedin.com/feed/update/urn:li:activity:1/",
        "post_text": "Building a useful Chrome extension.",
        "post_excerpt": "Building a useful Chrome extension.",
        "comment": "Useful direction.",
        "selected_comment": "Useful direction.",
    }


def test_approve_extension_item_skips_server_posting(monkeypatch):
    item = _extension_item(status="pending")
    updates_applied = {}

    monkeypatch.setattr(main.storage, "get_queue_item", lambda _u, _i: item)

    def fake_update(_user_id, _item_id, updates):
        updates_applied.update(updates)

    monkeypatch.setattr(main.storage, "update_queue_item", fake_update)

    def fail_schedule(*_args, **_kwargs):
        raise AssertionError("Server-side posting must not be scheduled for extension items")

    monkeypatch.setattr(main.asyncio, "run_coroutine_threadsafe", fail_schedule)

    client = main.api.test_client()
    response = client.post("/api/queue/u1/item-1/approve")

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "approved"
    assert data["execution"] == "extension"
    assert updates_applied["status"] == "approved"
    assert updates_applied["execution"] == "extension"
    assert "approved_at" in updates_applied


def test_extension_linkedin_actions_lists_only_approved_extension_items(monkeypatch):
    queue = [
        _extension_item("a1", status="approved"),
        _extension_item("a2", status="pending"),
        {**_extension_item("a3", status="approved"), "source": "scheduler"},
        {**_extension_item("a4", status="approved"), "platform": "reddit"},
    ]
    monkeypatch.setattr(main.storage, "get_queue", lambda _u: queue)

    client = main.api.test_client()
    response = client.get("/api/extension/linkedin/actions/u1")

    assert response.status_code == 200
    data = response.get_json()
    assert data["count"] == 1
    assert [a["id"] for a in data["actions"]] == ["a1"]


def test_extension_action_complete_updates_stats_and_removes_item(monkeypatch):
    item = _extension_item("a1")
    removed = []
    stats = []
    interactions = []

    monkeypatch.setattr(main.storage, "get_queue_item", lambda _u, _i: item)
    monkeypatch.setattr(main.storage, "increment_stat", lambda _u, key, amount=1: stats.append(key))
    monkeypatch.setattr(main.storage, "remove_from_queue", lambda _u, item_id: removed.append(item_id))
    monkeypatch.setattr(
        main.interaction_memory,
        "record_interaction",
        lambda **kwargs: interactions.append(kwargs),
    )

    client = main.api.test_client()
    response = client.post("/api/extension/linkedin/actions/u1/a1/complete")

    assert response.status_code == 200
    data = response.get_json()
    assert data["status"] == "completed"
    assert data["action"] == "comment"
    assert stats == ["linkedin_comments"]
    assert removed == ["a1"]
    assert interactions[0]["author_name"] == "Ada"
    assert interactions[0]["interaction_type"] == "comment"


def test_extension_action_complete_maps_like_stat(monkeypatch):
    item = _extension_item("a1", action="like")
    stats = []

    monkeypatch.setattr(main.storage, "get_queue_item", lambda _u, _i: item)
    monkeypatch.setattr(main.storage, "increment_stat", lambda _u, key, amount=1: stats.append(key))
    monkeypatch.setattr(main.storage, "remove_from_queue", lambda _u, _i: None)
    monkeypatch.setattr(main.interaction_memory, "record_interaction", lambda **kwargs: None)

    client = main.api.test_client()
    response = client.post("/api/extension/linkedin/actions/u1/a1/complete")

    assert response.status_code == 200
    assert response.get_json()["action"] == "like"
    assert stats == ["linkedin_likes"]


def test_extension_action_dismiss_removes_item(monkeypatch):
    item = _extension_item("a1")
    removed = []

    monkeypatch.setattr(main.storage, "get_queue_item", lambda _u, _i: item)
    monkeypatch.setattr(main.storage, "remove_from_queue", lambda _u, item_id: removed.append(item_id))

    client = main.api.test_client()
    response = client.post("/api/extension/linkedin/actions/u1/a1/dismiss")

    assert response.status_code == 200
    assert response.get_json()["status"] == "dismissed"
    assert removed == ["a1"]


def test_extension_action_complete_missing_item_returns_404(monkeypatch):
    monkeypatch.setattr(main.storage, "get_queue_item", lambda _u, _i: None)

    client = main.api.test_client()
    response = client.post("/api/extension/linkedin/actions/u1/missing/complete")

    assert response.status_code == 404
