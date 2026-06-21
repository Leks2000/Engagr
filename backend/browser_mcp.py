"""
Engagr — Browser MCP integration.

The user runs a Playwright MCP server on their PC and exposes it via a
Cloudflare tunnel:
    BROWSER_MCP_URL = https://tech-appropriate-golden-benchmark.trycloudflare.com/mcp

The local PC commands that must run before any MCP call:
    npx @playwright/mcp@latest --port 8931
    C:\\cloudflared\\cloudflared.exe tunnel --url http://localhost:8931

This module is a thin MCP client the Railway backend uses to:
  - probe the tunnel health (`health_check`),
  - drive the user's real browser through MCP tool calls (`call_tool`),
  - list available tools,
  - run a full "self-healing selector verification" pass against the live
    platform DOM (used by selector_healer to validate a proposed selector on
    the real page before the extension retries the action).

The MCP transport over HTTP is JSON-RPC 2.0. Playwright MCP server exposes
tools like `browser_navigate`, `browser_click`, `browser_evaluate`,
`browser_snapshot`. We speak the standard `initialize` → `tools/list` →
`tools/call` handshake.

This is deliberately resilient: every call degrades gracefully when the tunnel
is down (the user's PC is off) so the rest of the app keeps working.
"""

from __future__ import annotations

import json
import logging
import os
import threading
import time
import uuid
from typing import Any

import requests

logger = logging.getLogger("engagr.mcp")

# The tunnel URL is set per-deployment via env. It may be rotated by the user,
# so we read it live on every call instead of caching at import time.
_DEFAULT_MCP_URL = "https://tech-appropriate-golden-benchmark.trycloudflare.com/mcp"


def _mcp_url() -> str:
    return (os.getenv("BROWSER_MCP_URL") or _DEFAULT_MCP_URL).strip().rstrip("/")


def _rpc(method: str, params: dict | None = None, *, timeout: int = 30) -> dict:
    """Send a single JSON-RPC 2.0 request to the MCP server.

    The Playwright MCP server speaks HTTP+SSE; for one-shot tool calls we use
    the stateless `initialize`+`tools/call` pattern and read the SSE event
    stream for the result. If the server only returns JSON (no SSE), we handle
    that too.
    """
    url = _mcp_url()
    rid = str(uuid.uuid4())
    payload = {
        "jsonrpc": "2.0",
        "id": rid,
        "method": method,
    }
    if params is not None:
        payload["params"] = params

    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
    }
    try:
        resp = requests.post(url, json=payload, headers=headers, timeout=timeout, stream=True)
        if resp.status_code != 200:
            return {"ok": False, "error": f"HTTP {resp.status_code}", "body": resp.text[:300]}

        ctype = resp.headers.get("Content-Type", "")
        if "text/event-stream" in ctype:
            # Parse SSE: look for `data: {...}` lines until we see our id result
            for line in resp.iter_lines(decode_unicode=True):
                if not line or not line.startswith("data:"):
                    continue
                chunk = line[5:].strip()
                if not chunk:
                    continue
                try:
                    msg = json.loads(chunk)
                except json.JSONDecodeError:
                    continue
                if msg.get("id") == rid:
                    if "error" in msg:
                        return {"ok": False, "error": msg["error"]}
                    return {"ok": True, "result": msg.get("result")}
            return {"ok": False, "error": "SSE stream ended without result"}
        else:
            try:
                msg = resp.json()
            except Exception:
                return {"ok": False, "error": "non-JSON response", "body": resp.text[:300]}
            if msg.get("id") == rid:
                if "error" in msg:
                    return {"ok": False, "error": msg["error"]}
                return {"ok": True, "result": msg.get("result")}
            # Some servers echo without id; accept if it has a result
            if "result" in msg:
                return {"ok": True, "result": msg["result"]}
            return {"ok": False, "error": "no result in response", "body": msg}
    except requests.RequestException as e:
        logger.warning("MCP rpc failed method=%s err=%s", method, e)
        return {"ok": False, "error": f"network: {e}"}
    except Exception as e:
        logger.error("MCP rpc unexpected error method=%s err=%s", method, e)
        return {"ok": False, "error": str(e)}


# ── Public API ───────────────────────────────────────────────────────────────

def health_check() -> dict:
    """Cheap liveness probe for the tunnel. Does NOT require a browser session."""
    res = _rpc("initialize", {
        "protocolVersion": "2024-11-05",
        "capabilities": {},
        "clientInfo": {"name": "engagr-backend", "version": "1.0"},
    }, timeout=10)
    if res["ok"]:
        result = res.get("result") or {}
        return {
            "ok": True,
            "url": _mcp_url(),
            "server": result.get("serverInfo", {}),
            "protocol_version": result.get("protocolVersion"),
        }
    return {"ok": False, "url": _mcp_url(), "error": res.get("error")}


def list_tools() -> dict:
    """List the tools the Playwright MCP server exposes."""
    res = _rpc("tools/list", {}, timeout=15)
    if not res["ok"]:
        return {"ok": False, "error": res.get("error")}
    tools = (res.get("result") or {}).get("tools", [])
    return {"ok": True, "tools": tools, "count": len(tools)}


def call_tool(name: str, arguments: dict | None = None, *, timeout: int = 60) -> dict:
    """Invoke an MCP tool by name. e.g. call_tool('browser_navigate', {'url': ...})."""
    res = _rpc("tools/call", {"name": name, "arguments": arguments or {}}, timeout=timeout)
    if not res["ok"]:
        return {"ok": False, "error": res.get("error")}
    return {"ok": True, "result": res.get("result")}


# ── Higher-level helpers ─────────────────────────────────────────────────────

def verify_selector_on_page(url: str, selector: str, *, timeout: int = 45) -> dict:
    """Navigate to a real post URL in the user's browser and test whether a
    proposed CSS selector matches at least one element.

    Returns:
        { ok, matched: int, snapshot_excerpt, error }
    This is the "self-healing verification" step — a proposed selector from
    selector_healer is validated against the live DOM before it ships.
    """
    # 1. Navigate
    nav = call_tool("browser_navigate", {"url": url}, timeout=timeout)
    if not nav["ok"]:
        return {"ok": False, "step": "navigate", "error": nav.get("error")}

    # 2. Evaluate the selector in the page
    js = (
        "(function(){try{var s=" + json.dumps(selector) + ";"
        "var nodes=document.querySelectorAll(s);"
        "var first=nodes[0];return JSON.stringify({matched:nodes.length,"
        "tag:first?first.tagName.toLowerCase():'',"
        "text:first?(first.innerText||'').slice(0,160):''});}catch(e){"
        "return JSON.stringify({matched:0,error:String(e)});}})()"
    )
    ev = call_tool("browser_evaluate", {"script": js}, timeout=20)
    if not ev["ok"]:
        return {"ok": False, "step": "evaluate", "error": ev.get("error")}

    # The result is wrapped in MCP content blobs
    content = (ev.get("result") or {}).get("content") or []
    raw_text = ""
    for c in content:
        if isinstance(c, dict) and c.get("type") == "text":
            raw_text += c.get("text", "")
    try:
        parsed = json.loads(raw_text)
    except Exception:
        parsed = {"matched": 0, "raw": raw_text[:300]}
    return {"ok": True, **parsed}


def status() -> dict:
    """Combined status used by the Mini App Settings → MCP panel."""
    h = health_check()
    out = {
        "configured_url": _mcp_url(),
        "configured": bool(os.getenv("BROWSER_MCP_URL")),
        "tunnel_ok": h["ok"],
    }
    if h["ok"]:
        out["server"] = h.get("server")
    else:
        out["error"] = h.get("error")
    return out


# ── Agent-facing e2e runner (Task 3) ─────────────────────────────────────────
#
# Runs the tests/e2e Playwright scenarios through the user's Playwright MCP
# tunnel (i.e. on the user's real remote PC browser), returning a structured
# pass/fail result + logs so an agent / the Mini App can verify the build
# without a local Playwright install.
#
# The MCP tunnel exposes browser tools (browser_navigate / browser_evaluate /
# browser_click / browser_snapshot) but NOT page.addInitScript or page.route,
# so the feed/media specs' backend-mocking can't be installed by the runner.
# Instead the Mini App self-installs an equivalent fetch mock when opened with
# ?e2e=1 (see frontend/src/main.jsx), and this runner drives the remote
# browser through the same assertions the authored specs encode.
#
# Three scenario groups mirror the three spec files:
#   - action_selectors : navigate to fixture HTML + assert the extension's
#                        key selectors resolve on the remote DOM.
#   - feed              : open the Mini App (?e2e=1) + assert the Feed
#                        lifecycle (renders, generate variants, select +
#                        approve, decline, status chips).
#   - media             : open the Mini App (?e2e=1&e2e_scenario=media) +
#                        assert the MediaPreview image renders/decodes, and
#                        the graceful fallback on a simulated 403.

_E2E_MINI_APP_URL = os.getenv("E2E_MINI_APP_URL", "").strip() or \
    os.getenv("MINI_APP_URL", "").strip()


def _e2e_eval(js: str, *, timeout: int = 30) -> dict:
    """Run a JS assertion snippet in the current remote page via browser_evaluate.
    The snippet MUST return JSON of shape {ok: bool, detail: str}.
    """
    res = call_tool("browser_evaluate", {"script": js}, timeout=timeout)
    if not res["ok"]:
        return {"ok": False, "error": res.get("error"), "raw": None}
    content = (res.get("result") or {}).get("content") or []
    raw_text = ""
    for c in content:
        if isinstance(c, dict) and c.get("type") == "text":
            raw_text += c.get("text", "")
    try:
        parsed = json.loads(raw_text)
    except Exception:
        parsed = {"ok": False, "error": "non-JSON eval result", "raw": raw_text[:300]}
    return {"ok": bool(parsed.get("ok")), "detail": parsed.get("detail") or parsed.get("error") or "",
            "raw": parsed}


# Fixture HTML as a navigable data: URL. Reading the file bytes base64-encodes
# them so the remote browser can load them without a local file server.
def _fixture_data_url(name: str) -> str:
    import base64
    p = ROOT_DIR / "tests" / "e2e" / "tests" / "fixtures" / f"{name}.html"
    b64 = base64.b64encode(p.read_bytes()).decode("ascii")
    return f"data:text/html;charset=utf-8;base64,{b64}"


# One logical assertion. `kind` selects how the runner executes it.
def _assert_action_selectors() -> list[dict]:
    """Mirror tests/e2e/tests/action-selectors.spec.js: load each fixture
    HTML in the remote browser and check the extension's key selectors resolve."""
    from pathlib import Path as _P
    global ROOT_DIR
    ROOT_DIR = _P(__file__).resolve().parent.parent
    cases = [
        ("linkedin", "linkedin-post", '[data-urn^="urn:li:activity"]', "post card"),
        ("linkedin", "linkedin-post", '.ql-editor, [contenteditable="true"]', "comment composer"),
        ("x", "x-tweet", '[data-testid="tweetText"]', "tweet text"),
        ("x", "x-tweet", '[data-testid="reply"]', "reply button"),
        ("reddit", "reddit-post", '[data-testid="upvote"], shreddit-upvote, .arrow.upvote, .upvote',
         "upvote control"),
    ]
    results = []
    for platform, fixname, selector, label in cases:
        url = _fixture_data_url(fixname)
        nav = call_tool("browser_navigate", {"url": url}, timeout=30)
        if not nav["ok"]:
            results.append({"name": f"{platform}/{label}", "ok": False,
                            "error": f"navigate: {nav.get('error')}"})
            continue
        js = (
            "(function(){try{var s=" + json.dumps(selector) + ";"
            "var n=document.querySelectorAll(s).length;return JSON.stringify({ok:n>0,"
            "detail:'found '+n+' for '+(" + json.dumps(label) + ")});}"
            "catch(e){return JSON.stringify({ok:false,detail:String(e)});}})()"
        )
        r = _e2e_eval(js)
        results.append({"name": f"{platform}/{label}", "ok": r["ok"], "detail": r["detail"]})
    return results


def _assert_feed_lifecycle(mini_app_url: str) -> list[dict]:
    """Mirror tests/e2e/tests/feed.spec.js against the Mini App self-mock (?e2e=1).
    Uses browser_navigate + browser_evaluate (+ browser_click via JS) to drive
    the same assertions the authored spec encodes."""
    results = []
    base = mini_app_url.rstrip("/") + "/?e2e=1&e2e_scenario=feed&user_id=e2e_user"

    # 1) renders feed items with platform badges + authors
    nav = call_tool("browser_navigate", {"url": base}, timeout=45)
    if not nav["ok"]:
        return [{"name": "feed.render", "ok": False, "error": f"navigate: {nav.get('error')}"}]

    # Wait for the mock to be installed + Feed heading, then assert content.
    js_render = (
        "(function(){var m=window.__ENGAGR_E2E_MOCK__;"
        "var body=document.body?document.body.innerText:'';"
        "var ok=m&&body.indexOf('Jane Doe')>=0&&body.indexOf('@devnews')>=0;"
        "return JSON.stringify({ok:ok,detail:ok?'feed items rendered':"
        "'mock='+(!!m)+' body_has_authors='+(body.indexOf('Jane Doe')>=0)});})()"
    )
    r = _e2e_eval(js_render, timeout=30)
    results.append({"name": "feed.render", "ok": r["ok"], "detail": r["detail"]})

    # 2) generate variants for the new_post item — click the generate button
    #    via JS (MCP browser_click needs a ref; JS click is faithful to intent).
    js_gen = (
        "(function(){var btns=[...document.querySelectorAll('button')];"
        "var g=btns.find(b=>/generate reply variants/i.test(b.textContent||''));"
        "if(!g)return JSON.stringify({ok:false,detail:'generate button not found'});"
        "g.click();return JSON.stringify({ok:true,detail:'clicked generate'});})()"
    )
    rg = _e2e_eval(js_gen, timeout=20)
    # Allow the mock regenerate round-trip, then check a variant appeared.
    js_gen_check = (
        "(function(){var t=document.body.innerText;"
        "var ok=/Regenerated take 1/i.test(t);"
        "return JSON.stringify({ok:ok,detail:ok?'variants generated':'no variants text'});})()"
    )
    rgc = _e2e_eval(js_gen_check, timeout=30)
    results.append({"name": "feed.generate_variants", "ok": rgc["ok"],
                    "detail": rg["detail"] + " | " + rgc["detail"]})

    # 3) select variant 2 + approve → status approved
    js_sel = (
        "(function(){var rows=[...document.querySelectorAll('.queue-card-variant')];"
        "var r=rows.find(x=>/Variant 2/i.test(x.textContent||''));"
        "if(!r)return JSON.stringify({ok:false,detail:'variant 2 row not found'});"
        "var s=[...r.querySelectorAll('button')].find(b=>/^select$/i.test(b.textContent||''));"
        "if(!s)return JSON.stringify({ok:false,detail:'select button not found'});"
        "s.click();return JSON.stringify({ok:true,detail:'selected variant 2'});})()"
    )
    rs = _e2e_eval(js_sel, timeout=20)
    js_appr = (
        "(function(){var b=document.querySelector('button.queue-btn-primary');"
        "if(!b)return JSON.stringify({ok:false,detail:'approve button not found'});"
        "b.click();return JSON.stringify({ok:true,detail:'clicked approve'});})()"
    )
    ra = _e2e_eval(js_appr, timeout=20)
    js_appr_check = (
        "(function(){var t=document.body.innerText;var ok=/approved/i.test(t);"
        "return JSON.stringify({ok:ok,detail:ok?'status approved':'no approved text'});})()"
    )
    rac = _e2e_eval(js_appr_check, timeout=30)
    results.append({"name": "feed.select_and_approve", "ok": rac["ok"],
                    "detail": rs["detail"] + " | " + ra["detail"] + " | " + rac["detail"]})

    # 4) decline updates the badge — re-open fresh so the queue is unmutated
    nav2 = call_tool("browser_navigate", {"url": base}, timeout=45)
    if nav2["ok"]:
        js_dec = (
            "(function(){var b=[...document.querySelectorAll('button')].find(x=>/decline/i.test(x.textContent||''));"
            "if(!b)return JSON.stringify({ok:false,detail:'decline button not found'});"
            "b.click();return JSON.stringify({ok:true,detail:'clicked decline'});})()"
        )
        rd = _e2e_eval(js_dec, timeout=20)
        js_dec_check = (
            "(function(){var t=document.body.innerText;var ok=/declined/i.test(t);"
            "return JSON.stringify({ok:ok,detail:ok?'status declined':'no declined text'});})()"
        )
        rdc = _e2e_eval(js_dec_check, timeout=30)
        results.append({"name": "feed.decline", "ok": rdc["ok"], "detail": rd["detail"] + " | " + rdc["detail"]})
    else:
        results.append({"name": "feed.decline", "ok": False, "error": f"navigate: {nav2.get('error')}"})

    # 5) status chips reflect counts
    js_chips = (
        "(function(){var b=[...document.querySelectorAll('button')];"
        "var all=b.find(x=>/All \\(\\d+\\)/.test(x.textContent||''));"
        "var pend=b.find(x=>/Pending review/i.test(x.textContent||''));"
        "var ok=!!all&&!!pend;return JSON.stringify({ok:ok,detail:ok?'chips present':"
        "'all='+(!!all)+' pending='+(!!pend)});})()"
    )
    rch = _e2e_eval(js_chips, timeout=20)
    results.append({"name": "feed.status_chips", "ok": rch["ok"], "detail": rch["detail"]})
    return results


def _assert_media(mini_app_url: str) -> list[dict]:
    """Mirror tests/e2e/tests/media.spec.js: media image renders + decodes,
    and graceful fallback on a simulated 403."""
    results = []
    base = mini_app_url.rstrip("/") + "/?e2e=1&e2e_scenario=media&user_id=e2e_user"
    nav = call_tool("browser_navigate", {"url": base}, timeout=45)
    if not nav["ok"]:
        return [{"name": "media.render", "ok": False, "error": f"navigate: {nav.get('error')}"}]
    js_img = (
        "(function(){var i=document.querySelector('img[alt=\"post media\"]');"
        "if(!i)return JSON.stringify({ok:false,detail:'media img not found'});"
        "var srcOk=/\\/api\\/media\\/proxy/.test(i.getAttribute('src')||'')&&/url=/.test(i.getAttribute('src')||'');"
        "var dec=i.complete&&i.naturalWidth>0;"
        "return JSON.stringify({ok:srcOk&&dec,detail:'visible src_ok='+srcOk+' decoded='+dec});})()"
    )
    r = _e2e_eval(js_img, timeout=30)
    results.append({"name": "media.render_and_decode", "ok": r["ok"], "detail": r["detail"]})

    # fallback on 403
    base_fail = mini_app_url.rstrip("/") + "/?e2e=1&e2e_scenario=media-fail&user_id=e2e_user"
    nav2 = call_tool("browser_navigate", {"url": base_fail}, timeout=45)
    if not nav2["ok"]:
        results.append({"name": "media.fallback_403", "ok": False, "error": f"navigate: {nav2.get('error')}"})
        return results
    js_fb = (
        "(function(){var f=document.querySelector('.media-fallback');"
        "if(!f)return JSON.stringify({ok:false,detail:'fallback not found'});"
        "var ok=/Media unavailable/i.test(f.textContent||'');"
        "var retry=!!f.querySelector('button');"
        "return JSON.stringify({ok:ok&&retry,detail:'fallback='+ok+' retry='+retry});})()"
    )
    rf = _e2e_eval(js_fb, timeout=30)
    results.append({"name": "media.fallback_403", "ok": rf["ok"], "detail": rf["detail"]})
    return results


def run_e2e(scenarios: list[str] | None = None, mini_app_url: str | None = None) -> dict:
    """Agent-facing e2e runner. Drives the existing tests/e2e scenarios through
    the user's Playwright MCP tunnel on the remote PC browser and returns
    structured pass/fail per test + logs.

    Args:
        scenarios: subset of ['action_selectors','feed','media']; None = all.
        mini_app_url: Mini App base URL for the feed/media scenarios. Falls back
                      to E2E_MINI_APP_URL / MINI_APP_URL env. Required for
                      feed/media (the runner navigates the remote browser there).

    Returns:
        {
          "ok": bool,            # all selected tests passed
          "tunnel_ok": bool,
          "ran": int, "passed": int, "failed": int,
          "results": [ {name, ok, detail|error}, ... ],
          "logs": [str, ...],
        }
    """
    logs: list[str] = []
    # 1. Tunnel must be up — the whole point is to run on the remote PC.
    h = health_check()
    if not h["ok"]:
        return {"ok": False, "tunnel_ok": False, "ran": 0, "passed": 0, "failed": 0,
                "results": [], "logs": ["MCP tunnel down — cannot run e2e remotely: " + str(h.get("error"))]}

    chosen = scenarios or ["action_selectors", "feed", "media"]
    url = (mini_app_url or _E2E_MINI_APP_URL).strip()
    logs.append(f"tunnel ok; server={h.get('server', {}).get('name', '?')}")
    logs.append(f"scenarios={chosen} mini_app_url={'<set>' if url else '<missing>'}")

    results: list[dict] = []
    if "action_selectors" in chosen:
        logs.append("running action_selectors (fixture HTML on remote DOM)")
        results.extend(_assert_action_selectors())

    if "feed" in chosen:
        if not url:
            logs.append("feed: skipped — MINI_APP_URL not configured")
            results.append({"name": "feed", "ok": False, "error": "MINI_APP_URL not configured"})
        else:
            logs.append("running feed lifecycle (?e2e=1 self-mock)")
            results.extend(_assert_feed_lifecycle(url))

    if "media" in chosen:
        if not url:
            logs.append("media: skipped — MINI_APP_URL not configured")
            results.append({"name": "media", "ok": False, "error": "MINI_APP_URL not configured"})
        else:
            logs.append("running media preview (?e2e=1&e2e_scenario=media)")
            results.extend(_assert_media(url))

    passed = sum(1 for r in results if r.get("ok"))
    failed = len(results) - passed
    return {
        "ok": failed == 0 and len(results) > 0,
        "tunnel_ok": True,
        "ran": len(results),
        "passed": passed,
        "failed": failed,
        "results": results,
        "logs": logs,
    }
