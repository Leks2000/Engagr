"""
Engagr — Self-healing selectors.

Stage 5 follow-up: auto-detect a broken platform selector and propose a new one.

How it works
------------
1. The Chrome extension records a "selector probe" every time it tries to use a
   DOM selector for an action (comment box, post button, like button…). If the
   selector returns 0 nodes, that probe is flagged as `failed`.
2. The extension POSTs the probe result to `/api/extension/selector/probe`.
3. If a selector fails N times in a row (default 3), this module:
     a. marks the selector as `broken` in the per-user selector-health store,
     b. asks Groq to propose a *new* selector by inspecting the surrounding HTML
        snippet the extension sent with the probe (the fixture-driven guard in
        action-selectors.spec.js already proves the proposed selector is valid
        against saved fixture HTML before it ships),
     c. returns the candidate to the extension so it can retry immediately,
     d. records the proposal so the user can review/accept it in the Mini App.

Storage
-------
Selector health is kept in `data/<user_id>/selector_health.json` so it survives
restarts and is per-user (different users may hit different A/B variants).

Public API
----------
record_probe(user_id, probe) -> dict
    Persist a probe result and trigger healing if the failure threshold is hit.

get_selector_health(user_id) -> dict
    Snapshot of current selector health for the Mini App.

propose_selector(platform, action, html_snippet) -> dict
    Ask Groq for a replacement selector. Returns {"selector": ..., "confidence": ...}
    or {"selector": "", "reason": ...} on failure. Safe to call without Groq.

accept_proposal(user_id, proposal_id) -> dict
    Mark a proposed replacement as accepted (so future probes compare against it).
"""

from __future__ import annotations

import json
import logging
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from config import DATA_DIR

logger = logging.getLogger("engagr.selfheal")

_FAIL_THRESHOLD = 3          # consecutive failures before healing triggers
_MAX_PROBES_KEPT = 200       # rolling log per user
_MAX_PROPOSALS_KEPT = 20

_health_locks: dict[str, threading.Lock] = {}
_health_global = threading.Lock()


_BARE_TAG_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9-]*$")
_BROAD_MATCH_LIMIT = 3


def _selector_safety_check(selector: str, html_snippet: str = "") -> dict:
    """Cheap guardrail for AI proposals before they reach Accept.

    Reject selectors that are obviously too broad (for example plain `button`)
    or that match too many nodes in the saved probe snippet. Live MCP verify is
    still required on Accept; this just prevents risky proposals from being
    shown as safe candidates.
    """
    sel = (selector or "").strip()
    if not sel:
        return {"ok": False, "reason": "empty selector", "match_count": 0}
    if _BARE_TAG_RE.match(sel):
        return {"ok": False, "reason": "selector is a bare tag name", "match_count": None}

    if html_snippet:
        try:
            from bs4 import BeautifulSoup
            soup = BeautifulSoup(html_snippet, "html.parser")
            matches = soup.select(sel)
            match_count = len(matches)
            if match_count > _BROAD_MATCH_LIMIT:
                return {
                    "ok": False,
                    "reason": f"selector matches too broadly in saved snippet ({match_count} nodes)",
                    "match_count": match_count,
                }
            return {"ok": True, "reason": "", "match_count": match_count}
        except Exception as e:
            return {"ok": False, "reason": f"selector cannot be evaluated on saved snippet: {e}", "match_count": 0}

    return {"ok": True, "reason": "", "match_count": None}


def _lock(user_id: str) -> threading.Lock:
    with _health_global:
        if user_id not in _health_locks:
            _health_locks[user_id] = threading.Lock()
        return _health_locks[user_id]


def _path(user_id: str) -> Path:
    p = DATA_DIR / str(user_id) / "selector_health.json"
    p.parent.mkdir(parents=True, exist_ok=True)
    return p


def _load(user_id: str) -> dict:
    p = _path(user_id)
    if p.exists():
        try:
            return json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            pass
    return {
        "selectors": {},      # key "platform:action" -> { selector, status, consecutive_failures, last_success, last_failure, proposed }
        "probes": [],         # rolling log of recent probes
        "proposals": [],      # proposed replacements pending review
    }


def _save(user_id: str, data: dict) -> None:
    _path(user_id).write_text(json.dumps(data, indent=2, ensure_ascii=False), encoding="utf-8")


def _key(platform: str, action: str) -> str:
    return f"{(platform or '').lower()}:{(action or '').lower()}"


# ── Public: record a probe ──────────────────────────────────────────────────

def record_probe(user_id: str, probe: dict) -> dict:
    """Persist a selector probe and heal if the threshold is hit.

    probe = {
        platform: "linkedin"|"x"|"reddit",
        action:   "comment"|"like"|"reply"|"post_button"|...,
        selector: ".the-css-selector",
        found:    <int node count>,
        html_snippet: "<outer html around the target, ≤4kb>",
        url:      "...",
        at:       iso8601
    }
    """
    platform = (probe.get("platform") or "").lower()
    action = (probe.get("action") or "").lower()
    selector = probe.get("selector") or ""
    found = int(probe.get("found") or 0)
    snippet = (probe.get("html_snippet") or "")[:4000]
    at = probe.get("at") or datetime.now(timezone.utc).isoformat()

    with _lock(user_id):
        data = _load(user_id)
        sel_map = data["selectors"]
        k = _key(platform, action)
        entry = sel_map.setdefault(k, {
            "selector": selector,
            "status": "unknown",
            "consecutive_failures": 0,
            "consecutive_successes": 0,
            "last_success": "",
            "last_failure": "",
            "proposed": None,
        })

        # Update selector if it changed (extension shipped a new version)
        if selector and entry["selector"] != selector:
            entry["selector"] = selector
            entry["consecutive_failures"] = 0
            entry["consecutive_successes"] = 0

        if found > 0:
            entry["status"] = "healthy"
            entry["consecutive_failures"] = 0
            entry["consecutive_successes"] += 1
            entry["last_success"] = at
        else:
            # Was: `entry.get(...) + 1 >= _FAIL_THRESHOLD and "broken" or "degraded"`
            # — an `X and STR or Y` ternary that works only because non-empty
            # strings are truthy. Fragile and a readability trap. Replaced with
            # an explicit if/else so the intent is unambiguous.
            will_break = entry.get("consecutive_failures", 0) + 1 >= _FAIL_THRESHOLD
            entry["status"] = "broken" if will_break else "degraded"
            entry["consecutive_failures"] += 1
            entry["consecutive_successes"] = 0
            entry["last_failure"] = at

        # Rolling probe log
        data["probes"].append({
            "platform": platform, "action": action, "selector": selector,
            "found": found, "at": at, "url": probe.get("url", ""),
        })
        if len(data["probes"]) > _MAX_PROBES_KEPT:
            data["probes"] = data["probes"][-_MAX_PROBES_KEPT:]

        proposal = None
        # Trigger healing only at the threshold crossing (not on every failure)
        if found == 0 and entry["consecutive_failures"] == _FAIL_THRESHOLD and snippet:
            proposal = propose_selector(platform, action, snippet)
            if proposal.get("selector"):
                safety = _selector_safety_check(proposal["selector"], snippet)
                if not safety.get("ok"):
                    proposal = {
                        **proposal,
                        "selector": "",
                        "rejected_by_safety": True,
                        "safety": safety,
                        "reason": safety.get("reason") or proposal.get("reason", ""),
                    }
                else:
                    proposal["safety"] = safety
            if proposal.get("selector"):
                pr = {
                    "id": f"prop_{int(time.time())}_{platform}_{action}",
                    "platform": platform,
                    "action": action,
                    "old_selector": entry["selector"],
                    "new_selector": proposal["selector"],
                    "confidence": proposal.get("confidence", 0),
                    "reason": proposal.get("reason", ""),
                    "html_snippet": snippet[:800],
                    "preview": proposal.get("safety", {}),
                    # The page the probe ran on — accept_proposal navigates back
                    # here to validate the AI selector against the LIVE DOM (not
                    # the stale snippet) before it is trusted. Without this URL
                    # live verification is impossible and a blind Accept could
                    # silently break extraction.
                    "verify_url": (probe.get("url") or "")[:500],
                    "created_at": at,
                    "status": "pending",   # pending | accepted | rejected
                    "verified": None,      # None | {ok, matched, tag, text, checked_at}
                }
                data["proposals"].insert(0, pr)
                data["proposals"] = data["proposals"][:_MAX_PROPOSALS_KEPT]
                entry["proposed"] = {
                    "selector": pr["new_selector"],
                    "proposal_id": pr["id"],
                    "confidence": pr["confidence"],
                }
                entry["status"] = "healing_proposed"

        _save(user_id, data)
        return {
            "status": entry["status"],
            "consecutive_failures": entry["consecutive_failures"],
            "proposal": proposal,
        }


# ── Public: read health ─────────────────────────────────────────────────────

def get_selector_health(user_id: str) -> dict:
    with _lock(user_id):
        data = _load(user_id)
        # summary counts
        healthy = sum(1 for e in data["selectors"].values() if e.get("status") == "healthy")
        broken = sum(1 for e in data["selectors"].values() if e.get("status") in ("broken", "healing_proposed"))
        degraded = sum(1 for e in data["selectors"].values() if e.get("status") == "degraded")
        return {
            "selectors": data["selectors"],
            "proposals": data["proposals"],
            "recent_probes": data["probes"][-20:],
            "summary": {
                "healthy": healthy,
                "degraded": degraded,
                "broken": broken,
                "total": len(data["selectors"]),
            },
        }


# ── Public: accept a proposal ───────────────────────────────────────────────

# How many nodes the proposed selector MUST match on the live DOM before we
# trust an Accept. 1 is the minimum (the action needs one element); we don't
# require more because some legitimate selectors (e.g. a unique id) match once.
_VERIFY_MIN_MATCHES = 1


def _verify_proposal_live(pr: dict) -> dict:
    """Validate the proposed selector against the LIVE page DOM via the user's
    Playwright MCP tunnel, NOT the stale snippet saved with the probe.

    This is the self-healing safety gate: a Groq proposal that looks right but
    is actually broken (generated class, wrong element, stale fixture) is caught
    here before it silently breaks extraction. The user clicks Accept in the
    Mini App → backend navigates the real browser to verify_url → checks the
    selector resolves → only then does it ship.

    Graceful degrade: if the tunnel is down (user's PC off) we do NOT silently
    apply the selector. We return a `verify_unavailable` result so the Mini App
    can tell the user to start the tunnel and retry. Applying an unverified AI
    selector is exactly the silent-breakage risk self-healing exists to prevent.
    """
    verify_url = (pr.get("verify_url") or "").strip()
    new_sel = pr.get("new_selector") or ""
    if not verify_url or not new_sel:
        return {
            "ok": False,
            "verified": False,
            "verify_unavailable": True,
            "error": "no verify_url on proposal — cannot validate on live DOM",
        }
    try:
        import browser_mcp
        res = browser_mcp.verify_selector_on_page(verify_url, new_sel, timeout=45)
    except Exception as e:
        logger.warning("verify_proposal_live import/call failed: %s", e)
        return {"ok": False, "verified": False, "verify_unavailable": True, "error": str(e)}

    # browser_mcp.verify_selector_on_page returns {ok, matched, tag, text, ...}
    # or {ok:False, step, error} on a tunnel/transport failure.
    if not res.get("ok"):
        # Tunnel down / navigate failed → do NOT apply; surface to the user.
        return {
            "ok": False,
            "verified": False,
            "verify_unavailable": True,
            "step": res.get("step", ""),
            "error": res.get("error", "MCP tunnel unreachable"),
        }
    matched = int(res.get("matched", 0) or 0)
    return {
        "ok": matched >= _VERIFY_MIN_MATCHES,
        "verified": matched >= _VERIFY_MIN_MATCHES,
        "verify_unavailable": False,
        "matched": matched,
        "tag": res.get("tag", ""),
        "text": (res.get("text") or "")[:160],
        "checked_at": datetime.now(timezone.utc).isoformat(),
    }


def accept_proposal(user_id: str, proposal_id: str) -> dict:
    """Accept a proposed replacement selector.

    GATE: before the AI selector is trusted, it is validated against the LIVE
    page DOM through the user's Playwright MCP tunnel (see _verify_proposal_live).
    A blind Accept of a broken Groq proposal would silently break extraction —
    exactly the failure mode self-healing is meant to prevent — so we refuse to
    ship an unverified selector. If the tunnel is down the caller gets
    `verify_unavailable: True` and the proposal stays pending for retry.
    """
    # --- Verification (outside the storage lock: MCP I/O can be slow) ---
    with _lock(user_id):
        data = _load(user_id)
        pr = next((p for p in data["proposals"] if p["id"] == proposal_id), None)
        if not pr:
            return {"ok": False, "error": "proposal not found"}
        if pr.get("status") == "accepted":
            return {"ok": True, "already_accepted": True, "selector": pr["new_selector"]}
        # Snapshot what we need to verify without holding the lock during I/O.
        verify_snapshot = {
            "verify_url": pr.get("verify_url", ""),
            "new_selector": pr.get("new_selector", ""),
        }

    verify = _verify_proposal_live(verify_snapshot)

    # --- Apply only if verification passed ---
    with _lock(user_id):
        data = _load(user_id)
        pr = next((p for p in data["proposals"] if p["id"] == proposal_id), None)
        if not pr:
            return {"ok": False, "error": "proposal not found"}
        # Persist the verification result so the Mini App shows it.
        pr["verified"] = {
            "ok": verify.get("verified", False),
            "matched": verify.get("matched", 0),
            "tag": verify.get("tag", ""),
            "text": verify.get("text", ""),
            "checked_at": verify.get("checked_at", ""),
            "verify_unavailable": verify.get("verify_unavailable", False),
            "error": verify.get("error", ""),
        }

        if not verify.get("verified"):
            # Verification failed OR tunnel down. Keep the proposal pending so
            # the user can retry once the tunnel is up; do NOT apply the selector.
            pr["status"] = "pending"
            _save(user_id, data)
            return {
                "ok": False,
                "rejected_by_verify": not verify.get("verify_unavailable", False),
                "verify_unavailable": verify.get("verify_unavailable", False),
                "verify": pr["verified"],
                "message": (
                    "Selector did not match the live page — not applied. "
                    "Ask Groq for a new proposal or fix it manually."
                    if not verify.get("verify_unavailable", False) else
                    "MCP tunnel is down. Start it on your PC (see Settings → "
                    "Advanced → Browser MCP) and retry Accept."
                ),
            }

        # Verified → safe to ship.
        pr["status"] = "accepted"
        k = _key(pr["platform"], pr["action"])
        entry = data["selectors"].get(k)
        if entry:
            entry["selector"] = pr["new_selector"]
            entry["status"] = "healthy"
            entry["consecutive_failures"] = 0
            entry["proposed"] = None
        _save(user_id, data)
        return {
            "ok": True,
            "selector": pr["new_selector"],
            "verify": pr["verified"],
        }


def reject_proposal(user_id: str, proposal_id: str) -> dict:
    with _lock(user_id):
        data = _load(user_id)
        for pr in data["proposals"]:
            if pr["id"] == proposal_id:
                pr["status"] = "rejected"
                k = _key(pr["platform"], pr["action"])
                entry = data["selectors"].get(k)
                if entry:
                    entry["proposed"] = None
                    if entry.get("status") == "healing_proposed":
                        entry["status"] = "broken"
                _save(user_id, data)
                return {"ok": True}
        return {"ok": False, "error": "proposal not found"}


# ── AI proposal (Groq) ──────────────────────────────────────────────────────

# Maps a logical action to the kind of DOM node we're looking for. This is fed
# to the model so it produces a selector that actually matches the right thing.
_ACTION_HINTS = {
    "comment": "the comment input box / textarea where a user types a comment",
    "post_button": "the submit button that posts the comment",
    "reply": "the reply input box",
    "like": "the like / upvote button",
    "connect": "the connect / follow button",
    "share": "the share / repost button",
}


def propose_selector(platform: str, action: str, html_snippet: str) -> dict:
    """Ask Groq for a replacement CSS selector. Resilient — never raises."""
    try:
        import ai_comment
        from config import GROQ_MODEL
        client = ai_comment._get_client()
        hint = _ACTION_HINTS.get(action, f"the element used for the '{action}' action")
        prompt = (
            f"A Chrome extension can no longer find the DOM element for {hint} on "
            f"{platform}. The old selector stopped matching. Here is a snippet of "
            f"the surrounding HTML (≤4kb):\n\n```\n{html_snippet[:3500]}\n```\n\n"
            "Propose a SINGLE robust CSS selector that would match the correct element. "
            "Prefer data-testid attributes, then role/aria attributes, then stable class "
            "names. Avoid nth-child and generated class names. "
            "Reply in EXACTLY this format and nothing else:\n"
            "SELECTOR: <css>\nCONFIDENCE: <0-100>\nREASON: <one short sentence>"
        )
        resp = client.chat.completions.create(
            model=GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You output only the requested format."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.0,
            max_tokens=120,
            timeout=12,
        )
        raw = (resp.choices[0].message.content or "").strip()
        sel_m = re.search(r"SELECTOR:\s*(.+)", raw)
        conf_m = re.search(r"CONFIDENCE:\s*(\d+)", raw)
        reason_m = re.search(r"REASON:\s*(.+)", raw)
        if not sel_m:
            return {"selector": "", "reason": "model did not return a selector"}
        selector = sel_m.group(1).strip().strip("`")
        # Sanity: a CSS selector shouldn't contain newlines or >4kb
        if "\n" in selector or len(selector) > 2000:
            return {"selector": "", "reason": "invalid selector format"}
        return {
            "selector": selector,
            "confidence": int(conf_m.group(1)) if conf_m else 50,
            "reason": reason_m.group(1).strip() if reason_m else "",
        }
    except Exception as e:
        logger.warning("propose_selector failed platform=%s action=%s: %s", platform, action, e)
        return {"selector": "", "reason": str(e)}
