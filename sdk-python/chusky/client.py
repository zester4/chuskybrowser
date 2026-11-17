"""chuskybrowser Python client. One instance per end user. Standard library only.

    from chusky import ChuskyClient

    browser = ChuskyClient(user_id=user_id_from_your_session)   # never from user-typed text
    tab = browser.open_tab(url="https://example.com", session_key="task-1")
    page = browser.snapshot(tab["tabId"])
    browser.close_tab(tab["tabId"])

Set CHUSKYBROWSER_API_KEY in the environment or in a .env file in the working folder.
Optional: CHUSKYBROWSER_BASE_URL (defaults to the hosted gateway).
The key is never printed, and error messages do not include it.
"""

import json
import os
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_GATEWAY_URL = "https://chuskybrowser-production.up.railway.app/v1"


class ChuskyError(Exception):
    """An API call failed. Carries status, code (for example 'human_in_control') and the body."""

    def __init__(self, message, status=None, code=None, body=None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.body = body


def _load_dotenv(path=".env"):
    values = {}
    if not os.path.exists(path):
        return values
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            values[key.strip()] = value.strip().strip("'\"")
    return values


_ENV = {**_load_dotenv(), **os.environ}


class ChuskyClient:
    def __init__(self, user_id, api_key=None, base_url=None, timeout=120):
        key = api_key or _ENV.get("CHUSKYBROWSER_API_KEY", "").strip()
        if not key:
            raise ChuskyError("CHUSKYBROWSER_API_KEY is not set. Put it in .env or your environment.")
        if not isinstance(user_id, str) or not user_id.strip():
            raise ChuskyError("user_id is required. Pass the end user's ID from your authenticated session.")
        self._key = key
        self._base = (base_url or _ENV.get("CHUSKYBROWSER_BASE_URL") or DEFAULT_GATEWAY_URL).rstrip("/")
        self._timeout = timeout
        self.user_id = user_id.strip()

    # ----- transport -----

    def _call(self, method, path, query=None, body=None, raw=False):
        url = self._base + path
        if method in ("GET", "DELETE"):
            params = {"userId": self.user_id, **(query or {})}
            params = {k: v for k, v in params.items() if v is not None}
            url += "?" + urllib.parse.urlencode(params)
            data = None
        else:
            payload = {"userId": self.user_id, **(body or {})}
            data = json.dumps({k: v for k, v in payload.items() if v is not None}).encode("utf-8")
        headers = {"Authorization": f"Bearer {self._key}"}
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(url, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=self._timeout) as res:
                payload = res.read()
                if raw:
                    return payload
                return json.loads(payload) if payload else None
        except urllib.error.HTTPError as err:
            text = err.read().decode("utf-8", errors="replace")
            try:
                body_json = json.loads(text)
            except ValueError:
                body_json = {"raw": text[:200]}
            code = body_json.get("code") or body_json.get("error")
            raise ChuskyError(
                f"Chusky {method} {path} failed (HTTP {err.code})" + (f": {code}" if code else ""),
                status=err.code, code=code, body=body_json,
            ) from None

    # ----- tabs -----

    def open_tab(self, url=None, session_key=None, trace=False):
        if not session_key:
            raise ChuskyError("session_key is required (groups the tabs of one task).")
        return self._call("POST", "/tabs", body={"sessionKey": session_key, "url": url, "trace": trace or None})

    def navigate(self, tab_id, url=None, macro=None, query=None, session_key=None):
        return self._call("POST", f"/tabs/{_enc(tab_id)}/navigate",
                          body={"url": url, "macro": macro, "query": query, "sessionKey": session_key})

    def state(self, tab_id):
        return self._call("GET", f"/tabs/{_enc(tab_id)}/state")

    def snapshot(self, tab_id, offset=None):
        return self._call("GET", f"/tabs/{_enc(tab_id)}/snapshot", query={"offset": offset})

    def screenshot(self, tab_id):
        """Returns the PNG as bytes."""
        return self._call("GET", f"/tabs/{_enc(tab_id)}/screenshot", raw=True)

    def click(self, tab_id, ref=None, selector=None):
        return self._call("POST", f"/tabs/{_enc(tab_id)}/click", body={"ref": ref, "selector": selector})

    def type(self, tab_id, text, ref=None, selector=None, press_enter=False):
        return self._call("POST", f"/tabs/{_enc(tab_id)}/type",
                          body={"text": text, "ref": ref, "selector": selector, "pressEnter": press_enter})

    def press(self, tab_id, key):
        return self._call("POST", f"/tabs/{_enc(tab_id)}/press", body={"key": key})

    def scroll(self, tab_id, direction="down", amount=None):
        return self._call("POST", f"/tabs/{_enc(tab_id)}/scroll", body={"direction": direction, "amount": amount})

    def close_tab(self, tab_id):
        return self._call("DELETE", f"/tabs/{_enc(tab_id)}")

    def end_session(self):
        """Close every tab for this user."""
        return self._call("DELETE", f"/sessions/{_enc(self.user_id)}")

    # ----- handoff to a person -----

    def start_handoff(self, tab_id, reason, idle_ms=None):
        if not reason:
            raise ChuskyError("reason is required so the person knows what to do.")
        return self._call("POST", f"/tabs/{_enc(tab_id)}/handoff", body={"reason": reason, "idleMs": idle_ms})

    def release(self, tab_id):
        return self._call("POST", f"/tabs/{_enc(tab_id)}/handoff/release")

    def viewer_link(self, tab_id, control=False, ttl_seconds=3600):
        """A live view link for this user only. Returns the URL string."""
        out = self._call("POST", "/live-viewer/links",
                         body={"tabId": tab_id, "control": control, "ttlSeconds": ttl_seconds})
        return out.get("url")


def _enc(value):
    return urllib.parse.quote(str(value), safe="")
