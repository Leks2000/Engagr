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
